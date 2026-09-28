import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { run, queryOne } from './db.js';
import { buildStreamHeaders } from './playlist.js';
import { requestYangshipinUrl, YANGSHIPIN_CHANNELS } from './extractors/yangshipin.js';

// Cache segment mapping: segKey -> { url, headers, expires }
const segmentCache = new Map();
const MAX_CACHE_ITEMS = 5000;
const SEGMENT_TTL_MS = 90_000; // 90 seconds (segments rotate quickly)

function cleanExpiredSegments(now = Date.now()) {
  for (const [key, item] of segmentCache) {
    if (now > item.expires) {
      segmentCache.delete(key);
    }
  }
  if (segmentCache.size > MAX_CACHE_ITEMS) {
    segmentCache.clear();
  }
}

function generateSegKey(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  return `seg_${hash}`;
}

/**
 * Handle M3U8 Playlist Request in Full Proxy Mode
 * Rewrites all segment addresses to same-origin relative URLs
 */
export async function handleHlsProxyIndex(req, res) {
  const { sourceId } = req.params;
  const source = queryOne('SELECT * FROM sources WHERE id = ?', sourceId);
  if (!source) {
    return res.status(404).json({ error: '直播源不存在' });
  }

  let requestedUrl = req.query.url ? decodeURIComponent(req.query.url) : source.url;
  const headers = buildStreamHeaders({}, source);

  try {
    let upstreamRes = await fetch(requestedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        ...headers,
        'Accept': '*/*'
      }
    });

    if (!upstreamRes.ok && (source.channel_id || '').startsWith('ysp-') && !req.query.url) {
      const yspId = source.channel_id.replace(/^ysp-/, '');
      const ch = YANGSHIPIN_CHANNELS.find(c => c.id === yspId);
      if (ch) {
        try {
          const freshUrl = await requestYangshipinUrl(ch);
          if (freshUrl) {
            requestedUrl = freshUrl;
            run('UPDATE sources SET url = ? WHERE id = ?', freshUrl, source.id);
            upstreamRes = await fetch(requestedUrl, {
              signal: AbortSignal.timeout(10000),
              headers: {
                ...headers,
                'Accept': '*/*'
              }
            });
          }
        } catch (refreshErr) {
          console.warn('[HlsProxy] Refresh YSP error:', refreshErr.message);
        }
      }
    }

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream HTTP ${upstreamRes.status}`);
    }

    const playlistText = await upstreamRes.text();
    const finalUrl = upstreamRes.url || requestedUrl;
    const now = Date.now();
    cleanExpiredSegments(now);

    const lines = playlistText.split(/\r?\n/);
    const rewrittenLines = [];
    let isVariantNext = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        rewrittenLines.push('');
        continue;
      }

      if (line.startsWith('#EXT-X-STREAM-INF')) {
        rewrittenLines.push(rawLine);
        isVariantNext = true;
        continue;
      }

      if (line.startsWith('#')) {
        rewrittenLines.push(rawLine);
        continue;
      }

      // Handle child variant playlist
      if (isVariantNext) {
        isVariantNext = false;
        const absoluteVariantUrl = new URL(line, finalUrl).toString();
        rewrittenLines.push(`/stream/proxy/${sourceId}/index.m3u8?url=${encodeURIComponent(absoluteVariantUrl)}`);
        continue;
      }

      // Handle media segment
      const absoluteSegmentUrl = new URL(line, finalUrl).toString();
      const segKey = generateSegKey(absoluteSegmentUrl);

      segmentCache.set(segKey, {
        url: absoluteSegmentUrl,
        headers,
        expires: now + SEGMENT_TTL_MS
      });

      // Relative path to keep 100% same-origin
      rewrittenLines.push(`/stream/proxy/${sourceId}/segment/${segKey}`);
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewrittenLines.join('\n'));

  } catch (err) {
    console.error(`[HlsProxy] Error fetching playlist for source ${sourceId}:`, err.message);
    res.status(502).send('Error proxying HLS playlist');
  }
}

/**
 * Handle Media Segment Request in Full Proxy Mode
 * Streams segment from upstream directly without disk writes
 */
export async function handleHlsProxySegment(req, res) {
  const { sourceId, segKey } = req.params;
  const segInfo = segmentCache.get(segKey);

  if (!segInfo) {
    return res.status(404).send('Segment expired or not found');
  }

  // Extend TTL while actively streaming
  segInfo.expires = Date.now() + SEGMENT_TTL_MS;

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const upstreamRes = await fetch(segInfo.url, {
      headers: {
        ...segInfo.headers,
        'Accept': '*/*'
      },
      signal: controller.signal
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      return res.status(upstreamRes.status).send(`Upstream HTTP ${upstreamRes.status}`);
    }

    const contentType = upstreamRes.headers.get('content-type') || 'video/mp2t';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Access-Control-Allow-Origin', '*');

    Readable.fromWeb(upstreamRes.body).pipe(res);

  } catch (err) {
    if (!controller.signal.aborted) {
      console.warn(`[HlsProxy] Segment fetch failed (${sourceId}/${segKey}):`, err.message);
      if (!res.headersSent) {
        res.status(502).send('Failed to fetch segment from upstream');
      }
    }
  }
}

export default {
  handleHlsProxyIndex,
  handleHlsProxySegment
};
