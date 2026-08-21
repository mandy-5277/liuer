/**
 * 六儿 服务端 — 会话管理服务
 *
 * 管理所有活跃的 WebSocket 连接和对局会话
 * 维护：
 * - wsMap: openid → WebSocket 连接的映射
 * - gameSessions: gameId → GameEngine 实例的映射
 * - matchingQueue: 匹配队列
 * - roomMap: roomId → 房间信息的映射
 */

const GameEngine = require('../game/engine');
const { Stage } = require('../game/constants');
const { userService, gameRecordService, roomService, transactionService } = require('./data');
const { game: gameConfig } = require('../config');
const robot = require('./robot');
const robotAI = require('../game/robot');

// ========== 全局状态容器 ==========

/** openid → { ws, openid, nickName, avatarUrl, user: 用户数据 } */
const wsMap = new Map();

/** gameId → GameEngine */
const gameSessions = new Map();

/** 匹配队列: [{ openid, nickName, avatarUrl, rankScore }] */
const matchingQueue = [];

/** roomId → { roomDocId, creatorWs, joinerWs, creatorUid, joinerUid } */
const roomMap = new Map();

/** 生成对局ID（进程内计数器 + 时间戳 + 随机 + pid，避免并发碰撞） */
let _gameSeq = 0;
function generateGameId() {
  _gameSeq = (_gameSeq + 1) % 1000000;
  return `G${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}-${(_gameSeq).toString().padStart(6, '0')}`;
}

// ========== 连接管理 ==========

/** 注册连接 */
function registerConnection(ws, openid, userData) {
  wsMap.set(openid, {
    ws,
    openid,
    nickName: userData.nickName || '',
    avatarUrl: userData.avatarUrl || '',
    user: userData,
  });
}

/** 移除连接 */
function removeConnection(openid) {
  // 如果正在匹配队列中，移除
  const idx = matchingQueue.findIndex(p => p.openid === openid);
  if (idx !== -1) matchingQueue.splice(idx, 1);

  // 如果在某个游戏会话中，触发掉线处理
  const activeGame = findActiveGameByPlayer(openid);
  if (activeGame) {
    handlePlayerDisconnect(activeGame, openid);
  }

  wsMap.delete(openid);
}

/** 根据 openid 发送消息 */
function sendToPlayer(openid, msg) {
  const session = wsMap.get(openid);
  if (session && session.ws.readyState === 1) { // WebSocket.OPEN
    session.ws.send(JSON.stringify(msg));
  }
}

/** 广播给对局双方 */
function broadcastToGame(gameId, msg) {
  const engine = gameSessions.get(gameId);
  if (!engine) return;
  sendToPlayer(engine.blackPlayer.openid, msg);
  sendToPlayer(engine.whitePlayer.openid, msg);
}

/** 查找玩家所在的活跃对局 */
function findActiveGameByPlayer(openid) {
  for (const [gameId, engine] of gameSessions) {
    if (engine.stage !== Stage.SETTLED) {
      if (engine.blackPlayer.openid === openid || engine.whitePlayer.openid === openid) {
        return { gameId, engine };
      }
    }
  }
  return null;
}

/** 获取用户的对局对手 openid */
function getOpponentUid(engine, openid) {
  if (engine.blackPlayer.openid === openid) return engine.whitePlayer.openid;
  if (engine.whitePlayer.openid === openid) return engine.blackPlayer.openid;
  return null;
}

// ========== 匹配系统 ==========

/** 加入匹配队列 */
async function joinMatching(player) {
  // 检查是否已在队列中
  if (matchingQueue.find(p => p.openid === player.openid)) {
    return { success: false, errMsg: '已在匹配队列中' };
  }

  // 检查是否已在游戏中
  if (findActiveGameByPlayer(player.openid)) {
    return { success: false, errMsg: '你正在对局中' };
  }

  matchingQueue.push(player);
  // 记录真人入队时间，供机器人介入延迟判断（_enqueueAt 仅用于匹配看门狗）
  if (!player._bot) {
    player._enqueueAt = Date.now();
  }
  sendToPlayer(player.openid, {
    cmd: 'match_status',
    data: { status: 'matching', queueSize: matchingQueue.length },
  });

  // 尝试匹配
  await tryMatch();
  return { success: true, queueSize: matchingQueue.length };
}

