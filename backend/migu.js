import crypto from 'node:crypto';
import db, { query, queryOne, resolveStableChannelId } from './db.js';
import { deduplicateSourcesByUrl } from './deduplicate.js';

const MIGU_CATEGORY_URL = 'https://program-sc.miguvideo.com/live/v2/tv-data/1ff892f2b5ab4a79be6e25b69d2f5d05';
const MIGU_CATEGORY_DETAIL_URL = 'https://program-sc.miguvideo.com/live/v2/tv-data/';
const MIGU_PLAY_URL = 'https://play.miguvideo.com/playurl/v1/play/playurl';
const MIGU_MATCH_LIST_URL = 'http://v0-sc.miguvideo.com/vms-match/v6/staticcache/basic/match-list/normal-match-list/0/all/default/1/miguvideo';
const MIGU_MATCH_DETAIL_URL = 'https://vms-sc.miguvideo.com/vms-match/v6/staticcache/basic/basic-data/';
const MIGU_MATCH_REPLAY_URL = 'http://app-sc.miguvideo.com/vms-match/v5/staticcache/basic/all-view-list/';
const MIGU_PROGRAM_URL = 'https://program-sc.miguvideo.com/live/v2/tv-programs-data/';
const MIGU_ACCOUNT_TEST_PID = '608807420';
const MIGU_4K_TEST_PID = '641886683';
const ANDROID_APP_VERSION = '26000370';
const ANDROID_APP_VERSION_HEADER = '2600037000';
const ANDROID_CHANNEL_ID = '2600037000-99000-200300220100002';
const ANDROID_SIGN_SALT = '1230024';
const ANDROID_SIGN_SUFFIX = '3ce941cc3cbc40528bfd1c64f9fdf6c0migu0123';
const DD_KEYS = 'cdabyzwxkl';
const DD_SUFFIX = '&sv=10004&ct=android';

function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex').toLowerCase();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function getDateString(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10).replaceAll('-', '');
}

function getXmltvDateTime(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '').replace('T', '')} +0800`;
}

function boolSetting(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function getRateTypeLabel(rateType) {
  const labels = {
    2: '标清/480p',
    3: '高清/720p',
    4: '蓝光/1080p',
    7: '原画/1080p+',
    9: '尝试原画/4K'
  };
  return labels[Number(rateType)] || `未知(${rateType})`;
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeMiguSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    name: subscription.name || '咪咕',
    baseUrl: normalizeBaseUrl(subscription.migu_base_url || subscription.url || process.env.MIGU_BASE_URL || ''),
    userId: subscription.migu_user_id || '',
    token: subscription.migu_token || '',
    rateType: subscription.migu_rate_type || '3',
    enableH265: boolSetting(subscription.migu_enable_h265 ?? '1'),
    enableHdr: boolSetting(subscription.migu_enable_hdr ?? '0'),
    userAgent: subscription.user_agent || ''
  };
}

function getMiguSubscription(subscriptionId) {
  if (subscriptionId) {
    return normalizeMiguSubscription(queryOne("SELECT * FROM subscriptions WHERE id = ? AND source_type = 'migu'", subscriptionId));
  }
  return normalizeMiguSubscription(queryOne("SELECT * FROM subscriptions WHERE source_type = 'migu' ORDER BY id ASC LIMIT 1"));
}

function getMiguPlayProxyUrl(pid, baseUrl, subscriptionId) {
  const path = `/api/migu/play/${encodeURIComponent(subscriptionId)}/${encodeURIComponent(pid)}`;
  const normalizedBase = normalizeBaseUrl(baseUrl);
  return normalizedBase ? `${normalizedBase}${path}` : path;
}

async function fetchMiguCategories() {
  const data = await fetchJson(MIGU_CATEGORY_URL);
  const categories = Array.isArray(data?.body?.liveList) ? data.body.liveList : [];

  return categories
    .filter(item => item?.name && item?.vomsID && item.name !== '热门')
    .sort((a, b) => {
      if (a.name === '央视') return -1;
      if (b.name === '央视') return 1;
      return 0;
    });
}

async function fetchMiguChannels() {
  const categories = await fetchMiguCategories();
  const groups = [];

  for (const category of categories) {
    try {
      const data = await fetchJson(`${MIGU_CATEGORY_DETAIL_URL}${category.vomsID}`);
      const seen = new Set();
      const channels = (Array.isArray(data?.body?.dataList) ? data.body.dataList : [])
        .filter(item => item?.name && item?.pID)
        .filter(item => {
          const key = `${item.name}:${item.pID}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(item => ({
          name: String(item.name).trim(),
          pid: String(item.pID).trim(),
          category: String(category.name).trim(),
          logo: item.pics?.highResolutionH || item.pics?.highResolutionV || ''
        }));

      if (channels.length > 0) {
        groups.push({ category: category.name, channels });
      }
    } catch (error) {
      console.warn(`[Migu] Failed to fetch category ${category.name}: ${error.message}`);
    }
  }

  return groups;
}

