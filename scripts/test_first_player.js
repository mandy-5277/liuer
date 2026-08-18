/**
 * 阶段2/阶段3 先手规则自动化测试
 *
 * 引擎真实规则（见 server/src/game/engine.js）：
 *   - 阶段1 下子：WHITE(白) 先手  (engine.init: currentTurn = WHITE)
 *   - 阶段2 揪子：BLACK(黑) 先手  (enterCaptureStage: captureFirstPlayer = BLACK)
 *   - 阶段3 走子：BLACK(黑) 先手  (enterMoveStage: moveFirstPlayer = captureFirstPlayer)
 *
 * 即：下子与揪子/走子先手"相反"，且阶段2与阶段3先手"一致"（均为 BLACK），
 * 与某一方的可揪数是否为 0 无关（可揪数为 0 时阶段2会跳过该方，但阶段3仍按
 * captureFirstPlayer 固定先手）。
 *
 * 运行（需在有 node 的环境，如服务端 /opt/liuer/server）：
 *   node scripts/test_first_player.js
 */

// 自适应路径：脚本既可能在项目根 scripts/ 下，也可能在服务端根目录下
let GameEngine, BLACK, WHITE, Stage;
try {
  ({ GameEngine } = require('../server/src/game/engine'));
  ({ BLACK, WHITE, Stage } = require('../server/src/game/constants'));
} catch (_) {
  GameEngine = require('./src/game/engine');
  ({ BLACK, WHITE, Stage } = require('./src/game/constants'));
}

const cn = (c) => (c === BLACK ? 'BLACK' : c === WHITE ? 'WHITE' : 'NONE');

function simulate(blackCatch, whiteCatch) {
  const engine = new GameEngine('test', { openid: 'A' }, { openid: 'B' });
  engine.init();
  engine.blackCatchNum = blackCatch;
  engine.whiteCatchNum = whiteCatch;
  // 引擎真实默认：下子白先 → 揪子黑先
  engine.captureFirstPlayer = BLACK;
  engine.currentTurn = engine.captureFirstPlayer;

  // 兜底：双方都为 0 时各 +1（与 enterCaptureStage 一致）
  if (engine.blackCatchNum === 0 && engine.whiteCatchNum === 0) {
    engine.blackCatchNum = 1;
    engine.whiteCatchNum = 1;
  }

  engine._advanceCaptureTurn();

  const stage2First = engine.currentTurn;
  const stage2ActualCatch =
    stage2First === BLACK ? engine.blackCatchNum : engine.whiteCatchNum;

  if (engine.stage !== Stage.MOVING) {
    engine.enterMoveStage(stage2First);
  }
  const stage3First = engine.moveFirstPlayer;

  return {
    stage2First: cn(stage2First),
    stage2ActualCatch,
    stage3First: cn(stage3First),
    captureFirstPlayer: cn(engine.captureFirstPlayer),
  };
}

function runCase(idx, blackCatch, whiteCatch) {
  const r = simulate(blackCatch, whiteCatch);
  console.log(`Case${idx}: catch B/W=${blackCatch}/${whiteCatch}`);
  console.log(
    `  phase2 first=${r.stage2First}, phase2 actual catch=${r.stage2ActualCatch}, ` +
    `phase3 first=${r.stage3First} (captureFirstPlayer=${r.captureFirstPlayer})`
  );
  return r;
}

console.log('=== Phase2/3 first-player rule test ===');
console.log('Engine rule: phase1=WHITE, phase2=BLACK, phase3=BLACK (consistent, opposite to phase1)\n');

const c1 = runCase(1, 4, 0);
const c2 = runCase(2, 0, 4);
const c3 = runCase(3, 0, 0);
const c4 = runCase(4, 4, 4);

let fail = 0;
const A = (name, cond) => {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}`);
  if (!cond) fail++;
};

console.log('\n=== Assertions ===');
// phase2 first: BLACK 除非 black 可揪=0（跳到 WHITE）
A('C1 phase2=BLACK', c1.stage2First === 'BLACK');
A('C1 phase2 actual catch=4', c1.stage2ActualCatch === 4);
A('C1 phase3=BLACK', c1.stage3First === 'BLACK');

A('C2 phase2=WHITE (black 0 -> skip)', c2.stage2First === 'WHITE');
A('C2 phase2 actual catch=4', c2.stage2ActualCatch === 4);
A('C2 phase3=BLACK (fixed)', c2.stage3First === 'BLACK');

A('C3 phase2=BLACK (fallback 1/1)', c3.stage2First === 'BLACK');
A('C3 phase2 actual catch=1', c3.stage2ActualCatch === 1);
A('C3 phase3=BLACK', c3.stage3First === 'BLACK');

A('C4 phase2=BLACK', c4.stage2First === 'BLACK');
A('C4 phase2 actual catch=4', c4.stage2ActualCatch === 4);
A('C4 phase3=BLACK', c4.stage3First === 'BLACK');

console.log(fail === 0 ? '\nALL PASS ✅' : `\n${fail} FAILED ❌`);
process.exit(fail === 0 ? 0 : 1);