/** 取消匹配 */
function cancelMatching(openid) {
  const idx = matchingQueue.findIndex(p => p.openid === openid);
  if (idx !== -1) {
    matchingQueue.splice(idx, 1);
    sendToPlayer(openid, { cmd: 'match_status', data: { status: 'cancelled' } });
    return { success: true };
  }
  return { success: false, errMsg: '不在匹配队列中' };
}

/** 尝试匹配 */
async function tryMatch() {
  while (matchingQueue.length >= 2) {
    const player1 = matchingQueue.shift();
    const player2 = matchingQueue.shift();

    // 随机分配黑白
    const [blackPlayer, whitePlayer] = Math.random() < 0.5
      ? [player1, player2]
      : [player2, player1];

    await startGame(blackPlayer, whitePlayer, 'random');
  }
}

// ========== 房间系统 ==========

/** 创建邀请房间 */
async function createInviteRoom(creatorUid) {
  const room = await roomService.createRoom(creatorUid, 'invite');
  roomMap.set(room.roomId, {
    roomDocId: room._id,
    creatorUid,
    joinerUid: '',
  });

  sendToPlayer(creatorUid, {
    cmd: 'room_created',
    data: { roomId: room.roomId },
  });

  // 超时自动解散
  setTimeout(() => {
    const rm = roomMap.get(room.roomId);
    if (rm && !rm.joinerUid) {
      sendToPlayer(rm.creatorUid, {
        cmd: 'room_expired',
        data: { roomId: room.roomId },
      });
      roomService.cancelRoom(rm.roomDocId);
      roomMap.delete(room.roomId);
    }
  }, gameConfig.roomExpire);

  return { success: true, roomId: room.roomId };
}

/** 通过房间号加入 */
async function joinRoomByCode(joinerUid, roomId) {
  const room = await roomService.findByRoomId(roomId);
  if (!room) {
    return { success: false, errMsg: '房间不存在或已过期' };
  }

  // 阻断：不能加入自己创建的房间（否则双方为同一人，对局异常）
  if (room.creatorOpenid && room.creatorOpenid === joinerUid) {
    return { success: false, errMsg: '不能进入自己创建的房间' };
  }

  await roomService.joinRoom(room._id, joinerUid);

  const rm = roomMap.get(roomId);
  if (rm) {
    rm.joinerUid = joinerUid;
  }

  // 通知双方（数据库房间字段为 creatorOpenid）
  const creatorUid = room.creatorOpenid;
  const creatorSession = wsMap.get(creatorUid);
  const joinerSession = wsMap.get(joinerUid);
  console.log(`[Room] joinRoomByCode: joiner=${joinerUid}, creator=${creatorUid}, creatorSession=${!!creatorSession}, joinerSession=${!!joinerSession}`);

  const creatorUser = creatorSession ? creatorSession.user : {};
  const joinerUser = joinerSession ? joinerSession.user : {};

  sendToPlayer(creatorUid, {
    cmd: 'opponent_joined',
    data: {
      roomId,
      opponent: {
        openid: joinerUid,
        nickName: joinerUser.nickName || '',
        avatarUrl: joinerUser.avatarUrl || '',
        rankScore: joinerUser.rankScore || 0,
      },
    },
  });

  sendToPlayer(joinerUid, {
    cmd: 'join_room_success',
    data: {
      roomId,
      opponent: {
        openid: creatorUid,
        nickName: creatorUser.nickName || '',
        avatarUrl: creatorUser.avatarUrl || '',
        rankScore: creatorUser.rankScore || 0,
      },
    },
  });

  // 双方就位，自动开始对局
  const creatorPlayer = {
    openid: creatorUid,
    nickName: creatorUser.nickName || '',
    avatarUrl: creatorUser.avatarUrl || '',
    rankScore: creatorUser.rankScore || 0,
  };
  const joinerPlayer = {
    openid: joinerUid,
    nickName: joinerUser.nickName || '',
    avatarUrl: joinerUser.avatarUrl || '',
    rankScore: joinerUser.rankScore || 0,
  };

  // 随机分配黑白
  const [blackPlayer, whitePlayer] = Math.random() < 0.5
    ? [creatorPlayer, joinerPlayer]
    : [joinerPlayer, creatorPlayer];

  await startGame(blackPlayer, whitePlayer, 'room');

  // 清理房间
  if (rm) {
    roomMap.delete(roomId);
  }
  roomService.cancelRoom(room._id);

  return { success: true };
}

