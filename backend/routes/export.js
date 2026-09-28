import express from 'express';
import fs from 'fs';
import path from 'path';
import { query, queryOne } from '../db.js';
import { formatExtinfCatchupAttributes, parseJsonObject } from '../playlist.js';
import { ensureChannelId } from '../channelIdentity.js';
import { resolveLibraryLogo, DEFAULT_LOGO_BASE_URL } from '../logoLibrary.js';
import { matchBlockRule, matchGroupWildcard } from '../hiddenRules.js';
import { getAnnouncementM3uItem, getAnnouncementTxtItem } from '../announcement.js';

const router = express.Router();

// Helper to escape special characters for M3U format
function escapeM3uAttr(val) {
  if (!val) return '';
  return val.replace(/"/g, '\\"');
}

const DEFAULT_M3U_HTTP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PROVINCE_CATEGORY_ORDER = [
  '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北',
  '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃',
  '青海', '内蒙古', '广西', '西藏', '宁夏', '新疆'
];

function normalizeCategoryLabel(category = '') {
  return String(category || '')
    .trim()
    .replace(/^[*＊•·\s_【[(（-]+|[*＊•·\s_】\])）-]+$/g, '')
    .replace(/(频道|电视台|电视|直播源|分组|源)$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function categoryMatchesAny(text, words) {
  return words.some(word => text.includes(word.toLowerCase()));
}

function getExportCategorySortInfo(category = '') {
  const raw = String(category || '').trim();
  const normalized = normalizeCategoryLabel(raw);
  const text = `${normalized} ${raw.toLowerCase()}`;

  if (categoryMatchesAny(text, ['央视', '中央台', 'cctv', 'cntv'])) {
    return { groupRank: 0, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['卫视', '地方卫视', '各省卫视'])) {
    return { groupRank: 1, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['4k', '8k', '超高清', '超清', 'uhd', '2160p'])) {
    return { groupRank: 2, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['北京', 'bj', 'beijing'])) {
    return { groupRank: 3, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['港澳台', '港台', '香港', '澳门', '台湾', 'hk', 'hongkong', 'macau', 'taiwan', 'tw'])) {
    return { groupRank: 4, provinceRank: -1, normalized };
  }
  if (normalized === 'us' || categoryMatchesAny(text, ['美国', '美洲', 'usa', 'unitedstates', 'united states'])) {
    return { groupRank: 5, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['日本', 'jp', 'japan'])) {
    return { groupRank: 6, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['韩国', 'kr', 'korea'])) {
    return { groupRank: 7, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['国际', '海外', '境外', 'world', 'global', 'international', 'foreign'])) {
    return { groupRank: 8, provinceRank: -1, normalized };
  }

  const provinceRank = PROVINCE_CATEGORY_ORDER.findIndex(name => text.includes(name.toLowerCase()));
  if (provinceRank !== -1) {
    return { groupRank: 9, provinceRank, normalized };
  }

  if (categoryMatchesAny(text, ['景区', '风景', '旅游'])) {
    return { groupRank: 10, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['直播', 'live'])) {
    return { groupRank: 11, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['电影', '影院', '影视', 'movie', 'film'])) {
    return { groupRank: 12, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['广播', '电台', 'radio'])) {
    return { groupRank: 13, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['音乐', 'music', 'mv', 'mtv'])) {
    return { groupRank: 14, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['游戏', '电竞', 'game'])) {
    return { groupRank: 15, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['其它', '其他', '未分类', 'misc'])) {
    return { groupRank: 16, provinceRank: -1, normalized };
  }

  return { groupRank: 17, provinceRank: -1, normalized };
}

function compareExportCategories(a = '', b = '') {
  const aInfo = getExportCategorySortInfo(a);
  const bInfo = getExportCategorySortInfo(b);

  if (aInfo.groupRank !== bInfo.groupRank) {
    return aInfo.groupRank - bInfo.groupRank;
  }
  if (aInfo.provinceRank !== bInfo.provinceRank) {
    return aInfo.provinceRank - bInfo.provinceRank;
  }

  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN');
}

function getStatusSortRank(status = '') {
  if (status === 'active') return 0;
  if (status === 'testing') return 1;
  if (status === 'unknown' || !status) return 2;
  return 3;
}

function normalizeDelayForSort(delay) {
  const parsed = Number(delay);
  return parsed > 0 ? parsed : Number.MAX_SAFE_INTEGER;
}

function getCctvNameSortInfo(name = '') {
  const raw = String(name || '').trim();
  const normalized = raw
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
  const cctvNumberMatch = normalized.match(/^CCTV-?0?(\d{1,2})(?:$|[^A-Z0-9+])/);

  if (cctvNumberMatch) {
    const channelNumber = Number(cctvNumberMatch[1]);
    if (channelNumber >= 1 && channelNumber <= 17) {
      return { rank: 0, channelNumber, name: raw };
    }
  }

  if (/^CCTV/i.test(raw)) {
    return { rank: 1, channelNumber: Number.MAX_SAFE_INTEGER, name: raw };
  }

  if (/^CGTN/i.test(raw)) {
    return { rank: 2, channelNumber: Number.MAX_SAFE_INTEGER, name: raw };
  }

  if (/^[\u3400-\u9fff·（）()《》、，。—\-_\s]+$/.test(raw) && /[\u3400-\u9fff]/.test(raw)) {
    return { rank: 3, channelNumber: Number.MAX_SAFE_INTEGER, name: raw };
  }

  return { rank: 4, channelNumber: Number.MAX_SAFE_INTEGER, name: raw };
}

function compareCctvNamesForExport(a = '', b = '') {
  const aInfo = getCctvNameSortInfo(a);
  const bInfo = getCctvNameSortInfo(b);

  if (aInfo.rank !== bInfo.rank) {
    return aInfo.rank - bInfo.rank;
  }
  if (aInfo.channelNumber !== bInfo.channelNumber) {
    return aInfo.channelNumber - bInfo.channelNumber;
  }

  return aInfo.name.localeCompare(bInfo.name, 'zh-Hans-CN', { numeric: true });
}

function compareSourceQualityForExport(a, b) {
  const aIsMigu = String(a.origin || '').toLowerCase() === 'migu';
  const bIsMigu = String(b.origin || '').toLowerCase() === 'migu';
  if (aIsMigu !== bIsMigu) return aIsMigu ? -1 : 1;

  const statusCompare = getStatusSortRank(a.status) - getStatusSortRank(b.status);
  if (statusCompare !== 0) return statusCompare;

  const speedCompare = Number(b.speed || 0) - Number(a.speed || 0);
  if (speedCompare !== 0) return speedCompare;

  return normalizeDelayForSort(a.delay) - normalizeDelayForSort(b.delay);
}

function compareSourcesForExport(a, b) {
  const categoryCompare = compareExportCategories(a.category, b.category);
  if (categoryCompare !== 0) return categoryCompare;

  const categoryInfo = getExportCategorySortInfo(a.category);
  const nameCompare = categoryInfo.groupRank === 0
    ? compareCctvNamesForExport(a.name, b.name)
    : String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  if (nameCompare !== 0) return nameCompare;

  return compareSourceQualityForExport(a, b);
}

function normalizeChannelKey(src) {
  return String(src?.name || '').toLowerCase().trim();
}

function chooseExportChannelId(groupItems = []) {
  const ids = groupItems
    .map(item => ensureChannelId(item))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return ids[0] || '';
}

function buildExportChannel(groupItems, logoRepo, req = null) {
  groupItems.sort(compareSourceQualityForExport);
  const primary = groupItems[0];
  const channelId = chooseExportChannelId(groupItems);

  let tvgLogo = primary.tvg_logo || '';
  if (!tvgLogo) {
    const resolved = resolveLibraryLogo(primary.name, primary.category, logoRepo || DEFAULT_LOGO_BASE_URL);
    if (resolved) {
      if (resolved.startsWith('/') && req) {
        tvgLogo = `${getRequestOrigin(req)}${resolved}`;
      } else {
        tvgLogo = resolved;
      }
    }
  }

  return {
    ...primary,
    channel_id: channelId,
    tvg_logo: tvgLogo,
    url_items: groupItems
      .filter(item => item.url)
      .map(item => ({
        ...item,
        channel_id: channelId,
        tvg_logo: item.tvg_logo || tvgLogo
      })),
    urls: groupItems.map(item => item.url).filter(Boolean)
  };
}

function formatBeijingTimestamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const time = shifted.toISOString().slice(11, 19);
  return `${month}-${day} ${time}`;
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || '';
  return host ? `${proto}://${host}` : '';
}

function buildEpgUrl(req) {
  const origin = getRequestOrigin(req);
  const token = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
  return `${origin}/epg.xml${token}`;
}

function buildHlsUrl(req, sourceId) {
  return `${getRequestOrigin(req)}/stream/hls/${sourceId}/index.m3u8`;
}

function verifyExportToken(req) {
  const settings = Object.fromEntries(query('SELECT key, value FROM settings').map(r => [r.key, r.value]));
  const token = req.query.token;
  const configToken = settings.exportToken || '';
  if (configToken && token !== configToken) {
    throw new Error('403 Forbidden: Invalid export token');
  }
  return settings;
}

/**
 * Common export filtering and sorting logic
 */
function getExportData(req, ipvLimit = null, defaultFormat = 'm3u') {
  // Load settings
  const settingsRows = query('SELECT key, value FROM settings');
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  // 1. Verify token
  const token = req.query.token;
  const configToken = settings.exportToken || '';
  if (configToken && token !== configToken) {
    throw new Error('403 Forbidden: Invalid export token');
  }

  // 2. Read query parameters with fallbacks to settings
  const onlyActive = req.query.only_active !== undefined 
    ? req.query.only_active === '1' 
    : settings.onlyActive === '1';

  const limitPerChannel = req.query.limit_per_channel !== undefined
    ? parseInt(req.query.limit_per_channel)
    : parseInt(settings.limitPerChannel || 5);

  const categories = req.query.categories 
    ? req.query.categories.split(',').map(c => c.trim().toLowerCase()) 
    : [];

  const isps = req.query.isp
    ? req.query.isp.split(',').map(i => i.trim().toLowerCase())
    : [];

  const regions = req.query.region
    ? req.query.region.split(',').map(r => r.trim().toLowerCase())
    : [];

  // 3. Query all sources depending on data mode
  const mode = req.query.mode || settings.llmDefaultMode || 'original';
  let sources = [];
  if (mode === 'optimized') {
    sources = query('SELECT * FROM optimized_sources');
  } else {
    sources = query('SELECT * FROM sources');
  }

  const blockRules = settings.blockRules || '';
  const hiddenGroupRules = settings.hiddenGroupRules || '';

  // 4. Apply filters
  sources = sources.filter(src => {
    // Hidden group wildcard rule (e.g. 体育-*)
    if (hiddenGroupRules && matchGroupWildcard(src.category, hiddenGroupRules)) {
      return false;
    }

    // Name-based permanent block rule
    if (blockRules && matchBlockRule([src.name], blockRules)) {
      return false;
    }

    // Protocol filter (ipv4 / ipv6)
    if (ipvLimit && src.ipv_type !== ipvLimit) {
      return false;
    }

    // Status filter
    if (onlyActive && src.status !== 'active') {
      return false;
    }

    // Category filter
    if (categories.length > 0 && !categories.includes(src.category.toLowerCase())) {
      return false;
    }

    // ISP filter
    if (isps.length > 0 && (!src.isp || !isps.includes(src.isp.toLowerCase()))) {
      return false;
    }

    // Region filter
    if (regions.length > 0) {
      if (!src.region) return false;
      const srcRegionLower = src.region.toLowerCase();
      const hasRegionMatch = regions.some(r => srcRegionLower.includes(r));
      if (!hasRegionMatch) return false;
    }

    return true;
  });

  // 5. Apply limit_per_channel grouping and sorting.
  // Same channel is exported as one logical channel with multiple URL lines.
  const groups = new Map();
  for (const src of sources) {
    const key = normalizeChannelKey(src);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(src);
  }

  const finalChannels = [];
  const logoRepo = settings.logoRepositoryUrl || '';

  for (const [_, groupItems] of groups) {
    groupItems.sort(compareSourceQualityForExport);
    const limit = limitPerChannel > 0 ? Math.min(limitPerChannel, groupItems.length) : groupItems.length;
    finalChannels.push(buildExportChannel(groupItems.slice(0, limit), logoRepo, req));
  }

  // Sort overall sources by the preferred playlist/category order.
  finalChannels.sort(compareSourcesForExport);
  return finalChannels;
}

function getHlsExportData(req, ipvLimit = null) {
  verifyExportToken(req);
  let sources = query('SELECT * FROM sources WHERE stream_enabled = 1');
  if (ipvLimit) {
    sources = sources.filter(src => src.ipv_type === ipvLimit);
  }
  sources = sources
    .sort(compareSourcesForExport)
    .map(src => ({
      ...src,
      channel_id: ensureChannelId(src),
      url: buildHlsUrl(req, src.id),
      request_headers: '',
      url_items: [{
        ...src,
        channel_id: ensureChannelId(src),
        url: buildHlsUrl(req, src.id),
        request_headers: ''
      }],
      urls: [buildHlsUrl(req, src.id)]
    }));
  return sources;
}

/**
 * Format sources list as M3U
 */
function formatAsM3u(req, sources) {
  const settingsRows = query("SELECT key, value FROM settings WHERE key IN ('userAgent', 'announcementEnabled', 'announcementName', 'announcementCategory', 'announcementUrl', 'announcementLogo', 'hlsProxyEnabled')");
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const userAgent = settings.userAgent || DEFAULT_M3U_HTTP_USER_AGENT;
  const isProxyMode = req.query.proxy === '1' || settings.hlsProxyEnabled === '1';
  const origin = getRequestOrigin(req);

  const channels = sources
    .flatMap(src => {
      const items = Array.isArray(src.url_items) && src.url_items.length > 0
        ? src.url_items
        : [{ ...src, url: src.url }];
      const seen = new Set();
      return items
        .filter(item => {
          if (!item.url || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .map(item => {
          let streamUrl = item.url;
          const isItemFlv = streamUrl.includes('.flv') || streamUrl.includes('fengshows.cn');
          if (item.id && (isProxyMode || isItemFlv)) {
            if (isItemFlv) {
              streamUrl = `${origin}/stream/flv/${item.id}`;
            } else if (streamUrl.includes('.m3u8')) {
              streamUrl = `${origin}/stream/proxy/${item.id}/index.m3u8`;
            }
          }
          return { src: { ...src, ...item, url: streamUrl } };
        });
    });

  let output = `#EXTM3U x-tvg-url="${escapeM3uAttr(buildEpgUrl(req))}"\n`;
  output += `# Updated: ${formatBeijingTimestamp()}\n`;
  output += `# Channels: ${channels.length}\n\n`;

  // Inject system announcement channel at index 0
  if (settings.announcementEnabled !== '0') {
    output += `${getAnnouncementM3uItem(origin, settings, sources)}\n\n`;
  }

  for (const { src } of channels) {
    const catchupAttrs = formatExtinfCatchupAttributes(src.catchup);
    const channelId = ensureChannelId(src);
    const extinfAttrs = [
      `tvg-id="${escapeM3uAttr(channelId)}"`,
      `tvg-name="${escapeM3uAttr(src.name)}"`,
      `tvg-logo="${escapeM3uAttr(src.tvg_logo)}"`,
      `group-title="${escapeM3uAttr(src.category)}"`,
      catchupAttrs
    ].filter(Boolean).join(' ');

    output += `#EXTINF:-1 ${extinfAttrs},${src.name}\n`;
    output += '#EXTVLCOPT:network-caching=10000\n';
    output += '#EXTVLCOPT:http-reconnect=true\n';
    const headers = { 'User-Agent': userAgent, ...parseJsonObject(src.request_headers) };
    for (const [key, value] of Object.entries(headers)) {
      if (!value) continue;
      output += `#EXTVLCOPT:http-${String(key).toLowerCase()}=${value}\n`;
    }
    output += `${src.url}\n`;
    output += '\n';
  }
  return output;
}

/**
 * Format sources list as TXT
 */
function formatAsTxt(req, sources) {
  const settingsRows = query("SELECT key, value FROM settings WHERE key IN ('announcementEnabled', 'announcementName', 'announcementCategory', 'announcementUrl', 'announcementLogo', 'hlsProxyEnabled')");
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const isProxyMode = req.query.proxy === '1' || settings.hlsProxyEnabled === '1';
  const origin = getRequestOrigin(req);

  // Group by category
  const categories = new Map();
  for (const src of sources) {
    if (!categories.has(src.category)) {
      categories.set(src.category, []);
    }
    categories.get(src.category).push(src);
  }

  let output = '';

  // Inject system announcement at top
  if (settings.announcementEnabled !== '0') {
    output += `${getAnnouncementTxtItem(origin, settings, sources)}\n\n`;
  }

  for (const [category, items] of categories) {
    output += `${category},#genre#\n`;
    for (const src of items) {
      const urlItems = Array.isArray(src.url_items) && src.url_items.length > 0
        ? src.url_items
        : [{ ...src, url: src.url }];
      const seen = new Set();
      const urls = [];
      for (const item of urlItems) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        let streamUrl = item.url;
        const isItemFlv = streamUrl.includes('.flv') || streamUrl.includes('fengshows.cn');
        if (item.id && (isProxyMode || isItemFlv)) {
          if (isItemFlv) {
            streamUrl = `${origin}/stream/flv/${item.id}`;
          } else if (streamUrl.includes('.m3u8')) {
            streamUrl = `${origin}/stream/proxy/${item.id}/index.m3u8`;
          }
        }
        urls.push(streamUrl);
      }
      if (urls.length > 0) {
        output += `${src.name},${urls.join('#')}\n`;
      }
    }
    output += '\n';
  }
  return output;
}

/**
 * General helper to send playlist responses
 */
function sendPlaylistResponse(req, res, format, sources) {
  if (format === 'm3u') {
    res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
    res.send(formatAsM3u(req, sources));
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.txt"');
    res.send(formatAsTxt(req, sources));
  }
}



// 2. Full M3U /m3u
router.get('/m3u', (req, res) => {
  try {
    const sources = getExportData(req, null, 'm3u');
    sendPlaylistResponse(req, res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 3. Full TXT /txt
router.get('/txt', (req, res) => {
  try {
    const sources = getExportData(req, null, 'txt');
    sendPlaylistResponse(req, res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 4. Default IPv4 /ipv4
router.get('/ipv4', (req, res) => {
  try {
    const settings = Object.fromEntries(query('SELECT key, value FROM settings').map(r => [r.key, r.value]));
    const defaultFormat = settings.defaultExportFormat || 'm3u';
    const sources = getExportData(req, 'ipv4', defaultFormat);
    sendPlaylistResponse(req, res, defaultFormat, sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 5. Default IPv6 /ipv6
router.get('/ipv6', (req, res) => {
  try {
    const settings = Object.fromEntries(query('SELECT key, value FROM settings').map(r => [r.key, r.value]));
    const defaultFormat = settings.defaultExportFormat || 'm3u';
    const sources = getExportData(req, 'ipv6', defaultFormat);
    sendPlaylistResponse(req, res, defaultFormat, sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 6. IPv4 M3U /ipv4/m3u
router.get('/ipv4/m3u', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv4', 'm3u');
    sendPlaylistResponse(req, res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 7. IPv4 TXT /ipv4/txt
router.get('/ipv4/txt', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv4', 'txt');
    sendPlaylistResponse(req, res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 8. IPv6 M3U /ipv6/m3u
router.get('/ipv6/m3u', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv6', 'm3u');
    sendPlaylistResponse(req, res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 9. IPv6 TXT /ipv6/txt
router.get('/ipv6/txt', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv6', 'txt');
    sendPlaylistResponse(req, res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

router.get('/hls', (req, res) => {
  try {
    const settings = Object.fromEntries(query('SELECT key, value FROM settings').map(r => [r.key, r.value]));
    const defaultFormat = settings.defaultExportFormat || 'm3u';
    const sources = getHlsExportData(req);
    sendPlaylistResponse(req, res, defaultFormat, sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS 推流订阅失败: ' + error.message);
  }
});

router.get('/hls/m3u', (req, res) => {
  try {
    const sources = getHlsExportData(req);
    sendPlaylistResponse(req, res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS M3U 失败: ' + error.message);
  }
});

router.get('/hls/txt', (req, res) => {
  try {
    const sources = getHlsExportData(req);
    sendPlaylistResponse(req, res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS TXT 失败: ' + error.message);
  }
});

router.get('/hls/ipv4/m3u', (req, res) => {
  try {
    const sources = getHlsExportData(req, 'ipv4');
    sendPlaylistResponse(req, res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS IPv4 M3U 失败: ' + error.message);
  }
});

router.get('/hls/ipv6/m3u', (req, res) => {
  try {
    const sources = getHlsExportData(req, 'ipv6');
    sendPlaylistResponse(req, res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS IPv6 M3U 失败: ' + error.message);
  }
});

router.get('/hls/ipv4/txt', (req, res) => {
  try {
    const sources = getHlsExportData(req, 'ipv4');
    sendPlaylistResponse(req, res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS IPv4 TXT 失败: ' + error.message);
  }
});

router.get('/hls/ipv6/txt', (req, res) => {
  try {
    const sources = getHlsExportData(req, 'ipv6');
    sendPlaylistResponse(req, res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出 HLS IPv6 TXT 失败: ' + error.message);
  }
});

// 10. EPG XML /epg.xml
router.get('/epg.xml', (req, res) => {
  try {
    // Verify token
    const settings = Object.fromEntries(query('SELECT key, value FROM settings').map(r => [r.key, r.value]));
    const token = req.query.token;
    const configToken = settings.exportToken || '';
    if (configToken && token !== configToken) {
      return res.status(403).send('403 Forbidden: Invalid export token');
    }

    const xmlPath = path.resolve('./public/epg.xml');
    if (!fs.existsSync(xmlPath)) {
      return res.status(404).send('EPG file not found. Please sync EPG first.');
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.sendFile(xmlPath);
  } catch (error) {
    res.status(500).send('获取 EPG 失败: ' + error.message);
  }
});

// 11. EPG XML.GZ /epg.xml.gz
router.get('/epg.xml.gz', (req, res) => {
  try {
    // Verify token
    const settings = Object.fromEntries(query('SELECT key, value FROM settings').map(r => [r.key, r.value]));
    const token = req.query.token;
    const configToken = settings.exportToken || '';
    if (configToken && token !== configToken) {
      return res.status(403).send('403 Forbidden: Invalid export token');
    }

    const gzPath = path.resolve('./public/epg.xml.gz');
    if (!fs.existsSync(gzPath)) {
      return res.status(404).send('EPG Gzip file not found. Please sync EPG first.');
    }

    res.setHeader('Content-Type', 'application/x-gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="epg.xml.gz"');
    res.sendFile(gzPath);
  } catch (error) {
    res.status(500).send('获取 EPG 失败: ' + error.message);
  }
});

export default router;
