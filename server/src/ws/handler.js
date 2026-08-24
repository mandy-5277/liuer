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
const security = require('../services/security');

/**
 * 主消息分发器
 * @param {WebSocket} ws
 * @param {object} msg - { cmd, data, seq }
 */
async function dispatch(ws, msg) {
  const { cmd, data = {}, seq } = msg;

  try {
    // ========== 认证 ==========
    // login 是异步的（要查 DB）。服务端按消息顺序收到 login 后，把它包装成 Promise；
    // 后续非 login 指令必须先 await 该 Promise，避免在 DB 查询期间并发处理业务指令，
    // 导致连接尚未注册到 wsMap 就返回"请先登录"。
    if (cmd === 'login') {
      ws.loginPromise = handleLogin(ws, data).catch((err) => {
        console.error('[WS] handleLogin 异常:', err);
      });
      await ws.loginPromise;
      return;
    }

    // ========== 心跳 ==========
    // ping 不需要登录，直接响应
    if (cmd === 'ping') {
      ws.isAlive = true;
      ws.send(JSON.stringify({ cmd: 'pong' }));
      return;
    }

    // ========== 其他业务指令 ==========
    // 若登录仍在进行中，等待登录完成
    if (ws.loginPromise) {
      await ws.loginPromise;
    }

    const openid = getOpenid(ws);
    if (!openid) {
      console.log(`[WS] 未登录请求被拒绝: cmd=${cmd}, ws.openid=${ws.openid || 'null'}, wsMap.has=${wsMap.has(ws.openid || '')}`);
      safeSend(ws, {
        cmd: 'error',
        data: { errMsg: '请先登录', cmd },
        seq,
      });
      return;
    }

    switch (cmd) {
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
      case 'leave_room':
        await handleLeaveRoom(ws, data);
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
        handleGameAction(openid, cmd, data);
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
      case 'update_profile':
        await handleUpdateProfile(ws, data);
        break;

      // ========== 排行榜 ==========
      case 'get_rank_list':
        await handleGetRankList(ws, data);
        break;

      // ========== 经济系统 ==========
      case 'sign_in':
        await handleSignIn(ws);
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

      default:
        sendToPlayer(openid, {
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
  // 优先用 ws 上已绑定的 openid 直接查 wsMap，避免同 openid 多连接时
  // session.ws 引用比较失效导致的"请先登录"（ws.openid 在 handleLogin 中已设置）。
  if (ws && ws.openid && wsMap.has(ws.openid)) {
    return ws.openid;
  }
  for (const [openid, session] of wsMap) {
    if (session.ws === ws) return openid;
  }
  return null;
}

// ========== 认证处理 ==========

async function handleLogin(ws, data) {
  let { openid, nickName, avatarUrl } = data;

  if (!openid) {
    ws.send(JSON.stringify({ cmd: 'error', data: { errMsg: '缺少 openid 参数' } }));
    return;
  }

  // ★ 关键：先发 login_ack 确认收到登录请求（不等 DB）
  // 这样 CB 代理层知道连接活跃，防止 1006
  safeSend(ws, { cmd: 'login_ack', data: { openid } });
  console.log(`[WS] 登录请求: ${openid}，开始查询数据库...`);

  // ========== 内容安全：检测登录时携带的昵称 ==========
  // 仅当接口明确判定为违规(risky=true)时才强制改名；
  // 接口异常/超时(ok=false 但 risky=false)一律降级放行并记日志，避免误杀正常昵称
  let nickNameAdjusted = false;
  if (typeof nickName === 'string' && nickName.trim()) {
    try {
      const check = await security.msgSecCheck(nickName.trim());
      if (check.risky) {
        console.warn(`[Security] 登录昵称违规，openid=${openid}, nickName=${nickName}`);
        nickName = '玩家' + Math.floor(Math.random() * 9000 + 1000);
        nickNameAdjusted = true;
      } else if (!check.ok) {
        // 接口异常（token 失效/频率限制/网络错误等），降级放行，保留原昵称
        console.error('[Security] msgSecCheck 异常，降级放行，保留原昵称 openid=' + openid);
      }
    } catch (err) {
      // 调用抛异常同样降级放行，不阻断登录、不改名
      console.error('[Security] 昵称检测异常，降级放行:', err.message);
    }
  }

  // ========== DB 操作独立 try-catch，失败不影响连接 ==========
  try {
    // 获取或创建用户（带 5s 超时）
    let user = await Promise.race([
      userService.getOrCreateUser(openid, { nickName, avatarUrl }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('数据库查询超时(5s)')), 5000)
      ),
    ]);

    // 清理历史脏昵称：仅当明确违规(risky=true)才重置；异常降级放行
    if (user && user.nickName && typeof user.nickName === 'string') {
      try {
        const check = await security.msgSecCheck(user.nickName);
        if (check.risky) {
          const safeName = '玩家' + Math.floor(Math.random() * 9000 + 1000);
          console.warn(`[Security] 历史昵称违规，已重置 openid=${openid}, old=${user.nickName}, new=${safeName}`);
          await userService.updateUser(openid, { nickName: safeName });
          user = await userService.findByOpenid(openid);
          nickNameAdjusted = true;
        } else if (!check.ok) {
          console.error('[Security] 历史昵称检测异常，降级放行 openid=' + openid);
        }
      } catch (err) {
        console.error('[Security] 历史昵称检测异常，降级放行:', err.message);
      }
    }

    // 注册连接，并把 openid 绑定到 ws 对象方便心跳/close 直接定位
    ws.openid = openid;
    registerConnection(ws, openid, user);

    // 跨天对齐每日奖励次数（看广告/分享），确保今天登录即恢复
    let dailyAd = user.dailyAdCount || 0;
    let dailyShare = user.dailyShareCount || 0;
    try {
      const reset = await userService.ensureDailyReset(openid);
      if (reset && reset.success) {
        dailyAd = reset.adCount || 0;
        dailyShare = reset.shareCount || 0;
      }
    } catch (e) {
      console.error('[WS] 每日次数对齐失败:', e.message);
    }

    // 返回用户数据
    safeSend(ws, {
      cmd: 'login_success',
      data: {
        openid,
        nickName: user.nickName,
        avatarUrl: user.avatarUrl,
        nickNameAdjusted,
        rankScore: user.rankScore,
        rankName: user.rankName,
        // 场次统计：getOrCreateUser 返回 winCount/loseCount/drawCount（wins/losses/draws 为旧字段，兼容保留）
        totalGames: ((user.winCount || 0) + (user.loseCount || 0) + (user.drawCount || 0)),
        winCount: user.winCount || 0,
        loseCount: user.loseCount || 0,
        drawCount: user.drawCount || 0,
        wins: user.winCount || 0,
        losses: user.loseCount || 0,
        draws: user.drawCount || 0,
        winRate: user.winRate,
        energy: user.energy,
        energyMax: user.energyMax,
        energyRecoverAt: user.energyRecoverAt || 0,
        dailyAdCount: dailyAd,
        dailyShareCount: dailyShare,
        regretCards: user.regretCards,
        renameCards: user.renameCards,
        settings: user.settings,
        signinStreak: user.signinStreak,
        lastCheckin: user.lastCheckin,
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
        nickNameAdjusted,
        rankScore: fallbackUser.rankScore,
        rankName: fallbackUser.rankName,
        totalGames: 0, winCount: 0, loseCount: 0, drawCount: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
        energy: 30, energyMax: 30, energyRecoverAt: 0,
        regretCards: 0, renameCards: 0,
        settings: { soundEnabled: true, vibrationEnabled: true, musicEnabled: true },
        signinStreak: 0, lastCheckin: '',
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

  joinMatching({
    openid,
    nickName: session.nickName,
    avatarUrl: session.avatarUrl,
    rankScore: session.user?.rankScore || 0,
  }).then((result) => {
    if (!result.success) {
      sendToPlayer(openid, { cmd: 'error', data: { errMsg: result.errMsg } });
    }
  }).catch((err) => {
    console.error('[WS] joinMatching 失败:', err);
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '匹配失败，请重试' } });
  });
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
  const res = await joinRoomByCode(openid, roomId);
  if (!res || !res.success) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: (res && res.errMsg) || '加入房间失败' } });
  }
}

