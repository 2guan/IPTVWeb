import express from 'express';
import { authenticateToken } from '../middleware.js';
import { getMiguPlaybackDetails, getMiguStatus, syncMiguBundleForSubscription, testMiguAccount } from '../migu.js';
import { deduplicateSourcesByUrl } from '../deduplicate.js';

const router = express.Router();

function isStrictRate(req) {
  return req.query.strict_rate === '1' || req.query.strictRate === '1';
}

router.get('/play/:subscriptionId/:pid', async (req, res) => {
  try {
    const details = await getMiguPlaybackDetails(req.params.pid, req.query.rate_type, req.params.subscriptionId, {
      strictRate: isStrictRate(req)
    });
    if (req.query.debug === '1') {
      res.json({ ...details, protocol: new URL(details.url).protocol });
      return;
    }
    res.statusCode = 302;
    res.setHeader('Location', details.url);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Migu-Requested-Rate-Type', String(details.requestedRateType || ''));
    res.setHeader('X-Migu-Actual-Rate-Type', String(details.actualRateType || ''));
    res.setHeader('X-Migu-Downgraded', details.downgraded ? '1' : '0');
    res.end();
  } catch (error) {
    res.status(502).type('text/plain; charset=utf-8').send(`咪咕换链失败: ${error.message}`);
  }
});

router.get('/play/:pid', async (req, res) => {
  try {
    const details = await getMiguPlaybackDetails(req.params.pid, req.query.rate_type, undefined, {
      strictRate: isStrictRate(req)
    });
    if (req.query.debug === '1') {
      res.json({ ...details, protocol: new URL(details.url).protocol });
      return;
    }
    res.statusCode = 302;
    res.setHeader('Location', details.url);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Migu-Requested-Rate-Type', String(details.requestedRateType || ''));
    res.setHeader('X-Migu-Actual-Rate-Type', String(details.actualRateType || ''));
    res.setHeader('X-Migu-Downgraded', details.downgraded ? '1' : '0');
    res.end();
  } catch (error) {
    res.status(502).type('text/plain; charset=utf-8').send(`咪咕换链失败: ${error.message}`);
  }
});

router.get('/status', authenticateToken, (req, res) => {
  try {
    res.json(getMiguStatus());
  } catch (error) {
    res.status(500).json({ error: '获取咪咕源状态失败: ' + error.message });
  }
});

router.post('/test-account', authenticateToken, async (req, res) => {
  try {
    const result = await testMiguAccount({
      userId: req.body?.userId,
      token: req.body?.token,
      cookie: req.body?.cookie,
      rateType: req.body?.rateType || 4,
      enableH265: req.body?.enableH265,
      enableHdr: req.body?.enableHdr,
      userAgent: req.body?.userAgent
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '测试咪咕账号失败: ' + error.message });
  }
});

router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const subscriptionId = req.body?.subscriptionId;
    if (!subscriptionId) {
      return res.status(400).json({ error: '缺少咪咕订阅 ID' });
    }
    const result = await syncMiguBundleForSubscription(subscriptionId);
    const deduplicated = deduplicateSourcesByUrl();
    const { channels, sports } = result;
    res.json({
      message: `咪咕源同步完成，频道 ${channels.total} 个，体育赛事 ${sports.total} 个；已全量去重，清理 ${deduplicated.deleted} 个重复 URL。`,
      total: channels.total + sports.total,
      channels,
      sports,
      deduplicated
    });
  } catch (error) {
    res.status(500).json({ error: '同步咪咕源失败: ' + error.message });
  }
});

export default router;
