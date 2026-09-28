import express from 'express';
import db, { run, query, queryOne, resolveStableChannelId } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { runTestOnSources, testStatus } from '../tester.js';
import { deduplicateSourcesByUrl } from '../deduplicate.js';
import { parseM3u, parseTxt, stringifyJsonObject } from '../playlist.js';

const router = express.Router();

// Get dashboard stats
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const totalSources = queryOne('SELECT COUNT(*) as count FROM sources').count;
    const activeSources = queryOne("SELECT COUNT(*) as count FROM sources WHERE status = 'active'").count;
    const inactiveSources = queryOne("SELECT COUNT(*) as count FROM sources WHERE status = 'inactive'").count;
    const testingSources = queryOne("SELECT COUNT(*) as count FROM sources WHERE status = 'testing'").count;
    const unknownSources = queryOne("SELECT COUNT(*) as count FROM sources WHERE status = 'unknown'").count;
    const totalSubscriptions = queryOne('SELECT COUNT(*) as count FROM subscriptions').count;
    const totalEpg = queryOne('SELECT COUNT(*) as count FROM epg_sources').count;
    const frozenSources = queryOne("SELECT COUNT(*) as count FROM sources WHERE frozen_until IS NOT NULL AND datetime(frozen_until) > datetime('now')").count;

    const categories = query(`
      SELECT 
        CASE 
          WHEN s.origin = 'migu' THEN COALESCE(sub.name, '咪咕')
          WHEN s.subscription_id IS NULL THEN '手动导入' 
          ELSE sub.name 
        END as category, 
        COUNT(*) as count,
        SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) as activeCount,
        SUM(CASE WHEN s.status = 'inactive' THEN 1 ELSE 0 END) as inactiveCount,
        SUM(CASE WHEN s.status IS NULL OR s.status NOT IN ('active', 'inactive') THEN 1 ELSE 0 END) as unknownCount
      FROM sources s
      LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
      GROUP BY CASE WHEN s.origin = 'migu' THEN COALESCE(sub.name, '咪咕') WHEN s.subscription_id IS NULL THEN '手动导入' ELSE sub.name END
      ORDER BY CASE WHEN s.origin = 'migu' THEN 1 WHEN s.subscription_id IS NULL THEN 0 ELSE 2 END ASC, sub.last_fetched_at DESC
    `);
    const protocols = query('SELECT ipv_type, COUNT(*) as count FROM sources GROUP BY ipv_type');

    res.json({
      totalSources,
      activeSources,
      inactiveSources,
      testingSources,
      unknownSources,
      totalSubscriptions,
      totalEpg,
      frozenSources,
      categories,
      protocols
    });
  } catch (error) {
    res.status(500).json({ error: '获取统计数据失败: ' + error.message });
  }
});

