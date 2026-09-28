import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DEFAULT_LLM_OPTIMIZE_PROMPT } from './defaults.js';
import { buildChannelId, ensureChannelId, getChannelIdentitySignatures } from './channelIdentity.js';

const dbPath = process.env.DATABASE_PATH || './data/iptv.sqlite';
const dbDir = path.dirname(dbPath);

// Ensure database directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

export function initDb() {
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create subscriptions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      user_agent TEXT,
      source_type TEXT DEFAULT 'standard',
      migu_base_url TEXT,
      migu_user_id TEXT,
      migu_token TEXT,
      migu_rate_type TEXT DEFAULT '3',
      migu_enable_h265 INTEGER DEFAULT 1,
      migu_enable_hdr INTEGER DEFAULT 0,
      status TEXT DEFAULT 'idle',
      error_message TEXT,
      last_fetched_at DATETIME,
      auto_update INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create epg_sources table
  db.exec(`
    CREATE TABLE IF NOT EXISTS epg_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      source_type TEXT DEFAULT 'xml',
      status TEXT DEFAULT 'idle',
      error_message TEXT,
      last_fetched_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn('subscriptions', 'source_type', "TEXT DEFAULT 'standard'");
  ensureColumn('subscriptions', 'migu_base_url', 'TEXT');
  ensureColumn('subscriptions', 'migu_user_id', 'TEXT');
  ensureColumn('subscriptions', 'migu_token', 'TEXT');
  ensureColumn('subscriptions', 'migu_rate_type', "TEXT DEFAULT '3'");
  ensureColumn('subscriptions', 'migu_enable_h265', 'INTEGER DEFAULT 1');
  ensureColumn('subscriptions', 'migu_enable_hdr', 'INTEGER DEFAULT 0');
  ensureColumn('epg_sources', 'source_type', "TEXT DEFAULT 'xml'");

  // Create sources table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      origin TEXT DEFAULT 'manual',
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
      channel_id TEXT,
      tvg_logo TEXT,
      request_headers TEXT,
      catchup TEXT,
      ipv_type TEXT,
      region TEXT,
      isp TEXT,
      status TEXT DEFAULT 'unknown',
      delay INTEGER DEFAULT -1,
      speed REAL DEFAULT 0.0,
      resolution TEXT,
      codec TEXT,
      fail_count INTEGER DEFAULT 0,
      frozen_until DATETIME,
      stream_enabled INTEGER DEFAULT 0,
      last_tested_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn('sources', 'request_headers', 'TEXT');
  ensureColumn('sources', 'catchup', 'TEXT');
  ensureColumn('sources', 'stream_enabled', 'INTEGER DEFAULT 0');
  ensureColumn('sources', 'channel_id', 'TEXT');

  // Create settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Create optimized_sources table
  db.exec(`
    CREATE TABLE IF NOT EXISTS optimized_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      url TEXT NOT NULL,
      origin TEXT,
      subscription_id INTEGER,
      channel_id TEXT,
      tvg_logo TEXT,
      request_headers TEXT,
      catchup TEXT,
      ipv_type TEXT,
      region TEXT,
      isp TEXT,
      status TEXT,
      delay INTEGER,
      speed REAL,
      resolution TEXT,
      codec TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn('optimized_sources', 'request_headers', 'TEXT');
  ensureColumn('optimized_sources', 'catchup', 'TEXT');
  ensureColumn('optimized_sources', 'channel_id', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_identity_mappings (
      signature TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin user
  const checkAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!checkAdmin) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin2026', salt);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run('admin', hash, 'admin');
    console.log('Seeded default admin user: admin/admin2026');
  }

  // Seed default settings
  const defaultSettings = {
    concurrency: '5',
    timeout: '10000',
    minSpeed: '0.2',
    userAgent: 'TiviMate/5.1.0',
    testFastMode: '1',
    ffprobeMetadataEnabled: '0',
    ffprobeFallbackEnabled: '0',
    multicastDefaultActive: '0',
    onlyActive: '1',
    limitPerChannel: '5',
    blacklist: 'bxtv.3a.ink\n/audio/',
    whitelist: '',
    alias: '央视网,CCTV\n高清,',
    syncCron: '0 */4 * * *',
    testCron: '0 2 * * *',
    epgCron: '0 3 * * *',
    optimizeCron: '',
    exportToken: '',
    logoRepositoryUrl: 'https://gcore.jsdelivr.net/gh/taksssss/tv@main/icon/',
    defaultExportFormat: 'm3u',
    blockRules: '',
    hiddenGroupRules: '体育-*',
    scanGuardEnabled: '1',
    streamTranscodeMode: 'copy',
    streamMaxStreams: '6',
    streamIdleTimeout: '300',
    streamSegmentSeconds: '4',
    streamListSize: '8',
    llmApiKey: process.env.LLM_API_KEY || '',
    llmBaseUrl: process.env.LLM_BASE_URL || '',
    llmModelName: process.env.LLM_MODEL_NAME || '',
    llmEnableThinking: process.env.LLM_ENABLE_THINKING || '0',
    llmDefaultMode: process.env.LLM_DEFAULT_MODE || 'original',
    llmChunkSize: process.env.LLM_CHUNK_SIZE || '80',
    llmOptimizePrompt: process.env.LLM_OPTIMIZE_PROMPT || DEFAULT_LLM_OPTIMIZE_PROMPT
  };

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!getSetting.get(key)) {
      insertSetting.run(key, value);
    }
  }

  const envBackfilledSettings = {
    llmApiKey: process.env.LLM_API_KEY || '',
    llmBaseUrl: process.env.LLM_BASE_URL || '',
    llmModelName: process.env.LLM_MODEL_NAME || '',
    llmEnableThinking: process.env.LLM_ENABLE_THINKING || '',
    llmDefaultMode: process.env.LLM_DEFAULT_MODE || '',
    llmChunkSize: process.env.LLM_CHUNK_SIZE || '',
    llmOptimizePrompt: process.env.LLM_OPTIMIZE_PROMPT || ''
  };
  const updateSetting = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [key, value] of Object.entries(envBackfilledSettings)) {
    if (!value) continue;
    const current = getSetting.get(key);
    if (!current || !String(current.value || '').trim()) {
      updateSetting.run(value, key);
    }
  }

  seedMiguEpgSource();
  seedDefaultSubscriptions();
  migrateLegacyMiguSettingsToSubscription();
  backfillChannelIds();
  repairMiguSources();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedMiguEpgSource() {
  const existing = db.prepare("SELECT id FROM epg_sources WHERE source_type = 'migu' LIMIT 1").get();
  if (!existing) {
    db.prepare(`
      INSERT INTO epg_sources (name, url, source_type)
      VALUES ('咪咕 EPG', 'migu://epg', 'migu')
    `).run();
  }

  const existingXml = db.prepare("SELECT id FROM epg_sources WHERE source_type = 'xml' LIMIT 1").get();
  if (!existingXml) {
    db.prepare(`
      INSERT INTO epg_sources (name, url, source_type)
      VALUES ('全网综合 EPG (erw.cc)', 'https://e.erw.cc/all.xml.gz', 'xml')
    `).run();
  }
}

