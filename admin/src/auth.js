/**
 * 后台管理 — 认证与授权
 * - 管理员账号存于 admin_users 表（bcrypt 密码哈希）
 * - 登录签发 JWT（默认 2 小时有效期）
 * - 支持分权分域：role(super/admin/operator) + domain(分域标识)
 * - 密码强度校验（注册/改密时）
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('./db');
const crypto = require('crypto');

// JWT 密钥：优先使用环境变量，否则用一次性随机（重启后旧 token 失效，仅开发用）
const JWT_SECRET = process.env.ADMIN_JWT_SECRET
  || (process.env.ADMIN_JWT_SECRET = crypto.randomBytes(32).toString('hex'));
const JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES || '2h';

// 角色权限矩阵：每个角色可访问的"域"
// super  : 全部接口 + 系统管理 + 用户管理 + 分权配置
// admin  : 用户管理 + 统计 + 性能监控（不能改分权/重启）
// operator: 仅统计查看 + 用户查询（不能执行赠送/加黑/清分等写操作）
const ROLE_PERMISSIONS = {
  super:    ['stats:view', 'user:view', 'user:edit', 'system:all', 'monitor:view'],
  admin:    ['stats:view', 'user:view', 'user:edit', 'monitor:view'],
  operator: ['stats:view', 'user:view', 'monitor:view'],
};

function hasPermission(role, perm) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes(perm) || perms.includes('system:all');
}

// 密码强度：>=8 位，含大小写字母+数字，或长度>=12
function validatePasswordStrength(pwd) {
  if (!pwd || typeof pwd !== 'string') return { ok: false, msg: '密码不能为空' };
  if (pwd.length < 8) return { ok: false, msg: '密码至少 8 位' };
  if (pwd.length >= 12) return { ok: true };
  const hasLower = /[a-z]/.test(pwd);
  const hasUpper = /[A-Z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
  const kinds = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
  if (kinds < 3) return { ok: false, msg: '密码需包含大小写字母、数字、特殊符号中至少 3 类' };
  return { ok: true };
}

async function findAdmin(username) {
  const rows = await query('SELECT * FROM admin_users WHERE username = ?', [username]);
  return rows[0] || null;
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function createAdmin(username, password, role = 'operator', domain = '*', remark = '') {
  const strength = validatePasswordStrength(password);
  if (!strength.ok) return { ok: false, msg: strength.msg };
  const hash = bcrypt.hashSync(password, 10);
  await query(
    'INSERT INTO admin_users (username, passwordHash, role, domain, remark) VALUES (?, ?, ?, ?, ?)',
    [username, hash, role, domain, remark]
  );
  return { ok: true };
}

function signToken(admin) {
  return jwt.sign(
    { sub: admin.id, username: admin.username, role: admin.role, domain: admin.domain },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// 确保至少存在一个 super 管理员（首次启动用环境变量初始化）
async function ensureSeedAdmin() {
  const rows = await query('SELECT COUNT(*) AS c FROM admin_users');
  if (rows[0].c > 0) return;
  const user = process.env.ADMIN_SEED_USER || 'admin';
  const pwd = process.env.ADMIN_SEED_PASSWORD || 'Liuer@2026Admin';
  const r = validatePasswordStrength(pwd);
  const hash = bcrypt.hashSync(r.ok ? pwd : 'Liuer@2026Admin', 10);
  await query(
    'INSERT INTO admin_users (username, passwordHash, role, domain, remark) VALUES (?, ?, ?, ?, ?)',
    [user, hash, 'super', '*', '初始化超级管理员']
  );
  console.log(`[Auth] 已初始化超级管理员账号: ${user} (请尽快修改密码)`);
}

module.exports = {
  JWT_SECRET, JWT_EXPIRES, ROLE_PERMISSIONS,
  hasPermission, validatePasswordStrength,
  findAdmin, verifyPassword, createAdmin, signToken, verifyToken, ensureSeedAdmin,
};
