/**
 * 防客户端扫台与上游频控保护中间件 (Client Scan Guard)
 * 防止 TiviMate / APTV 等播放器短时间内并发请求探测大量频道导致服务器出口 IP 被封
 */

const SCAN_DEFAULTS = {
  distinctLimit: 6,       // 10秒内请求了 >= 6 个不同频道，判定为扫描/扫台
  windowMs: 10_000,       // 判定时间窗口 (10秒)
  idleMs: 5_000,          // 连续 5 秒不再碰新频道即解除拦截
  runGapMs: 30_000,       // 频道间隔 30 秒以上算重新播放
  settleLeadMs: 2_000,    // 扫描开始前 2 秒已经在播放的频道豁免放行
  clientTtlMs: 10 * 60_000, // 客户端记录保活 10 分钟
  maxClients: 2_000,
  announceEveryMs: 10_000 // 提示日志打点周期
};

const clients = new Map();
let sweepCounter = 0;

function pruneClients(now) {
  for (const [key, client] of clients) {
    if (now - client.lastSeen > SCAN_DEFAULTS.clientTtlMs) {
      clients.delete(key);
      continue;
    }
    for (const [channel, run] of client.runs) {
      if (now - run.last > SCAN_DEFAULTS.runGapMs) {
        client.runs.delete(channel);
      }
    }
  }
  if (clients.size > SCAN_DEFAULTS.maxClients) {
    clients.clear();
  }
}

/**
 * 校验播放请求是否为恶意/快速探测
 * @param {string} clientKey 客户端标识 (IP + UA)
 * @param {string} channelKey 频道标识 (URL 或 channelId)
 * @param {number} now
 * @returns {{ allowed: boolean, scanning: boolean, retryAfter: number, logMsg?: string }}
 */
export function checkClientScan(clientKey, channelKey, now = Date.now()) {
  if (!clientKey || !channelKey) {
    return { allowed: true, scanning: false, retryAfter: 0 };
  }

  if (++sweepCounter % 128 === 0 || clients.size > SCAN_DEFAULTS.maxClients) {
    pruneClients(now);
  }

  let client = clients.get(clientKey);
  if (!client) {
    client = {
      lastSeen: now,
      runs: new Map(),
      touches: [],
      scanning: false,
      episodeStart: 0,
      lastTouch: 0,
      blocked: 0,
      announcedAt: 0
    };
    clients.set(clientKey, client);
  }
  client.lastSeen = now;

  let run = client.runs.get(channelKey);
  const touched = !run || (now - run.last > SCAN_DEFAULTS.windowMs);
  if (!run || (now - run.last > SCAN_DEFAULTS.runGapMs)) {
    run = { since: now, last: now };
    client.runs.set(channelKey, run);
  } else {
    run.last = now;
  }

  // 检查是否已解除扫描
  if (client.scanning && (now - client.lastTouch >= SCAN_DEFAULTS.idleMs)) {
    client.scanning = false;
    client.touches.length = 0;
    client.blocked = 0;
  }

  if (touched) {
    client.touches.push(now);
    client.lastTouch = now;
  }

  // 滑动清理过期触摸点
  while (client.touches.length && (now - client.touches[0] >= SCAN_DEFAULTS.windowMs)) {
    client.touches.shift();
  }

  // 触发扫描判定
  if (!client.scanning && client.touches.length >= SCAN_DEFAULTS.distinctLimit) {
    client.scanning = true;
    client.episodeStart = now;
    client.blocked = 0;
    client.announcedAt = 0;
  }

  if (!client.scanning) {
    return { allowed: true, scanning: false, retryAfter: 0 };
  }

  // 豁免：扫描开始前 2 秒就在稳定播放的当前频道照常放行，不掐断正看电视的观众
  if (run.since <= client.episodeStart - SCAN_DEFAULTS.settleLeadMs) {
    return { allowed: true, scanning: true, retryAfter: 0 };
  }

  client.blocked++;
  const announce = now - client.announcedAt >= SCAN_DEFAULTS.announceEveryMs;
  if (announce) {
    client.announcedAt = now;
  }

  const logMsg = announce 
    ? `[ScanGuard] 客户端 ${clientKey} 在 10 秒内连续探测 ${client.touches.length} 个不同频道，判定为播放器扫台，已本地拦截 ${client.blocked} 次`
    : '';

  return {
    allowed: false,
    scanning: true,
    retryAfter: Math.ceil(SCAN_DEFAULTS.idleMs / 1000),
    logMsg
  };
}

/**
 * Express 中间件：为流媒体与直播播放路由拦截扫台
 */
export function scanGuardMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'unknown';
  const clientKey = `${ip}|${ua.slice(0, 30)}`;
  const channelKey = req.originalUrl.split('?')[0];

  const verdict = checkClientScan(clientKey, channelKey);
  if (verdict.logMsg) {
    console.warn(verdict.logMsg);
  }

  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfter));
    return res.status(429).json({
      error: '请求过于频繁：检测到播放器正在快速扫台探测，请稍候 5 秒重试',
      retryAfter: verdict.retryAfter
    });
  }

  next();
}

export default {
  checkClientScan,
  scanGuardMiddleware
};
