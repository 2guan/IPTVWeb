import express from 'express';
import bcrypt from 'bcryptjs';
import db, { run, query, queryOne } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware.js';
import { updateScheduler } from '../scheduler.js';

const router = express.Router();

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
    
    // Check if crons changed
    const oldCrons = queryOne('SELECT value FROM settings WHERE key = ?', 'syncCron')?.value + 
                     queryOne('SELECT value FROM settings WHERE key = ?', 'testCron')?.value +
                     queryOne('SELECT value FROM settings WHERE key = ?', 'epgCron')?.value;

    db.exec('BEGIN TRANSACTION');
    try {
      for (const [key, value] of Object.entries(settingsData)) {
        insertStmt.run(key, value.toString());
      }
      db.exec('COMMIT');
    } catch (dbErr) {
      db.exec('ROLLBACK');
      throw dbErr;
    }

    const newCrons = (settingsData.syncCron || '') + (settingsData.testCron || '') + (settingsData.epgCron || '');
    if (oldCrons !== newCrons) {
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

export default router;
