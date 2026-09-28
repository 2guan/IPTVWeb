import fs from 'fs';
import path from 'path';
import db, { query, run } from './db.js';

const BACKUP_FORMAT = 'iptv-admin-backup';
const BACKUP_VERSION = 1;
const SNAPSHOT_PATH = path.resolve('./data/pre-import-backup.json');

/**
 * Export full system configuration as single JSON object
 */
export function exportBackup() {
  const settings = query('SELECT key, value FROM settings');
  const subscriptions = query('SELECT * FROM subscriptions');
  const epgSources = query('SELECT * FROM epg_sources');
  const manualSources = query("SELECT name, url, category, origin, channel_id, tvg_logo, request_headers, catchup, ipv_type FROM sources WHERE origin = 'manual'");

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      settings,
      subscriptions,
      epg_sources: epgSources,
      manual_sources: manualSources
    }
  };
}

/**
 * Import backup JSON with automatic pre-import snapshot
 */
export function importBackup(backupJson, options = {}) {
  if (!backupJson || typeof backupJson !== 'object') {
    throw new Error('备份文件格式错误，必须为合法 JSON 对象');
  }

  if (backupJson.format !== BACKUP_FORMAT) {
    throw new Error(`不支持的备份文件格式: ${backupJson.format || 'unknown'}`);
  }

  const { data } = backupJson;
  if (!data || typeof data !== 'object') {
    throw new Error('备份文件中缺少有效数据段');
  }

  // 1. Create safety snapshot before overriding (unless this is already a rollback)
  if (!options.isRollback) {
    try {
      const currentSnapshot = exportBackup();
      fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(currentSnapshot, null, 2), 'utf-8');
      console.log('[ConfigBackup] Created pre-import backup snapshot at', SNAPSHOT_PATH);
    } catch (snapshotErr) {
      console.warn('[ConfigBackup] Failed to create pre-import snapshot:', snapshotErr.message);
    }
  }

  // 2. Perform restore in SQLite transaction
  db.exec('BEGIN TRANSACTION');
  try {
    // Restore settings
    if (Array.isArray(data.settings)) {
      const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const item of data.settings) {
        if (item.key) {
          insertSetting.run(item.key, String(item.value ?? ''));
        }
      }
    }

    // Restore subscriptions
    if (Array.isArray(data.subscriptions)) {
      const insertSub = db.prepare(`
        INSERT OR REPLACE INTO subscriptions 
        (id, name, url, user_agent, auto_update, source_type, migu_base_url, migu_user_id, migu_token, migu_rate_type, migu_enable_h265, migu_enable_hdr)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of data.subscriptions) {
        if (s.name && s.url) {
          insertSub.run(
            s.id || null,
            s.name,
            s.url,
            s.user_agent || '',
            s.auto_update ?? 1,
            s.source_type || 'standard',
            s.migu_base_url || '',
            s.migu_user_id || '',
            s.migu_token || '',
            s.migu_rate_type || '3',
            s.migu_enable_h265 ?? 1,
            s.migu_enable_hdr ?? 0
          );
        }
      }
    }

    // Restore EPG sources
    if (Array.isArray(data.epg_sources)) {
      const insertEpg = db.prepare(`
        INSERT OR REPLACE INTO epg_sources (id, name, url, source_type)
        VALUES (?, ?, ?, ?)
      `);
      for (const e of data.epg_sources) {
        if (e.name && e.url) {
          insertEpg.run(e.id || null, e.name, e.url, e.source_type || 'xml');
        }
      }
    }

    // Restore manual sources if any
    if (Array.isArray(data.manual_sources) && data.manual_sources.length > 0) {
      const insertManual = db.prepare(`
        INSERT OR IGNORE INTO sources 
        (name, url, category, origin, channel_id, tvg_logo, request_headers, catchup, ipv_type)
        VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?)
      `);
      for (const m of data.manual_sources) {
        if (m.name && m.url) {
          insertManual.run(
            m.name,
            m.url,
            m.category || '手动导入',
            m.channel_id || '',
            m.tvg_logo || '',
            m.request_headers || '',
            m.catchup || '',
            m.ipv_type || 'ipv4'
          );
        }
      }
    }

    db.exec('COMMIT');
    return {
      success: true,
      message: options.isRollback ? '配置已成功回滚到导入前快照' : '配置导入成功',
      hasSnapshot: fs.existsSync(SNAPSHOT_PATH)
    };

  } catch (err) {
    db.exec('ROLLBACK');
    throw new Error(`配置导入失败: ${err.message}`);
  }
}

/**
 * Rollback to the pre-import snapshot
 */
export function rollbackBackup() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error('未找到导入前的备份快照，无法回滚');
  }

  const content = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
  const snapshotData = JSON.parse(content);
  return importBackup(snapshotData, { isRollback: true });
}

/**
 * Check if a pre-import rollback snapshot exists
 */
export function hasRollbackSnapshot() {
  return fs.existsSync(SNAPSHOT_PATH);
}

export default {
  exportBackup,
  importBackup,
  rollbackBackup,
  hasRollbackSnapshot
};
