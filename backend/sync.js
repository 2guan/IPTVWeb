import db, { run, query, queryOne, resolveStableChannelId } from './db.js';
import { BEIJING_NOW_SQL } from './time.js';
import { syncMiguBundleForSubscription } from './migu.js';
import { deduplicateSourcesByUrl } from './deduplicate.js';
import { buildDefaultHeaders, parseM3u, parseTxt } from './playlist.js';

export const syncStatus = {
  running: false,
  message: ''
};

/**
 * Synchronize a single subscription
 */
export async function syncSubscription(subId, options = {}) {
  const { deduplicateAfter = true } = options;
  const sub = queryOne('SELECT * FROM subscriptions WHERE id = ?', subId);
  if (!sub) {
    throw new Error('Subscription not found');
  }

  console.log(`Syncing subscription: ${sub.name} (${sub.url})`);
  run("UPDATE subscriptions SET status = 'fetching', error_message = NULL WHERE id = ?", sub.id);

  try {
    if (sub.source_type === 'migu') {
      const result = await syncMiguBundleForSubscription(sub.id);
      run(`UPDATE subscriptions SET status = 'success', last_fetched_at = ${BEIJING_NOW_SQL} WHERE id = ?`, sub.id);
      const deduplicated = deduplicateAfter ? deduplicateSourcesByUrl() : null;
      console.log(`Migu subscription ${sub.name} sync successful. Channels: ${result.channels.total}, sports: ${result.sports.total}, deduplicated: ${deduplicated?.deleted || 0}`);
      return { ...result, deduplicated };
    }

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
    const defaultHeaders = buildDefaultHeaders(sub.user_agent || '');
    const parsedItems = isM3u ? parseM3u(content, sub.name, defaultHeaders) : parseTxt(content, sub.name, defaultHeaders);

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
        INSERT INTO sources (name, url, category, origin, subscription_id, channel_id, tvg_logo, request_headers, catchup, status)
        VALUES (?, ?, ?, 'subscription', ?, ?, ?, ?, ?, 'unknown')
      `);
      const updateStmt = db.prepare(`
        UPDATE sources 
        SET name = ?, category = ?, tvg_logo = ?, request_headers = ?, catchup = ?,
            channel_id = COALESCE(NULLIF(channel_id, ''), ?)
        WHERE id = ?
      `);

      for (const item of filteredItems) {
        activeUrls.add(item.url);
        
        const existing = existingMap.get(item.url);
        const channelId = resolveStableChannelId({
          ...item,
          origin: 'subscription',
          subscription_id: sub.id,
          subscription_name: sub.name
        });
        if (existing) {
          // Update properties if changed
          updateStmt.run(item.name, item.category, item.tvg_logo, item.request_headers || '', item.catchup || '', channelId, existing.id);
        } else {
          // Insert new source
          insertStmt.run(item.name, item.url, item.category, sub.id, channelId, item.tvg_logo, item.request_headers || '', item.catchup || '');
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
    const deduplicated = deduplicateAfter ? deduplicateSourcesByUrl() : null;
    console.log(`Subscription ${sub.name} sync successful. Total sources: ${filteredItems.length}, deduplicated: ${deduplicated?.deleted || 0}`);
    return {
      total: filteredItems.length,
      deduplicated
    };
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
        await syncSubscription(sub.id, { deduplicateAfter: false });
      } catch (err) {
        // Continue with other subscriptions even if one fails
      }
    }
    const deduplicated = deduplicateSourcesByUrl();
    syncStatus.message = `订阅源同步完成！已全量去重，清理 ${deduplicated.deleted} 个重复 URL。`;
  } catch (err) {
    syncStatus.message = '订阅同步失败: ' + err.message;
  } finally {
    syncStatus.running = false;
  }
}
