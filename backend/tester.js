import { execFile } from 'child_process';
import dns from 'dns/promises';
import net from 'net';
import util from 'util';
import { run, query } from './db.js';
import { lookupIP } from './geoip.js';
import { BEIJING_NOW_SQL, formatBeijingIsoAfterHours } from './time.js';
import { buildStreamHeaders as buildSourceStreamHeaders } from './playlist.js';

const execFilePromise = util.promisify(execFile);
const BALANCED_SPEED_SAMPLE_MAX_BYTES = 1024 * 1024;
const FAST_SPEED_SAMPLE_MAX_BYTES = 256 * 1024;
const BALANCED_SPEED_SAMPLE_MAX_MS = 3000;
const FAST_SPEED_SAMPLE_MAX_MS = 1500;
const BALANCED_HLS_SEGMENT_SAMPLE_COUNT = 2;
const FAST_HLS_SEGMENT_SAMPLE_COUNT = 1;
const HLS_BANDWIDTH_ESTIMATE_FACTOR = 0.85;
const DEFAULT_PLAYER_USER_AGENT = 'TiviMate/5.1.0';
let ffprobeAvailablePromise = null;

// Global status of active test run
export const testStatus = {
  running: false,
  total: 0,
  completed: 0,
  successCount: 0,
  failedCount: 0,
  currentItem: ''
};

// Check if ffprobe is installed in the system
async function isFfprobeAvailable() {
  if (!ffprobeAvailablePromise) {
    ffprobeAvailablePromise = execFilePromise('ffprobe', ['-version'], { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
  }
  return ffprobeAvailablePromise;
}

/**
 * Parses HLS playlist for resolution, codecs, and ad loops
 * @param {string} text 
 * @returns {{resolution: string|null, codec: string|null, isAd: boolean}}
 */
function parseM3u8Metadata(text) {
  let resolution = null;
  let codec = null;
  let isAd = false;

  // Find resolution in master playlist
  const resMatch = text.match(/RESOLUTION=(\d+x\d+)/i);
  if (resMatch) {
    resolution = resMatch[1];
  }

  // Find codecs
  const codecMatch = text.match(/CODECS="([^"]+)"/i);
  if (codecMatch) {
    codec = codecMatch[1].split(',')[0]; // Take first codec
  }

  // Detect loop/ad play list
  if (text.includes('#EXT-X-ENDLIST')) {
    // Sum duration of all segments
    const infMatches = [...text.matchAll(/#EXTINF:(\d+(\.\d+)?)/g)];
    const totalDuration = infMatches.reduce((sum, match) => sum + parseFloat(match[1]), 0);
    
    // If it's a finished playlist and total length is less than 60s, it's likely a loop placeholder/ad
    if (totalDuration > 0 && totalDuration < 60) {
      isAd = true;
    }
  }

  // Common ad URL patterns in segments
  if (text.includes('ad_loop') || text.includes('ad_video') || text.includes('placeholder')) {
    isAd = true;
  }

  return { resolution, codec, isAd };
}

function parseHlsPlaylist(text, playlistUrl) {
  const variants = [];
  const segments = [];
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let pendingVariant = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      pendingVariant = {
        bandwidth: parseInt(line.match(/BANDWIDTH=(\d+)/i)?.[1] || '0'),
        resolution: line.match(/RESOLUTION=(\d+x\d+)/i)?.[1] || null,
        codec: line.match(/CODECS="([^"]+)"/i)?.[1]?.split(',')[0] || null
      };
      continue;
    }

    if (line.startsWith('#')) continue;

    const absoluteUrl = new URL(line, playlistUrl).toString();
    if (pendingVariant) {
      variants.push({ ...pendingVariant, url: absoluteUrl });
      pendingVariant = null;
    } else {
      segments.push(absoluteUrl);
    }
  }

  return { variants, segments };
}

