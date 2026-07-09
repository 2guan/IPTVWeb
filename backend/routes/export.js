import express from 'express';
import fs from 'fs';
import path from 'path';
import { query, queryOne } from '../db.js';

const router = express.Router();

// Helper to escape special characters for M3U format
function escapeM3uAttr(val) {
  if (!val) return '';
  return val.replace(/"/g, '\\"');
}

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
  if (categoryMatchesAny(text, ['北京', 'bj', 'beijing'])) {
    return { groupRank: 2, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['港澳台', '港台', '香港', '澳门', '台湾', 'hk', 'hongkong', 'macau', 'taiwan', 'tw'])) {
    return { groupRank: 3, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['日本', 'jp', 'japan'])) {
    return { groupRank: 4, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['韩国', 'kr', 'korea'])) {
    return { groupRank: 5, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['国际', '海外', '境外', 'world', 'global', 'international', 'foreign'])) {
    return { groupRank: 6, provinceRank: -1, normalized };
  }

  const provinceRank = PROVINCE_CATEGORY_ORDER.findIndex(name => text.includes(name.toLowerCase()));
  if (provinceRank !== -1) {
    return { groupRank: 7, provinceRank, normalized };
  }

  if (categoryMatchesAny(text, ['景区', '风景', '旅游'])) {
    return { groupRank: 8, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['直播', 'live'])) {
    return { groupRank: 9, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['电影', '影院', '影视', 'movie', 'film'])) {
    return { groupRank: 10, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['广播', '电台', 'radio'])) {
    return { groupRank: 11, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['音乐', 'music', 'mv', 'mtv'])) {
    return { groupRank: 12, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['游戏', '电竞', 'game'])) {
    return { groupRank: 13, provinceRank: -1, normalized };
  }
  if (categoryMatchesAny(text, ['其它', '其他', '未分类', 'misc'])) {
    return { groupRank: 14, provinceRank: -1, normalized };
  }

  return { groupRank: 15, provinceRank: -1, normalized };
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

function compareSourceQualityForExport(a, b) {
  const statusCompare = getStatusSortRank(a.status) - getStatusSortRank(b.status);
  if (statusCompare !== 0) return statusCompare;

  const speedCompare = Number(b.speed || 0) - Number(a.speed || 0);
  if (speedCompare !== 0) return speedCompare;

  return normalizeDelayForSort(a.delay) - normalizeDelayForSort(b.delay);
}

function compareSourcesForExport(a, b) {
  const categoryCompare = compareExportCategories(a.category, b.category);
  if (categoryCompare !== 0) return categoryCompare;

  const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  if (nameCompare !== 0) return nameCompare;

  return compareSourceQualityForExport(a, b);
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

  // 4. Apply filters
  sources = sources.filter(src => {
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

  // 5. Apply limit_per_channel grouping and sorting
  // Group by channel name (case-insensitive)
  const groups = new Map();
  for (const src of sources) {
    const key = src.name.toLowerCase().trim();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(src);
  }

  const finalSources = [];
  const logoRepo = settings.logoRepositoryUrl || '';

  for (const [_, groupItems] of groups) {
    // Sort in group: active first, then highest speed, then lowest delay
    groupItems.sort(compareSourceQualityForExport);

    // Take top N
    const limit = limitPerChannel > 0 ? Math.min(limitPerChannel, groupItems.length) : groupItems.length;
    for (let i = 0; i < limit; i++) {
      const src = groupItems[i];
      
      // Match and attach Logo if missing
      if (!src.tvg_logo && logoRepo) {
        // Strip symbols from name for matching, e.g. CCTV-1 -> cctv1
        const cleanName = src.name.toLowerCase().replace(/[-_\s📺📡☘️]/g, '');
        src.tvg_logo = `${logoRepo}/${cleanName}.png`;
      }
      
      finalSources.push(src);
    }
  }

  // Sort overall sources by the preferred playlist/category order.
  finalSources.sort(compareSourcesForExport);
  return finalSources;
}

/**
 * Format sources list as M3U
 */
function formatAsM3u(sources) {
  let output = '#EXTM3U\n';
  for (const src of sources) {
    output += `#EXTINF:-1 tvg-name="${escapeM3uAttr(src.name)}" tvg-logo="${escapeM3uAttr(src.tvg_logo)}" group-title="${escapeM3uAttr(src.category)}",${src.name}\n`;
    output += `${src.url}\n`;
  }
  return output;
}

/**
 * Format sources list as TXT
 */
function formatAsTxt(sources) {
  // Group by category
  const categories = new Map();
  for (const src of sources) {
    if (!categories.has(src.category)) {
      categories.set(src.category, []);
    }
    categories.get(src.category).push(src);
  }

  let output = '';
  for (const [category, items] of categories) {
    output += `${category},#genre#\n`;
    for (const src of items) {
      output += `${src.name},${src.url}\n`;
    }
    output += '\n';
  }
  return output;
}

/**
 * General helper to send playlist responses
 */
function sendPlaylistResponse(res, format, sources) {
  if (format === 'm3u') {
    res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
    res.send(formatAsM3u(sources));
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.txt"');
    res.send(formatAsTxt(sources));
  }
}



// 2. Full M3U /m3u
router.get('/m3u', (req, res) => {
  try {
    const sources = getExportData(req, null, 'm3u');
    sendPlaylistResponse(res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 3. Full TXT /txt
router.get('/txt', (req, res) => {
  try {
    const sources = getExportData(req, null, 'txt');
    sendPlaylistResponse(res, 'txt', sources);
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
    sendPlaylistResponse(res, defaultFormat, sources);
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
    sendPlaylistResponse(res, defaultFormat, sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 6. IPv4 M3U /ipv4/m3u
router.get('/ipv4/m3u', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv4', 'm3u');
    sendPlaylistResponse(res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 7. IPv4 TXT /ipv4/txt
router.get('/ipv4/txt', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv4', 'txt');
    sendPlaylistResponse(res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 8. IPv6 M3U /ipv6/m3u
router.get('/ipv6/m3u', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv6', 'm3u');
    sendPlaylistResponse(res, 'm3u', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
  }
});

// 9. IPv6 TXT /ipv6/txt
router.get('/ipv6/txt', (req, res) => {
  try {
    const sources = getExportData(req, 'ipv6', 'txt');
    sendPlaylistResponse(res, 'txt', sources);
  } catch (error) {
    if (error.message.includes('403')) return res.status(403).send(error.message);
    res.status(500).send('导出失败: ' + error.message);
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
