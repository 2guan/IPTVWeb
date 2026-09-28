import { queryOne } from './db.js';

export function formatBeijingShortTime(input) {
  if (typeof input === 'string') {
    const match = input.match(/\d{4}-(\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
  }
  const date = input instanceof Date ? input : new Date();
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const min = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

export function getLatestTestTime(sources = null) {
  if (Array.isArray(sources) && sources.length > 0) {
    let max = null;
    for (const s of sources) {
      if (s?.last_tested_at && (!max || s.last_tested_at > max)) {
        max = s.last_tested_at;
      }
    }
    if (max) return max;
  }
  try {
    const row = queryOne('SELECT MAX(last_tested_at) AS last_test_time FROM sources WHERE last_tested_at IS NOT NULL');
    return row?.last_test_time || null;
  } catch {
    return null;
  }
}

export const DUMMY_UNPLAYABLE_URL = 'http://127.0.0.1/';

export const DEFAULT_ANNOUNCEMENT_CHANNEL = Object.freeze({
  name: 'Guan‘s IPTV',
  category: '公告',
  logoPath: '/assets/announcement-logo.png'
});

export const ANNOUNCEMENT_CHANNEL = DEFAULT_ANNOUNCEMENT_CHANNEL;

export function resolveAnnouncementConfig(origin = '', settings = {}, now = new Date()) {
  const name = String(settings.announcementName || '').trim() || DEFAULT_ANNOUNCEMENT_CHANNEL.name;
  const category = String(settings.announcementCategory || '').trim() || DEFAULT_ANNOUNCEMENT_CHANNEL.category;

  // 默认不挂可播放视频链接（指向 http://127.0.0.1/），若用户在设置中明确填写了自定义地址则使用自定义地址
  let videoUrl = String(settings.announcementUrl || '').trim();
  if (!videoUrl) {
    videoUrl = DUMMY_UNPLAYABLE_URL;
  } else if (!/^https?:\/\//i.test(videoUrl)) {
    videoUrl = `${origin}${videoUrl.startsWith('/') ? '' : '/'}${videoUrl}`;
  }

  let logoUrl = String(settings.announcementLogo || '').trim();
  if (!logoUrl) {
    logoUrl = `${origin}${DEFAULT_ANNOUNCEMENT_CHANNEL.logoPath}`;
  } else if (!/^https?:\/\//i.test(logoUrl)) {
    logoUrl = `${origin}${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`;
  }

  return {
    name,
    category,
    videoUrl,
    logoUrl
  };
}

export function resolveTestTime(testTimeOrSources = null) {
  if (typeof testTimeOrSources === 'string' && testTimeOrSources.trim()) {
    return testTimeOrSources.trim();
  }
  if (testTimeOrSources instanceof Date) {
    return testTimeOrSources;
  }
  const dbLatest = getLatestTestTime(testTimeOrSources);
  if (dbLatest) {
    return dbLatest;
  }
  return new Date();
}

export function getAnnouncementM3uItem(origin = '', settings = {}, testTimeOrSources = null) {
  const cfg = resolveAnnouncementConfig(origin, settings);
  const resolvedTime = resolveTestTime(testTimeOrSources);
  const timeStr = formatBeijingShortTime(resolvedTime);

  const item1 = [
    `#EXTINF:-1 tvg-id="iptv-announcement-title" tvg-name="${cfg.name}" tvg-logo="${cfg.logoUrl}" group-title="${cfg.category}",${cfg.name}`,
    cfg.videoUrl
  ].join('\n');

  const item2 = [
    `#EXTINF:-1 tvg-id="iptv-announcement-time" tvg-name="更新时间" tvg-logo="${cfg.logoUrl}" group-title="${cfg.category}",更新时间:${timeStr}`,
    DUMMY_UNPLAYABLE_URL
  ].join('\n');

  return `${item1}\n\n${item2}`;
}

export function getAnnouncementTxtItem(origin = '', settings = {}, testTimeOrSources = null) {
  const cfg = resolveAnnouncementConfig(origin, settings);
  const resolvedTime = resolveTestTime(testTimeOrSources);
  const timeStr = formatBeijingShortTime(resolvedTime);
  return [
    `${cfg.category},#genre#`,
    `${cfg.name},${cfg.videoUrl}`,
    `更新时间:${timeStr},${DUMMY_UNPLAYABLE_URL}`
  ].join('\n');
}

export default {
  DEFAULT_ANNOUNCEMENT_CHANNEL,
  ANNOUNCEMENT_CHANNEL,
  DUMMY_UNPLAYABLE_URL,
  formatBeijingShortTime,
  getLatestTestTime,
  resolveTestTime,
  resolveAnnouncementConfig,
  getAnnouncementM3uItem,
  getAnnouncementTxtItem
};
