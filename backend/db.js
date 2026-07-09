import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

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
      status TEXT DEFAULT 'idle',
      error_message TEXT,
      last_fetched_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create sources table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      origin TEXT DEFAULT 'manual',
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
      tvg_logo TEXT,
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
      last_tested_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
      tvg_logo TEXT,
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
    onlyActive: '1',
    limitPerChannel: '5',
    blacklist: 'bxtv.3a.ink\n/audio/',
    whitelist: '',
    alias: '央视网,CCTV\n高清,',
    syncCron: '0 */4 * * *',
    testCron: '0 2 * * *',
    epgCron: '0 3 * * *',
    exportToken: '',
    logoRepositoryUrl: 'https://raw.githubusercontent.com/Guovin/iptv-api/master/static/images/logo.svg',
    defaultExportFormat: 'm3u',
    llmApiKey: '',
    llmBaseUrl: '',
    llmModelName: '',
    llmDefaultMode: 'original',
    llmChunkSize: '80'
  };

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!getSetting.get(key)) {
      insertSetting.run(key, value);
    }
  }
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
