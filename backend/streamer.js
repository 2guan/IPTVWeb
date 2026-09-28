import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { query, queryOne, run } from './db.js';
import { buildStreamHeaders } from './playlist.js';

export const HLS_ROOT = path.resolve('./data/streams/hls');

const runningStreams = new Map();
const lastStates = new Map();
let idleTimer = null;

function ensureHlsRoot() {
  fs.mkdirSync(HLS_ROOT, { recursive: true });
}

function readStreamSettings() {
  const rows = query("SELECT key, value FROM settings WHERE key IN ('streamTranscodeMode', 'streamMaxStreams', 'streamIdleTimeout', 'streamSegmentSeconds', 'streamListSize', 'userAgent')");
  const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    ...settings,
    streamTranscodeMode: settings.streamTranscodeMode || 'copy',
    streamMaxStreams: Math.max(parseInt(settings.streamMaxStreams || '6'), 1),
    streamIdleTimeout: Math.max(parseInt(settings.streamIdleTimeout || '300'), 30),
    streamSegmentSeconds: Math.max(parseInt(settings.streamSegmentSeconds || '4'), 1),
    streamListSize: Math.max(parseInt(settings.streamListSize || '8'), 3)
  };
}

function streamDir(sourceId) {
  return path.join(HLS_ROOT, String(sourceId));
}

function playlistPath(sourceId) {
  return path.join(streamDir(sourceId), 'index.m3u8');
}

function removeStreamFiles(sourceId) {
  fs.rmSync(streamDir(sourceId), { recursive: true, force: true });
  fs.mkdirSync(streamDir(sourceId), { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHttpUrl(url = '') {
  return /^https?:\/\//i.test(url);
}

function buildInputArgs(source, headers) {
  const args = ['-hide_banner', '-loglevel', 'warning'];
  if (isHttpUrl(source.url)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  }

  if (headers['User-Agent']) {
    args.push('-user_agent', headers['User-Agent']);
  }

  const extraHeaders = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() !== 'user-agent')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');

  if (extraHeaders) {
    args.push('-headers', `${extraHeaders}\r\n`);
  }

  args.push('-i', source.url);
  return args;
}

function buildOutputArgs(sourceId, settings, mode) {
  const segmentPath = path.join(streamDir(sourceId), 'segment_%05d.ts');
  const args = [];
  if (mode === 'transcode') {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  } else {
    args.push('-c', 'copy');
  }

  args.push(
    '-f', 'hls',
    '-hls_time', String(settings.streamSegmentSeconds),
    '-hls_list_size', String(settings.streamListSize),
    '-hls_flags', 'delete_segments+omit_endlist+program_date_time',
    '-hls_segment_filename', segmentPath,
    playlistPath(sourceId)
  );
  return args;
}

function normalizeMode(mode, source = {}) {
  const requested = String(mode || '').toLowerCase();
  if (requested === 'copy' || requested === 'transcode' || requested === 'auto') return requested;

  const codec = String(source.codec || '').toLowerCase();
  if (['hevc', 'h265', 'x265', 'av1'].some(item => codec.includes(item))) return 'transcode';
  return 'copy';
}

function setState(sourceId, patch) {
  const prev = lastStates.get(Number(sourceId)) || {};
  const next = {
    sourceId: Number(sourceId),
    status: 'stopped',
    running: false,
    ...prev,
    ...patch
  };
  lastStates.set(Number(sourceId), next);
  return next;
}

function cleanupExitedStreams() {
  for (const [sourceId, entry] of runningStreams.entries()) {
    if (!entry.process || entry.process.killed || entry.process.exitCode !== null) {
      runningStreams.delete(sourceId);
    }
  }
}

function enforceMaxStreams(settings) {
  cleanupExitedStreams();
  while (runningStreams.size >= settings.streamMaxStreams) {
    const oldest = [...runningStreams.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
    if (!oldest) break;
    stopStream(oldest.sourceId, '超过最大推流并发，自动停止最久未访问的流');
  }
}

function spawnFfmpeg(source, settings, mode) {
  ensureHlsRoot();
  removeStreamFiles(source.id);

  const headers = buildStreamHeaders(settings, source);
  const args = [
    ...buildInputArgs(source, headers),
    ...buildOutputArgs(source.id, settings, mode)
  ];

  const process = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  process.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000);
  });

  const entry = {
    sourceId: Number(source.id),
    sourceName: source.name,
    url: source.url,
    mode,
    process,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    stderr: () => stderr
  };

  runningStreams.set(Number(source.id), entry);
  setState(source.id, {
    status: 'starting',
    running: true,
    sourceName: source.name,
    mode,
    error: '',
    hlsPath: `/stream/hls/${source.id}/index.m3u8`
  });

  process.on('close', code => {
    const current = runningStreams.get(Number(source.id));
    if (current?.process === process) {
      runningStreams.delete(Number(source.id));
    }
    setState(source.id, {
      status: code === 0 ? 'stopped' : 'failed',
      running: false,
      sourceName: source.name,
      mode,
      error: code === 0 ? '' : (stderr || `ffmpeg exited with code ${code}`)
    });
  });

  return entry;
}

async function waitForPlaylistReady(sourceId, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(playlistPath(sourceId))) {
      const content = fs.readFileSync(playlistPath(sourceId), 'utf8');
      if (content.includes('#EXTINF')) return true;
    }
    await sleep(500);
  }
  return false;
}

