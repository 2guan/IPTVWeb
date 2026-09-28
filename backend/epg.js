import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import db, { run, query, queryOne } from './db.js';
import { BEIJING_NOW_SQL } from './time.js';
import { collectMiguEpgProgrammes } from './migu.js';

// Helper to escape XML special characters
function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Helper to extract text from XML nodes parsed with fast-xml-parser
function getXmlText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    return getXmlText(node[0]);
  }
  if (typeof node === 'object') {
    return node['#text'] || '';
  }
  return String(node);
}

// Global active sync status
export const epgSyncStatus = {
  running: false,
  message: ''
};

/**
 * Fetch and decompress EPG XML
 */
async function fetchEpgXml(url, userAgent = 'IPTV-Admin') {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent }
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  const isGzip = url.split('?')[0].endsWith('.gz') || 
                 response.headers.get('content-type') === 'application/x-gzip' ||
                 response.headers.get('content-type') === 'application/gzip';

  const buffer = await response.arrayBuffer();
  let xmlText = '';

  if (isGzip) {
    const decompressed = zlib.gunzipSync(Buffer.from(buffer));
    xmlText = decompressed.toString('utf-8');
  } else {
    xmlText = Buffer.from(buffer).toString('utf-8');
  }

  return xmlText;
}

/**
 * Normalizes channel names for matching (removes symbols, lowercases)
 */
function normalizeName(name) {
  if (!name) return '';
  return name.toString().toLowerCase().replace(/[-_\s📺📡☘️]/g, '').replace(/cctv-(\d+)/g, 'cctv$1');
}

/**
 * Pull and merge EPG sources
 */
