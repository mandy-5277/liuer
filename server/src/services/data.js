/**
 * 数据服务层（MySQL + Redis 实现）
 * 接口签名与原 CloudBase 版完全一致，仅底层存储切换。
 * - MySQL：持久化（users / games / transactions / rooms）
 * - Redis：内存态（匹配队列 / 房间 / 对局 / 掉线缓存）
 *
 * 注意：房间对局期间的实时状态仍在 Redis（性能），仅结算时落 MySQL。
 */

const { pool } = require('../db/mysql');
const redis = require('../db/redis');
const { game: gameConfig } = require('../config');

// 内存态 Key 前缀
const K = {
  queue: 'liuer:queue',          // 匹配队列（list，存 openid）
  room: 'liuer:room:',           // room:<roomId>
  game: 'liuer:game:',           // game:<gameId>
  offline: 'liuer:offline:',     // offline:<openid>
};

// ============ 用户 ============

// 启动时确保 users 表存在精力/奖励次数字段（懒迁移，字段已存在会报错忽略）
async function ensureEnergySchema() {
  const cols = [
    ['energyRecoverAt', 'BIGINT NOT NULL DEFAULT 0'],
    ['dailyAdCount', 'INT NOT NULL DEFAULT 0'],      // 每日看广告次数
    ['dailyShareCount', 'INT NOT NULL DEFAULT 0'],   // 每日分享次数
  ];
  for (const [col, def] of cols) {
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
      console.log(`[Data] users.${col} 字段已创建`);
    } catch (e) { /* 字段已存在会报错，忽略 */ }
  }
}

/**
 * 每日奖励次数读取 + 跨天自动重置。
 * 若 lastDailyReset 不是今天，则清零 dailyAdCount / dailyShareCount / dailyCopper。
 */
