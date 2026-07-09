import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'iptv-admin-secret-2026';

/**
 * Middleware to authenticate JWT tokens
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未登录，访问被拒绝' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '登录会话已过期，请重新登录' });
    }
    req.user = user;
    next();
  });
}

/**
 * Middleware to enforce Admin role
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，仅管理员可执行此操作' });
  }
  next();
}
