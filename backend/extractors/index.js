/**
 * 官方直采源抓取模块聚合器 (Extractors Registry)
 * 聚合 Lotus TV (澳门莲花卫视), Quanzhou (泉州闽南语), Sichuan (四川广电) 等直采流
 */
import db, { run, query, queryOne } from '../db.js';
import { extractLotusTv } from './lotustv.js';
import { extractQuanzhou } from './quanzhou.js';
import { extractSichuan } from './sichuan.js';

export async function runAllExtractors() {
  const results = await Promise.allSettled([
    extractLotusTv(),
    extractQuanzhou(),
    extractSichuan()
  ]);

  const allChannels = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allChannels.push(...res.value);
    }
  }

  return allChannels;
}

/**
 * 同步官方直采源到 sources 表 (origin = 'extractor')
 */
export async function syncOfficialExtractors() {
  const channels = await runAllExtractors();
  if (!channels || channels.length === 0) {
    return { count: 0, channels: [] };
  }

  const checkStmt = db.prepare(`SELECT id FROM sources WHERE origin = 'extractor' AND (name = ? OR url = ?) LIMIT 1`);
  const updateStmt = db.prepare(`
    UPDATE sources SET
      name = ?,
      url = ?,
      category = ?,
      channel_id = ?,
      tvg_logo = ?,
      request_headers = ?,
      status = ?
    WHERE id = ?
  `);
  const insertStmt = db.prepare(`
    INSERT INTO sources (
      name, url, category, origin, channel_id, tvg_logo, request_headers, status
    ) VALUES (?, ?, ?, 'extractor', ?, ?, ?, ?)
  `);

  db.exec('BEGIN TRANSACTION');
  let count = 0;
  try {
    for (const ch of channels) {
      if (!ch.name || !ch.url) continue;
      const existing = checkStmt.get(ch.name, ch.url);
      if (existing) {
        updateStmt.run(
          ch.name,
          ch.url,
          ch.category || '官方直采',
          ch.channel_id || '',
          ch.tvg_logo || '',
          ch.request_headers || '',
          ch.status || 'active',
          existing.id
        );
      } else {
        insertStmt.run(
          ch.name,
          ch.url,
          ch.category || '官方直采',
          ch.channel_id || '',
          ch.tvg_logo || '',
          ch.request_headers || '',
          ch.status || 'active'
        );
      }
      count++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { count, channels };
}

export default {
  runAllExtractors,
  syncOfficialExtractors
};