// ========== 退出房间 ==========
/** 房主或加入者退出房间，通知对方并清理 */
async function leaveRoom(uid, roomId) {
  let rm = null;
  if (roomId) {
    rm = roomMap.get(roomId);
  } else {
    // 未带 roomId 时按 uid 反查
    for (const [rid, r] of roomMap.entries()) {
      if (r.creatorUid === uid || r.joinerUid === uid) { rm = r; roomId = rid; break; }
    }
  }
  if (rm) {
    const otherUid = rm.creatorUid === uid ? rm.joinerUid : rm.creatorUid;
    if (otherUid) {
      sendToPlayer(otherUid, { cmd: 'room_cancelled', data: { roomId } });
    }
    try { roomService.cancelRoom(rm.roomDocId); } catch (e) { /* ignore */ }
    roomMap.delete(roomId);
  }
  return { success: true };
}

// ========== 对局管理 ==========

/** 开始对局 */
async function startGame(blackPlayer, whitePlayer, roomType) {
  const gameId = generateGameId();

  // ★ 积分基准实时化：开局前用 DB 最新积分覆盖传入的快照。
  // 此前用登录时的 session.user.rankScore 快照作为结算基准，会导致：
  //   一次登录内多次对局后，后续结算基准错乱（积分被算错/看似无变化）。
  // 这里统一以 DB 实时值为准，保证每次对局结算基准准确。
  try {
    const [bU, wU] = await Promise.all([
      userService.findByOpenid(blackPlayer.openid),
      userService.findByOpenid(whitePlayer.openid),
    ]);
    if (bU) blackPlayer.rankScore = bU.rankScore || 0;
    if (wU) whitePlayer.rankScore = wU.rankScore || 0;
  } catch (e) {
    console.error('[Session] 刷新开局积分失败（使用传入快照）:', e.message);
  }

  // 开局消耗双方精力（每局 energyPerGame），不足则跳过扣减，避免对局卡死
  // 机器人无精力系统，不参与扣减
  const cost = gameConfig.energyPerGame || 1;
  const { isBotUser } = userService;
  try {
    if (!(await isBotUser(blackPlayer.openid))) {
      await userService.deductEnergy(blackPlayer.openid, cost);
    }
  } catch (e) {
    console.error('[Session] 扣除黑方开局精力失败:', e);
  }
  try {
    if (!(await isBotUser(whitePlayer.openid))) {
      await userService.deductEnergy(whitePlayer.openid, cost);
    }
  } catch (e) {
    console.error('[Session] 扣除白方开局精力失败:', e);
  }

  const engine = new GameEngine(gameId, blackPlayer, whitePlayer);
  engine.init();
  gameSessions.set(gameId, engine);

  // 通知双方游戏开始
  const isBot = async (oid) => { try { return await userService.isBotUser(oid); } catch (e) { return false; } };
  const blackIsBot = await isBot(blackPlayer.openid);
  const whiteIsBot = await isBot(whitePlayer.openid);

  const startMsg = {
    cmd: 'game_start',
    data: {
      gameId,
      stage: Stage.PLACING,
      currentTurn: engine.currentTurn, // WHITE 先手
      remainingTime: Math.ceil(gameConfig.moveTimeout / 1000),
      board: engine.board,
      blackPlayer: {
        openid: blackPlayer.openid,
        nickName: blackPlayer.nickName,
        avatarUrl: blackPlayer.avatarUrl,
        rankScore: blackPlayer.rankScore,
        isBot: blackIsBot,
      },
      whitePlayer: {
        openid: whitePlayer.openid,
        nickName: whitePlayer.nickName,
        avatarUrl: whitePlayer.avatarUrl,
        rankScore: whitePlayer.rankScore,
        isBot: whiteIsBot,
      },
      timeLimit: gameConfig.moveTimeout,
    },
  };

  broadcastToGame(gameId, startMsg);

  // 统一起始回合流转：真人先手→正常超时；机器人先手→AI调度+兜底超时
  restartTurnFlow(gameId, engine);
}