export async function syncMiguSources({ subscriptionId, subscription, baseUrl } = {}) {
  const config = normalizeMiguSubscription(subscription) || getMiguSubscription(subscriptionId);
  if (!config) throw new Error('咪咕订阅不存在');

  const effectiveBaseUrl = normalizeBaseUrl(baseUrl || config.baseUrl);
  if (!effectiveBaseUrl) throw new Error('请先填写咪咕播放代理公网地址');

  const groups = await fetchMiguChannels();
  const channels = groups.flatMap(group => group.channels);

  if (channels.length === 0) {
    throw new Error('未获取到咪咕频道，请检查当前网络是否可访问咪咕接口');
  }

  const existingSources = query("SELECT id, url FROM sources WHERE origin = 'migu' AND (subscription_id = ? OR subscription_id IS NULL) AND category NOT LIKE '体育-%'", config.id);
  const existingByUrl = new Map(existingSources.map(source => [source.url, source]));
  const activeUrls = new Set();

  const insertStmt = db.prepare(`
    INSERT INTO sources (name, url, category, origin, subscription_id, channel_id, tvg_logo, ipv_type, status, delay, speed, resolution, codec, isp, region)
    VALUES (?, ?, ?, 'migu', ?, ?, ?, 'ipv4', 'active', 50, 5.0, '1920x1080', 'h264', '中国移动', '全国')
  `);
  const updateStmt = db.prepare(`
    UPDATE sources
    SET name = ?, category = ?, tvg_logo = ?, ipv_type = 'ipv4',
        channel_id = COALESCE(NULLIF(channel_id, ''), ?),
        status = 'active',
        delay = CASE WHEN delay > 0 THEN delay ELSE 50 END,
        speed = CASE WHEN speed > 0 THEN speed ELSE 5.0 END,
        resolution = COALESCE(NULLIF(resolution, ''), '1920x1080'),
        codec = COALESCE(NULLIF(codec, ''), 'h264'),
        isp = CASE WHEN isp IS NULL OR isp = '' OR isp = '未知' THEN '中国移动' ELSE isp END,
        region = CASE WHEN region IS NULL OR region = '' OR region = '未知' THEN '全国' ELSE region END,
        fail_count = 0,
        frozen_until = NULL
    WHERE id = ?
  `);
  const deleteStmt = db.prepare('DELETE FROM sources WHERE id = ?');

  let inserted = 0;
  let updated = 0;
  let removed = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    for (const channel of channels) {
      const url = getMiguPlayProxyUrl(channel.pid, effectiveBaseUrl, config.id);
      activeUrls.add(url);

      const existing = existingByUrl.get(url);
      const channelId = resolveStableChannelId({
        ...channel,
        origin: 'migu',
        subscription_id: config.id,
        subscription_name: config.name,
        url
      });
      if (existing) {
        updateStmt.run(channel.name, channel.category, channel.logo, channelId, existing.id);
        updated += 1;
      } else {
        insertStmt.run(channel.name, url, channel.category, config.id, channelId, channel.logo);
        inserted += 1;
      }
    }

    for (const source of existingSources) {
      if (!activeUrls.has(source.url)) {
        deleteStmt.run(source.id);
        removed += 1;
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    total: channels.length,
    groups: groups.length,
    inserted,
    updated,
    removed,
    baseUrl: effectiveBaseUrl,
    subscriptionId: config.id
  };
}

function extractMiguPid(url = '') {
  return String(url || '').match(/\/api\/migu\/play\/(?:\d+\/)?(\d+)(?:[?#].*)?$/)?.[1] || '';
}

function getRelativeMatchDate(dayText) {
  const today = getDateString(new Date());
  if (dayText === today) return '今天';
  if (Number(dayText) > Number(today)) return '明天';
  return '昨天';
}

async function fetchMiguSportsEvents() {
  const data = await fetchJson(MIGU_MATCH_LIST_URL);
  const days = Array.isArray(data?.body?.days) ? data.body.days.slice(1, 4) : [];
  const matchList = data?.body?.matchList || {};
  const events = [];

  for (const day of days) {
    const relativeDate = getRelativeMatchDate(day);
    const matches = Array.isArray(matchList[day]) ? matchList[day] : [];

    for (const match of matches) {
      let title = match.pkInfoTitle || '';
      if (Array.isArray(match.confrontTeams) && match.confrontTeams.length >= 2) {
        title = `${match.confrontTeams[0].name}VS${match.confrontTeams[1].name}`;
      }

      try {
        const detail = await fetchJson(`${MIGU_MATCH_DETAIL_URL}${match.mgdbId}/miguvideo`);
        const body = detail?.body || {};
        if (!body) continue;

        if (body.endTime && body.endTime < Date.now()) {
          const replayData = await fetchJson(`${MIGU_MATCH_REPLAY_URL}${match.mgdbId}/2/miguvideo`).catch(() => null);
          const replays = replayData?.body?.replayList || body.multiPlayList?.replayList || [];
          for (const replay of replays) {
            if (!replay?.pID || /集锦|训练/.test(replay.name || '')) continue;
            if (!/回放|赛/.test(replay.name || '')) continue;

            let timeText = String(body.keyword || '').substring(7);
            const preList = body.multiPlayList?.preList || [];
            const startTimeText = preList[preList.length - 1]?.startTimeStr;
            if (startTimeText) timeText = startTimeText.substring(11, 16);

            events.push({
              name: `${match.competitionName || ''} ${title} ${replay.name} ${timeText}`.trim(),
              pid: String(replay.pID),
              category: `体育-${relativeDate}`,
              logo: match.competitionLogo || ''
            });
          }
          continue;
        }

        const liveList = body.multiPlayList?.liveList || [];
        for (const live of liveList) {
          if (!live?.pID || /集锦/.test(live.name || '') || !live.startTimeStr) continue;
          events.push({
            name: `${match.competitionName || ''} ${title} ${live.name} ${live.startTimeStr.substring(11, 16)}`.trim(),
            pid: String(live.pID),
            category: `体育-${relativeDate}`,
            logo: match.competitionLogo || ''
          });
        }
      } catch {
        // Some match detail endpoints are unavailable depending on rights or timing.
      }
    }
  }

  return events;
}

export async function syncMiguSportsSources({ subscriptionId, subscription, baseUrl } = {}) {
  const config = normalizeMiguSubscription(subscription) || getMiguSubscription(subscriptionId);
  if (!config) throw new Error('咪咕订阅不存在');

  const effectiveBaseUrl = normalizeBaseUrl(baseUrl || config.baseUrl);
  if (!effectiveBaseUrl) throw new Error('请先填写咪咕播放代理公网地址');

  const events = await fetchMiguSportsEvents();
  const existingSources = query("SELECT id, url FROM sources WHERE origin = 'migu' AND (subscription_id = ? OR subscription_id IS NULL) AND category LIKE '体育-%'", config.id);
  const existingByUrl = new Map(existingSources.map(source => [source.url, source]));
  const activeUrls = new Set();

  const insertStmt = db.prepare(`
    INSERT INTO sources (name, url, category, origin, subscription_id, channel_id, tvg_logo, ipv_type, status, delay, speed, resolution, codec, isp, region)
    VALUES (?, ?, ?, 'migu', ?, ?, ?, 'ipv4', 'active', 50, 5.0, '1920x1080', 'h264', '中国移动', '全国')
  `);
  const updateStmt = db.prepare(`
    UPDATE sources
    SET name = ?, category = ?, tvg_logo = ?, ipv_type = 'ipv4',
        channel_id = COALESCE(NULLIF(channel_id, ''), ?),
        status = 'active',
        delay = CASE WHEN delay > 0 THEN delay ELSE 50 END,
        speed = CASE WHEN speed > 0 THEN speed ELSE 5.0 END,
        resolution = COALESCE(NULLIF(resolution, ''), '1920x1080'),
        codec = COALESCE(NULLIF(codec, ''), 'h264'),
        isp = CASE WHEN isp IS NULL OR isp = '' OR isp = '未知' THEN '中国移动' ELSE isp END,
        region = CASE WHEN region IS NULL OR region = '' OR region = '未知' THEN '全国' ELSE region END,
        fail_count = 0,
        frozen_until = NULL
    WHERE id = ?
  `);
  const deleteStmt = db.prepare('DELETE FROM sources WHERE id = ?');

  let inserted = 0;
  let updated = 0;
  let removed = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    for (const event of events) {
      const url = getMiguPlayProxyUrl(event.pid, effectiveBaseUrl, config.id);
      activeUrls.add(url);

      const existing = existingByUrl.get(url);
      const channelId = resolveStableChannelId({
        ...event,
        origin: 'migu',
        subscription_id: config.id,
        subscription_name: config.name,
        url
      });
      if (existing) {
        updateStmt.run(event.name, event.category, event.logo, channelId, existing.id);
        updated += 1;
      } else {
        insertStmt.run(event.name, url, event.category, config.id, channelId, event.logo);
        inserted += 1;
      }
    }

    for (const source of existingSources) {
      if (!activeUrls.has(source.url)) {
        deleteStmt.run(source.id);
        removed += 1;
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    total: events.length,
    inserted,
    updated,
    removed,
    baseUrl: effectiveBaseUrl,
    subscriptionId: config.id
  };
}

export async function syncMiguBundleForSubscription(subscriptionId) {
  const subscription = queryOne("SELECT * FROM subscriptions WHERE id = ? AND source_type = 'migu'", subscriptionId);
  if (!subscription) throw new Error('咪咕订阅不存在');

  const config = normalizeMiguSubscription(subscription);
  if (!config.baseUrl) throw new Error('请先填写咪咕播放代理公网地址');

  const channels = await syncMiguSources({ subscription });
  const sports = await syncMiguSportsSources({ subscription });
  return { skipped: false, channels, sports, subscriptionId: config.id };
}

export async function syncAllMiguSubscriptions() {
  const subscriptions = query("SELECT * FROM subscriptions WHERE source_type = 'migu' AND auto_update = 1 ORDER BY id ASC");
  const results = [];
  for (const subscription of subscriptions) {
    results.push(await syncMiguBundleForSubscription(subscription.id));
  }
  deduplicateSourcesByUrl();
  return results;
}

export async function collectMiguEpgProgrammes({ days = 1 } = {}) {
  const miguSources = query(`
    SELECT DISTINCT name, url
    FROM sources
    WHERE origin = 'migu'
      AND category NOT LIKE '体育-%'
    ORDER BY category, name
  `);

  const channels = [];
  const programmes = [];
  const maxDays = Math.max(1, Math.min(Number(days) || 1, 3));

  for (const source of miguSources) {
    const pid = extractMiguPid(source.url);
    if (!pid) continue;

    let addedChannel = false;
    for (let offset = 0; offset < maxDays; offset += 1) {
      const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
      const dateText = getDateString(date);
      try {
        const data = await fetchJson(`${MIGU_PROGRAM_URL}${pid}/${dateText}`, {}, 6000);
        const items = data?.body?.program?.[0]?.content || [];
        if (!Array.isArray(items) || items.length === 0) continue;

        if (!addedChannel) {
          channels.push({ id: source.name, name: source.name });
          addedChannel = true;
        }

        for (const item of items) {
          if (!item?.startTime || !item?.endTime) continue;
          programmes.push({
            channel: source.name,
            start: getXmltvDateTime(new Date(item.startTime)),
            stop: getXmltvDateTime(new Date(item.endTime)),
            title: item.contName || '未知节目'
          });
        }
      } catch {
        // Missing EPG for a channel should not stop the whole EPG build.
      }
    }
  }

  return { channels, programmes };
}

function getSignedAndroidUrl(rawUrl, pid, rateType, userId) {
  const puData = rawUrl.split('&puData=')[1];
  if (!puData) return rawUrl;

  let firstWord = 'v';
  if (userId) {
    firstWord = DD_KEYS[userId[7]] || firstWord;
  }
  if (String(rateType) === '2') {
    firstWord = 'v';
  }
  if (userId.length > 3 && userId.length <= 8) {
    firstWord = 'e';
  }

  const words = [firstWord, 'a', '0', 'a'];
  const ddCalcu = [];
  for (let i = 0; i < puData.length / 2; i += 1) {
    ddCalcu.push(puData[puData.length - i - 1]);
    ddCalcu.push(puData[i]);
    if (i === 1) ddCalcu.push(words[0]);
    if (i === 2) ddCalcu.push(DD_KEYS[new Date().toISOString().slice(0, 10).replaceAll('-', '')[0]]);
    if (i === 3) ddCalcu.push(DD_KEYS[pid[6]]);
    if (i === 4) ddCalcu.push(words[3]);
  }

  return `${rawUrl}&ddCalcu=${ddCalcu.join('')}${DD_SUFFIX}`;
}

function buildPlayHeaders(pid, userId, token, rateType) {
  const headers = {
    AppVersion: ANDROID_APP_VERSION_HEADER,
    TerminalId: 'android',
    'X-UP-CLIENT-CHANNEL-ID': ANDROID_CHANNEL_ID
  };

  if (pid !== '641886683' && pid !== '641886773') {
    headers.appCode = 'miguvideo_default_android';
  }
  if (String(rateType) !== '2' && userId && token) {
    headers.UserId = userId;
    headers.UserToken = token;
  }

  return headers;
}

async function requestMiguPlayUrl(pid, requestedRateType, config, options = {}) {
  const userId = config.userId || '';
  const token = config.token || '';
  const strictRate = options.strictRate === true;
  const requestedRate = Number(requestedRateType || config.rateType || 3);
  let rateType = requestedRate;
  if (!Number.isFinite(rateType) || rateType < 2) rateType = 3;
  const initialRateType = rateType;

  const timestamp = Date.now();
  const sign = md5(md5(`${timestamp}${pid}${ANDROID_APP_VERSION}`) + ANDROID_SIGN_SUFFIX);
  const h265 = config.enableH265 ? '&h265N=true' : '';
  const hdr = config.enableHdr ? '&4kvivid=true&2Kvivid=true&vivid=2' : '';
  const attempts = [];

  async function requestWithRate(nextRateType, useOtt = (Number(nextRateType) === 9)) {
    const params = new URLSearchParams({
      sign,
      rateType: String(nextRateType),
      contId: pid,
      timestamp: String(timestamp),
      salt: ANDROID_SIGN_SALT,
      flvEnable: 'true',
      super4k: 'true'
    });
    const suffix = `${h265}${hdr}${useOtt ? '&ott=true' : ''}`;
    const data = await fetchJson(`${MIGU_PLAY_URL}?${params.toString()}${suffix}`, {
      headers: {
        ...buildPlayHeaders(pid, userId, token, nextRateType),
        ...(config.userAgent ? { 'User-Agent': config.userAgent } : {})
      }
    });
    attempts.push({
      requestedRateType: Number(nextRateType),
      useOtt: !!useOtt,
      returnedRateType: Number(data?.body?.urlInfo?.rateType || 0) || null,
      rid: data?.rid || '',
      message: data?.body?.auth?.resultDesc || data?.msg || ''
    });
    return data;
  }

  let data = await requestWithRate(rateType);

  // 咪咕 4K 降级与三屏会员支持 (借鉴 akiralereal/iptv issue #117 / v4.8.0 / v4.16.0)：
  // 若使用大屏策略 (ott=true) 请求 4K (rateType: 9) 遭到拒绝 (如三屏会员无大屏电视权益)，自动降级按手机端策略 (不带 ott) 重试 4K
  if (Number(rateType) === 9 && (data?.rid === 'TIPS_NEED_MEMBER' || !data?.body?.urlInfo?.url)) {
    const mobileData = await requestWithRate(9, false);
    if (mobileData?.body?.urlInfo?.url) {
      data = mobileData;
    }
  }

  // 常规会员画质降级回退 (非 strictRate 模式下降级到 1080P 或 720P)
  if (data?.rid === 'TIPS_NEED_MEMBER' && !strictRate) {
    const suggestedRate = Number(data?.body?.urlInfo?.rateType || 3);
    rateType = suggestedRate > 4 ? 4 : Math.max(suggestedRate, 3);
    data = await requestWithRate(rateType, false);
  }
  if (data?.rid === 'TIPS_NEED_MEMBER' && !strictRate) {
    rateType = 3;
    data = await requestWithRate(rateType, false);
  }

  const rawUrl = data?.body?.urlInfo?.url;
  const resolvedPid = String(data?.body?.content?.contId || pid);
  const actualRateType = Number(data?.body?.urlInfo?.rateType || rateType);
  if (!rawUrl) {
    let errDesc = data?.body?.auth?.resultDesc || data?.msg || data?.rid || '咪咕未返回播放地址';
    // 借鉴 akiralereal/iptv issue #131：遇到版权保护时给出友好说明
    if (errDesc.includes('节目播出调整') || errDesc.includes('播出调整')) {
      errDesc += ' (咪咕版权临时屏蔽：通常为特定赛事版权保护，节目结束后自动恢复，可先切至其他源)';
    }
    throw new Error(errDesc);
  }

  return {
    signedUrl: getSignedAndroidUrl(rawUrl, resolvedPid, actualRateType, userId),
    requestedRateType: initialRateType,
    requestedRateLabel: getRateTypeLabel(initialRateType),
    actualRateType,
    actualRateLabel: getRateTypeLabel(actualRateType),
    downgraded: actualRateType < initialRateType,
    strictRate,
    hasUser: !!userId,
    hasToken: !!token,
    attempts,
    auth: {
      logined: !!data?.body?.auth?.logined,
      result: data?.body?.auth?.authResult || '',
      description: data?.body?.auth?.resultDesc || ''
    }
  };
}

async function resolveMiguRedirect(url) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal
      });
      const location = response.headers.get('location');
      if (location && !location.startsWith('http://bofang')) {
        return normalizeMiguMediaUrl(location);
      }
      if (response.ok) {
        return normalizeMiguMediaUrl(url);
      }
    } catch (error) {
      if (attempt === 6) throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    await delay(150);
  }

  return normalizeMiguMediaUrl(url);
}

function normalizeMiguMediaUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && /(^|\.)miguvideo\.com$/i.test(parsed.hostname) && parsed.port === '8080') {
      parsed.protocol = 'http:';
      return parsed.toString();
    }
  } catch {
    return String(url || '').replace(/^https:\/\/([^/?#]+\.miguvideo\.com:8080)([/?#]|$)/i, 'http://$1$2');
  }
  return String(url || '').replace(/^https:\/\/([^/?#]+\.miguvideo\.com:8080)([/?#]|$)/i, 'http://$1$2');
}

export async function getMiguPlaybackDetails(pid, requestedRateType, subscriptionId, options = {}) {
  if (!/^\d{3,32}$/.test(String(pid || ''))) {
    throw new Error('无效的咪咕频道 ID');
  }

  const config = getMiguSubscription(subscriptionId);
  if (!config) throw new Error('咪咕订阅不存在');

  const result = await requestMiguPlayUrl(String(pid), requestedRateType, config, options);
  return {
    ...result,
    url: await resolveMiguRedirect(result.signedUrl)
  };
}

export async function getMiguPlaybackUrl(pid, requestedRateType, subscriptionId) {
  const result = await getMiguPlaybackDetails(pid, requestedRateType, subscriptionId);
  return result.url;
}

export function extractMiguCredentials(text = '') {
  if (!text || typeof text !== 'string') return { userId: '', token: '' };
  const str = text.trim();

  let userId = '';
  const uidMatch = str.match(/(?:(?:user_?id|uid|msisdn)[=:\s]+|["'](?:user_?id|uid)["']\s*:\s*["'])([^;"'\s&]+)/i);
  if (uidMatch) {
    userId = uidMatch[1];
  }

  let token = '';
  const tokenMatch = str.match(/(?:(?:user_?token|token|accesstoken|utoken)[=:\s]+|["'](?:user_?token|token)["']\s*:\s*["'])([^;"'\s&]+)/i);
  if (tokenMatch) {
    token = tokenMatch[1];
  }

  return { userId, token };
}

export async function testMiguAccount({
  userId = '',
  token = '',
  cookie = '',
  rateType = 4,
  enableH265 = true,
  enableHdr = false,
  userAgent = ''
} = {}) {
  let normalizedUserId = String(userId || '').trim();
  let normalizedToken = String(token || '').trim();

  // 智能 Cookie 提取：支持粘贴 Cookie/Headers 自动解析
  if (cookie) {
    const extracted = extractMiguCredentials(cookie);
    if (extracted.userId && !normalizedUserId) normalizedUserId = extracted.userId;
    if (extracted.token && !normalizedToken) normalizedToken = extracted.token;
  }
  if (normalizedToken.includes(';') || normalizedToken.includes('=')) {
    const extracted = extractMiguCredentials(normalizedToken);
    if (extracted.userId && !normalizedUserId) normalizedUserId = extracted.userId;
    if (extracted.token) normalizedToken = extracted.token;
  }
  if (normalizedUserId.includes(';') || normalizedUserId.includes('=')) {
    const extracted = extractMiguCredentials(normalizedUserId);
    if (extracted.userId) normalizedUserId = extracted.userId;
    if (extracted.token && !normalizedToken) normalizedToken = extracted.token;
  }

  const requestedRateType = Number(rateType || 4);
  const probePid = requestedRateType >= 7 ? MIGU_4K_TEST_PID : MIGU_ACCOUNT_TEST_PID;
  const probeName = requestedRateType >= 7 ? 'CCTV5体育' : 'CCTV-1';

  if (!normalizedUserId || !normalizedToken) {
    return {
      valid: false,
      member: false,
      highQualityAuthorized: false,
      message: '请先填写咪咕 UserId 和 Token（支持直接粘贴完整 Cookie 自动解析）',
      hasUser: !!normalizedUserId,
      hasToken: !!normalizedToken,
      requestedRateType,
      requestedRateLabel: getRateTypeLabel(requestedRateType),
      probePid,
      probeName
    };
  }

  const config = {
    userId: normalizedUserId,
    token: normalizedToken,
    rateType: String(requestedRateType),
    enableH265: boolSetting(enableH265) || enableH265 === true,
    enableHdr: boolSetting(enableHdr) || enableHdr === true,
    userAgent: String(userAgent || '').trim()
  };

  try {
    const result = await requestMiguPlayUrl(probePid, requestedRateType, config, { strictRate: true });
    const actualRateType = Number(result.actualRateType || 0);
    const highQualityAuthorized = actualRateType >= 4;
    const selectedQualityAuthorized = actualRateType >= requestedRateType;

    let policy = '';
    const lastAttempt = result.attempts?.[result.attempts.length - 1];
    if (actualRateType === 9) {
      policy = lastAttempt?.useOtt ? '大屏 4K 策略' : '手机端 4K 策略 (投屏专享回退)';
    }

    return {
      valid: true,
      member: highQualityAuthorized,
      highQualityAuthorized,
      selectedQualityAuthorized,
      policy,
      extractedUserId: normalizedUserId,
      message: selectedQualityAuthorized
        ? `账号鉴权通过！${policy ? `(${policy}) ` : ''}已成功获取 ${result.actualRateLabel}`
        : highQualityAuthorized
          ? `账号鉴权通过，但当前测试频道实际返回 ${result.actualRateLabel}`
          : `账号可用，但未获取到会员高画质授权，实际返回 ${result.actualRateLabel}`,
      probePid,
      probeName,
      requestedRateType: result.requestedRateType,
      requestedRateLabel: result.requestedRateLabel,
      actualRateType: result.actualRateType,
      actualRateLabel: result.actualRateLabel,
      downgraded: result.downgraded,
      hasUser: result.hasUser,
      hasToken: result.hasToken,
      auth: result.auth,
      attempts: result.attempts
    };
  } catch (error) {
    const errorMsg = String(error.message || '');

    // 智能分级探测：若选了 4K 但被拒绝，进一步自动探测是否具备 1080P 会员权益，避免误判账号失效
    if (requestedRateType >= 7 && (errorMsg.includes('TIPS_NEED_MEMBER') || errorMsg.includes('会员'))) {
      try {
        const fallback1080p = await requestMiguPlayUrl(MIGU_ACCOUNT_TEST_PID, 4, config, { strictRate: true });
        if (Number(fallback1080p?.actualRateType || 0) >= 4) {
          return {
            valid: true,
            member: true,
            highQualityAuthorized: true,
            selectedQualityAuthorized: false,
            maxAuthorizedRate: 4,
            maxAuthorizedLabel: '蓝光 (1080P)',
            extractedUserId: normalizedUserId,
            message: `账号有效！已获得蓝光 (1080P) 会员权限。当前选中的 4K 需开通大屏 VIP 或该频道暂无 4K 流，建议将默认画质设为【蓝光 / 1080p】。`,
            probePid: MIGU_ACCOUNT_TEST_PID,
            probeName: 'CCTV-1',
            requestedRateType,
            requestedRateLabel: getRateTypeLabel(requestedRateType),
            actualRateType: 4,
            actualRateLabel: '蓝光 (1080P)',
            hasUser: true,
            hasToken: true
          };
        }
      } catch {
        // Fallback 1080p failed as well
      }
    }

    if (errorMsg.includes('TIPS_NEED_MEMBER')) {
      return {
        valid: true,
        member: false,
        highQualityAuthorized: false,
        selectedQualityAuthorized: false,
        extractedUserId: normalizedUserId,
        message: '账号可用，但未开通咪咕会员权益（普通游客身份），最高可播放高清 720P。建议将默认画质设为【高清】。',
        probePid,
        probeName,
        requestedRateType,
        requestedRateLabel: getRateTypeLabel(requestedRateType),
        hasUser: true,
        hasToken: true
      };
    }

    return {
      valid: false,
      member: false,
      highQualityAuthorized: false,
      message: errorMsg || '账号鉴权失败，请检查 Token 是否有效',
      probePid,
      probeName,
      requestedRateType,
      requestedRateLabel: getRateTypeLabel(requestedRateType),
      hasUser: true,
      hasToken: true
    };
  }
}

export function getMiguStatus() {
  const channelCount = queryOne("SELECT COUNT(*) AS count FROM sources WHERE origin = 'migu' AND category NOT LIKE '体育-%'")?.count || 0;
  const sportsCount = queryOne("SELECT COUNT(*) AS count FROM sources WHERE origin = 'migu' AND category LIKE '体育-%'")?.count || 0;
  const count = channelCount + sportsCount;
  const activeCount = queryOne("SELECT COUNT(*) AS count FROM sources WHERE origin = 'migu' AND status = 'active'")?.count || 0;
  const subscriptionCount = queryOne("SELECT COUNT(*) AS count FROM subscriptions WHERE source_type = 'migu'")?.count || 0;

  return {
    enabled: subscriptionCount > 0,
    count,
    channelCount,
    sportsCount,
    activeCount,
    subscriptionCount
  };
}
