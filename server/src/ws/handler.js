/**
 * 六儿 服务端 — WebSocket 消息路由
 *
 * 协议格式（PRD 定义）：
 * {
 *   "cmd": "指令名",
 *   "data": {},
 *   "seq": 序列号（可选）
 * }
 */

const { userService, transactionService, checkinService, gameRecordService } = require('../services/data');
const {
  wsMap, registerConnection, removeConnection,
  sendToPlayer, findActiveGameByPlayer,
  joinMatching, cancelMatching,
  createInviteRoom, joinRoomByCode,
  handleGameAction, gameSessions,
} = require('../services/session');
const { getRankName } = require('../game/board');
const { game: gameConfig } = require('../config');

/**
 * 主消息分发器
 * @param {WebSocket} ws
 * @param {object} msg - { cmd, data, seq }
 */
async function dispatch(ws, msg) {
  const { cmd, data = {}, seq } = msg;

  try {
    switch (cmd) {
      // ========== 认证 ==========
      case 'login':
        await handleLogin(ws, data);
        break;

      // ========== 匹配 ==========
      case 'match_start':
        handleMatchStart(ws, data);
        break;
      case 'match_cancel':
        handleMatchCancel(ws);
        break;

      // ========== 房间 ==========
      case 'invite_room':
        await handleInviteRoom(ws);
        break;
      case 'join_room':
        await handleJoinRoom(ws, data);
        break;

      // ========== 对局操作 ==========
      case 'place_piece':
      case 'capture_piece':
      case 'move_piece':
      case 'linked_capture':
      case 'skip_capture':
      case 'give_up':
      case 'request_draw':
      case 'respond_draw':
        handleGameAction(getOpenid(ws), cmd, data);
        break;

      // ========== 用户数据 ==========
      case 'get_profile':
        await handleGetProfile(ws);
        break;
      case 'get_history':
        await handleGetHistory(ws, data);
        break;
      case 'update_settings':
        await handleUpdateSettings(ws, data);
        break;

      // ========== 排行榜 ==========
      case 'get_rank_list':
        await handleGetRankList(ws, data);
        break;

      // ========== 经济系统 ==========
      case 'sign_in':
        await handleSignIn(ws);
        break;
      case 'buy_energy':
        await handleBuyEnergy(ws);
        break;
      case 'get_transactions':
        await handleGetTransactions(ws, data);
        break;
      case 'get_ad_reward':
        await handleAdReward(ws);
        break;
      case 'get_share_reward':
        await handleShareReward(ws);
        break;

      // ========== 重连 ==========
      case 'reconnect':
        handleReconnect(ws, data);
        break;

      // ========== 心跳 ==========
      case 'ping':
        // 更新 isAlive，配合 index.js 中的心跳检测定时器使用
        // 客户端每 25s 发送一次 ping，服务端每 30s 检测一次 isAlive
        ws.isAlive = true;
        ws.send(JSON.stringify({ cmd: 'pong' }));
        break;

      default:
        sendToPlayer(getOpenid(ws), {
          cmd: 'error',
          data: { errMsg: `未知指令: ${cmd}` },
        });
    }
  } catch (err) {
    console.error(`[WS] 处理指令 ${cmd} 出错:`, err);
    safeSend(ws, {
      cmd: 'error',
      data: { errMsg: '服务器内部错误', cmd },
      seq,
    });
  }
}

// ========== 辅助 ==========

/** 获取 WebSocket 对应的 openid */
function getOpenid(ws) {
  for (const [openid, session] of wsMap) {
    if (session.ws === ws) return openid;
  }
  return null;
}

// ========== 认证处理 ==========