function estimateSpeedFromHlsBandwidth(bandwidth) {
  const parsed = Number(bandwidth || 0);
  if (!parsed || parsed <= 0) return 0;
  return (parsed / 8 / 1024 / 1024) * HLS_BANDWIDTH_ESTIMATE_FACTOR;
}

function isRecoverableHlsSampleError(error) {
  const message = String(error?.message || '');
  return /超时|aborted|terminated|fetch failed|network|ECONNRESET|UND_ERR/i.test(message);
}

function buildStreamHeaders(settings = {}, source = {}) {
  return {
    ...buildSourceStreamHeaders(settings, source),
    'Accept': '*/*'
  };
}

function isEnabledSetting(value) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function getTestProfile(settings = {}) {
  const fastMode = isEnabledSetting(settings.testFastMode ?? '1');
  return {
    fastMode,
    speedSampleMaxBytes: parsePositiveInt(
      settings.speedSampleMaxBytes,
      fastMode ? FAST_SPEED_SAMPLE_MAX_BYTES : BALANCED_SPEED_SAMPLE_MAX_BYTES,
      64 * 1024,
      4 * 1024 * 1024
    ),
    speedSampleMaxMs: parsePositiveInt(
      settings.speedSampleMaxMs,
      fastMode ? FAST_SPEED_SAMPLE_MAX_MS : BALANCED_SPEED_SAMPLE_MAX_MS,
      500,
      10000
    ),
    hlsSegmentSampleCount: parsePositiveInt(
      settings.hlsSegmentSampleCount,
      fastMode ? FAST_HLS_SEGMENT_SAMPLE_COUNT : BALANCED_HLS_SEGMENT_SAMPLE_COUNT,
      1,
      5
    ),
    ffprobeMetadataEnabled: isEnabledSetting(settings.ffprobeMetadataEnabled),
    ffprobeFallbackEnabled: isEnabledSetting(settings.ffprobeFallbackEnabled)
  };
}

function isIpv4Multicast(hostname = '') {
  const parts = String(hostname).split('.').map(part => Number(part));
  return parts.length === 4
    && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] >= 224
    && parts[0] <= 239;
}

function isIpv6Multicast(hostname = '') {
  return String(hostname).toLowerCase().replace(/^\[|\]$/g, '').startsWith('ff');
}

function isMulticastStreamUrl(url) {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname;
    return protocol === 'rtp:'
      || protocol === 'udp:'
      || isIpv4Multicast(hostname)
      || isIpv6Multicast(hostname);
  } catch {
    return false;
  }
}

function buildFfprobeArgs(url, timeoutMs, headers = {}) {
  const userAgent = headers['User-Agent'] || DEFAULT_PLAYER_USER_AGENT;
  const extraHeaders = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() !== 'user-agent')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');

  const args = [
    '-v', 'error',
    '-rw_timeout', String(timeoutMs * 1000),
    '-user_agent', userAgent
  ];

  if (extraHeaders) {
    args.push('-headers', `${extraHeaders}\r\n`);
  }

  args.push(
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name:format=format_name,bit_rate',
    '-of', 'json',
    '-i', url
  );

  return args;
}

async function resolveHostWithTimeout(host, timeoutMs = 3000) {
  if (!host || net.isIP(host)) return host ? [host] : [];
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS lookup timeout')), timeoutMs);
    });
    return await Promise.race([
      dns.resolve(host),
      timeoutPromise
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers
    });

    return {
      response,
      delay: Date.now() - startedAt,
      cancel: () => {
        clearTimeout(timeoutId);
        try { controller.abort(); } catch {}
      }
    };
  } catch (error) {
    clearTimeout(timeoutId);
    try { controller.abort(); } catch {}
    throw error;
  }
}