/**
 * 统一回合流转：在一次操作/超时处理后，决定下一回合如何驱动。
 * - 若下一回合玩家是机器人：立即调度其 AI 决策（1-5s 内行动），并启动一个
 *   较长的兜底超时（防止 AI 异常导致卡死）；AI 正常时先于兜底超时行动。
 * - 若下一回合玩家是真人：启动正常操作超时（moveTimeout）。
 */
function restartTurnFlow(gameId, engine) {
  if (engine.stage === Stage.SETTLED) return;
  engine.clearTimer();
  const currentUid = engine.getCurrentPlayerUid();
  if (robot.robotPool.has(currentUid)) {
    // 机器人回合：AI 主动调度 + 兜底超时
    const fallback = (gameConfig.robot && gameConfig.robot.fallbackTimeout) || 8000;
    engine.startTurnTimer((c) => handleTimeout(gameId, c), fallback);
    robot.scheduleRobotMove(currentUid, engine);
  } else {
    engine.startTurnTimer((c) => handleTimeout(gameId, c));
  }
}

/** 处理回合超时 */
function handleTimeout(gameId, color) {
  const engine = gameSessions.get(gameId);
  if (!engine || engine.stage === Stage.SETTLED) return;
  // 防止对"已过期"的回合操作（例如机器人 AI 已把回合切走，超时回调才触发）
  if (engine.currentTurn !== color) return;

  const openid = color === 1 ? engine.blackPlayer.openid : engine.whitePlayer.openid;

  // 机器人超时：保持原有自动逻辑（理论上机器人由自身驱动，几乎不会触发）
  // 真人超时：采用机器人同款"初级智能 + 随机"决策进行代管，避免套路单一
  const isBot = robot.robotPool.has(openid);
  let result;

  if (isBot) {
    result = engine.autoTimeout(color);
  } else {
    result = autoTimeoutSmart(gameId, engine, color, openid);
  }

  // 仅通知当前超时的那一方（对方无需提示）
  sendToPlayer(openid, {
    cmd: 'timeout_warning',
    data: {
      openid,
      player: color,
      nickName: engine.getPlayerByColor(color).nickName || '',
      consecutiveTimeouts: result.consecutiveTimeouts,
    },
  });

  // 广播操作结果
  broadcastToGame(gameId, buildBroadcastMsg(engine, result, openid));

  // 如果结算：必须先广播 game_settle 再 finalizeGame，
  // 否则客户端收不到结算消息，会卡在原阶段直到用户再次操作触发 error
  if (result.settled) {
    broadcastToGame(gameId, { cmd: 'game_settle', data: result });
    finalizeGame(gameId, result);
    return;
  }

  // 统一下一回合流转（真人→正常超时；机器人→AI调度+兜底超时）
  restartTurnFlow(gameId, engine);
}

/**
 * 真人超时的"智能代管"：复用机器人 AI 决策，而非简单取第一个合法位置。
 * 连续超时计数与 engine.autoTimeout 一致（连续 3 次判负）。
 */