async function ensureDailyReset(openid) {
  const [rows] = await pool.query('SELECT lastDailyReset, dailyAdCount, dailyShareCount, dailyCopper FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const u = rows[0];
  const today = todayCNStr();
  if (u.lastDailyReset === today) {
    return { success: true, adCount: u.dailyAdCount || 0, shareCount: u.dailyShareCount || 0 };
  }
  // 跨天：重置次数
  await pool.query(
    'UPDATE users SET lastDailyReset = ?, dailyAdCount = 0, dailyShareCount = 0, dailyCopper = 0 WHERE openid = ?',
    [today, openid]
  );
  return { success: true, adCount: 0, shareCount: 0 };
}

/**
 * 精力懒恢复：根据 energyRecoverAt 时间戳补算离线/在线累计恢复的点数。
 * 离线也算——因为用绝对时间戳，登陆或结算读用户时调用即可。
 * @returns {{ energy, energyRecoverAt }} 补算后的最新值（已写回 DB）
 */
async function recoverEnergy(openid, energy, energyRecoverAt) {
  const max = gameConfig.energyMax || 30;
  const intervalMs = (gameConfig.energyRecoverMinutes || 5) * 60 * 1000;
  if (energy >= max) {
    if (energyRecoverAt !== 0) {
      await pool.query('UPDATE users SET energyRecoverAt = 0 WHERE openid = ?', [openid]);
    }
    return { energy, energyRecoverAt: 0 };
  }
  const now = Date.now();
  if (!energyRecoverAt || energyRecoverAt <= 0) {
    // 未记录恢复起点：立即设定为 now + interval
    const next = now + intervalMs;
    await pool.query('UPDATE users SET energyRecoverAt = ? WHERE openid = ?', [next, openid]);
    return { energy, energyRecoverAt: next };
  }
  if (now < energyRecoverAt) {
    return { energy, energyRecoverAt };
  }
  const recovered = Math.floor((now - energyRecoverAt) / intervalMs) + 1;
  let newEnergy = energy + recovered;
  let newRecoverAt = 0;
  if (newEnergy >= max) {
    newEnergy = max;
  } else {
    // 剩余时间折算到下个恢复点
    const elapsed = now - energyRecoverAt;
    const used = recovered * intervalMs;
    newRecoverAt = now + (intervalMs - (elapsed - used));
  }
  await pool.query('UPDATE users SET energy = ?, energyRecoverAt = ? WHERE openid = ?', [newEnergy, newRecoverAt, openid]);
  return { energy: newEnergy, energyRecoverAt: newRecoverAt };
}

async function getOrCreateUser(openid, userInfo = {}) {
  const [rows] = await pool.query('SELECT * FROM users WHERE openid = ?', [openid]);
  if (rows.length > 0) {
    const u = rows[0];
    const rec = await recoverEnergy(openid, u.energy, u.energyRecoverAt || 0);
    return {
      openid: u.openid,
      unionid: u.unionid,
      nickName: u.nickName,
      avatarUrl: u.avatarUrl,
      rankScore: u.rankScore,
      rankName: u.rankName,
      energy: rec.energy,
      energyRecoverAt: rec.energyRecoverAt,
      lastCheckin: u.lastCheckin,
      lastDailyReset: u.lastDailyReset,
      winCount: u.winCount,
      loseCount: u.loseCount,
      drawCount: u.drawCount,
      settings: u.settings ? (typeof u.settings === 'string' ? JSON.parse(u.settings) : u.settings) : {},
      createTime: u.createTime,
    };
  }

  const nickName = userInfo.nickName || '';
  const avatarUrl = userInfo.avatarUrl || '';
  const unionid = userInfo.unionid || null;
  const rankScore = 1000;
  const rankName = '初级小六';

  await pool.query(
    `INSERT INTO users (openid, unionid, nickName, avatarUrl, rankScore, rankName)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [openid, unionid, nickName, avatarUrl, rankScore, rankName]
  );

  return {
    openid,
    unionid,
    nickName,
    avatarUrl,
    rankScore,
    rankName,
    energy: 30,
    energyRecoverAt: 0,
    lastCheckin: null,
    lastDailyReset: null,
    winCount: 0,
    loseCount: 0,
    drawCount: 0,
    settings: {},
    createTime: new Date(),
  };
}

async function findByOpenid(openid) {
  const [rows] = await pool.query('SELECT * FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return null;
  const u = rows[0];
  const rec = await recoverEnergy(openid, u.energy, u.energyRecoverAt || 0);
  return {
    openid: u.openid,
    unionid: u.unionid,
    nickName: u.nickName,
    avatarUrl: u.avatarUrl,
    rankScore: u.rankScore,
    rankName: u.rankName,
    energy: rec.energy,
    energyRecoverAt: rec.energyRecoverAt,
    lastCheckin: u.lastCheckin,
    lastDailyReset: u.lastDailyReset,
    winCount: u.winCount,
    loseCount: u.loseCount,
    drawCount: u.drawCount,
    settings: u.settings ? (typeof u.settings === 'string' ? JSON.parse(u.settings) : u.settings) : {},
    createTime: u.createTime,
  };
}

async function updateUser(openid, updates) {
  const allowed = ['nickName', 'avatarUrl', 'rankScore', 'rankName', 'energy', 'lastCheckin', 'lastDailyReset', 'winCount', 'loseCount', 'drawCount', 'settings'];
  const fields = [];
  const values = [];
  for (const k of allowed) {
    if (k in updates) {
      fields.push(`${k} = ?`);
      values.push(k === 'settings' ? JSON.stringify(updates[k]) : updates[k]);
    }
  }
  if (fields.length === 0) return;
  values.push(openid);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE openid = ?`, values);
}

async function getUserGames(openid, limit = 20, skip = 0) {
  const [rows] = await pool.query(
    `SELECT * FROM games WHERE blackOpenid = ? OR whiteOpenid = ?
     ORDER BY createTime DESC LIMIT ? OFFSET ?`,
    [openid, openid, limit, skip]
  );
  return rows.map((g) => ({
    gameId: g.gameId,
    blackOpenid: g.blackOpenid,
    whiteOpenid: g.whiteOpenid,
    mode: g.mode,
    result: g.result,
    endReason: g.endReason,
    endStage: g.endStage,
    blackMoves: g.blackMoves,
    whiteMoves: g.whiteMoves,
    blackCaptures: g.blackCaptures,
    whiteCaptures: g.whiteCaptures,
    blackRating: g.blackRating,
    whiteRating: g.whiteRating,
    durationMs: g.durationMs,
    createTime: g.createTime,
    endTime: g.endTime,
  }));
}

async function getRankList(limit = 100, sortBy = 'score') {
  // sortBy='score' 按积分排；'winRate' 按胜率排（同分按积分兜底）
  let rows;
  if (sortBy === 'winRate') {
    const sql = `
      SELECT openid, nickName, avatarUrl, rankScore, rankName,
             winCount, loseCount, drawCount,
             CASE WHEN (winCount + loseCount + drawCount) = 0 THEN 0
                  ELSE ROUND(winCount * 100.0 / (winCount + loseCount + drawCount), 1)
             END AS winRate
        FROM users
       WHERE (winCount + loseCount + drawCount) >= 50
       ORDER BY winRate DESC, rankScore DESC
       LIMIT ?
    `;
    [rows] = await pool.query(sql, [Number(limit) || 100]);
  } else {
    [rows] = await pool.query(
      'SELECT openid, nickName, avatarUrl, rankScore, rankName, winCount, loseCount, drawCount FROM users ORDER BY rankScore DESC LIMIT ?',
      [Number(limit) || 100]
    );
  }
  return rows.map((u, i) => ({
    rank: i + 1,
    openid: u.openid,
    nickName: u.nickName,
    avatarUrl: u.avatarUrl,
    rankScore: u.rankScore,
    rankName: u.rankName,
    winRate: typeof u.winRate === 'number' ? u.winRate : (function () {
      const t = (u.winCount || 0) + (u.loseCount || 0) + (u.drawCount || 0);
      return t > 0 ? Math.round((u.winCount || 0) * 1000 / t) / 10 : 0;
    })(),
  }));
}

// 更新用户维度战绩（session.js 中 userService.updateGameRecord 调用）
async function updateUserGameResult(openid, result, ratingChange, afterScore) {
  const field = result === 'win' ? 'winCount' : result === 'lose' ? 'loseCount' : 'drawCount';
  await pool.query(
    `UPDATE users SET ${field} = ${field} + 1, rankScore = ? WHERE openid = ?`,
    [afterScore, openid]
  );
}

// 保存完整对局记录（session.js 中 gameRecordService.saveGameRecord 调用）
async function saveGameRecord({ gameId, blackPlayer, whitePlayer, result, endReason, endStage, blackRatingChange, whiteRatingChange, blackAfterScore, whiteAfterScore, blackMoves, whiteMoves, blackCaptures, whiteCaptures, durationMs }) {
  await createGameRecord(gameId, blackPlayer.openid, whitePlayer.openid);
  await updateGameRecord(gameId, {
    result,
    endReason,
    endStage,
    // 兜底：字段缺失时归 0，避免写入 NULL 触发 NOT NULL 约束
    blackMoves: blackMoves ?? 0,
    whiteMoves: whiteMoves ?? 0,
    blackCaptures: blackCaptures ?? 0,
    whiteCaptures: whiteCaptures ?? 0,
    blackRating: blackAfterScore,
    whiteRating: whiteAfterScore,
    durationMs: durationMs ?? 0,
    endTime: new Date(),
  });
  return gameId;
}

// ============ 对局记录 ============

async function createGameRecord(gameId, blackOpenid, whiteOpenid, mode = 'random') {
  await pool.query(
    `INSERT INTO games (gameId, blackOpenid, whiteOpenid, mode)
     VALUES (?, ?, ?, ?)`,
    [gameId, blackOpenid, whiteOpenid, mode]
  );
}

async function updateGameRecord(gameId, update) {
  const allowed = ['result', 'endReason', 'endStage', 'blackMoves', 'whiteMoves', 'blackCaptures', 'whiteCaptures', 'blackRating', 'whiteRating', 'durationMs', 'endTime'];
  const fields = [];
  const values = [];
  for (const k of allowed) {
    if (k in update) {
      fields.push(`${k} = ?`);
      values.push(update[k]);
    }
  }
  if (fields.length === 0) return;
  values.push(gameId);
  await pool.query(`UPDATE games SET ${fields.join(', ')} WHERE gameId = ?`, values);
}

// ============ 交易 / 铜板 / 能量 ============

async function record(openid, type, amount, remark = '', balanceAfter) {
  await pool.query(
    `INSERT INTO transactions (openid, type, amount, balanceAfter, remark)
     VALUES (?, ?, ?, ?, ?)`,
    [openid, type, amount, balanceAfter ?? 0, remark]
  );
}

async function getUserTransactions(openid, limit = 20) {
  const [rows] = await pool.query(
    'SELECT * FROM transactions WHERE openid = ? ORDER BY createTime DESC LIMIT ?',
    [openid, limit]
  );
  return rows.map((t) => ({
    id: t.id,
    openid: t.openid,
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    remark: t.remark,
    createTime: t.createTime,
  }));
}

/** 生成北京时间（UTC+8）的日期字符串 YYYY-MM-DD，规避服务器/数据库时区差异 */
function todayCNStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function checkin(openid, today) {
  const [rows] = await pool.query('SELECT * FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const u = rows[0];

  // 用应用层固定 +8 时区判断"今天"，避免数据库 CURDATE() 因服务器时区(UTC)导致跨日误判。
  const todayStr = todayCNStr();
  const [[last]] = await pool.query(
    'SELECT DATE_FORMAT(lastCheckin, "%Y-%m-%d") AS d FROM users WHERE openid = ?',
    [openid]
  );
  if (last && last.d === todayStr) {
    return { success: false, reason: 'already_checked_in', errMsg: '今日已签到，明天再来', energy: u.energy };
  }

  // 精力奖励：工作日 +5，周六/日 +10（与客户端展示一致）
  const nowCN = new Date(Date.now() + 8 * 3600 * 1000);
  const dayOfWeek = nowCN.getDay(); // 0=周日, 6=周六
  const bonus = (dayOfWeek === 0 || dayOfWeek === 6) ? 10 : 5;
  await pool.query('UPDATE users SET lastCheckin = ? WHERE openid = ?', [todayStr, openid]);
  return { success: true, energy: u.energy, bonus };
}

// 扣减/增加精力后，重置下次自然恢复的时间戳
async function resetRecoverAt(openid, newEnergy) {
  const max = gameConfig.energyMax || 30;
  const intervalMs = (gameConfig.energyRecoverMinutes || 5) * 60 * 1000;
  const recoverAt = newEnergy >= max ? 0 : Date.now() + intervalMs;
  await pool.query('UPDATE users SET energyRecoverAt = ? WHERE openid = ?', [recoverAt, openid]);
  return recoverAt;
}

async function deductEnergy(openid, amount) {
  const [rows] = await pool.query('SELECT energy FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const cur = rows[0].energy;
  if (cur < amount) return { success: false, reason: 'insufficient_energy', energy: cur };
  const newEnergy = cur - amount;
  await pool.query('UPDATE users SET energy = ? WHERE openid = ?', [newEnergy, openid]);
  const recoverAt = await resetRecoverAt(openid, newEnergy);
  return { success: true, energy: newEnergy, energyRecoverAt: recoverAt };
}

async function addEnergy(openid, amount) {
  const [rows] = await pool.query('SELECT energy FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  // 主动获得精力（看广告/分享/签到）可超过上限（energyMax=30），
  // 仅自然恢复（recoverEnergy）受上限约束。
  const newEnergy = rows[0].energy + amount;
  await pool.query('UPDATE users SET energy = ? WHERE openid = ?', [newEnergy, openid]);
  const recoverAt = await resetRecoverAt(openid, newEnergy);
  return { success: true, energy: newEnergy, energyRecoverAt: recoverAt };
}

/** 每日看广告计数 +1，返回新计数（需先 ensureDailyReset） */
async function incrementAdCount(openid) {
  const [rows] = await pool.query('SELECT dailyAdCount FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const next = (rows[0].dailyAdCount || 0) + 1;
  await pool.query('UPDATE users SET dailyAdCount = ? WHERE openid = ?', [next, openid]);
  return { success: true, count: next };
}

/** 每日分享计数 +1，返回新计数（需先 ensureDailyReset） */
async function incrementShareCount(openid) {
  const [rows] = await pool.query('SELECT dailyShareCount FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const next = (rows[0].dailyShareCount || 0) + 1;
  await pool.query('UPDATE users SET dailyShareCount = ? WHERE openid = ?', [next, openid]);
  return { success: true, count: next };
}

async function buyEnergy_REMOVED(openid, energyAmount, copperCost) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT copper, energy FROM users WHERE openid = ? FOR UPDATE', [openid]);
    if (rows.length === 0) {
      await conn.rollback();
      return { success: false, reason: 'user_not_found' };
    }
    const u = rows[0];
    if (u.copper < copperCost) {
      await conn.rollback();
      return { success: false, reason: 'insufficient_copper', copper: u.copper };
    }
    const newCopper = u.copper - copperCost;
    const newEnergy = u.energy + energyAmount;
    await conn.query('UPDATE users SET copper = ?, energy = ? WHERE openid = ?', [newCopper, newEnergy, openid]);
    await conn.query(
      'INSERT INTO transactions (openid, type, amount, balanceAfter, remark) VALUES (?, ?, ?, ?, ?)',
      [openid, 'copper_consume', -copperCost, newCopper, '购买精力']
    );
    await conn.commit();
    return { success: true, copper: newCopper, energy: newEnergy };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function updateCopper(openid, amount) {
  const [rows] = await pool.query('SELECT copper FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const newCopper = rows[0].copper + amount;
  await pool.query('UPDATE users SET copper = ? WHERE openid = ?', [newCopper, openid]);
  return { success: true, copper: newCopper };
}

async function updateDailyCopper(openid, amount) {
  const [rows] = await pool.query('SELECT dailyCopper FROM users WHERE openid = ?', [openid]);
  if (rows.length === 0) return { success: false, reason: 'user_not_found' };
  const newDaily = rows[0].dailyCopper + amount;
  await pool.query('UPDATE users SET dailyCopper = ? WHERE openid = ?', [newDaily, openid]);
  return { success: true, dailyCopper: newDaily };
}

async function updateDailyReset(openid, today, resetFields = {}) {
  const set = ['lastDailyReset = ?'];
  const values = [today.toISOString().slice(0, 10)];
  for (const [k, v] of Object.entries(resetFields)) {
    if (['energy', 'dailyCopper'].includes(k)) {
      set.push(`${k} = ?`);
      values.push(v);
    }
  }
  values.push(openid);
  await pool.query(`UPDATE users SET ${set.join(', ')} WHERE openid = ?`, values);
}

async function updateSettings(openid, settings) {
  await pool.query('UPDATE users SET settings = ? WHERE openid = ?', [JSON.stringify(settings), openid]);
}

// ============ 房间（Redis） ============

async function generateRoomId() {
  // 6位大写字母+数字
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (await redis.exists(K.room + id));
  return id;
}

async function createRoom(roomId, creatorOpenid) {
  const data = {
    roomId,
    creatorOpenid,
    joinerOpenid: '',
    status: 'waiting',
    createTime: Date.now(),
    expireTime: Date.now() + 5 * 60 * 1000, // 5分钟
  };
  await redis.set(K.room + roomId, JSON.stringify(data), 'PX', 5 * 60 * 1000);
  return data;
}

async function findByRoomId(roomId) {
  const raw = await redis.get(K.room + roomId);
  return raw ? JSON.parse(raw) : null;
}

async function joinRoom(roomId, joinerOpenid) {
  const raw = await redis.get(K.room + roomId);
  if (!raw) return null;
  const room = JSON.parse(raw);
  room.joinerOpenid = joinerOpenid;
  room.status = 'matched';
  await redis.set(K.room + roomId, JSON.stringify(room), 'PX', 5 * 60 * 1000);
  return room;
}

async function updateStatus(roomId, status) {
  const raw = await redis.get(K.room + roomId);
  if (!raw) return;
  const room = JSON.parse(raw);
  room.status = status;
  await redis.set(K.room + roomId, JSON.stringify(room), 'PX', 5 * 60 * 1000);
}

async function cancelRoom(roomId) {
  await redis.del(K.room + roomId);
}

async function cleanExpired() {
  // Redis 已用 PX 过期，这里为空实现以兼容原接口
  return 0;
}

// ============ 内存态：匹配队列 / 对局 / 掉线（Redis） ============

async function pushMatchQueue(openid) {
  await redis.rpush(K.queue, openid);
}

async function popMatchQueue() {
  return await redis.lpop(K.queue);
}

async function getQueueLength() {
  return await redis.llen(K.queue);
}

async function removeFromQueue(openid) {
  await redis.lrem(K.queue, 0, openid);
}

async function setGameState(gameId, state) {
  await redis.set(K.game + gameId, JSON.stringify(state), 'PX', 60 * 60 * 1000);
}

async function getGameState(gameId) {
  const raw = await redis.get(K.game + gameId);
  return raw ? JSON.parse(raw) : null;
}

async function setOfflineCache(openid, data) {
  // 掉线缓存 2 分钟，用于断线重连
  await redis.set(K.offline + openid, JSON.stringify(data), 'PX', 2 * 60 * 1000);
}

async function getOfflineCache(openid) {
  const raw = await redis.get(K.offline + openid);
  return raw ? JSON.parse(raw) : null;
}

async function clearOfflineCache(openid) {
  await redis.del(K.offline + openid);
}

module.exports = {
  // 用户
  getOrCreateUser,
  findByOpenid,
  updateUser,
  getUserGames,
  getRankList,
  ensureEnergySchema,
  recoverEnergy,
  ensureDailyReset,
  incrementAdCount,
  incrementShareCount,
  // 对局
  createGameRecord,
  updateGameRecord,
  saveGameRecord,
  // 交易
  record,
  getUserTransactions,
  checkin,
  deductEnergy,
  addEnergy,
  updateDailyReset,
  updateSettings,
  // 房间
  generateRoomId,
  createRoom,
  findByRoomId,
  joinRoom,
  updateStatus,
  cancelRoom,
  cleanExpired,
  // 内存态
  pushMatchQueue,
  popMatchQueue,
  getQueueLength,
  removeFromQueue,
  setGameState,
  getGameState,
  setOfflineCache,
  getOfflineCache,
  clearOfflineCache,

  // ============ 兼容命名空间（session.js / handler.js 调用） ============
  userService: {
    getOrCreateUser,
    findByOpenid,
    updateUser,
    getUserGames,
    getRankList,
    // session.js: userService.updateGameRecord(openid, result, ratingChange, afterScore)
    updateGameRecord: updateUserGameResult,
    // handler.js
    addEnergy,
    deductEnergy,
    checkin,
    updateSettings,
    ensureDailyReset,
    incrementAdCount,
    incrementShareCount,
  },
  gameRecordService: {
    createGameRecord,
    updateGameRecord,
    saveGameRecord,
    getUserGames,
  },
  transactionService: {
    record,
    getUserTransactions,
  },
  checkinService: {
    checkin,
  },
  roomService: {
    // session.js: roomService.createRoom(creatorUid, type)
    async createRoom(creatorUid, type) {
      const roomId = await generateRoomId();
      const data = await createRoom(roomId, creatorUid);
      return { ...data, _id: roomId, type: type || 'invite' };
    },
    async findByRoomId(roomId) {
      const data = await findByRoomId(roomId);
      return data ? { ...data, _id: roomId } : null;
    },
    async joinRoom(roomId, joinerOpenid) {
      const data = await joinRoom(roomId, joinerOpenid);
      return data ? { ...data, _id: roomId } : null;
    },
    async updateStatus(roomId, status) {
      return updateStatus(roomId, status);
    },
    async cancelRoom(roomId) {
      return cancelRoom(roomId);
    },
  },
};
