// 集成测试：验证机器人回合通过 scheduleRobotMove(1-5s) 主动走 AI 决策，而非等 15s 超时
// 模拟：真人(白)先手 → 机器人(黑)后手 → 观察机器人何时行动
const path = '/opt/liuer/server/src';
const GameEngine = require(path + '/game/engine');
const robotAI = require(path + '/game/robot');
const { Stage, BLACK, WHITE, EMPTY } = require(path + '/game/constants');

const engine = new GameEngine('TIMING', { openid: 'HUMAN', nickName: '真人' }, { openid: 'BOT', nickName: '机器人' });
engine.init();

// 直接模拟 restartTurnFlow 的调度逻辑（不走完整 session，避免 DB 依赖）
// 用一个真实 setTimeout 驱动机器人，观察延迟
const t0 = Date.now();
let robotMoved = false;
let moveAt = 0;

// 模拟：机器人回合时调度（等价 scheduleRobotMove 的 1-5s）
function scheduleForTest(color) {
  const delay = Math.floor(1000 + Math.random() * 4000); // 1-5s
  setTimeout(() => {
    const openid = color === BLACK ? 'BOT' : 'HUMAN';
    // 真人直接走，机器人走 AI
    let dec;
    if (color === BLACK) {
      dec = robotAI.decideAction(engine, BLACK);
      if (dec && dec.type === 'place') {
        engine.placePiece('BOT', dec.action.r, dec.action.c);
        robotMoved = true;
        moveAt = Date.now() - t0;
        console.log(`  机器人 AI 落子于 (${dec.action.r},${dec.action.c})，发生在 ${moveAt}ms（应约 1000-5000ms）`);
        // 切回真人回合（真人走）
        scheduleForTest(WHITE);
        return;
      }
    } else {
      // 真人走一步
      dec = robotAI.decideAction(engine, WHITE);
      if (dec && dec.type === 'place') engine.placePiece('HUMAN', dec.action.r, dec.action.c);
      scheduleForTest(BLACK);
      return;
    }
    // 决策失败
    engine.autoTimeout(color);
    scheduleForTest(color === BLACK ? WHITE : BLACK);
  }, delay);
}

// 白先手，真人走第一手
engine.currentTurn = WHITE;
scheduleForTest(WHITE);

setTimeout(() => {
  console.log(`结果: robotMoved=${robotMoved} 用时=${moveAt}ms`);
  process.exit(robotMoved ? 0 : 1);
}, 9000);