function seedDefaultSubscriptions() {
  const existing = db.prepare("SELECT id FROM subscriptions WHERE url LIKE '%akiralereal%' OR url LIKE '%IPTV.m3u%' LIMIT 1").get();
  if (!existing) {
    db.prepare(`
      INSERT INTO subscriptions (name, url, source_type, auto_update)
      VALUES ('官方与精选直连源 (akiralereal)', 'https://gcore.jsdelivr.net/gh/akiralereal/iptv@main/IPTV.m3u', 'standard', 1)
    `).run();
  }
}

function migrateLegacyMiguSettingsToSubscription() {
  const existing = db.prepare("SELECT id FROM subscriptions WHERE source_type = 'migu' LIMIT 1").get();
  if (existing) return;

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const baseUrl = String(getSetting.get('miguBaseUrl')?.value || process.env.MIGU_BASE_URL || '').trim();
  if (!baseUrl) return;

  db.prepare(`
    INSERT INTO subscriptions (
      name, url, user_agent, source_type, migu_base_url, migu_user_id, migu_token,
      migu_rate_type, migu_enable_h265, migu_enable_hdr, auto_update
    )
    VALUES (?, ?, ?, 'migu', ?, ?, ?, ?, ?, ?, 1)
  `).run(
    '咪咕',
    'migu://live',
    '',
    baseUrl,
    getSetting.get('miguUserId')?.value || '',
    getSetting.get('miguToken')?.value || '',
    getSetting.get('miguRateType')?.value || '3',
    ['0', 'false'].includes(String(getSetting.get('miguEnableH265')?.value || '').toLowerCase()) ? 0 : 1,
    ['1', 'true'].includes(String(getSetting.get('miguEnableHdr')?.value || '').toLowerCase()) ? 1 : 0
  );
}

