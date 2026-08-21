/**
 * 六儿 服务端 — 机器人陪练服务
 *
 * 职责：
 * 1. 维护机器人在线池（虚拟连接，挂在 wsMap 上，无需真实 WebSocket）。
 * 2. 真人随机匹配等待超过 robot.matchDelay（默认 15s）后介入：
 *    - 优先复用"空闲且在池内"的旧机器人；
 *    - 若无空闲旧机器人，则新建机器人（池上限 robot.maxIdle）。
 * 3. 机器人在自己的回合主动计算决策并通过 handleGameAction 执行，
 *    模拟真人节奏（随机思考延迟），具备初级智能且带随机性。
 * 4. 机器人无精力系统：开局不扣精力，结算照常更新积分/胜率/排行。
 *
 * 机器人身份：openid 以 robot.prefix 开头，user.isBot=true。
 * 机器人拥有自己的积分、胜率、排行（与真人共用 users 表）。
 */

const { game: gameConfig } = require('../config');
const { Stage, BLACK, WHITE, EMPTY } = require('../game/constants');
const robotAI = require('../game/robot');
// 注意：session.js 反向 require 了本模块（robot.js），形成循环依赖。
// session.js 用 `module.exports = {...}` 整体赋值，导致本模块顶层 require 拿到的是
// 加载期尚未完整导出的旧对象引用。因此这里不直接持有 session 对象，而是提供惰性
// 获取器：函数执行时（模块图已完全加载）再 require，即可拿到最终导出的 session 模块。
function getSession() {
  return require('./session');
}
const { userService } = require('./data');

/** 机器人虚拟连接池：openid → { ws, openid, user, busy } */
const robotPool = new Map();

/** 定时器引用（避免重复启动） */
let matchTimer = null;

/** 创建机器人的"假 WebSocket"：send 为空操作，readyState=OPEN */
function createFakeWs(openid) {
  return {
    openid,
    readyState: 1, // WebSocket.OPEN
    isAlive: true,
    isBot: true,
    send() { /* 机器人不需要接收广播，空操作 */ },
    close() { /* 虚拟连接，无需真正关闭 */ },
    terminate() { /* 虚拟连接，无需真正终止 */ },
    on() { /* 不需要监听事件 */ },
  };
}

/** 机器人是否空闲（不在任何活跃对局中） */
function isRobotIdle(openid) {
  const active = getSession().findActiveGameByPlayer(openid);
  return !active;
}

/** 获取一个空闲的旧机器人（优先复用） */
function getIdleRobot() {
  for (const [openid, info] of robotPool) {
    if (isRobotIdle(openid)) return info;
  }
  return null;
}

/** 当前机器人池是否已满 */
function isPoolFull() {
  const max = (gameConfig.robot && gameConfig.robot.maxIdle) || 50;
  return robotPool.size >= max;
}

/**
 * 创建并登录一个机器人（写入 wsMap 与 robotPool）
 * @returns {Promise<{openid, user}>}
 */
async function spawnRobot() {
  const user = await userService.createBotUser();
  const ws = createFakeWs(user.openid);
  getSession().registerConnection(ws, user.openid, user);
  robotPool.set(user.openid, { ws, openid: user.openid, user, busy: false });
  console.log(`[Robot] 新建机器人: ${user.openid} (nick=${user.nickName}), 池大小=${robotPool.size}`);
  return { openid: user.openid, user };
}

/**
 * 获取一个可用机器人：
 *  - 优先复用空闲旧机器人；
 *  - 否则新建（若未满），或退回最久未用的旧机器人（强制复用）。
 * @returns {Promise<{openid, user}>}
 */
async function acquireRobot() {
  const idle = getIdleRobot();
  if (idle) {
    idle.busy = true;
    return { openid: idle.openid, user: idle.user };
  }
  if (!isPoolFull()) {
    return await spawnRobot();
  }
  // 池满且无空闲：强制取第一个（理论上不会并发到这种程度，兜底）
  const first = robotPool.values().next().value;
  first.busy = true;
  return { openid: first.openid, user: first.user };
}

/**
 * 机器人在自己回合时调度一次决策。
 * 延迟一段随机时间（模拟真人思考），再通过 handleGameAction 执行。
 * @param {string} openid 机器人 openid
 * @param {object} engine GameEngine
 */
function scheduleRobotMove(openid, engine) {
  const cfg = gameConfig.robot || {};
  const min = cfg.thinkMin || 1000;
  const max = cfg.thinkMax || 5000;
  const delay = Math.floor(min + Math.random() * (max - min));

  // 标记机器人忙碌
  const info = robotPool.get(openid);
  if (info) info.busy = true;

  setTimeout(() => {
    driveRobotMove(openid, engine);
  }, delay);
}

/**
 * 实际执行一次机器人决策（被 scheduleRobotMove 调用，也可递归触发下一回合）
 */
