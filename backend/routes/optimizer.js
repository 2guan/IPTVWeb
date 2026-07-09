import express from 'express';
import { run, query, queryOne } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { runLlmOptimization, optimizerStatus } from '../optimizer.js';

const router = express.Router();

// 1. Get list of optimized sources with pagination, search, and filtering
router.get('/', authenticateToken, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  const { name, category, ipvType, origin, status, isp, region, subscriptionId, frozen } = req.query;
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
  if (subscriptionId) {
    if (subscriptionId === 'manual') {
      whereClauses.push('s.subscription_id IS NULL');
    } else {
      whereClauses.push('s.subscription_id = ?');
      params.push(parseInt(subscriptionId));
    }
  }
  if (frozen) {
    if (frozen === 'true') {
      whereClauses.push("src.frozen_until IS NOT NULL AND datetime(src.frozen_until) > datetime('now')");
    } else {
      whereClauses.push("(src.frozen_until IS NULL OR datetime(src.frozen_until) <= datetime('now'))");
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
      FROM optimized_sources s
      LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
      LEFT JOIN sources src ON s.original_source_id = src.id
      ${whereSql}
    `;
    const totalCount = queryOne(countQuery, ...params).count;

    // Get page items
    const itemsQuery = `
      SELECT s.*, sub.name as subscription_name, src.frozen_until, src.last_tested_at
      FROM optimized_sources s
      LEFT JOIN subscriptions sub ON s.subscription_id = sub.id
      LEFT JOIN sources src ON s.original_source_id = src.id
      ${whereSql} 
      ORDER BY s.${sortCol} ${sortOrder} 
      LIMIT ? OFFSET ?
    `;
    const items = query(itemsQuery, ...params, pageSize, offset);

    // Get all unique categories, ISPs, regions, and subscriptions for filters
    const categories = query("SELECT DISTINCT category FROM optimized_sources WHERE category != ''").map(c => c.category);
    const isps = query("SELECT DISTINCT isp FROM optimized_sources WHERE isp != ''").map(i => i.isp);
    const regions = query("SELECT DISTINCT region FROM optimized_sources WHERE region != ''").map(r => r.region);
    const subscriptions = query("SELECT id, name FROM subscriptions ORDER BY id DESC");

    res.json({
      items,
      total: totalCount,
      page,
      pageSize,
      filters: { categories, isps, regions, subscriptions }
    });
  } catch (error) {
    res.status(500).json({ error: '查询优化直播源失败: ' + error.message });
  }
});

// 2. Trigger LLM Optimization
router.post('/run', authenticateToken, (req, res) => {
  if (optimizerStatus.running) {
    return res.status(409).json({ error: '大模型优化任务已经在后台运行中，请等待其完成' });
  }
  try {
    run("DELETE FROM optimized_sources");
    runLlmOptimization({ clearBeforeRun: false }).catch(err => {
      console.error('Background LLM optimization error:', err);
    });
    res.json({ message: '已清空旧优化结果，大模型优化任务已在后台启动' });
  } catch (error) {
    res.status(500).json({ error: '启动优化前清空旧数据失败: ' + error.message });
  }
});

router.post('/run-incremental', authenticateToken, (req, res) => {
  if (optimizerStatus.running) {
    return res.status(409).json({ error: '大模型优化任务已经在后台运行中，请等待其完成' });
  }
  runLlmOptimization({ clearBeforeRun: false, incremental: true }).catch(err => {
    console.error('Background incremental LLM optimization error:', err);
  });
  res.json({ message: '增量优化任务已在后台启动' });
});

// 3. Get LLM Optimization Status
router.get('/status', authenticateToken, (req, res) => {
  res.json(optimizerStatus);
});

// Stop LLM Optimization
router.post('/stop', authenticateToken, (req, res) => {
  if (!optimizerStatus.running) {
    return res.status(400).json({ error: '当前没有正在运行的大模型优化任务' });
  }
  optimizerStatus.running = false;
  optimizerStatus.message = '大模型优化任务已由用户手动终止。';
  res.json({ message: '已向优化任务发送停止指令，正在终止中' });
});

router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { category } = req.body;
  const normalizedCategory = Array.isArray(category) ? category[0] : category;

  if (!normalizedCategory) {
    return res.status(400).json({ error: '分组不能为空' });
  }

  try {
    const result = run(`
      UPDATE optimized_sources
      SET category = ?
      WHERE id = ?
    `,
      normalizedCategory,
      id
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: '优化直播源不存在' });
    }

    res.json({ message: '优化直播源分组修改成功' });
  } catch (error) {
    res.status(500).json({ error: '修改优化直播源失败: ' + error.message });
  }
});

// 4. Delete channel (all lines belonging to the optimized channel name)
router.delete('/channel', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: '频道名称不能为空' });
  }
  try {
    run("DELETE FROM optimized_sources WHERE name = ?", name);
    res.json({ message: `成功删除频道 [${name}] 的所有优化线路` });
  } catch (error) {
    res.status(500).json({ error: '删除优化线路失败: ' + error.message });
  }
});

// Delete optimized sources by IDs (bulk or single)
router.delete('/', authenticateToken, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'IDs 数组不能为空' });
  }
  try {
    const placeholders = ids.map(() => '?').join(',');
    run(`DELETE FROM optimized_sources WHERE id IN (${placeholders})`, ...ids);
    res.json({ message: `成功删除 ${ids.length} 个优化直播源` });
  } catch (error) {
    res.status(500).json({ error: '删除优化直播源失败: ' + error.message });
  }
});

// 5. Clear all optimized sources
router.post('/clear', authenticateToken, (req, res) => {
  try {
    run("DELETE FROM optimized_sources");
    res.json({ message: '已清空所有优化的直播源' });
  } catch (error) {
    res.status(500).json({ error: '清空优化直播源失败: ' + error.message });
  }
});

export default router;
