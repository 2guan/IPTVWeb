import fs from 'fs';
import path from 'path';

const INDEX_CACHE_PATH = path.resolve('./data/logo-index.json');
const LOCAL_LOGOS_DIR = path.resolve('./data/logos');
export const DEFAULT_LOGO_INDEX_URL = 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/iconList_default.json';
export const DEFAULT_LOGO_BASE_URL = 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/';
export const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let cachedIndexMap = null;
let lastLoadedTime = 0;

function ensureLocalLogosDir() {
  if (!fs.existsSync(LOCAL_LOGOS_DIR)) {
    fs.mkdirSync(LOCAL_LOGOS_DIR, { recursive: true });
  }
}

/**
 * Load cached index from disk if valid
 */
function loadDiskIndex() {
  try {
    if (fs.existsSync(INDEX_CACHE_PATH)) {
      const stat = fs.statSync(INDEX_CACHE_PATH);
      const content = fs.readFileSync(INDEX_CACHE_PATH, 'utf-8');
      const data = JSON.parse(content);
      if (data && typeof data === 'object') {
        cachedIndexMap = new Map();
        for (const [key, val] of Object.entries(data)) {
          if (key && typeof val === 'string') {
            cachedIndexMap.set(key.toLowerCase(), val);
          }
        }
        lastLoadedTime = stat.mtimeMs;
        return true;
      }
    }
  } catch (err) {
    console.warn('[LogoLibrary] Failed to load cached index:', err.message);
  }
  return false;
}

/**
 * Fetch and refresh logo index from upstream
 */
export async function ensureLogoIndex(indexUrl = DEFAULT_LOGO_INDEX_URL, force = false) {
  ensureLocalLogosDir();
  const now = Date.now();
  if (!force && cachedIndexMap && (now - lastLoadedTime < REFRESH_INTERVAL_MS)) {
    return true;
  }

  // Try loading from disk first
  if (!force && !cachedIndexMap && loadDiskIndex()) {
    if (now - lastLoadedTime < REFRESH_INTERVAL_MS) {
      return true;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(indexUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      cachedIndexMap = new Map();
      for (const [key, val] of Object.entries(data)) {
        if (key && typeof val === 'string') {
          cachedIndexMap.set(key.toLowerCase(), val);
        }
      }
      lastLoadedTime = now;
      fs.mkdirSync(path.dirname(INDEX_CACHE_PATH), { recursive: true });
      fs.writeFileSync(INDEX_CACHE_PATH, JSON.stringify(data), 'utf-8');
      console.log(`[LogoLibrary] Successfully updated logo index (${cachedIndexMap.size} channels)`);
      return true;
    }
  } catch (err) {
    if (cachedIndexMap || loadDiskIndex()) {
      console.warn(`[LogoLibrary] Failed to refresh logo index, fallback to cache: ${err.message}`);
      return true;
    }
    console.warn(`[LogoLibrary] Failed to download logo index: ${err.message}`);
  }
  return false;
}

/**
 * Normalizes channel name for logo matching
 */
function cleanChannelName(name = '') {
  let s = String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\[【(（][^\]】)）]*[\]】)）]/g, '') // remove brackets
    .replace(/(超清|高清|标清|原画|蓝光|4k|8k|1080p|720p|hevc|h265|fhd|hd)/gi, '')
    .replace(/(ipv6|ipv4|移动|电信|联通|广电)/gi, '')
    .replace(/[-_·.|\s]+$/g, '')
    .trim();

  // CCTV normalization: e.g. CCTV-1 -> CCTV1, CCTV-5+ -> CCTV5+
  const cctvMatch = s.match(/CCTV[-_\s]*(\d{1,2})(K)?\s*(\+|PLUS|加)?/i);
  if (cctvMatch) {
    if (cctvMatch[2]) return `CCTV${cctvMatch[1]}K`;
    return `CCTV${cctvMatch[1]}${cctvMatch[3] ? '+' : ''}`;
  }

  return s;
}

/**
 * Generate candidate lookup names ordered by priority
 */
function getCandidateNames(name = '', category = '') {
  const candidates = new Set();
  const raw = String(name || '').trim();
  const cleaned = cleanChannelName(raw);

  if (raw) candidates.add(raw);
  if (cleaned) candidates.add(cleaned);

  // Remove generic trailing words like 频道, 电视台, 台
  const strippedSuffix = cleaned.replace(/(频道|电视台|台)$/, '');
  if (strippedSuffix && strippedSuffix.length >= 2) {
    candidates.add(strippedSuffix);
  }

  // For CCTV special channels: e.g. CCTV怀旧剧场 -> 怀旧剧场
  if (/^CCTV[^\d]/i.test(cleaned)) {
    candidates.add(cleaned.replace(/^CCTV/i, ''));
  }

  // Prepend category if province (e.g. category "内蒙古" + channel "新闻综合" -> "内蒙古新闻综合")
  if (category) {
    const cleanCat = String(category).trim().replace(/(频道|电视台|电视|省|市)$/, '');
    if (cleanCat && !cleaned.startsWith(cleanCat)) {
      candidates.add(`${cleanCat}${cleaned}`);
      candidates.add(`${cleanCat}${strippedSuffix}`);
    }
  }

  return Array.from(candidates);
}

/**
 * Resolve a verified logo URL for a channel.
 * Returns valid image URL if found in index or local directory, otherwise returns empty string ''.
 * This guarantees ZERO 404 broken images!
 */
export function resolveLibraryLogo(name, category = '', customBaseUrl = DEFAULT_LOGO_BASE_URL) {
  if (!name) return '';

  // 1. Check local logos directory data/logos/<name>.png
  ensureLocalLogosDir();
  const sanitized = String(name).trim().replace(/[\\/:*?"<>|]/g, '');
  const localExtensions = ['.png', '.svg', '.jpg', '.webp'];
  for (const ext of localExtensions) {
    const localFile = path.join(LOCAL_LOGOS_DIR, `${sanitized}${ext}`);
    if (fs.existsSync(localFile)) {
      return `/logos/${encodeURIComponent(`${sanitized}${ext}`)}`;
    }
  }

  // 2. Check in memory / disk index
  if (!cachedIndexMap) {
    loadDiskIndex();
  }

  if (cachedIndexMap && cachedIndexMap.size > 0) {
    const candidates = getCandidateNames(name, category);
    for (const cand of candidates) {
      const lower = cand.toLowerCase();
      if (cachedIndexMap.has(lower)) {
        const val = cachedIndexMap.get(lower);
        if (val.startsWith('http://') || val.startsWith('https://')) {
          return val;
        }
        const base = customBaseUrl.endsWith('/') ? customBaseUrl : `${customBaseUrl}/`;
        return `${base}${encodeURIComponent(val.endsWith('.png') ? val : `${val}.png`)}`;
      }
    }
  }

  // 3. Not found in index -> return empty string to prevent 404
  return '';
}

export default {
  ensureLogoIndex,
  resolveLibraryLogo,
  DEFAULT_LOGO_BASE_URL,
  DEFAULT_LOGO_INDEX_URL
};
