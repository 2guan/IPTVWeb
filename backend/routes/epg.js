import express from 'express';
import { run, query } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { syncEpg, epgSyncStatus } from '../epg.js';

const router = express.Router();

// Get all EPG sources
router.get('/', authenticateToken, (req, res) => {
  try {
    const list = query('SELECT * FROM epg_sources ORDER BY id DESC');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: '获取 EPG 订阅列表失败: ' + error.message });
  }
});

// Create EPG source
router.post('/', authenticateToken, (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '名称和 XML 链接不能为空' });
  }

  try {
    run('INSERT INTO epg_sources (name, url) VALUES (?, ?)', name, url);
    res.status(201).json({ message: '创建 EPG 订阅成功' });
  } catch (error) {
    res.status(500).json({ error: '创建 EPG 订阅失败: ' + error.message });
  }
});

// Update EPG source
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '名称和 XML 链接不能为空' });
  }

  try {
    run('UPDATE epg_sources SET name = ?, url = ? WHERE id = ?', name, url, id);
    res.json({ message: '更新 EPG 订阅成功' });
  } catch (error) {
    res.status(500).json({ error: '更新 EPG 订阅失败: ' + error.message });
  }
});

// Delete EPG source
router.delete('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  try {
    run('DELETE FROM epg_sources WHERE id = ?', id);
    res.json({ message: '删除 EPG 订阅成功' });
  } catch (error) {
    res.status(500).json({ error: '删除 EPG 订阅失败: ' + error.message });
  }
});

// Trigger full EPG compilation (sync and merge)
router.post('/sync', authenticateToken, (req, res) => {
  if (epgSyncStatus.running) {
    return res.status(409).json({ error: 'EPG 同步任务已经在后台运行中，请等待其完成' });
  }
  try {
    syncEpg().catch(err => {
      console.error('Background EPG sync error:', err);
    });
    res.json({ message: 'EPG 同步与合并已在后台启动' });
  } catch (error) {
    res.status(500).json({ error: '启动 EPG 同步失败: ' + error.message });
  }
});

// Get EPG sync status
router.get('/sync/status', authenticateToken, (req, res) => {
  res.json(epgSyncStatus);
});

export default router;
