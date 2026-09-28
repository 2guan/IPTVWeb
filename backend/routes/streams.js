import express from 'express';
import { query } from '../db.js';
import { authenticateToken } from '../middleware.js';
import {
  getStreamStatuses,
  selectBestSourcesByChannelNames,
  setStreamEnabled,
  startStreamForSource,
  stopStream
} from '../streamer.js';

const router = express.Router();

function getSourcesFromBody(body = {}) {
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.map(Number).filter(Boolean) : [];
  const channelNames = Array.isArray(body.channelNames) ? body.channelNames : [];
  const sources = [];

  if (sourceIds.length > 0) {
    const placeholders = sourceIds.map(() => '?').join(',');
    sources.push(...query(`SELECT * FROM sources WHERE id IN (${placeholders})`, ...sourceIds));
  }

  sources.push(...selectBestSourcesByChannelNames(channelNames));

  const seen = new Set();
  return sources.filter(source => {
    if (!source?.id || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

router.get('/status', authenticateToken, (req, res) => {
  res.json(getStreamStatuses());
});

router.post('/enable', authenticateToken, (req, res) => {
  try {
    const count = setStreamEnabled({
      sourceIds: req.body.sourceIds || [],
      channelNames: req.body.channelNames || [],
      enabled: req.body.enabled !== false
    });
    res.json({ message: `已${req.body.enabled === false ? '取消' : '标记'} ${count} 个推流频道`, count });
  } catch (error) {
    res.status(500).json({ error: '设置推流频道失败: ' + error.message });
  }
});

router.post('/start', authenticateToken, async (req, res) => {
  try {
    const sources = getSourcesFromBody(req.body);
    if (sources.length === 0) {
      return res.status(400).json({ error: '没有找到要推流的频道或线路' });
    }

    const results = [];
    for (const source of sources) {
      try {
        results.push(await startStreamForSource(source, { mode: req.body.mode }));
      } catch (error) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: 'failed',
          running: false,
          error: error.message
        });
      }
    }

    res.json({ message: `已处理 ${results.length} 个推流任务`, results });
  } catch (error) {
    res.status(500).json({ error: '启动推流失败: ' + error.message });
  }
});

router.post('/start-enabled', authenticateToken, async (req, res) => {
  try {
    const sources = query('SELECT * FROM sources WHERE stream_enabled = 1');
    if (sources.length === 0) {
      return res.status(400).json({ error: '没有已标记启用推流的频道' });
    }

    const results = [];
    for (const source of sources) {
      try {
        results.push(await startStreamForSource(source, { mode: req.body.mode }));
      } catch (error) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: 'failed',
          running: false,
          error: error.message
        });
      }
    }
    res.json({ message: `已启动 ${results.filter(item => item.running).length} 个已启用推流频道`, results });
  } catch (error) {
    res.status(500).json({ error: '启动已启用推流失败: ' + error.message });
  }
});

router.post('/stop', authenticateToken, (req, res) => {
  try {
    const sources = getSourcesFromBody(req.body);
    const ids = new Set([
      ...sources.map(source => Number(source.id)),
      ...(Array.isArray(req.body.sourceIds) ? req.body.sourceIds.map(Number).filter(Boolean) : [])
    ]);
    if (ids.size === 0) {
      return res.status(400).json({ error: '没有找到要停止推流的频道或线路' });
    }

    for (const id of ids) stopStream(id, '手动停止');
    res.json({ message: `已停止 ${ids.size} 个推流任务` });
  } catch (error) {
    res.status(500).json({ error: '停止推流失败: ' + error.message });
  }
});

export default router;
