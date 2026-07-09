import { exec } from 'child_process';
import dns from 'dns/promises';
import util from 'util';
import { run, query } from './db.js';
import { lookupIP } from './geoip.js';
import { BEIJING_NOW_SQL, formatBeijingIsoAfterHours } from './time.js';

const execPromise = util.promisify(exec);
const SPEED_SAMPLE_MAX_BYTES = 2 * 1024 * 1024;
const SPEED_SAMPLE_MAX_MS = 6000;
const HLS_SEGMENT_SAMPLE_COUNT = 3;
const HLS_BANDWIDTH_ESTIMATE_FACTOR = 0.85;

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
  try {
    await execPromise('ffprobe -version');
    return true;
  } catch {
    return false;
  }
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
      cancel: () => clearTimeout(timeoutId)
    };
  } catch (error) {
    clearTimeout(timeoutId);
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
    await reader.cancel().catch(() => {});
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

async function measureHlsSpeed(url, initialText, headers, timeoutMs) {
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

    const sampleSegments = playlist.segments.slice(0, HLS_SEGMENT_SAMPLE_COUNT);
    let totalBytes = 0;
    let totalDuration = 0;

    for (const segmentUrl of sampleSegments) {
      if (totalBytes >= SPEED_SAMPLE_MAX_BYTES) break;

      const request = await fetchWithTimeout(segmentUrl, headers, timeoutMs);
      try {
        maxDelay = Math.max(maxDelay, request.delay);
        if (!request.response.ok) {
          throw new Error(`媒体分片 HTTP ${request.response.status}`);
        }

        const remainingBytes = SPEED_SAMPLE_MAX_BYTES - totalBytes;
        const sample = await readResponseSample(
          request.response,
          remainingBytes,
          Math.min(SPEED_SAMPLE_MAX_MS, timeoutMs)
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
async function probeWithFfprobe(url, timeoutMs) {
  try {
    // ffprobe command with timeout in microseconds
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of json -timeout ${timeoutMs * 1000} "${url}"`;
    const { stdout } = await execPromise(cmd, { timeout: timeoutMs });
    const info = JSON.parse(stdout);
    if (info.streams && info.streams.length > 0) {
      const stream = info.streams[0];
      const resolution = stream.width && stream.height ? `${stream.width}x${stream.height}` : null;
      const codec = stream.codec_name || null;
      return { resolution, codec };
    }
  } catch (error) {
    // Ignore probing error, return nulls
  }
  return { resolution: null, codec: null };
}

/**
 * Test a single stream URL
 */
export async function testSingleSource(source, settings) {
  const timeout = parseInt(settings.timeout || 10000);
  const minSpeed = parseFloat(settings.minSpeed || 0.2);
  const userAgent = 'IPTV Admin/' + (settings.userAgent || 'Mozilla/5.0');
  
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
    try {
      const addresses = await dns.resolve(host).catch(() => []);
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
    const headers = { 'User-Agent': userAgent };
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

        const hlsResult = await measureHlsSpeed(source.url, text, headers, timeout);
        speed = hlsResult.speed;
        delay = Math.max(delay, hlsResult.delay || 0);
        if (!resolution && hlsResult.resolution) resolution = hlsResult.resolution;
        if (!codec && hlsResult.codec) codec = hlsResult.codec;
      } else {
        // Direct stream (TS, MP4, etc.), measure real download speed.
        const sample = await readResponseSample(
          response,
          SPEED_SAMPLE_MAX_BYTES,
          Math.min(SPEED_SAMPLE_MAX_MS, timeout)
        );
        speed = sample.speed;
      }
    } finally {
      request.cancel();
    }

    // 4. Fallback to ffprobe if resolution wasn't in HLS playlist
    if (!resolution && await isFfprobeAvailable()) {
      const probe = await probeWithFfprobe(source.url, 5000);
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
    run(`
      UPDATE sources 
      SET status = ?, delay = ?, speed = ?, resolution = ?, codec = ?, ipv_type = ?, region = ?, isp = ?, fail_count = 0, frozen_until = NULL, last_tested_at = ${BEIJING_NOW_SQL}
      WHERE id = ?
    `, status, delay, speed, resolution, codec, ipvType, region, isp, source.id);
    run(`
      UPDATE optimized_sources
      SET status = ?, delay = ?, speed = ?, resolution = ?, codec = ?, ipv_type = ?, region = ?, isp = ?
      WHERE original_source_id = ?
    `, status, delay, speed, resolution, codec, ipvType, region, isp, source.id);

    return { success: true, status, delay, speed, resolution, codec };

  } catch (err) {
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

  const queue = [...sourcesList];

  const worker = async () => {
    while (queue.length > 0) {
      if (!testStatus.running) {
        break;
      }
      const source = queue.shift();
      if (!source) continue;

      // Skip testing if frozen
      if (source.frozen_until && new Date(source.frozen_until) > new Date()) {
        testStatus.completed++;
        testStatus.failedCount++;
        continue;
      }

      testStatus.currentItem = source.name;
      
      // Update status in DB to testing
      run("UPDATE sources SET status = 'testing' WHERE id = ?", source.id);
      run("UPDATE optimized_sources SET status = 'testing' WHERE original_source_id = ?", source.id);

      const result = await testSingleSource(source, settings);
      
      testStatus.completed++;
      if (result.success && result.status === 'active') {
        testStatus.successCount++;
      } else {
        testStatus.failedCount++;
      }
    }
  };

  // Start concurrent workers
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, worker);
  
  // Run in background
  Promise.all(workers).finally(() => {
    testStatus.running = false;
    testStatus.currentItem = '';
    console.log(`Test task completed. Total: ${testStatus.total}, Success: ${testStatus.successCount}, Failed: ${testStatus.failedCount}`);
  });
}
