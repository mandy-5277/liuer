/**
 * 后台管理 — 用户管理
 * 查询（ID / 昵称 / 注册时间段）+ 操作（赠送精力 / 加黑 / 清分）
 * 直接读写与游戏服务端同一 users 表（独立连接池，原子 UPDATE）。
 *
 * 字段映射（后台展示）：
 *  ID=openid, 昵称=nickName, 注册时间=createTime, 头像=avatarUrl,
 *  级别=rankName, 场次=winCount+loseCount+drawCount,
 *  积分=rankScore, 胜率, 看广告次数=totalAdCount, 分享次数=totalShareCount,
 *  最后上线=lastLoginTime, 黑名单=isBlacklist
 */
const { query } = require('./db');

function mapUser(u) {
  if (!u) return null;
  const games = (u.winCount || 0) + (u.loseCount || 0) + (u.drawCount || 0);
  const winRate = games > 0 ? Math.round((u.winCount || 0) * 1000 / games) / 10 : 0;
  return {
    openid: u.openid,
    nickName: u.nickName,
    avatarUrl: u.avatarUrl,
    createTime: u.createTime,
    lastLoginTime: u.lastLoginTime,
    rankName: u.rankName,
    rankScore: u.rankScore,
    games,
    winRate,
    totalAdCount: u.totalAdCount || 0,
    totalShareCount: u.totalShareCount || 0,
    isBlacklist: u.isBlacklist || 0,
    isBot: (u.openid || '').startsWith('bot_'),
  };
}

// 默认查询最新活跃的 100 个用户
async function listUsers({ keyword, startTime, endTime, blacklistOnly, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  where.push("openid NOT LIKE 'bot_%'"); // 后台不展示机器人
  if (keyword) {
    where.push('(openid LIKE ? OR nickName LIKE ?)');
    params.push('%' + keyword + '%', '%' + keyword + '%');
  }
  if (startTime) { where.push('createTime >= ?'); params.push(startTime); }
  if (endTime) { where.push('createTime <= ?'); params.push(endTime); }
  if (blacklistOnly) { where.push('isBlacklist = 1'); }

  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await query(
    `SELECT * FROM users ${w} ORDER BY lastLoginTime DESC, createTime DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await query(`SELECT COUNT(*) AS c FROM users ${w}`, params);
  return { total: cnt.c, list: rows.map(mapUser) };
}

async function getUser(openid) {
  const rows = await query('SELECT * FROM users WHERE openid = ?', [openid]);
  return mapUser(rows[0] || null);
}

async function grantEnergy(openid, amount) {
  const amt = parseInt(amount, 10);
  if (!(amt === 10 || amt === 20 || amt === 30)) return { ok: false, msg: '赠送额度非法（仅支持 10/20/30）' };
  const [r] = await query('SELECT energy FROM users WHERE openid = ?', [openid]);
  if (!r) return { ok: false, msg: '用户不存在' };
  const next = Math.min((r.energy || 0) + amt, 9999);
  await query('UPDATE users SET energy = ? WHERE openid = ?', [next, openid]);
  return { ok: true, energy: next };
}

async function setBlacklist(openid, on) {
  await query('UPDATE users SET isBlacklist = ? WHERE openid = ?', [on ? 1 : 0, openid]);
  return { ok: true };
}

// 清分：积分归零、段位重置、胜负场次清零（保留机器人判定）
async function clearScore(openid) {
  await query(
    'UPDATE users SET rankScore = 0, rankName = ?, winCount = 0, loseCount = 0, drawCount = 0 WHERE openid = ?',
    ['初级小六', openid]
  );
  return { ok: true };
}

module.exports = { listUsers, getUser, grantEnergy, setBlacklist, clearScore, mapUser };