async function handleLogin(ws, data) {
  const { openid, nickName, avatarUrl } = data;

  if (!openid) {
    ws.send(JSON.stringify({ cmd: 'error', data: { errMsg: '缺少 openid 参数' } }));
    return;
  }

  // ★ 关键：先发 login_ack 确认收到登录请求（不等 DB）
  // 这样 CB 代理层知道连接活跃，防止 1006
  safeSend(ws, { cmd: 'login_ack', data: { openid } });
  console.log(`[WS] 登录请求: ${openid}，开始查询数据库...`);

  // ========== DB 操作独立 try-catch，失败不影响连接 ==========
  try {
    // 获取或创建用户（带 5s 超时）
    const user = await Promise.race([
      userService.getOrCreateUser(openid, { nickName, avatarUrl }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('数据库查询超时(5s)')), 5000)
      ),
    ]);

    // 注册连接
    registerConnection(ws, openid, user);

    // 返回用户数据
    safeSend(ws, {
      cmd: 'login_success',
      data: {
        openid,
        nickName: user.nickName,
        avatarUrl: user.avatarUrl,
        rankScore: user.rankScore,
        rankName: user.rankName,
        totalGames: user.totalGames,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        winRate: user.winRate,
        energy: user.energy,
        energyMax: user.energyMax,
        copper: user.copper,
        regretCards: user.regretCards,
        renameCards: user.renameCards,
        settings: user.settings,
        signinStreak: user.signinStreak,
        lastSigninDate: user.lastSigninDate,
      },
    });

    console.log(`[WS] 用户登录成功: ${openid}`);
  } catch (dbErr) {
    console.error(`[WS] 登录 DB 错误 (${openid}):`, dbErr.message);

    // ★ 使用降级用户数据（纯内存，不走 DB）
    const fallbackUser = createFallbackUser(openid, nickName, avatarUrl);
    registerConnection(ws, openid, fallbackUser);

    safeSend(ws, {
      cmd: 'login_success',
      data: {
        openid,
        nickName: fallbackUser.nickName,
        avatarUrl: fallbackUser.avatarUrl,
        rankScore: fallbackUser.rankScore,
        rankName: fallbackUser.rankName,
        totalGames: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
        energy: 30, energyMax: 30,
        copper: 100,
        regretCards: 0, renameCards: 0,
        settings: { soundEnabled: true, vibrationEnabled: true, musicEnabled: true },
        signinStreak: 0, lastSigninDate: '',
      },
    });

    console.log(`[WS] 用户降级登录: ${openid} (DB不可用)`);
  }
}

// ========== 匹配处理 ==========

function handleMatchStart(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) {
    ws.send(JSON.stringify({ cmd: 'error', data: { errMsg: '请先登录' } }));
    return;
  }

  const session = wsMap.get(openid);
  if (!session) return;

  const result = joinMatching({
    openid,
    nickName: session.nickName,
    avatarUrl: session.avatarUrl,
    rankScore: session.user?.rankScore || 0,
  });

  if (!result.success) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: result.errMsg } });
  }
}

function handleMatchCancel(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;
  cancelMatching(openid);
}

// ========== 房间处理 ==========

async function handleInviteRoom(ws) {
  const openid = getOpenid(ws);
  if (!openid) {
    ws.send(JSON.stringify({ cmd: 'error', data: { errMsg: '请先登录' } }));
    return;
  }
  await createInviteRoom(openid);
}

async function handleJoinRoom(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) {
    ws.send(JSON.stringify({ cmd: 'error', data: { errMsg: '请先登录' } }));
    return;
  }
  const { roomId } = data;
  if (!roomId) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '请输入房间号' } });
    return;
  }
  await joinRoomByCode(openid, roomId);
}

// ========== 用户数据处理 ==========

async function handleGetProfile(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const user = await userService.findByOpenid(openid);
  if (!user) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '用户不存在' } });
    return;
  }

  sendToPlayer(openid, {
    cmd: 'profile',
    data: {
      openid: user._openid,
      nickName: user.nickName,
      avatarUrl: user.avatarUrl,
      rankScore: user.rankScore,
      rankName: user.rankName,
      totalGames: user.totalGames,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      winRate: user.winRate,
      maxRankScore: user.maxRankScore,
      energy: user.energy,
      energyMax: user.energyMax,
      copper: user.copper,
      regretCards: user.regretCards,
      renameCards: user.renameCards,
      settings: user.settings,
      signinStreak: user.signinStreak,
      lastSigninDate: user.lastSigninDate,
      createdAt: user.createdAt,
    },
  });
}

async function handleGetHistory(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const limit = data.limit || 20;
  const games = await gameRecordService.getUserGames(openid, limit);

  sendToPlayer(openid, {
    cmd: 'history',
    data: { games },
  });
}