async function handleLeaveRoom(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;
  const roomId = data && data.roomId;
  await leaveRoom(openid, roomId);
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

// 更新昵称/头像（"完善资料"浮层提交）
async function handleUpdateProfile(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const updates = {};
  if (typeof data.nickName === 'string' && data.nickName.trim()) {
    updates.nickName = data.nickName.trim().slice(0, 30);
  }
  if (typeof data.avatarUrl === 'string' && data.avatarUrl.trim()) {
    updates.avatarUrl = data.avatarUrl.trim().slice(0, 512);
  }
  if (!Object.keys(updates).length) {
    return sendToPlayer(openid, { cmd: 'error', data: { errMsg: '没有可更新的资料' } });
  }

  // ========== 内容安全：昵称文本检测 ==========
  // 仅明确违规(risky=true)才拒绝；接口异常降级放行，允许正常改名
  if (updates.nickName) {
    try {
      const check = await security.msgSecCheck(updates.nickName);
      if (check.risky) {
        console.warn(`[Security] 更新昵称违规，openid=${openid}, nickName=${updates.nickName}, err=${check.errcode}`);
        return sendToPlayer(openid, { cmd: 'error', data: { errMsg: '昵称包含违规内容，请修改后重试' } });
      } else if (!check.ok) {
        console.error('[Security] 更新昵称检测异常，降级放行 openid=' + openid);
      }
    } catch (err) {
      console.error('[Security] 昵称检测异常，降级放行:', err.message);
    }
  }

  try {
    await userService.updateUser(openid, updates);
    const user = await userService.findByOpenid(openid);
    sendToPlayer(openid, {
      cmd: 'profile_updated',
      data: {
        openid,
        nickName: user ? user.nickName : updates.nickName,
        avatarUrl: user ? user.avatarUrl : updates.avatarUrl,
      },
    });
  } catch (err) {
    console.error('[WS] 更新资料失败:', err);
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '资料保存失败' } });
  }
}