export async function syncEpg() {
  if (epgSyncStatus.running) {
    throw new Error('EPG synchronization is already running');
  }

  epgSyncStatus.running = true;
  epgSyncStatus.message = '正在拉取 EPG 源...';

  try {
    const epgSources = query('SELECT * FROM epg_sources');

    // Get aliases from settings
    const aliasSetting = queryOne("SELECT value FROM settings WHERE key = 'alias'");
    const aliasLines = (aliasSetting?.value || '').split('\n').filter(l => l.includes(','));
    const aliasMap = new Map();
    for (const line of aliasLines) {
      const [chName, aliasesStr] = line.split(',');
      if (chName && aliasesStr) {
        const aliases = aliasesStr.split('|').map(a => normalizeName(a.trim()));
        aliasMap.set(normalizeName(chName.trim()), aliases);
      }
    }

    // Get all distinct channel names in our database
    const localChannels = query('SELECT DISTINCT name FROM sources').map(s => s.name);
    const localChannelsNormalized = localChannels.map(name => ({
      original: name,
      normalized: normalizeName(name),
      aliases: aliasMap.get(normalizeName(name)) || []
    }));

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      processEntities: {
        maxEntityCount: 999999,
        maxTotalExpansions: 999999
      }
    });

    const mergedChannels = new Map(); // normalized_name -> { id, displayNames }
    const mergedProgrammes = []; // list of program XML segments or objects
    const miguCoveredChannels = new Set();

    for (const source of epgSources) {
      console.log(`Syncing EPG source: ${source.name} (${source.url})`);
      run("UPDATE epg_sources SET status = 'fetching', error_message = NULL WHERE id = ?", source.id);

      try {
        if (source.source_type === 'migu') {
          epgSyncStatus.message = '正在拉取咪咕 EPG (跨天2日)...';
          const miguEpg = await collectMiguEpgProgrammes({ days: 2 });
          for (const channel of miguEpg.channels) {
            if (!mergedChannels.has(channel.id)) {
              mergedChannels.set(channel.id, { id: channel.id, displayNames: [channel.name] });
            }
            miguCoveredChannels.add(channel.id);
          }
          mergedProgrammes.push(...miguEpg.programmes);
          run(`UPDATE epg_sources SET status = 'success', last_fetched_at = ${BEIJING_NOW_SQL} WHERE id = ?`, source.id);
          console.log(`Migu EPG collected. Channels: ${miguEpg.channels.length}, programmes: ${miguEpg.programmes.length}`);
          continue;
        }

        const xmlText = await fetchEpgXml(source.url);
        const parsed = parser.parse(xmlText);
        
        if (!parsed.tv) {
          throw new Error('Invalid XMLTV format: missing <tv> root');
        }

        // 1. Map EPG channels to local channels
        const epgChannels = Array.isArray(parsed.tv.channel) ? parsed.tv.channel : [parsed.tv.channel].filter(Boolean);
        const epgChannelMap = new Map(); // epg_channel_id -> local_channel_original_name

        for (const ec of epgChannels) {
          const id = ec['@_id'];
          const displayNames = Array.isArray(ec['display-name']) 
            ? ec['display-name'] 
            : [ec['display-name']].filter(Boolean);

          // Try to match one of the display names with our local channels
          let matchedName = null;
          for (const dn of displayNames) {
            const dnText = getXmlText(dn);
            const dnNorm = normalizeName(dnText);
            const match = localChannelsNormalized.find(lc => 
              lc.normalized === dnNorm || lc.aliases.includes(dnNorm)
            );
            if (match) {
              matchedName = match.original;
              break;
            }
          }

          if (matchedName) {
            epgChannelMap.set(id, matchedName);
            if (!mergedChannels.has(matchedName)) {
              mergedChannels.set(matchedName, { id: matchedName, displayNames: [matchedName] });
            }
          }
        }

        // 2. Filter programs
        const epgProgrammes = Array.isArray(parsed.tv.programme) ? parsed.tv.programme : [parsed.tv.programme].filter(Boolean);
        for (const ep of epgProgrammes) {
          const chId = ep['@_channel'];
          const localChName = epgChannelMap.get(chId);
          if (localChName && !miguCoveredChannels.has(localChName)) {
            // Keep program
            const title = getXmlText(ep.title);
            const desc = getXmlText(ep.desc);
            
            mergedProgrammes.push({
              channel: localChName,
              start: ep['@_start'],
              stop: ep['@_stop'],
              title: title || '未知节目',
              desc: desc || ''
            });
          }
        }

        run(`UPDATE epg_sources SET status = 'success', last_fetched_at = ${BEIJING_NOW_SQL} WHERE id = ?`, source.id);
      } catch (err) {
        console.error(`EPG source ${source.name} failed:`, err.message);
        run("UPDATE epg_sources SET status = 'failed', error_message = ? WHERE id = ?", err.message, source.id);
      }
    }

    // 3. Write merged XML with deduplication
    epgSyncStatus.message = '正在写入并压缩合并后的 EPG 数据...';
    let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xmlContent += '<!DOCTYPE tv SYSTEM "xmltv.dtd">\n';
    xmlContent += `<tv generator-info-name="IPTV Admin" generator-info-url="http://localhost:4010">\n`;

    // Write channels
    for (const [name, chObj] of mergedChannels) {
      xmlContent += `  <channel id="${escapeXml(chObj.id)}">\n`;
      xmlContent += `    <display-name>${escapeXml(name)}</display-name>\n`;
      xmlContent += `  </channel>\n`;
    }

    // Deduplicate programmes across multiple sources / cross-midnight overlap
    const seenProgrammes = new Set();
    for (const p of mergedProgrammes) {
      const key = `${p.channel}|${p.start}`;
      if (seenProgrammes.has(key)) continue;
      seenProgrammes.add(key);

      xmlContent += `  <programme start="${escapeXml(p.start)}" stop="${escapeXml(p.stop)}" channel="${escapeXml(p.channel)}">\n`;
      xmlContent += `    <title lang="zh">${escapeXml(p.title)}</title>\n`;
      if (p.desc) {
        xmlContent += `    <desc lang="zh">${escapeXml(p.desc)}</desc>\n`;
      }
      xmlContent += `  </programme>\n`;
    }
    xmlContent += '</tv>\n';

    // Ensure output directories exist
    const publicDir = './public';
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const xmlPath = path.join(publicDir, 'epg.xml');
    const gzPath = path.join(publicDir, 'epg.xml.gz');

    fs.writeFileSync(xmlPath, xmlContent);
    const gzBuffer = zlib.gzipSync(Buffer.from(xmlContent));
    fs.writeFileSync(gzPath, gzBuffer);

    console.log(`EPG merged successfully. Generated epg.xml (${(xmlContent.length/1024/1024).toFixed(2)} MB) and epg.xml.gz`);
    epgSyncStatus.message = 'EPG 同步成功！';

  } catch (error) {
    console.error('EPG sync error:', error);
    epgSyncStatus.message = 'EPG 同步失败: ' + error.message;
  } finally {
    epgSyncStatus.running = false;
  }
}