async function readResponseSample(response, maxBytes, maxMs) {
  if (!response.body) {
    throw new Error('响应体不可读，无法测速');
  }

  const reader = response.body.getReader();
  const startedAt = Date.now();
  let bytesRead = 0;

  try {
    while (bytesRead < maxBytes) {
      const remainingMs = maxMs - (Date.now() - startedAt);
      if (remainingMs <= 0) break;

      let timeoutId;
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('读取测速数据超时')), remainingMs);
        })
      ]).finally(() => clearTimeout(timeoutId));

      if (result.done) break;
      bytesRead += result.value?.byteLength || result.value?.length || 0;
    }
  } finally {
    // Non-blocking reader cancel: don't await to avoid hanging on stalled TCP sockets
    try {
      reader.cancel().catch(() => {});
    } catch {}
  }

  if (bytesRead <= 0) {
    throw new Error('未读取到有效媒体数据');
  }

  const duration = Math.max((Date.now() - startedAt) / 1000, 0.001);
  return {
    bytes: bytesRead,
    duration,
    speed: (bytesRead / (1024 * 1024)) / duration
  };
}

async function fetchPlaylistText(url, headers, timeoutMs) {
  const request = await fetchWithTimeout(url, headers, timeoutMs);
  try {
    if (!request.response.ok) {
      throw new Error(`HTTP ${request.response.status}`);
    }

    const text = await request.response.text();
    return {
      text,
      delay: request.delay,
      contentType: request.response.headers.get('content-type') || ''
    };
  } finally {
    request.cancel();
  }
}

async function measureHlsSpeed(url, initialText, headers, timeoutMs, profile) {
  let playlistUrl = url;
  let playlistText = initialText;
  let maxDelay = 0;
  let resolution = null;
  let codec = null;
  let advertisedBandwidth = 0;

  for (let depth = 0; depth < 3; depth++) {
    const meta = parseM3u8Metadata(playlistText);
    if (meta.isAd) {
      throw new Error('Ad or looped placeholder stream detected');
    }
    if (!resolution && meta.resolution) resolution = meta.resolution;
    if (!codec && meta.codec) codec = meta.codec;

    const playlist = parseHlsPlaylist(playlistText, playlistUrl);
    if (playlist.variants.length > 0) {
      const selectedVariant = playlist.variants
        .sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];

      advertisedBandwidth = selectedVariant.bandwidth || advertisedBandwidth;
      if (!resolution && selectedVariant.resolution) resolution = selectedVariant.resolution;
      if (!codec && selectedVariant.codec) codec = selectedVariant.codec;

      let childPlaylist;
      try {
        childPlaylist = await fetchPlaylistText(selectedVariant.url, headers, timeoutMs);
      } catch (error) {
        const estimatedSpeed = estimateSpeedFromHlsBandwidth(advertisedBandwidth);
        if (estimatedSpeed > 0) {
          return {
            speed: estimatedSpeed,
            delay: maxDelay,
            resolution,
            codec
          };
        }
        throw error;
      }
      maxDelay = Math.max(maxDelay, childPlaylist.delay);
      playlistUrl = selectedVariant.url;
      playlistText = childPlaylist.text;
      continue;
    }

    if (playlist.segments.length === 0) {
      throw new Error('HLS 列表中没有可测速的媒体分片');
    }

    const sampleSegments = playlist.segments.slice(0, profile.hlsSegmentSampleCount);
    let totalBytes = 0;
    let totalDuration = 0;

    for (const segmentUrl of sampleSegments) {
      if (totalBytes >= profile.speedSampleMaxBytes) break;

      const request = await fetchWithTimeout(segmentUrl, headers, timeoutMs);
      try {
        maxDelay = Math.max(maxDelay, request.delay);
        if (!request.response.ok) {
          throw new Error(`媒体分片 HTTP ${request.response.status}`);
        }

        const remainingBytes = profile.speedSampleMaxBytes - totalBytes;
        const sample = await readResponseSample(
          request.response,
          remainingBytes,
          Math.min(profile.speedSampleMaxMs, timeoutMs)
        );
        totalBytes += sample.bytes;
        totalDuration += sample.duration;
      } finally {
        request.cancel();
      }
    }

    if (totalBytes <= 0 || totalDuration <= 0) {
      throw new Error('HLS 媒体分片测速失败');
    }

    return {
      speed: (totalBytes / (1024 * 1024)) / totalDuration,
      delay: maxDelay,
      resolution,
      codec
    };
  }

  throw new Error('HLS playlist 嵌套层级过深，无法测速');
}

