import express from 'express';
import { run, query, queryOne } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { syncSubscription, syncAllSubscriptions, syncStatus } from '../sync.js';

const router = express.Router();

// Get all subscriptions
router.get('/', authenticateToken, (req, res) => {
  try {
    const list = query('SELECT * FROM subscriptions ORDER BY id DESC');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: '获取订阅列表失败: ' + error.message });
  }
});

// Create subscription
router.post('/', authenticateToken, (req, res) => {
  const { name, url, user_agent, auto_update } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '订阅名称和地址不能为空' });
  }

  try {
    run(`
      INSERT INTO subscriptions (name, url, user_agent, auto_update)
      VALUES (?, ?, ?, ?)
    `, name, url, user_agent || '', auto_update !== false ? 1 : 0);
    res.status(201).json({ message: '创建订阅成功' });
  } catch (error) {
    res.status(500).json({ error: '创建订阅失败: ' + error.message });
  }
});

// Update subscription
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, url, user_agent, auto_update } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '订阅名称和地址不能为空' });
  }

  try {
    run(`
      UPDATE subscriptions 
      SET name = ?, url = ?, user_agent = ?, auto_update = ?
      WHERE id = ?
    `, name, url, user_agent || '', auto_update ? 1 : 0, id);
    res.json({ message: '更新订阅成功' });
  } catch (error) {
    res.status(500).json({ error: '更新订阅失败: ' + error.message });
  }
});

// Delete subscription
router.delete('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  try {
    run('DELETE FROM sources WHERE subscription_id = ?', id);
    run('DELETE FROM subscriptions WHERE id = ?', id);
    res.json({ message: '成功删除订阅及其拉取的直播源' });
  } catch (error) {
    res.status(500).json({ error: '删除订阅失败: ' + error.message });
  }
});

// Trigger sync for all active subscriptions
router.post('/sync', authenticateToken, (req, res) => {
  if (syncStatus.running) {
    return res.status(409).json({ error: '订阅同步任务已经在后台运行中，请等待其完成' });
  }
  try {
    syncAllSubscriptions().catch(err => {
      console.error('Background sync-all error:', err);
    });
    res.json({ message: '订阅同步任务已在后台启动' });
  } catch (error) {
    res.status(500).json({ error: '启动订阅同步失败: ' + error.message });
  }
});

// Get subscription sync status
router.get('/sync/status', authenticateToken, (req, res) => {
  res.json(syncStatus);
});

// Manually trigger sync for a single subscription
router.post('/:id/sync', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await syncSubscription(id);
    res.json({ message: '同步订阅源成功！' });
  } catch (error) {
    res.status(500).json({ error: '同步订阅源失败: ' + error.message });
  }
});

export default router;