function driveRobotMove(openid, engine) {
  // 校验：对局仍存在且未结算
  const active = getSession().findActiveGameByPlayer(openid);
  if (!active) return;
  const { gameId, engine: eng } = active;
  if (eng.stage === Stage.SETTLED) return;

  // 校验：确实轮到该机器人
  const myColor = eng.getColorByUid(openid);
  if (myColor !== eng.currentTurn) return;

  const decision = robotAI.decideAction(eng, myColor);
  if (!decision || decision.type === 'none') {
    // 决策失败兜底：复用 session 的超时处理链路（handleTimeout 内含引擎托管、
    // 广播、重启回合计时器，且对机器人/真人分支均已处理）。这样无论处于下子/揪子/
    // 走子阶段，回合都必然推进，杜绝"不是我的回合"死锁。
    // 该分支为极端兜底（机器人正常决策极少落入），连续超时计数由引擎自动管理。
    const session = getSession();
    const active = session.findActiveGameByPlayer(openid);
    if (active) session.handleTimeout(active.gameId, myColor);
    return;
  }

  switch (decision.type) {
    case 'place':
      getSession().handleGameAction(openid, 'place_piece', { r: decision.action.r, c: decision.action.c });
      break;
    case 'capture':
      getSession().handleGameAction(openid, 'capture_piece', { r: decision.action.r, c: decision.action.c });
      break;
    case 'skip_capture':
      getSession().handleGameAction(openid, 'skip_capture', {});
      break;
    case 'move':
      getSession().handleGameAction(openid, 'move_piece', {
        fromR: decision.action.fromR,
        fromC: decision.action.fromC,
        toR: decision.action.toR,
        toC: decision.action.toC,
      });
      break;
    default:
      return;
  }

  // 说明：下一回合的驱动统一由 session.restartTurnFlow 负责——
  // 它会在机器人操作完成后，根据 newTurn 是否是机器人再次 scheduleRobotMove，
  // 或对真人启动正常超时。因此这里不再做链式调度，避免重复驱动。
}

/**
 * 当一个游戏开始时，若参与者是机器人，则启动其首回合驱动。
 * 由 session.startGame 调用。
 * @param {string} gameId
 */
function maybeStartRobot(gameId) {
  const engine = getSession().gameSessions.get(gameId);
  if (!engine) return;

  const blackOpenid = engine.blackPlayer.openid;
  const whiteOpenid = engine.whitePlayer.openid;

  // 黑方若为机器人
  if (robotPool.has(blackOpenid) && engine.currentTurn === BLACK) {
    scheduleRobotMove(blackOpenid, engine);
  }
  // 白方若为机器人（通常白先手下子）
  if (robotPool.has(whiteOpenid) && engine.currentTurn === WHITE) {
    scheduleRobotMove(whiteOpenid, engine);
  }
}

/**
 * 定时扫描匹配队列：若队列中有真人等待超过 matchDelay 且仍无对手，
 * 则让机器人介入匹配。
 * 仅介入"随机匹配"等待（机器人只填补 random 匹配的空缺）。
 *
 * @param {Array} matchingQueue 引用 session.matchingQueue
 * @param {Function} joinMatching 引用 session.joinMatching
 */
function startMatchWatchdog(matchingQueue, joinMatching) {
  if (matchTimer) return; // 已启动
  const cfg = gameConfig.robot || {};
  if (!cfg.enabled) {
    console.log('[Robot] 机器人功能未启用（robot.enabled=false）');
    return;
  }
  const delay = cfg.matchDelay || 15000;
  console.log(`[Robot] 匹配看门狗已启动，介入延迟=${delay}ms`);

  matchTimer = setInterval(async () => {
    try {
      // 找出仍在队列中且等待超时的真人
      const now = Date.now();
      // matchingQueue 元素无入队时间，这里用"队列非空"近似：
      // 每次有真人加入队列时记录入队时间（见下方 patchJoinMatching）。
      const waiters = matchingQueue.filter(p => !p._bot && now - (p._enqueueAt || now) >= delay);
      if (waiters.length === 0) return;

      for (const waiter of waiters) {
        // 该真人仍在对局外，则让机器人介入
        const active = getSession().findActiveGameByPlayer(waiter.openid);
        if (active) continue;

        console.log(`[Robot] 真人 ${waiter.openid} 等待超时，机器人介入匹配`);
        const bot = await acquireRobot();
        // 把机器人作为对手加入匹配队列并执行匹配
        await joinMatching({
          openid: bot.openid,
          nickName: bot.user.nickName,
          avatarUrl: bot.user.avatarUrl,
          rankScore: bot.user.rankScore,
          _bot: true,
        });
        // 机器人作为真实玩家已经在 wsMap 中，移除其 _bot 标记（避免后续误判）
        // joinMatching 后 tryMatch 会立即匹配该真人与机器人
      }
    } catch (err) {
      console.error('[Robot] 匹配看门狗异常:', err);
    }
  }, Math.max(1000, Math.floor(delay / 2)));
}

/** 停止看门狗（优雅关闭用） */
function stopMatchWatchdog() {
  if (matchTimer) {
    clearInterval(matchTimer);
    matchTimer = null;
  }
}

module.exports = {
  robotPool,
  spawnRobot,
  acquireRobot,
  getIdleRobot,
  isRobotIdle,
  scheduleRobotMove,
  driveRobotMove,
  maybeStartRobot,
  startMatchWatchdog,
  stopMatchWatchdog,
  createFakeWs,
};