/**
 * Call ffprobe to inspect video properties
 */
async function probeWithFfprobe(url, timeoutMs, headers = {}) {
  try {
    const { stdout } = await execFilePromise(
      'ffprobe',
      buildFfprobeArgs(url, timeoutMs, headers),
      {
        timeout: timeoutMs + 1000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024
      }
    );
    const info = JSON.parse(stdout);
    if (info.streams && info.streams.length > 0) {
      const stream = info.streams[0];
      const resolution = stream.width && stream.height ? `${stream.width}x${stream.height}` : null;
      const codec = stream.codec_name || null;
      const bitRate = Number(info.format?.bit_rate || 0);
      const speed = bitRate > 0 ? bitRate / 8 / 1024 / 1024 : 0;
      return { playable: true, resolution, codec, speed };
    }
  } catch (error) {
    // Ignore probing error, return nulls
  }
  return { playable: false, resolution: null, codec: null, speed: 0 };
}

async function probePlayableWithFfprobe(url, headers, timeoutMs) {
  try {
    const { stdout } = await execFilePromise(
      'ffprobe',
      buildFfprobeArgs(url, timeoutMs, headers),
      {
        timeout: timeoutMs + 1000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024
      }
    );
    const info = JSON.parse(stdout);
    const stream = info.streams?.[0] || null;
    if (!stream) {
      return { playable: false, resolution: null, codec: null, speed: 0 };
    }

    const bitRate = Number(info.format?.bit_rate || 0);
    return {
      playable: true,
      resolution: stream.width && stream.height ? `${stream.width}x${stream.height}` : null,
      codec: stream.codec_name || null,
      speed: bitRate > 0 ? bitRate / 8 / 1024 / 1024 : 0
    };
  } catch {
    return { playable: false, resolution: null, codec: null, speed: 0 };
  }
}

function persistTestResult(sourceId, result) {
  run(`
    UPDATE sources 
    SET status = ?, delay = ?, speed = ?, resolution = ?, codec = ?, ipv_type = ?, region = ?, isp = ?, fail_count = 0, frozen_until = NULL, last_tested_at = ${BEIJING_NOW_SQL}
    WHERE id = ?
  `, result.status, result.delay, result.speed, result.resolution, result.codec, result.ipvType, result.region, result.isp, sourceId);
  run(`
    UPDATE optimized_sources
    SET status = ?, delay = ?, speed = ?, resolution = ?, codec = ?, ipv_type = ?, region = ?, isp = ?
    WHERE original_source_id = ?
  `, result.status, result.delay, result.speed, result.resolution, result.codec, result.ipvType, result.region, result.isp, sourceId);
}

export function isMiguSource(source) {
  if (!source) return false;
  if (source.origin === 'migu') return true;
  const url = String(source.url || '');
  if (/miguvideo\.com|cmvideo\.cn/i.test(url)) return true;
  const subName = String(source.subscription_name || '');
  if (/migu/i.test(subName) || subName.includes('咪咕')) return true;
  return false;
}

/**
 * Test a single stream URL
 */
