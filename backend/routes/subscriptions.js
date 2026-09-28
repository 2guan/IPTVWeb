import express from 'express';
import { run, query, queryOne } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { syncSubscription, syncAllSubscriptions, syncStatus } from '../sync.js';
import { syncOfficialExtractors } from '../extractors/index.js';

const router = express.Router();

class ValidationError extends Error {}

function toBoolInt(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()) || value === 1 || value === true ? 1 : 0;
}

function normalizeSubscriptionPayload(body) {
  const sourceType = body.source_type === 'migu' ? 'migu' : 'standard';
  const name = String(body.name || '').trim();
  if (!name) {
    throw new ValidationError('订阅名称不能为空');
  }

  if (sourceType === 'migu') {
    const baseUrl = String(body.migu_base_url || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ValidationError('播放代理公网地址不能为空');
    }
    return {
      name,
      url: 'migu://live',
      user_agent: String(body.user_agent || '').trim(),
      source_type: 'migu',
      migu_base_url: baseUrl,
      migu_user_id: String(body.migu_user_id || '').trim(),
      migu_token: String(body.migu_token || '').trim(),
      migu_rate_type: String(body.migu_rate_type || '3'),
      migu_enable_h265: toBoolInt(body.migu_enable_h265, 1),
      migu_enable_hdr: toBoolInt(body.migu_enable_hdr, 0),
      auto_update: toBoolInt(body.auto_update, 1)
    };
  }

  const url = String(body.url || '').trim();
  if (!url) {
    throw new ValidationError('订阅地址不能为空');
  }
  return {
    name,
    url,
    user_agent: String(body.user_agent || '').trim(),
    source_type: 'standard',
    migu_base_url: '',
    migu_user_id: '',
    migu_token: '',
    migu_rate_type: '3',
    migu_enable_h265: 1,
    migu_enable_hdr: 0,
    auto_update: toBoolInt(body.auto_update, 1)
  };
}

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
  try {
    const payload = normalizeSubscriptionPayload(req.body || {});
    run(`
      INSERT INTO subscriptions (
        name, url, user_agent, source_type, migu_base_url, migu_user_id, migu_token,
        migu_rate_type, migu_enable_h265, migu_enable_hdr, auto_update
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, payload.name, payload.url, payload.user_agent, payload.source_type, payload.migu_base_url,
      payload.migu_user_id, payload.migu_token, payload.migu_rate_type, payload.migu_enable_h265,
      payload.migu_enable_hdr, payload.auto_update);
    res.status(201).json({ message: '创建订阅成功' });
  } catch (error) {
    res.status(error instanceof ValidationError ? 400 : 500).json({ error: '创建订阅失败: ' + error.message });
  }
});

// Update subscription
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  try {
    const payload = normalizeSubscriptionPayload(req.body || {});
    run(`
      UPDATE subscriptions 
      SET name = ?, url = ?, user_agent = ?, source_type = ?, migu_base_url = ?,
          migu_user_id = ?, migu_token = ?, migu_rate_type = ?, migu_enable_h265 = ?,
          migu_enable_hdr = ?, auto_update = ?
      WHERE id = ?
    `, payload.name, payload.url, payload.user_agent, payload.source_type, payload.migu_base_url,
      payload.migu_user_id, payload.migu_token, payload.migu_rate_type, payload.migu_enable_h265,
      payload.migu_enable_hdr, payload.auto_update, id);
    res.json({ message: '更新订阅成功' });
  } catch (error) {
    res.status(error instanceof ValidationError ? 400 : 500).json({ error: '更新订阅失败: ' + error.message });
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
    const result = await syncSubscription(id);
    const deleted = result?.deduplicated?.deleted || 0;
    res.json({
      message: `同步订阅源成功！已全量去重，清理 ${deleted} 个重复 URL。`,
      deduplicated: result?.deduplicated || null
    });
  } catch (error) {
    res.status(500).json({ error: '同步订阅源失败: ' + error.message });
  }
});

// Trigger official extractors sync (Sichuan, Quanzhou, Lotus TV, etc.)
router.post('/sync-official', authenticateToken, async (req, res) => {
  try {
    const result = await syncOfficialExtractors();
    res.json({
      message: `官方直采源同步成功，共发现并更新 ${result.count} 个频道。`,
      count: result.count,
      channels: result.channels
    });
  } catch (error) {
    res.status(500).json({ error: '同步官方直采源失败: ' + error.message });
  }
});

export default router;
