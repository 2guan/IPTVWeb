import db, { run, query, queryOne } from './db.js';
import { BEIJING_NOW_SQL } from './time.js';

export const syncStatus = {
  running: false,
  message: ''
};

/**
 * Normalizes a channel name
 */
function normalizeChannelName(name) {
  if (!name) return '未知频道';
  return name.trim().replace(/\r/g, '');
}

/**
 * Parses M3U content
 */
function parseM3u(content, defaultCategory = '其他频道') {
  const lines = content.split('\n');
  const items = [];
  let currentItem = null;
  let currentCategory = defaultCategory;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      // Extract name (last part after comma)
      const commaIndex = line.lastIndexOf(',');
      const name = commaIndex !== -1 ? normalizeChannelName(line.substring(commaIndex + 1)) : '未知频道';
      
      // Extract group-title (category)
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const category = groupMatch ? groupMatch[1].trim() : currentCategory;
      
      // Extract tvg-logo
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      const logo = logoMatch ? logoMatch[1].trim() : '';

      currentItem = { name, category, tvg_logo: logo };
    } else if (line.startsWith('#') && !line.startsWith('#EXTINF:')) {
      // Skip other comment lines
      continue;
    } else {
      // This is the URL line
      if (currentItem) {
        currentItem.url = line;
        items.push(currentItem);
        currentItem = null;
      }
    }
  }

  return items;
}

/**
 * Parses TXT content (Category,#genre# and Name,URL)
 */
function parseTxt(content, defaultCategory = '其他频道') {
  const lines = content.split('\n');
  const items = [];
  let currentCategory = defaultCategory;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    if (line.includes('#genre#')) {
      // e.g. 央视频道,#genre#
      const parts = line.split(',');
      if (parts.length > 0 && parts[0].trim()) {
        currentCategory = parts[0].trim().replace(/[-_\s📺📡☘️]/g, '');
      }
      continue;
    }

    // Check for comma separator (support both English and Chinese commas)
    const separatorIndex = line.indexOf(',') !== -1 ? line.indexOf(',') : line.indexOf('，');
    if (separatorIndex !== -1) {
      const name = normalizeChannelName(line.substring(0, separatorIndex));
      const url = line.substring(separatorIndex + 1).trim();
      if (name && url && url.startsWith('http')) {
        items.push({
          name,
          url,
          category: currentCategory,
          tvg_logo: ''
        });
      }
    }
  }

  return items;
}

/**
 * Synchronize a single subscription
 */
export async function syncSubscription(subId) {
  const sub = queryOne('SELECT * FROM subscriptions WHERE id = ?', subId);
  if (!sub) {
    throw new Error('Subscription not found');
  }

  console.log(`Syncing subscription: ${sub.name} (${sub.url})`);
  run("UPDATE subscriptions SET status = 'fetching', error_message = NULL WHERE id = ?", sub.id);

  try {
    // 1. Fetch content
    const ua = sub.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
    const response = await fetch(sub.url, {
      headers: { 'User-Agent': ua }
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const content = await response.text();
    
    // 2. Parse content based on format detection
    const isM3u = content.includes('#EXTM3U') || sub.url.includes('.m3u') || sub.url.includes('.m3u8');
    const parsedItems = isM3u ? parseM3u(content, sub.name) : parseTxt(content, sub.name);

    if (parsedItems.length === 0) {
      throw new Error('No valid channels found in subscription');
    }

    // 3. Load Blacklist & Whitelist
    const blacklistSetting = queryOne("SELECT value FROM settings WHERE key = 'blacklist'");
    const blacklistKeywords = (blacklistSetting?.value || '').split('\n').map(k => k.trim()).filter(Boolean);

    const whitelistSetting = queryOne("SELECT value FROM settings WHERE key = 'whitelist'");
    const whitelistKeywords = (whitelistSetting?.value || '').split('\n').map(k => k.trim()).filter(Boolean);

    // Filter items based on Blacklist
    const filteredItems = parsedItems.filter(item => {
      const lowerUrl = item.url.toLowerCase();
      const lowerName = item.name.toLowerCase();

      // If URL matches any whitelist keyword, we ALWAYS keep it
      const isWhitelisted = whitelistKeywords.some(kw => lowerUrl.includes(kw.toLowerCase()) || lowerName.includes(kw.toLowerCase()));
      if (isWhitelisted) return true;

      // Check blacklist
      const isBlacklisted = blacklistKeywords.some(kw => lowerUrl.includes(kw.toLowerCase()) || lowerName.includes(kw.toLowerCase()));
      return !isBlacklisted;
    });

    // 4. Perform delta synchronization
    // Get existing sources in DB for this subscription
    const existingSources = query('SELECT id, url, fail_count, frozen_until FROM sources WHERE subscription_id = ?', sub.id);
    const existingMap = new Map(existingSources.map(s => [s.url, s]));

    // Track URLs we processed in this run
    const activeUrls = new Set();

    db.exec('BEGIN TRANSACTION');
    try {
      const insertStmt = db.prepare(`
        INSERT INTO sources (name, url, category, origin, subscription_id, tvg_logo, status)
        VALUES (?, ?, ?, 'subscription', ?, ?, 'unknown')
      `);
      const updateStmt = db.prepare(`
        UPDATE sources 
        SET name = ?, category = ?, tvg_logo = ?
        WHERE id = ?
      `);

      for (const item of filteredItems) {
        activeUrls.add(item.url);
        
        const existing = existingMap.get(item.url);
        if (existing) {
          // Update properties if changed
          updateStmt.run(item.name, item.category, item.tvg_logo, existing.id);
        } else {
          // Insert new source
          insertStmt.run(item.name, item.url, item.category, sub.id, item.tvg_logo);
        }
      }

      // Delete sources no longer present in the subscription
      const deleteStmt = db.prepare('DELETE FROM sources WHERE id = ?');
      for (const src of existingSources) {
        if (!activeUrls.has(src.url)) {
          deleteStmt.run(src.id);
        }
      }

      db.exec('COMMIT');
    } catch (dbErr) {
      db.exec('ROLLBACK');
      throw dbErr;
    }

    run(`UPDATE subscriptions SET status = 'success', last_fetched_at = ${BEIJING_NOW_SQL} WHERE id = ?`, sub.id);
    console.log(`Subscription ${sub.name} sync successful. Total sources: ${filteredItems.length}`);
  } catch (err) {
    console.error(`Subscription sync failed for ${sub.name}:`, err.message);
    run("UPDATE subscriptions SET status = 'failed', error_message = ? WHERE id = ?", err.message, sub.id);
    throw err;
  }
}

/**
 * Sync all active subscriptions
 */
export async function syncAllSubscriptions() {
  if (syncStatus.running) {
    throw new Error('Subscriptions sync task is already running');
  }

  syncStatus.running = true;
  syncStatus.message = '正在同步订阅源...';

  try {
    const subs = query('SELECT id FROM subscriptions WHERE auto_update = 1');
    for (const sub of subs) {
      try {
        await syncSubscription(sub.id);
      } catch (err) {
        // Continue with other subscriptions even if one fails
      }
    }
    syncStatus.message = '订阅源同步完成！';
  } catch (err) {
    syncStatus.message = '订阅同步失败: ' + err.message;
  } finally {
    syncStatus.running = false;
  }
}