async function startWithMode(source, settings, mode) {
  const entry = spawnFfmpeg(source, settings, mode);
  await sleep(2500);
  if (entry.process.exitCode !== null) {
    throw new Error(entry.stderr() || `ffmpeg failed in ${mode} mode`);
  }
  setState(source.id, {
    status: 'running',
    running: true,
    sourceName: source.name,
    mode,
    error: '',
    hlsPath: `/stream/hls/${source.id}/index.m3u8`
  });
  return getStreamStatus(source.id);
}

export async function startStreamForSource(source, options = {}) {
  if (!source?.id || !source?.url) {
    throw new Error('直播源不存在或缺少 URL');
  }

  const existing = runningStreams.get(Number(source.id));
  if (existing && existing.process.exitCode === null) {
    existing.lastAccess = Date.now();
    return getStreamStatus(source.id);
  }

  const settings = readStreamSettings();
  enforceMaxStreams(settings);

  const mode = normalizeMode(options.mode || settings.streamTranscodeMode, source);
  if (mode === 'auto') {
    try {
      return await startWithMode(source, settings, 'copy');
    } catch {
      stopStream(source.id);
      return await startWithMode(source, settings, 'transcode');
    }
  }
  return await startWithMode(source, settings, mode);
}

export function stopStream(sourceId, reason = '') {
  const id = Number(sourceId);
  const entry = runningStreams.get(id);
  if (entry?.process && entry.process.exitCode === null) {
    entry.process.kill('SIGTERM');
  }
  runningStreams.delete(id);
  setState(id, {
    status: 'stopped',
    running: false,
    error: reason
  });
}

export function getStreamStatus(sourceId) {
  const id = Number(sourceId);
  const entry = runningStreams.get(id);
  if (entry && entry.process.exitCode === null) {
    return {
      sourceId: id,
      sourceName: entry.sourceName,
      status: 'running',
      running: true,
      mode: entry.mode,
      startedAt: entry.startedAt,
      lastAccess: entry.lastAccess,
      hlsPath: `/stream/hls/${id}/index.m3u8`,
      error: ''
    };
  }
  return lastStates.get(id) || { sourceId: id, status: 'stopped', running: false };
}

export function getStreamStatuses() {
  cleanupExitedStreams();
  const enabled = query('SELECT id, name, stream_enabled FROM sources WHERE stream_enabled = 1');
  const ids = new Set([...lastStates.keys(), ...runningStreams.keys(), ...enabled.map(row => row.id)]);
  return [...ids].map(id => ({
    ...getStreamStatus(id),
    enabled: enabled.some(row => row.id === id)
  }));
}

export function touchStreamFromPath(requestPath = '') {
  const match = String(requestPath).match(/^\/?(\d+)\//);
  if (!match) return;
  const id = Number(match[1]);
  const entry = runningStreams.get(id);
  if (entry) entry.lastAccess = Date.now();
}

export async function hlsIndexHandler(req, res, next) {
  const sourceId = Number(req.params.sourceId);
  touchStreamFromPath(`${sourceId}/index.m3u8`);
  const source = queryOne('SELECT * FROM sources WHERE id = ?', sourceId);
  if (!source) return res.status(404).send('Stream source not found');

  const shouldAutoStart = source.stream_enabled === 1 || req.query.autostart === '1';
  if (!fs.existsSync(playlistPath(sourceId)) && shouldAutoStart) {
    try {
      await startStreamForSource(source, { mode: req.query.mode });
      await waitForPlaylistReady(sourceId);
    } catch (error) {
      return res.status(503).send(`HLS stream is not ready: ${error.message}`);
    }
  }

  if (!fs.existsSync(playlistPath(sourceId))) {
    return res.status(404).send('HLS stream is not running');
  }

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  return res.sendFile(playlistPath(sourceId));
}

export function selectBestSourcesByChannelNames(channelNames = []) {
  const names = [...new Set(channelNames.map(name => String(name || '').trim()).filter(Boolean))];
  if (names.length === 0) return [];
  const placeholders = names.map(() => '?').join(',');
  const rows = query(`
    SELECT *
    FROM sources
    WHERE name IN (${placeholders})
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'unknown' THEN 1 WHEN 'testing' THEN 2 ELSE 3 END,
      speed DESC,
      CASE WHEN delay > 0 THEN delay ELSE 999999 END ASC,
      id ASC
  `, ...names);

  const selected = new Map();
  for (const row of rows) {
    if (!selected.has(row.name)) selected.set(row.name, row);
  }
  return [...selected.values()];
}

export function setStreamEnabled({ sourceIds = [], channelNames = [], enabled = true }) {
  const ids = new Set(sourceIds.map(Number).filter(Boolean));
  for (const source of selectBestSourcesByChannelNames(channelNames)) {
    ids.add(Number(source.id));
  }
  if (ids.size === 0) return 0;
  const placeholders = [...ids].map(() => '?').join(',');
  run(`UPDATE sources SET stream_enabled = ? WHERE id IN (${placeholders})`, enabled ? 1 : 0, ...ids);
  return ids.size;
}

export function initStreamIdleMonitor() {
  ensureHlsRoot();
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    const settings = readStreamSettings();
    const now = Date.now();
    for (const entry of runningStreams.values()) {
      if (now - entry.lastAccess > settings.streamIdleTimeout * 1000) {
        stopStream(entry.sourceId, `空闲超过 ${settings.streamIdleTimeout} 秒，已自动停止`);
      }
    }
  }, 15000);
}
