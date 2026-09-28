export const DEFAULT_PLAYER_USER_AGENT = 'TiviMate/5.1.0';

function normalizeChannelName(name) {
  if (!name) return '未知频道';
  return String(name).trim().replace(/\r/g, '');
}

function normalizeHeaderName(name = '') {
  const raw = String(name || '').trim();
  const lower = raw.toLowerCase();
  if (['ua', 'useragent', 'user-agent'].includes(lower)) return 'User-Agent';
  if (['referrer', 'referer'].includes(lower)) return 'Referer';
  return raw
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-');
}

function normalizeAttrKey(key = '') {
  return String(key || '').toLowerCase().replace(/[-_]/g, '');
}

export function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stringifyJsonObject(value) {
  const obj = parseJsonObject(value);
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : '';
}

export function parseM3uAttributes(text = '') {
  const attrs = {};
  const regex = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const key = normalizeAttrKey(match[1]);
    const raw = match[2] || '';
    attrs[key] = raw.replace(/^["']|["']$/g, '').trim();
  }
  return attrs;
}

function headersFromAttributes(attrs = {}) {
  const headers = {};
  const headerKeys = {
    ua: 'User-Agent',
    useragent: 'User-Agent',
    httpuseragent: 'User-Agent',
    referer: 'Referer',
    referrer: 'Referer',
    httpreferer: 'Referer',
    httpreferrer: 'Referer',
    origin: 'Origin',
    cookie: 'Cookie'
  };

  for (const [key, header] of Object.entries(headerKeys)) {
    if (attrs[key]) headers[header] = attrs[key];
  }
  return headers;
}

function catchupFromAttributes(attrs = {}) {
  const keys = ['catchup', 'catchupsource', 'catchupdays', 'timeshift'];
  const out = {};
  for (const key of keys) {
    if (!attrs[key]) continue;
    if (key === 'catchupsource') out['catchup-source'] = attrs[key];
    else if (key === 'catchupdays') out['catchup-days'] = attrs[key];
    else out[key] = attrs[key];
  }
  return out;
}

function parseExtVlcOpt(line = '') {
  const option = line.replace(/^#EXTVLCOPT:/i, '').trim();
  const separator = option.indexOf('=');
  if (separator === -1) return {};

  const key = option.slice(0, separator).trim();
  const value = option.slice(separator + 1).trim();
  const lower = key.toLowerCase();
  if (!lower.startsWith('http-') || !value) return {};

  return { [normalizeHeaderName(key.slice(5))]: value };
}

function parseInlineUrlHeaders(value = '') {
  const pipeIndex = value.indexOf('|');
  if (pipeIndex === -1) return { url: value.trim(), headers: {} };

  const url = value.slice(0, pipeIndex).trim();
  const headerText = value.slice(pipeIndex + 1).trim();
  const headers = {};
  for (const part of headerText.split(/[&;]/)) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = decodeURIComponent(part.slice(0, eqIndex).trim());
    const rawValue = decodeURIComponent(part.slice(eqIndex + 1).trim());
    if (key && rawValue) headers[normalizeHeaderName(key)] = rawValue;
  }
  return { url, headers };
}

function mergeHeaders(...items) {
  const merged = {};
  for (const item of items) {
    const obj = parseJsonObject(item);
    for (const [key, value] of Object.entries(obj)) {
      if (!key || value === undefined || value === null || value === '') continue;
      merged[normalizeHeaderName(key)] = String(value);
    }
  }
  return merged;
}

export function buildDefaultHeaders(userAgent) {
  return userAgent ? { 'User-Agent': userAgent } : {};
}

export function parseM3u(content, defaultCategory = '其他频道', defaultHeaders = {}) {
  const lines = String(content || '').split(/\r?\n/);
  const items = [];
  let currentItem = null;
  let pendingHeaders = {};
  let currentCategory = defaultCategory;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const commaIndex = line.lastIndexOf(',');
      const name = commaIndex !== -1 ? normalizeChannelName(line.substring(commaIndex + 1)) : '未知频道';
      const attrText = commaIndex !== -1 ? line.substring(0, commaIndex) : line;
      const attrs = parseM3uAttributes(attrText);
      currentCategory = attrs.grouptitle?.trim() || currentCategory;
      currentItem = {
        name,
        category: currentCategory,
        tvg_id: attrs.tvgid || '',
        tvg_logo: attrs.tvglogo || '',
        request_headers: stringifyJsonObject(mergeHeaders(defaultHeaders, headersFromAttributes(attrs))),
        catchup: stringifyJsonObject(catchupFromAttributes(attrs))
      };
      pendingHeaders = {};
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      pendingHeaders = mergeHeaders(pendingHeaders, parseExtVlcOpt(line));
      continue;
    }

    if (line.startsWith('#')) continue;

    if (currentItem) {
      const parsed = parseInlineUrlHeaders(line);
      const headers = mergeHeaders(currentItem.request_headers, pendingHeaders, parsed.headers);
      currentItem.url = parsed.url;
      currentItem.request_headers = stringifyJsonObject(headers);
      if (currentItem.name && currentItem.url) items.push(currentItem);
      currentItem = null;
      pendingHeaders = {};
    }
  }

  return items;
}

export function parseTxt(content, defaultCategory = '其他频道', defaultHeaders = {}) {
  const lines = String(content || '').split(/\r?\n/);
  const items = [];
  let currentCategory = defaultCategory;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.includes('#genre#')) {
      const parts = line.split(',');
      if (parts.length > 0 && parts[0].trim()) {
        currentCategory = parts[0].trim().replace(/[-_\s📺📡☘️]/g, '');
      }
      continue;
    }

    const separatorIndex = line.indexOf(',') !== -1 ? line.indexOf(',') : line.indexOf('，');
    if (separatorIndex === -1) continue;

    const name = normalizeChannelName(line.substring(0, separatorIndex));
    const parsed = parseInlineUrlHeaders(line.substring(separatorIndex + 1).trim());
    if (name && parsed.url && /^(https?|rtmp|rtsp|udp|rtp):/i.test(parsed.url)) {
      const headers = mergeHeaders(defaultHeaders, parsed.headers);
      items.push({
        name,
        url: parsed.url,
        category: currentCategory,
        tvg_id: '',
        tvg_logo: '',
        request_headers: stringifyJsonObject(headers),
        catchup: ''
      });
    }
  }

  return items;
}

export function formatExtinfCatchupAttributes(catchupValue) {
  const catchup = parseJsonObject(catchupValue);
  return Object.entries(catchup)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
    .join(' ');
}

export function buildStreamHeaders(settings = {}, source = {}) {
  const globalUserAgent = settings.userAgent || DEFAULT_PLAYER_USER_AGENT;
  return mergeHeaders({ 'User-Agent': globalUserAgent }, source.request_headers);
}