export async function testSingleSource(source, settings) {
  const timeout = parseInt(settings.timeout || 10000);
  const minSpeed = parseFloat(settings.minSpeed || 0.2);
  const headers = buildStreamHeaders(settings, source);
  const profile = getTestProfile(settings);

  // Skip testing for Migu sources (always active by default)
  if (isMiguSource(source)) {
    const urlStr = String(source.url || '');
    const isIpv6 = urlStr.includes('[') || urlStr.includes('ipv6');
    const ipvType = source.ipv_type || (isIpv6 ? 'ipv6' : 'ipv4');
    const defaultDelay = Number(source.delay) > 0 ? Number(source.delay) : 50;
    const defaultSpeed = Number(source.speed) > 0 ? Number(source.speed) : Math.max(minSpeed, 5.0);
    const resolution = source.resolution || '1920x1080';
    const codec = source.codec || 'h264';
    const region = source.region || '全国';
    const isp = source.isp || '中国移动';

    persistTestResult(source.id, {
      status: 'active',
      delay: defaultDelay,
      speed: defaultSpeed,
      resolution,
      codec,
      ipvType,
      region,
      isp
    });
    return {
      success: true,
      status: 'active',
      delay: defaultDelay,
      speed: defaultSpeed,
      resolution,
      codec,
      skipped: true,
      reason: 'migu_default_active'
    };
  }

  // Fengshows official FLV streams are dynamically authenticated on-demand by proxy
  if (source.channel_id?.startsWith('fengshows-') || (source.origin === 'extractor' && source.name?.includes('凤凰'))) {
    const defaultDelay = 120;
    const defaultSpeed = Math.max(minSpeed, 3.5);
    const resolution = '1280x720';
    const codec = 'h264';
    const ipvType = 'ipv4';
    const region = '香港';
    const isp = '凤凰秀官方';

    persistTestResult(source.id, {
      status: 'active',
      delay: defaultDelay,
      speed: defaultSpeed,
      resolution,
      codec,
      ipvType,
      region,
      isp
    });
    return {
      success: true,
      status: 'active',
      delay: defaultDelay,
      speed: defaultSpeed,
      resolution,
      codec,
      skipped: true,
      reason: 'fengshows_default_active'
    };
  }
  
  const start = Date.now();
  let delay = -1;
  let speed = 0.0;
  let resolution = null;
  let codec = null;
  let isAd = false;
  let status = 'inactive';
  
  let ip = '';
  let region = '未知';
  let isp = '未知';

  try {
    // 1. Resolve domain IP
    const urlObj = new URL(source.url);
    const host = urlObj.hostname;

    if (isEnabledSetting(settings.multicastDefaultActive) && isMulticastStreamUrl(source.url)) {
      const ipvType = host.includes(':') || isIpv6Multicast(host) ? 'ipv6' : 'ipv4';
      const fallbackSpeed = Math.max(minSpeed, 0.01);
      persistTestResult(source.id, {
        status: 'active',
        delay: 0,
        speed: fallbackSpeed,
        resolution,
        codec,
        ipvType,
        region: '组播',
        isp: '组播'
      });
      return {
        success: true,
        status: 'active',
        delay: 0,
        speed: fallbackSpeed,
        resolution,
        codec,
        fallback: 'multicast-default-active'
      };
    }

    try {
      const addresses = await resolveHostWithTimeout(host, 3000);
      if (addresses.length > 0) {
        ip = addresses[0];
        const geo = await lookupIP(ip);
        region = geo.region;
        isp = geo.isp;
      }
    } catch {
      // DNS resolve error, lookup will be default
    }

    // 2. HTTP Request
    const request = await fetchWithTimeout(source.url, headers, timeout);
    const response = request.response;
    
    // connection latency (TTFB)
    delay = Date.now() - start;

    try {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      const isHls = source.url.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL');

      // 3. Read body for speed testing and parse if HLS text
      if (isHls) {
        const text = await response.text();
        request.cancel();

        const meta = parseM3u8Metadata(text);
        resolution = meta.resolution;
        codec = meta.codec;
        isAd = meta.isAd;

        if (isAd) {
          throw new Error('Ad or looped placeholder stream detected');
        }

        try {
          const hlsResult = await measureHlsSpeed(source.url, text, headers, timeout, profile);
          speed = hlsResult.speed;
          delay = Math.max(delay, hlsResult.delay || 0);
          if (!resolution && hlsResult.resolution) resolution = hlsResult.resolution;
          if (!codec && hlsResult.codec) codec = hlsResult.codec;
        } catch (error) {
          if (!isRecoverableHlsSampleError(error)) {
            throw error;
          }

          const playlist = parseHlsPlaylist(text, source.url);
          if (playlist.variants.length === 0 && playlist.segments.length === 0) {
            throw error;
          }

          const bestVariant = playlist.variants
            .sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
          speed = Math.max(estimateSpeedFromHlsBandwidth(bestVariant?.bandwidth), minSpeed);
          delay = Math.max(delay, Date.now() - start);
          if (!resolution && bestVariant?.resolution) resolution = bestVariant.resolution;
          if (!codec && bestVariant?.codec) codec = bestVariant.codec;
        }
      } else {
        // Direct stream (TS, MP4, etc.), measure real download speed.
        const sample = await readResponseSample(
          response,
          profile.speedSampleMaxBytes,
          Math.min(profile.speedSampleMaxMs, timeout)
        );
        speed = sample.speed;
      }
    } finally {
      request.cancel();
    }

    // 4. Fallback to ffprobe if resolution wasn't in HLS playlist
    if (profile.ffprobeMetadataEnabled && !resolution && await isFfprobeAvailable()) {
      const probe = await probeWithFfprobe(source.url, 5000, headers);
      if (probe.resolution) resolution = probe.resolution;
      if (probe.codec) codec = probe.codec;
    }

    // Determine IPv protocol
    const ipvType = ip.includes(':') ? 'ipv6' : 'ipv4';

    // Verify speed meets minimum limit
    if (speed >= minSpeed) {
      status = 'active';
    } else {
      status = 'inactive'; // low speed
    }

    // Successful test: reset fails
    persistTestResult(source.id, { status, delay, speed, resolution, codec, ipvType, region, isp });

    return { success: true, status, delay, speed, resolution, codec };

  } catch (err) {
    if (profile.ffprobeFallbackEnabled && await isFfprobeAvailable()) {
      const probeTimeout = Math.min(Math.max(timeout, 5000), 10000);
      const probe = await probePlayableWithFfprobe(source.url, headers, probeTimeout);
      if (probe.playable) {
        const ipvType = ip.includes(':') ? 'ipv6' : 'ipv4';
        const fallbackSpeed = Math.max(probe.speed || 0, minSpeed);
        const fallbackDelay = delay >= 0 ? delay : Date.now() - start;
        persistTestResult(source.id, {
          status: 'active',
          delay: fallbackDelay,
          speed: fallbackSpeed,
          resolution: probe.resolution,
          codec: probe.codec,
          ipvType,
          region,
          isp
        });
        return {
          success: true,
          status: 'active',
          delay: fallbackDelay,
          speed: fallbackSpeed,
          resolution: probe.resolution,
          codec: probe.codec,
          fallback: 'ffprobe'
        };
      }
    }

    // Failed test
    const currentFails = Number(source.fail_count || 0) + 1;
    let frozenUntil = null;
    
    // Freeze for 24 hours if fails 3 consecutive times
    if (currentFails >= 3) {
      const cooldownHours = 24 * Math.pow(2, Math.min(currentFails - 3, 3)); // Exponential backoff max 8 days (24 * 8 = 192 hrs)
      frozenUntil = formatBeijingIsoAfterHours(cooldownHours);
    }

    // Update fails in db
    run(`
      UPDATE sources 
      SET status = 'inactive', delay = -1, speed = 0.0, fail_count = ?, frozen_until = ?, last_tested_at = ${BEIJING_NOW_SQL}
      WHERE id = ?
    `, currentFails, frozenUntil, source.id);
    run(`
      UPDATE optimized_sources
      SET status = 'inactive', delay = -1, speed = 0.0
      WHERE original_source_id = ?
    `, source.id);

    return { success: false, error: err.message };
  }
}

