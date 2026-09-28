import express from 'express';
import bcrypt from 'bcryptjs';
import db, { run, query, queryOne } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware.js';
import { updateScheduler } from '../scheduler.js';
import { exportBackup, importBackup, rollbackBackup, hasRollbackSnapshot } from '../configBackup.js';
import { verifyYangshipinCookie } from '../extractors/yangshipin.js';
import { verifyFengshowsToken } from '../extractors/fengshows.js';

const router = express.Router();
const CRON_SETTING_KEYS = ['syncCron', 'testCron', 'epgCron', 'optimizeCron'];

function readCronSettings() {
  const rows = query(
    `SELECT key, value FROM settings WHERE key IN (${CRON_SETTING_KEYS.map(() => '?').join(',')})`,
    ...CRON_SETTING_KEYS
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value || '']));
  return Object.fromEntries(CRON_SETTING_KEYS.map(key => [key, values[key] || '']));
}

// 1. Get system settings
router.get('/', authenticateToken, (req, res) => {
  try {
    const rows = query('SELECT key, value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: '获取设置失败: ' + error.message });
  }
});

// 2. Save system settings
router.post('/', authenticateToken, (req, res) => {
  const settingsData = req.body;
  if (!settingsData || typeof settingsData !== 'object') {
    return res.status(400).json({ error: '无效的设置数据' });
  }

  try {
    const insertStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    
    const oldCrons = readCronSettings();

    db.exec('BEGIN TRANSACTION');
    try {
      for (const [key, value] of Object.entries(settingsData)) {
        insertStmt.run(key, (value ?? '').toString());
      }
      db.exec('COMMIT');
    } catch (dbErr) {
      db.exec('ROLLBACK');
      throw dbErr;
    }

    const newCrons = readCronSettings();
    if (CRON_SETTING_KEYS.some(key => oldCrons[key] !== newCrons[key])) {
      // Reload cron tasks if cron expressions changed
      updateScheduler();
    }

    res.json({ message: '设置保存成功' });
  } catch (error) {
    res.status(500).json({ error: '保存设置失败: ' + error.message });
  }
});

// 3. List all users (admin only)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = query('SELECT id, username, role, created_at FROM users ORDER BY id DESC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: '获取用户列表失败: ' + error.message });
  }
});

// 4. Create user (admin only, registration disabled)
router.post('/users', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: '用户名、密码和角色不能为空' });
  }

  try {
    const exists = queryOne('SELECT id FROM users WHERE username = ?', username);
    if (exists) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', username, hash, role);
    res.status(201).json({ message: '用户创建成功' });
  } catch (error) {
    res.status(500).json({ error: '创建用户失败: ' + error.message });
  }
});

// 5. Reset user password (admin only)
router.put('/users/:id/password', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: '新密码不能为空' });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    run('UPDATE users SET password = ? WHERE id = ?', hash, id);
    res.json({ message: '密码重置成功' });
  } catch (error) {
    res.status(500).json({ error: '重置密码失败: ' + error.message });
  }
});

// 6. Delete user (admin only)
router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: '不能删除您当前登录的账户' });
  }

  try {
    run('DELETE FROM users WHERE id = ?', id);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    res.status(500).json({ error: '删除用户失败: ' + error.message });
  }
});

// 7. Export full configuration backup JSON
router.get('/backup/export', authenticateToken, (req, res) => {
  try {
    const backup = exportBackup();
    const filename = `iptv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    res.status(500).json({ error: '导出备份失败: ' + error.message });
  }
});

router.get('/backup', authenticateToken, (req, res) => {
  try {
    const backup = exportBackup();
    res.json(backup);
  } catch (error) {
    res.status(500).json({ error: '获取备份失败: ' + error.message });
  }
});

// 8. Import configuration backup JSON
router.post('/backup/import', authenticateToken, requireAdmin, (req, res) => {
  try {
    const backupData = req.body;
    const result = importBackup(backupData);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 9. Rollback configuration to pre-import snapshot
router.post('/backup/rollback', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = rollbackBackup();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 10. Check if rollback snapshot is available
router.get('/backup/status', authenticateToken, (req, res) => {
  res.json({ hasSnapshot: hasRollbackSnapshot() });
});

// 11. Verify Yangshipin Cookie
router.post('/verify-ysp', authenticateToken, async (req, res) => {
  try {
    let cookie = req.body?.cookie;
    if (!cookie) {
      const row = queryOne("SELECT value FROM settings WHERE key = 'yspCookie'");
      cookie = row?.value || '';
    }
    if (!cookie) {
      return res.status(400).json({ error: '未提供央视频 Cookie，请先在输入框中粘贴 Cookie' });
    }
    const result = await verifyYangshipinCookie(cookie);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || '央视频凭据校验失败' });
  }
});

// 12. Verify Fengshows Token
router.post('/verify-fengshows', authenticateToken, async (req, res) => {
  try {
    let token = req.body?.token;
    if (!token) {
      const row = queryOne("SELECT value FROM settings WHERE key = 'fengshowsToken'");
      token = row?.value || '';
    }
    if (!token) {
      return res.status(400).json({ error: '未提供凤凰秀 Token，请先在输入框中填入 Token' });
    }
    const result = await verifyFengshowsToken(token);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || '凤凰秀凭据校验失败' });
  }
});

export default router;