// 1. Get list of sources with pagination, search, and filtering
router.get('/', authenticateToken, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  const { name, category, ipvType, origin, status, isp, region, isFrozen, subscriptionId } = req.query;
  const sortBy = req.query.sortBy || 'id';
  const sortOrder = req.query.sortOrder === 'DESC' ? 'DESC' : 'ASC';

  // Build WHERE conditions
  const whereClauses = [];
  const params = [];

  if (name) {
    whereClauses.push('s.name LIKE ?');
    params.push(`%${name}%`);
  }
  if (category) {
    whereClauses.push('s.category = ?');
    params.push(category);
  }
  if (ipvType) {
    whereClauses.push('s.ipv_type = ?');
    params.push(ipvType);
  }
  if (origin) {
    whereClauses.push('s.origin = ?');
    params.push(origin);
  }
  if (status) {
    whereClauses.push('s.status = ?');
    params.push(status);
  }
  if (isp) {
    whereClauses.push('s.isp = ?');
    params.push(isp);
  }
  if (region) {
    whereClauses.push('s.region LIKE ?');
    params.push(`%${region}%`);
  }
  if (isFrozen === 'true') {
    whereClauses.push("s.frozen_until IS NOT NULL AND datetime(s.frozen_until) > datetime('now')");
  } else if (isFrozen === 'false') {
    whereClauses.push("(s.frozen_until IS NULL OR datetime(s.frozen_until) <= datetime('now'))");
  }
  if (subscriptionId) {
    if (subscriptionId === 'manual') {
      whereClauses.push("(s.subscription_id IS NULL AND COALESCE(s.origin, '') != 'migu')");
    } else if (subscriptionId === 'migu') {
      whereClauses.push("s.origin = 'migu'");
    } else {
      whereClauses.push('s.subscription_id = ?');
      params.push(parseInt(subscriptionId));
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Validate sort columns to prevent SQL injection
  const allowedSortCols = ['id', 'name', 'category', 'delay', 'speed', 'created_at', 'status'];
  const sortCol = allowedSortCols.includes(sortBy) ? sortBy : 'id';

  try {
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM sources s
      LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
      ${whereSql}
    `;
    const totalCount = queryOne(countQuery, ...params).count;

    // Get page items
    const itemsQuery = `
      SELECT s.*, sub.name as subscription_name 
      FROM sources s
      LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
      ${whereSql} 
      ORDER BY s.${sortCol} ${sortOrder} 
      LIMIT ? OFFSET ?
    `;
    const items = query(itemsQuery, ...params, pageSize, offset);

    // Get all unique categories, ISPs, regions, and subscriptions for filters
    const categories = query("SELECT DISTINCT category FROM sources WHERE category != ''").map(c => c.category);
    const isps = query("SELECT DISTINCT isp FROM sources WHERE isp != ''").map(i => i.isp);
    const regions = query("SELECT DISTINCT region FROM sources WHERE region != ''").map(r => r.region);
    const subscriptions = query("SELECT id, name FROM subscriptions ORDER BY id DESC");

    res.json({
      items,
      total: totalCount,
      page,
      pageSize,
      filters: { categories, isps, regions, subscriptions }
    });
  } catch (error) {
    res.status(500).json({ error: '查询直播源失败: ' + error.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const item = queryOne(`
      SELECT s.*, sub.name as subscription_name
      FROM sources s
      LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
      WHERE s.id = ?
    `, req.params.id);

    if (!item) {
      return res.status(404).json({ error: '直播源不存在' });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: '查询直播源失败: ' + error.message });
  }
});

// 2. Create single source manually
router.post('/', authenticateToken, (req, res) => {
  const { name, url, category, tvg_logo, request_headers, catchup, stream_enabled } = req.body;
  if (!name || !url || !category) {
    return res.status(400).json({ error: '名称、链接和分组不能为空' });
  }

  try {
    const ipvType = url.includes('[') || url.includes('ipv6') ? 'ipv6' : 'ipv4'; // basic check
    const channelId = resolveStableChannelId({ name, category, origin: 'manual', url });
    run(`
      INSERT INTO sources (name, url, category, origin, channel_id, tvg_logo, request_headers, catchup, ipv_type, stream_enabled)
      VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)
    `, name, url, category, channelId, tvg_logo || '', stringifyJsonObject(request_headers), stringifyJsonObject(catchup), ipvType, stream_enabled ? 1 : 0);
    
    res.status(201).json({ message: '直播源创建成功' });
  } catch (error) {
    res.status(500).json({ error: '创建直播源失败: ' + error.message });
  }
});

// 3. Edit single source
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, url, category, tvg_logo, request_headers, catchup, status, stream_enabled } = req.body;

  if (!name || !url || !category) {
    return res.status(400).json({ error: '名称、链接和分组不能为空' });
  }

  try {
    const ipvType = url.includes('[') || url.includes('ipv6') ? 'ipv6' : 'ipv4';
    const fallbackChannelId = resolveStableChannelId({ name, category, origin: 'manual', url });
    run(`
      UPDATE sources 
      SET name = ?, url = ?, category = ?, tvg_logo = ?, request_headers = ?, catchup = ?, ipv_type = ?, status = ?, stream_enabled = ?,
          channel_id = COALESCE(NULLIF(channel_id, ''), ?)
      WHERE id = ?
    `, name, url, category, tvg_logo || '', stringifyJsonObject(request_headers), stringifyJsonObject(catchup), ipvType, status || 'unknown', stream_enabled ? 1 : 0, fallbackChannelId, id);

    res.json({ message: '修改成功' });
  } catch (error) {
    res.status(500).json({ error: '修改直播源失败: ' + error.message });
  }
});

// 4. Delete multiple/single sources
router.delete('/', authenticateToken, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '未选择要删除的直播源' });
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    run(`DELETE FROM sources WHERE id IN (${placeholders})`, ...ids);
    res.json({ message: '成功删除 ' + ids.length + ' 个直播源' });
  } catch (error) {
    res.status(500).json({ error: '删除直播源失败: ' + error.message });
  }
});

// 4a. Clear all sources
router.post('/clear', authenticateToken, (req, res) => {
  try {
    run('DELETE FROM sources');
    res.json({ message: '所有直播源已成功清空' });
  } catch (error) {
    res.status(500).json({ error: '清空直播源失败: ' + error.message });
  }
});

// 4b. Delete all sources of a specific channel name
router.delete('/channel', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: '频道名称不能为空' });
  }

  try {
    run('DELETE FROM sources WHERE name = ?', name);
    res.json({ message: `频道 [${name}] 的所有线路已成功删除` });
  } catch (error) {
    res.status(500).json({ error: '删除频道失败: ' + error.message });
  }
});

// 5. Import sources in bulk
router.post('/import', authenticateToken, (req, res) => {
  const { content, category: defaultCategory } = req.body;
  if (!content) {
    return res.status(400).json({ error: '导入内容不能为空' });
  }

  try {
    let imported = 0;
    let currentCategory = defaultCategory || '手动导入';

    db.exec('BEGIN TRANSACTION');
    try {
      const insertStmt = db.prepare(`
        INSERT INTO sources (name, url, category, origin, channel_id, tvg_logo, request_headers, catchup, ipv_type)
        VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?)
      `);

      const isM3u = content.includes('#EXTM3U');
      const parsedItems = isM3u ? parseM3u(content, currentCategory) : parseTxt(content, currentCategory);
      for (const item of parsedItems) {
        const ipvType = item.url.includes('[') || item.url.includes('ipv6') ? 'ipv6' : 'ipv4';
        const channelId = resolveStableChannelId({ ...item, origin: 'manual' });
        insertStmt.run(item.name, item.url, item.category, channelId, item.tvg_logo || '', item.request_headers || '', item.catchup || '', ipvType);
        imported++;
      }

      db.exec('COMMIT');
      res.json({ message: `成功导入 ${imported} 个直播源` });
    } catch (dbErr) {
      db.exec('ROLLBACK');
      throw dbErr;
    }
  } catch (error) {
    res.status(500).json({ error: '批量导入失败: ' + error.message });
  }
});

// 6. Trigger validity test on sources
router.post('/test', authenticateToken, (req, res) => {
  if (testStatus.running) {
    return res.status(409).json({ error: '检测任务已经在后台运行中，请等待其完成' });
  }

  const { ids, onlyUntested } = req.body;

  try {
    let sourcesToTest = [];
    if (ids && Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      sourcesToTest = query(`SELECT * FROM sources WHERE id IN (${placeholders})`, ...ids);
    } else if (onlyUntested) {
      sourcesToTest = query("SELECT * FROM sources WHERE last_tested_at IS NULL");
    } else {
      sourcesToTest = query('SELECT * FROM sources');
    }

    if (sourcesToTest.length === 0) {
      return res.status(400).json({ error: '没有可测试的直播源' });
    }

    // Call async speed tester in background
    runTestOnSources(sourcesToTest).catch(err => {
      console.error('Background test error:', err);
    });

    res.json({ message: '已在后台启动检测任务，共检测 ' + sourcesToTest.length + ' 个源' });
  } catch (error) {
    res.status(500).json({ error: '启动检测失败: ' + error.message });
  }
});

// 7. Get active test task status
router.get('/test/status', authenticateToken, (req, res) => {
  res.json(testStatus);
});

// 8. Stop active test run
router.post('/test/stop', authenticateToken, (req, res) => {
  if (!testStatus.running) {
    return res.status(400).json({ error: '当前没有正在运行的检测任务' });
  }
  testStatus.running = false;
  res.json({ message: '已向检测任务发送停止指令，正在终止中' });
});

// 8. Defrost frozen sources
router.post('/defrost', authenticateToken, (req, res) => {
  try {
    run("UPDATE sources SET fail_count = 0, frozen_until = NULL");
    res.json({ message: '已成功重置所有冷冻失效源，下次检测时将重新发起测试' });
  } catch (error) {
    res.status(500).json({ error: '解冻失败: ' + error.message });
  }
});

// 9. One-click de-duplicate URLs in sources
router.post('/deduplicate', authenticateToken, (req, res) => {
  try {
    const result = deduplicateSourcesByUrl();
    res.json({
      message: `成功完成去重！共清理了 ${result.deleted} 个重复的直播流地址。`,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: '去重操作失败: ' + error.message });
  }
});

export default router;