function autoTimeoutSmart(gameId, engine, color, openid) {
  engine.consecutiveTimeouts[color]++;

  // 连续 3 次超时 → 判负（与原逻辑一致）
  if (engine.consecutiveTimeouts[color] >= gameConfig.timeoutForfeit) {
    const winner = color === BLACK ? WHITE : BLACK;
    const settle = engine.settleGame(
      winner === BLACK ? 'black' : 'white',
      'timeout'
    );
    return {
      auto: true,
      consecutiveTimeouts: engine.consecutiveTimeouts[color],
      ...settle,
    };
  }

  const decision = robotAI.decideAction(engine, color);
  let opResult;

  if (!decision || decision.type === 'none') {
    // 无决策（极端情况），退回原生自动逻辑兜底
    opResult = engine.autoTimeout(color);
  } else {
    switch (decision.type) {
      case 'place':
        opResult = engine.placePiece(openid, decision.action.r, decision.action.c);
        break;
      case 'capture':
        // 揪子阶段：一次性揪完剩余所有可揪敌方棋子（修复超时只揪 1 个被跳过的 bug）
        // 走子阶段：保持联动揪（linked_capture），一次只能联动揪 1 个
        if (engine.stage === Stage.CAPTURING) {
          opResult = engine.autoCaptureAll(color);
        } else {
          opResult = engine.linkedCapturePiece(openid, decision.action.r, decision.action.c);
        }
        break;
      case 'skip_capture':
        // 揪子阶段跳过：交给 autoCaptureAll 处理"无可揪则跳过并推进"
        if (engine.stage === Stage.CAPTURING) {
          opResult = engine.autoCaptureAll(color);
        } else {
          opResult = engine.skipLinkedCapture(openid);
        }
        break;
      case 'move':
        opResult = engine.movePiece(openid, decision.action.fromR, decision.action.fromC, decision.action.toR, decision.action.toC);
        break;
      default:
        opResult = engine.autoTimeout(color);
    }
  }

  return {
    auto: true,
    consecutiveTimeouts: engine.consecutiveTimeouts[color],
    ...opResult,
  };
}

/** 处理玩家掉线 */
function handlePlayerDisconnect({ gameId, engine }, openid) {
  // 防止重复触发（close + 心跳超时可能同时触发）
  const disconnectKey = `${gameId}:${openid}`;
  if (engine._disconnectTimers && engine._disconnectTimers.has(disconnectKey)) return;
  if (!engine._disconnectTimers) engine._disconnectTimers = new Set();
  engine._disconnectTimers.add(disconnectKey);

  // 通知对手
  const opponentUid = getOpponentUid(engine, openid);
  sendToPlayer(opponentUid, {
    cmd: 'opponent_disconnected',
    data: { openid },
  });

  console.log(`[Session] 玩家掉线启动重连窗口: ${openid}, game=${gameId}`);

  // 设置重连窗口
  setTimeout(() => {
    engine._disconnectTimers.delete(disconnectKey);
    // 检查玩家是否已重连
    const stillConnected = wsMap.has(openid);
    if (!stillConnected && engine.stage !== Stage.SETTLED) {
      console.log(`[Session] 重连窗口到期，判掉线方负: ${openid}`);
      // 判掉线方负
      const color = engine.getColorByUid(openid);
      const winner = color === 1 ? 2 : 1;
      const result = engine.settleGame(
        winner === 1 ? 'black' : 'white',
        'disconnect'
      );

      broadcastToGame(gameId, {
        cmd: 'game_settle',
        data: result,
      });

      finalizeGame(gameId, result);
    }
  }, gameConfig.reconnectWindow);
}

// ========== 消息处理 ==========

