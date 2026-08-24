/**
 * 后台管理 — 系统管理
 * - 分权分域：管理员账号的 role / domain 配置（增删改查）
 * - 密码强度策略：复用 auth.validatePasswordStrength
 * - 安全管理：管理员列表、禁用/启用、改密、操作日志查询
 * - 重启服务端：调用同机 pm2 重启游戏服务（ADMIN_ALLOW_RESTART=1 时启用）
 * - 查询日志：admin_op_log / alerts
 */
const { query } = require('./db');
const { validatePasswordStrength, findAdmin, verifyPassword, hasPermission } = require('./auth');
const bcrypt = require('bcryptjs');
const { opLog } = require('./middleware');
const { exec } = require('child_process');

// ============ 管理员（分权分域） ============
async function listAdmins() {
  const rows = await query(
    'SELECT id, username, role, domain, remark, status, createTime, lastLoginTime FROM admin_users ORDER BY id'
  );
  return rows;
}

async function addAdmin({ username, password, role, domain, remark, operator }) {
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username || '')) return { ok: false, msg: '账号名需 3-32 位字母数字下划线' };
  if (!['super', 'admin', 'operator'].includes(role)) return { ok: false, msg: '角色非法' };
  const exist = await findAdmin(username);
  if (exist) return { ok: false, msg: '账号已存在' };
  const r = validatePasswordStrength(password);
  if (!r.ok) return { ok: false, msg: r.msg };
  const hash = bcrypt.hashSync(password, 10);
  await query(
    'INSERT INTO admin_users (username, passwordHash, role, domain, remark) VALUES (?, ?, ?, ?, ?)',
    [username, hash, role, domain || '*', remark || '']
  );
  await opLog(operator, 'admin_add', username, `role=${role} domain=${domain || '*'}`);
  return { ok: true };
}

async function updateAdmin({ id, role, domain, status, operator }) {
  const sets = [], params = [];
  if (role) { sets.push('role = ?'); params.push(role); }
  if (domain !== undefined) { sets.push('domain = ?'); params.push(domain); }
  if (status !== undefined) { sets.push('status = ?'); params.push(status ? 1 : 0); }
  if (sets.length === 0) return { ok: false, msg: '无变更' };
  params.push(id);
  await query(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`, params);
  await opLog(operator, 'admin_update', String(id), sets.join(','));
  return { ok: true };
}

async function changePassword({ username, oldPwd, newPwd, operator }) {
  const admin = await findAdmin(username);
  if (!admin) return { ok: false, msg: '账号不存在' };
  if (oldPwd && !(await verifyPassword(oldPwd, admin.passwordHash))) {
    return { ok: false, msg: '原密码错误' };
  }
  const r = validatePasswordStrength(newPwd);
  if (!r.ok) return { ok: false, msg: r.msg };
  const hash = bcrypt.hashSync(newPwd, 10);
  await query('UPDATE admin_users SET passwordHash = ? WHERE username = ?', [hash, username]);
  await opLog(operator || username, 'admin_pwd', username, '');
  return { ok: true };
}

// ============ 重启游戏服务端 ============
function restartGameServer() {
  return new Promise((resolve) => {
    if (process.env.ADMIN_ALLOW_RESTART !== '1') {
      return resolve({ ok: false, msg: '未开启重启权限（设置 ADMIN_ALLOW_RESTART=1）' });
    }
    exec('pm2 restart liuer-server', { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, msg: stderr || err.message });
      resolve({ ok: true, out: stdout });
    });
  });
}

// ============ 日志查询 ============
async function getOpLog(limit = 100) {
  return query('SELECT * FROM admin_op_log ORDER BY createTime DESC LIMIT ?', [limit]);
}
async function getAlerts(limit = 100, unresolvedOnly = false) {
  const w = unresolvedOnly ? 'WHERE resolved = 0' : '';
  return query(`SELECT * FROM alerts ${w} ORDER BY createTime DESC LIMIT ?`, [limit]);
}

module.exports = {
  listAdmins, addAdmin, updateAdmin, changePassword,
  restartGameServer, getOpLog, getAlerts,
};