/**
 * Wraps testSingleSource with a strict hard ceiling timeout
 * so no dead stream or blocking process can ever hang a worker indefinitely.
 */
export async function testSingleSourceWithHardTimeout(source, settings) {
  const timeoutMs = parseInt(settings.timeout || 10000);
  const hardCeilingMs = Math.max(timeoutMs * 2 + 5000, 20000);

  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`单源测试整体超时 (${Math.round(hardCeilingMs / 1000)}秒)`));
    }, hardCeilingMs);
  });

  try {
    return await Promise.race([
      testSingleSource(source, settings),
      timeoutPromise
    ]);
  } catch (err) {
    try {
      run(`
        UPDATE sources 
        SET status = 'inactive', delay = -1, speed = 0.0, last_tested_at = ${BEIJING_NOW_SQL}
        WHERE id = ?
      `, source.id);
      run(`
        UPDATE optimized_sources
        SET status = 'inactive', delay = -1, speed = 0.0
        WHERE original_source_id = ?
      `, source.id);
    } catch {}
    return { success: false, status: 'inactive', error: err.message };
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Test a list of sources concurrently
 */
export async function runTestOnSources(sourcesList) {
  if (testStatus.running) {
    throw new Error('Test task is already running');
  }

  // Get active settings
  const settingsRows = query('SELECT key, value FROM settings');
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const concurrency = parseInt(settings.concurrency || 5);

  testStatus.running = true;
  testStatus.total = sourcesList.length;
  testStatus.completed = 0;
  testStatus.successCount = 0;
  testStatus.failedCount = 0;
  testStatus.currentItem = '';

  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < sourcesList.length) {
      if (!testStatus.running) {
        break;
      }
      const source = sourcesList[nextIndex++];
      if (!source) continue;

      // Skip testing if frozen
      if (source.frozen_until && new Date(source.frozen_until) > new Date()) {
        testStatus.completed++;
        testStatus.failedCount++;
        continue;
      }

      // Skip Migu sources directly (default active)
      if (isMiguSource(source)) {
        testStatus.currentItem = `${source.name} (咪咕跳过)`;
        try {
          await testSingleSource(source, settings);
          testStatus.successCount++;
        } catch {
          testStatus.failedCount++;
        } finally {
          testStatus.completed++;
        }
        continue;
      }

      testStatus.currentItem = source.name;
      
      // Update status in DB to testing
      try {
        run("UPDATE sources SET status = 'testing' WHERE id = ?", source.id);
        run("UPDATE optimized_sources SET status = 'testing' WHERE original_source_id = ?", source.id);
      } catch {}

      try {
        const result = await testSingleSourceWithHardTimeout(source, settings);
        if (result && result.success && result.status === 'active') {
          testStatus.successCount++;
        } else {
          testStatus.failedCount++;
        }
      } catch (err) {
        testStatus.failedCount++;
      } finally {
        testStatus.completed++;
      }
    }
  };

  // Start concurrent workers
  const workers = Array.from({ length: Math.min(concurrency, sourcesList.length) }, worker);
  
  // Safety watchdog: ensure task never hangs indefinitely if any promise deadlocks
  const maxTotalTimeMs = Math.max(sourcesList.length * 6000, 60000);
  let watchdogTimer;
  const watchdogPromise = new Promise(resolve => {
    watchdogTimer = setTimeout(() => {
      if (testStatus.running) {
        console.warn(`[Tester] Task safety watchdog triggered after ${Math.round(maxTotalTimeMs / 1000)}s, finishing task.`);
        resolve();
      }
    }, maxTotalTimeMs);
  });

  // Run in background
  Promise.race([
    Promise.all(workers),
    watchdogPromise
  ]).finally(() => {
    clearTimeout(watchdogTimer);
    testStatus.running = false;
    testStatus.currentItem = '';
    console.log(`Test task completed. Total: ${testStatus.total}, Success: ${testStatus.successCount}, Failed: ${testStatus.failedCount}`);
  });
}