/** 处理玩家操作消息 */
async function handleGameAction(openid, cmd, data) {
  const activeGame = findActiveGameByPlayer(openid);
  if (!activeGame) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: '未找到进行中的对局，可能已结束或服务器已重启' } });
    return;
  }

  const { gameId, engine } = activeGame;
  let result;

  switch (cmd) {
    case 'place_piece':
      result = engine.placePiece(openid, data.r, data.c);
      break;

    case 'capture_piece':
      result = engine.capturePiece(openid, data.r, data.c);
      break;

    case 'move_piece':
      result = engine.movePiece(openid, data.fromR, data.fromC, data.toR, data.toC);
      break;

    case 'linked_capture':
      result = engine.linkedCapturePiece(openid, data.r, data.c);
      break;

    case 'skip_capture':
      result = engine.skipLinkedCapture(openid);
      break;

    case 'give_up':
      result = engine.surrender(openid);
      if (result.success && result.settled) {
        broadcastToGame(gameId, { cmd: 'game_settle', data: result });
        finalizeGame(gameId, result);
        return;
      }
      break;

    case 'request_draw':
      result = engine.requestDraw(openid);
      if (result.success && result.drawRequestBy) {
        const opponentUid = getOpponentUid(engine, openid);
        // 机器人对手：自动拒绝求和，不给刷分机会
        if (robot.robotPool.has(opponentUid)) {
          result = engine.respondDraw(opponentUid, false);
          if (result.success && result.drawRejected) {
            sendToPlayer(openid, { cmd: 'draw_rejected', data: { by: opponentUid } });
            engine.startTurnTimer((c) => { handleTimeout(gameId, c); });
          }
          return;
        }
        sendToPlayer(opponentUid, {
          cmd: 'draw_request',
          data: {
            by: openid,
            nickName: wsMap.get(openid)?.nickName || '',
          },
        });
        // 求和请求已处理，不重启计时器（游戏暂停等待响应）
        return;
      }
      break;

    case 'respond_draw':
      result = engine.respondDraw(openid, data.agree);
      if (result.success && result.settled) {
        broadcastToGame(gameId, { cmd: 'game_settle', data: result });
        finalizeGame(gameId, result);
        return;
      }
      break;

    default:
      result = { success: false, errMsg: `未知指令: ${cmd}` };
  }

  if (!result.success) {
    sendToPlayer(openid, { cmd: 'error', data: { errMsg: result.errMsg || '操作失败' } });
    return;
  }

  if (result.settled) {
    // 操作直接导致结算（绝杀/联动揪光/和棋等），广播并保存战绩
    broadcastToGame(gameId, { cmd: 'game_settle', data: result });
    finalizeGame(gameId, result);
    return;
  }

  // 清除同方向的操作超时
  const color = engine.getColorByUid(openid);
  engine.consecutiveTimeouts[color] = 0;

  // 广播操作结果
  broadcastToGame(gameId, buildBroadcastMsg(engine, result, openid));

  // 统一下一回合流转（真人→正常超时；机器人→AI调度+兜底超时）
  if (engine.stage !== Stage.SETTLED) {
    restartTurnFlow(gameId, engine);
  }
}

/** 构建广播消息 */
function buildBroadcastMsg(engine, result, openid) {
  const color = engine.getColorByUid(openid);

  const msg = {
    cmd: '',
    data: {
      stage: engine.stage,
      currentTurn: engine.currentTurn,
      remainingTime: Math.ceil(engine.getRemainingTime() / 1000),
      board: result.board || engine.board,
      lastMove: {
        player: color,
        action: result.lastAction,
      },
    },
  };

  if (result.stageChanged) {
    msg.cmd = 'stage_change';
    msg.data.stage = result.stage;
    msg.data.catchNums = result.catchNums;
  } else if (result.linkedCapture) {
    msg.cmd = 'linked_capture';
    msg.data.linkedCapture = result.linkedCapture;
  } else if (result.drawRejected) {
    msg.cmd = 'draw_rejected';
  } else if (result.noNewForm) {
    msg.cmd = 'move_made';
  } else if (result.drawRequestBy) {
    msg.cmd = 'draw_requested';
  } else {
    // 依据引擎返回的动作类型决定广播指令，避免下子被误判为揪子
    switch (result.lastAction) {
      case 'capture':
        msg.cmd = 'capture_made';
        break;
      case 'move':
        msg.cmd = 'move_made';
        break;
      case 'place':
      default:
        msg.cmd = 'piece_placed';
        break;
    }
  }

  msg.data.catchNums = result.catchNums || {
    black: engine.blackCatchNum,
    white: engine.whiteCatchNum,
  };

  return msg;
}