function backfillChannelIds() {
  const updateSource = db.prepare('UPDATE sources SET channel_id = ? WHERE id = ?');
  const sources = db.prepare(`
    SELECT s.id, s.name, s.category, s.origin, s.subscription_id, sub.name AS subscription_name, s.url, s.channel_id
    FROM sources s
    LEFT JOIN subscriptions sub ON sub.id = s.subscription_id
  `).all();
  for (const source of sources) {
    const channelId = resolveStableChannelId(source);
    if (!source.channel_id || !String(source.channel_id).trim()) {
      updateSource.run(channelId, source.id);
    }
  }

  const updateOptimized = db.prepare('UPDATE optimized_sources SET channel_id = ? WHERE id = ?');
  const optimizedSources = db.prepare(`
    SELECT os.id, os.name, os.category, os.origin, os.subscription_id, sub.name AS subscription_name,
           os.url, os.channel_id, s.channel_id AS source_channel_id
    FROM optimized_sources os
    LEFT JOIN sources s ON s.id = os.original_source_id
    LEFT JOIN subscriptions sub ON sub.id = os.subscription_id
  `).all();
  for (const source of optimizedSources) {
    const channelId = ensureChannelId({
      ...source,
      channel_id: source.source_channel_id || source.channel_id
    });
    rememberChannelIdentity({ ...source, channel_id: channelId });
    if (!source.channel_id || !String(source.channel_id).trim()) {
      updateOptimized.run(channelId, source.id);
    }
  }
}

function repairMiguSources() {
  db.exec(`
    UPDATE sources
    SET status = 'active',
        delay = CASE WHEN delay > 0 THEN delay ELSE 50 END,
        speed = CASE WHEN speed > 0 THEN speed ELSE 5.0 END,
        resolution = COALESCE(NULLIF(resolution, ''), '1920x1080'),
        codec = COALESCE(NULLIF(codec, ''), 'h264'),
        isp = CASE WHEN isp IS NULL OR isp = '' OR isp = '未知' THEN '中国移动' ELSE isp END,
        region = CASE WHEN region IS NULL OR region = '' OR region = '未知' THEN '全国' ELSE region END,
        fail_count = 0,
        frozen_until = NULL
    WHERE origin = 'migu'
       OR url LIKE '%miguvideo.com%'
       OR url LIKE '%cmvideo.cn%'
       OR subscription_id IN (SELECT id FROM subscriptions WHERE LOWER(name) LIKE '%migu%' OR name LIKE '%咪咕%');

    UPDATE optimized_sources
    SET status = 'active',
        delay = CASE WHEN delay > 0 THEN delay ELSE 50 END,
        speed = CASE WHEN speed > 0 THEN speed ELSE 5.0 END,
        resolution = COALESCE(NULLIF(resolution, ''), '1920x1080'),
        codec = COALESCE(NULLIF(codec, ''), 'h264'),
        isp = CASE WHEN isp IS NULL OR isp = '' OR isp = '未知' THEN '中国移动' ELSE isp END,
        region = CASE WHEN region IS NULL OR region = '' OR region = '未知' THEN '全国' ELSE region END
    WHERE origin = 'migu'
       OR url LIKE '%miguvideo.com%'
       OR url LIKE '%cmvideo.cn%'
       OR subscription_id IN (SELECT id FROM subscriptions WHERE LOWER(name) LIKE '%migu%' OR name LIKE '%咪咕%');
  `);
}

export function rememberChannelIdentity(row = {}) {
  const channelId = ensureChannelId(row);
  const signatures = getChannelIdentitySignatures(row);
  if (!channelId || signatures.length === 0) return channelId;

  const insertMapping = db.prepare(`
    INSERT OR IGNORE INTO channel_identity_mappings (signature, channel_id)
    VALUES (?, ?)
  `);
  for (const signature of signatures) {
    insertMapping.run(signature, channelId);
  }
  return channelId;
}

export function resolveStableChannelId(row = {}) {
  const existingChannelId = String(row.channel_id || '').trim();
  if (existingChannelId) {
    rememberChannelIdentity(row);
    return existingChannelId;
  }

  const signatures = getChannelIdentitySignatures(row);
  const getMapping = db.prepare('SELECT channel_id FROM channel_identity_mappings WHERE signature = ?');
  for (const signature of signatures) {
    const mapped = getMapping.get(signature);
    if (mapped?.channel_id) {
      rememberChannelIdentity({ ...row, channel_id: mapped.channel_id });
      return mapped.channel_id;
    }
  }

  return rememberChannelIdentity({ ...row, channel_id: buildChannelId(row) });
}

export function query(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function queryOne(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export default db;
