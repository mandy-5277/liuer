/**
 * 后台管理 — 中间件
 * - requireAuth: 校验 JWT，注入 req.admin
 * - requirePerm: 校验角色权限
 * - enforceHttps: 检测到 http（非本地）时 301 跳转到 https
 * - opLog: 记录管理操作到 admin_op_log
 */
const { verifyToken, hasPermission } = require('./auth');
const { query } = require('./db');

// 从 Authorization: Bearer <token> 取 token
function extractToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.token || req.body.token || null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ ok: false, errMsg: '未登录' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, errMsg: '登录已过期，请重新登录' });
  req.admin = payload;
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ ok: false, errMsg: '未登录' });
    if (!hasPermission(req.admin.role, perm)) {
      return res.status(403).json({ ok: false, errMsg: '权限不足' });
    }
    next();
  };
}

// 强制 HTTPS（仅当处于反向代理后且客户端为 http 时跳转）
function enforceHttps(req, res, next) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const remote = (req.socket && req.socket.remoteAddress) || req.ip || '';
  const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1' || remote === 'localhost';
  if (proto === 'http' && !isLocal && process.env.ADMIN_FORCE_HTTPS !== 'false') {
    const host = req.get('host');
    return res.redirect(301, 'https://' + host + req.originalUrl);
  }
  next();
}

// 操作日志（异步写入，不阻塞响应）
async function opLog(adminUser, action, target, detail) {
  try {
    await query(
      'INSERT INTO admin_op_log (adminUser, action, target, detail) VALUES (?, ?, ?, ?)',
      [adminUser || 'unknown', action, target || '', detail || '']
    );
  } catch (e) {
    console.error('[OpLog] 写入失败:', e.message);
  }
}

module.exports = { requireAuth, requirePerm, enforceHttps, opLog, extractToken };