// ========== 对局结算 ==========

async function finalizeGame(gameId, settleResult) {
  const engine = gameSessions.get(gameId);
  if (!engine) return;

  engine.clearTimer();

  // 标记参战机器人为空闲，便于下次匹配复用
  for (const openid of [engine.blackPlayer.openid, engine.whitePlayer.openid]) {
    const info = robot.robotPool.get(openid);
    if (info) info.busy = false;
  }

  // 更新双方战绩
  const blackResult = settleResult.result === 'black' ? 'win'
    : settleResult.result === 'white' ? 'lose' : 'draw';
  const whiteResult = settleResult.result === 'white' ? 'win'
    : settleResult.result === 'black' ? 'lose' : 'draw';

  await Promise.all([
    userService.updateGameRecord(engine.blackPlayer.openid, blackResult, settleResult.blackRatingChange, settleResult.blackAfterScore),
    userService.updateGameRecord(engine.whitePlayer.openid, whiteResult, settleResult.whiteRatingChange, settleResult.whiteAfterScore),
  ]);

  // 从引擎计算真实统计值（settleResult 不携带这些字段）
  const allMoves = engine.moves || [];
  const blackMoves = allMoves.filter(m => m.stage === Stage.MOVING && m.player === 'black').length;
  const whiteMoves = allMoves.filter(m => m.stage === Stage.MOVING && m.player === 'white').length;
  const blackCaptures = allMoves.filter(m => m.stage === Stage.CAPTURING && m.player === 'black').length;
  const whiteCaptures = allMoves.filter(m => m.stage === Stage.CAPTURING && m.player === 'white').length;
  const durationMs = (engine.endedAt && engine.startedAt)
    ? (engine.endedAt - engine.startedAt)
    : 0;

  // 保存对局记录
  await gameRecordService.saveGameRecord({
    gameId,
    ...settleResult,
    blackPlayer: engine.blackPlayer,
    whitePlayer: engine.whitePlayer,
    blackMoves,
    whiteMoves,
    blackCaptures,
    whiteCaptures,
    durationMs,
  });

  // 资源变更通知（精力已含自然恢复时间戳，客户端据此显示"下次恢复"倒计时）
  const freshBlackUser = await userService.findByOpenid(engine.blackPlayer.openid);
  const freshWhiteUser = await userService.findByOpenid(engine.whitePlayer.openid);

  function buildResourceData(u) {
    const total = (u?.winCount || 0) + (u?.loseCount || 0) + (u?.drawCount || 0);
    return {
      rankScore: u?.rankScore || 0,
      rankName: u?.rankName || '初级小六',
      energy: u?.energy || 0,
      energyRecoverAt: u?.energyRecoverAt || 0,
      energyMax: gameConfig.energyMax || 30,
      winCount: u?.winCount || 0,
      loseCount: u?.loseCount || 0,
      drawCount: u?.drawCount || 0,
      winRate: total > 0 ? Math.round((u?.winCount || 0) * 1000 / total) / 10 : 0,
    };
  }

  sendToPlayer(engine.blackPlayer.openid, {
    cmd: 'resource_update',
    data: buildResourceData(freshBlackUser),
  });

  sendToPlayer(engine.whitePlayer.openid, {
    cmd: 'resource_update',
    data: buildResourceData(freshWhiteUser),
  });
}

// ========== 导出 ==========

module.exports = {
  wsMap,
  gameSessions,
  matchingQueue,
  roomMap,
  registerConnection,
  removeConnection,
  sendToPlayer,
  broadcastToGame,
  findActiveGameByPlayer,
  joinMatching,
  cancelMatching,
  createInviteRoom,
  joinRoomByCode,
  leaveRoom,
  startGame,
  handleGameAction,
  handlePlayerDisconnect,
  handleTimeout,
  finalizeGame,
  generateGameId,
};