// ========== 排行榜 ==========

async function handleGetRankList(ws, data) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const sortBy = data.type === 'winRate' ? 'winRate' : 'score';
  const limit = data.limit || 100;
  const rankList = await userService.getRankList(limit, sortBy);

  // 计算自己的排名（按相同规则查询更大范围后定位）
  let myRank = -1;
  let myWinRate = 0;
  const user = await userService.findByOpenid(openid);
  if (user) {
    if (sortBy === 'winRate') {
      const total = (user.winCount || 0) + (user.loseCount || 0) + (user.drawCount || 0);
      myWinRate = total > 0 ? Math.round((user.winCount || 0) * 1000 / total) / 10 : 0;
    }
    // 用较大 limit 查询真实名次（避免仅在 rankList 内查找漏判）
    const fullList = await userService.getRankList(500, sortBy);
    myRank = fullList.findIndex(r => r.openid === openid) + 1;
  }

  sendToPlayer(openid, {
    cmd: 'rank_list',
    data: {
      rankList,
      myRank,
      myWinRate,
      myRankScore: user?.rankScore || 0,
      myRankName: user?.rankName || '初级小六',
      myTotalGames: user ? ((user.winCount || 0) + (user.lossCount || 0) + (user.drawCount || 0)) : 0,
      sortBy,
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
        energy: result.energy,
        bonus: result.bonus,
      },
    });
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { energy: result.energy, energyRecoverAt: result.energyRecoverAt || 0 },
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

  const maxAd = gameConfig.maxAdPerDay || 3;
  // 跨天重置每日计数
  const reset = await userService.ensureDailyReset(openid);
  const cur = reset && reset.success ? (reset.adCount || 0) : 0;
  if (cur >= maxAd) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '今日看视频次数已用完' } });
    return;
  }

  const reward = gameConfig.adReward || 10;
  const result = await userService.addEnergy(openid, reward);
  if (result.success) {
    const inc = await userService.incrementAdCount(openid);
    sendToPlayer(openid, {
      cmd: 'ad_reward_result',
      data: { energy: result.energy, reward, adCount: inc && inc.count ? inc.count : 0 },
    });
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { energy: result.energy, energyRecoverAt: result.energyRecoverAt || 0 },
    });
  }
}

async function handleShareReward(ws) {
  const openid = getOpenid(ws);
  if (!openid) return;

  const maxShare = gameConfig.shareRewardLimit || 5;
  const reset = await userService.ensureDailyReset(openid);
  const cur = reset && reset.success ? (reset.shareCount || 0) : 0;
  if (cur >= maxShare) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '今日分享次数已用完' } });
    return;
  }

  const reward = gameConfig.shareReward || 5;
  const result = await userService.addEnergy(openid, reward);
  if (result.success) {
    const inc = await userService.incrementShareCount(openid);
    sendToPlayer(openid, {
      cmd: 'share_reward_result',
      data: { energy: result.energy, reward, shareCount: inc && inc.count ? inc.count : 0 },
    });
    sendToPlayer(openid, {
      cmd: 'resource_update',
      data: { energy: result.energy, energyRecoverAt: result.energyRecoverAt || 0 },
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