async function handleUpdateSettings(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const result = await userService.updateSettings(openid, data.settings || {});
  if (result.success) {
    sendToPlayer(openid, { cmd: 'settings_updated', data: { settings: result.settings } });
  } else {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: result.errMsg } });
  }
}

// ========== 排行榜 ==========

async function handleGetRankList(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const limit = data.limit || 50;
  const rankList = await userService.getRankList(limit);

  // 查找自己的排名
  const user = await userService.findByOpenid(openid);
  const myRank = user
    ? rankList.findIndex(r => r._openid === openid) + 1
    : -1;

  sendToPlayer(openid, {
    cmd: 'rank_list',
    data: {
      rankList,
      myRank,
      myRankScore: user?.rankScore || 0,
      myRankName: user?.rankName || '初级小六',
    },
  });
}

// ========== 经济系统 ==========

async function handleSignIn(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const result = await checkinService.checkin(openid);
  if (result.success) {
    sendToPlayer(openid, {
      cmd: 'sign_in_result',
      data: {
        streak: result.streak,
        dayIndex: result.dayIndex,
        rewardCopper: result.rewardCopper,
        copper: result.copper,
      },
    });
    // 资源更新通知
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { copper: result.copper },
    });
  } else {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: result.errMsg } });
  }
}

async function handleBuyEnergy(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const result = await userService.buyEnergy(openid);
  if (result.success) {
    // 记录交易
    await transactionService.record(openid, 'purchase_energy', -30, '', '购买精力x10');

    sendToPlayer(openid, {
      cmd: 'buy_energy_result',
      data: { energy: result.energy, copper: result.copper },
    });
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { energy: result.energy, copper: result.copper },
    });
  } else {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: result.errMsg } });
  }
}

async function handleGetTransactions(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const limit = data.limit || 50;
  const transactions = await transactionService.getUserTransactions(openid, limit);

  sendToPlayer(openid, {
    cmd: 'transactions',
    data: { transactions },
  });
}

async function handleAdReward(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;

  // TODO: 验证广告回调（微信激励视频广告）
  const result = await userService.addEnergy(openid, 5);
  if (result.success) {
    sendToPlayer(openid, {
      cmd: 'ad_reward_result',
      data: { energy: result.energy, reward: 5 },
    });
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { energy: result.energy },
    });
  }
}

async function handleShareReward(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;

  // TODO: 验证分享回调
  const result = await userService.updateCopper(openid, 10);
  await transactionService.record(openid, 'share', 10, '', '分享获得');
  if (result.success) {
    sendToPlayer(openid, {
      cmd: 'share_reward_result',
      data: { copper: result.copper, reward: 10 },
    });
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { copper: result.copper },
    });
  }
}

// ========== 重连处理 ==========

function handleReconnect(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const activeGame = findActiveGameByPlayer(openid);
  if (activeGame) {
    const { gameId, engine } = activeGame;
    // 更新 WebSocket 引用
    const session = wsMap.get(openid);
    if (session) session.ws = ws;

    // 发送游戏快照
    ws.send(JSON.stringify({
      cmd: 'game_snapshot',
      data: engine.getSnapshot(),
    }));
  }
}

module.exports = { dispatch };

// ========== 辅助工具函数 ==========

/** 安全发送消息，忽略连接已关闭错误 */
function safeSend(ws, msg) {
  try {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(msg));
    }
  } catch (err) {
    console.error('[WS] safeSend 失败:', err.message);
  }
}

/** 创建降级用户数据（DB 不可用时使用纯内存版本） */
function createFallbackUser(openid, nickName, avatarUrl) {
  const now = Date.now();
  return {
    _openid: openid,
    _id: 'fallback_' + openid,
    nickName: nickName || '',
    avatarUrl: avatarUrl || '',
    rankScore: 0,
    rankName: '初级小六',
    totalGames: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    maxRankScore: 0,
    energy: 30,
    energyMax: 30,
    copper: 100,
    dailyCopperEarned: 0,
    lastSigninDate: '',
    signinStreak: 0,
    regretCards: 0,
    renameCards: 0,
    settings: { soundEnabled: true, vibrationEnabled: true, musicEnabled: true },
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
}
