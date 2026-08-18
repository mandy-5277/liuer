/**
 * 六儿 全流程端到端自动测试 (server 自包含版)
 * 模拟两位玩家(黑/白)自动对弈，覆盖：创建房间->下子->揪子->走子->结算，
 * 并比对"服务端引擎返回"与"客户端视角(stage_change/cmd 映射)"一致性，
 * 列出可疑点。
 *
 * 用法: 放到 server/ 目录下, node test_full_flow.js
 */

const path = require('path');
const _engineMod = require('./src/game/engine.js');
const GameEngine = (_engineMod.GameEngine || _engineMod);
const { Stage, BLACK, WHITE, EMPTY } = require('./src/game/constants.js');
const board = require('./src/game/board.js');

// 内联最小客户端视角映射(复刻 game-core.resolveStage + session.buildBroadcastMsg)
const STAGE_MAP = { 1: 'place', 2: 'capture', 3: 'move', 4: 'settled' };
function resolveStage(stage) {
  if (typeof stage === 'string') {
    const valid = new Set(Object.values(STAGE_MAP));
    return valid.has(stage) ? stage : 'place';
  }
  return STAGE_MAP[stage] || 'place';
}
function clientView(eng, result, openid) {
  const color = eng.getColorByUid(openid);
  const data = { stage: eng.stage, currentTurn: result.currentTurn ?? eng.currentTurn, board: result.board || eng.board };
  let cmd = '';
  if (result.stageChanged) { cmd = 'stage_change'; data.stage = result.stage; data.catchNums = result.catchNums; }
  else if (result.linkedCapture) { cmd = 'linked_capture'; data.linkedCapture = result.linkedCapture; }
  else if (result.drawRejected) cmd = 'draw_rejected';
  else if (result.noNewForm) cmd = 'move_made';
  else if (result.drawRequestBy) cmd = 'draw_requested';
  else {
    switch (result.lastAction) {
      case 'capture': cmd = 'capture_made'; break;
      case 'move': cmd = 'move_made'; break;
      case 'place': default: cmd = 'piece_placed'; break;
    }
  }
  data.catchNums = result.catchNums || { black: eng.blackCatchNum, white: eng.whiteCatchNum };
  return { cmd, data, color, stage: data.stage, phase: resolveStage(data.stage) };
}

let pass = 0, fail = 0;
const issues = [];
function check(cond, name, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  -> ' + detail : '')); issues.push(name + (detail ? ' :: ' + detail : '')); }
}
function logStep(s) { console.log('\n=== ' + s + ' ==='); }

function pickEmpty(b) { for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (b[r][c] === EMPTY) return { r, c }; return null; }
function pickCapturable(eng, enemy) { return board.getCapturableCells(eng.board, enemy, board.getAllFormed(eng.board)); }
function pickCapturableSet(eng, enemy) {
  const formed = board.getAllFormed(eng.board);
  return board.getCapturableCells(eng.board, enemy, formed).filter(o => !formed.has(o.r + ',' + o.c));
}
function pickMove(eng, color) { return board.getLegalMoves(eng.board, color)[0]; }

const black = { openid: 'U_BLACK', nickName: '黑', avatarUrl: '', rankScore: 1000 };
const white = { openid: 'U_WHITE', nickName: '白', avatarUrl: '', rankScore: 1000 };

function run() {
  const eng = new GameEngine('G_TEST_1', black, white);
  eng.init();

  logStep('房间创建 + game_start');
  check(eng.currentTurn === WHITE, 'game_start.currentTurn = WHITE (白先下)', 'got ' + eng.currentTurn);
  check(eng.stage === Stage.PLACING, 'stage = PLACING(1)');
  check(resolveStage(eng.stage) === 'place', 'client resolves PLACING -> place');

  logStep('阶段1: 下子 (黑白交替填满棋盘)');
  let placingCount = 0;
  // 用交错顺序下子（类似真实分散布局），避免整盘成块导致无棋子可揪
  const order = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2 === 0) order.push({ r, c });
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2 === 1) order.push({ r, c });
  let placed = 0;
  while (eng.stage === Stage.PLACING) {
    const cur = eng.currentTurn;
    const uid = cur === BLACK ? black.openid : white.openid;
    // 选一个空位：优先与已下子不同色的相邻，模拟真实分散下子
    const empty = order.filter(o => eng.board[o.r][o.c] === EMPTY);
    if (empty.length === 0) break;
    const cell = empty[0];
    const res = eng.placePiece(uid, cell.r, cell.c);
    if (!res.success) { check(false, 'placePiece success', JSON.stringify(res)); break; }
    placingCount++;
    if (res.stageChanged) {
      check(res.stage === Stage.CAPTURING, '下满后 stageChanged -> CAPTURING(2)', 'got ' + res.stage);
      const cv = clientView(eng, res, uid);
      check(cv.cmd === 'stage_change' && cv.phase === 'capture', 'client cmd=stage_change phase=capture', 'cmd=' + cv.cmd + ' phase=' + cv.phase);
      break;
    } else {
      const cv = clientView(eng, res, uid);
      check(cv.cmd === 'piece_placed', 'place broadcast cmd=piece_placed (第' + placingCount + '手) 实际=' + cv.cmd);
      check(cv.phase === 'place', 'client phase=place during placing');
    }
    if (placingCount > 40) { check(false, 'placing loop runaway'); break; }
  }
  check(placingCount === 36, 'total placed pieces = 36', 'got ' + placingCount);

  logStep('阶段2: 揪子阶段');
  check(eng.stage === Stage.CAPTURING, 'stage = CAPTURING(2)');
  check(eng.currentTurn === BLACK, 'capture first = BLACK', 'got ' + eng.currentTurn);
  check(resolveStage(eng.stage) === 'capture', 'client resolveStage -> capture');

  const phase2CatchBW = eng.blackCatchNum + '/' + eng.whiteCatchNum;
  console.log('  [info] 阶段2 双方可揪数 (黑/白) = ' + phase2CatchBW);

  let capTurns = 0;
  while (eng.stage === Stage.CAPTURING) {
    const cur = eng.currentTurn;
    const uid = cur === BLACK ? black.openid : white.openid;
    const enemy = cur === BLACK ? WHITE : BLACK;
    const caps = pickCapturable(eng, enemy);
    let res = null;
    if (caps.length > 0) {
      for (const cc of caps) {
        res = eng.capturePiece(uid, cc.r, cc.c);
        if (res && res.success) break;
      }
    }
    if (!res || !res.success) {
      // 无合法可揪：消耗次数触发 skipped 防御（模拟引擎自动跳过）
      const k = cur === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
      eng[k] = 0;
      res = eng.capturePiece(uid, 0, 0);
    }
    if (!res || !res.success) { check(false, 'capturePiece success (turn ' + capTurns + ')', JSON.stringify(res)); break; }
    const cv = clientView(eng, res, uid);
    if (res.stageChanged) {
      check(res.stage === Stage.MOVING, 'capture exhausted -> MOVING(3)', 'got ' + res.stage);
      check(cv.cmd === 'stage_change' && cv.phase === 'move', 'client cmd=stage_change phase=move', 'cmd=' + cv.cmd);
      break;
    } else {
      check(cv.cmd === 'capture_made',
        'capture broadcast cmd=capture_made (turn ' + capTurns + ')', 'cmd=' + cv.cmd + ' skipped=' + !!res.skipped);
    }
    capTurns++;
    if (capTurns > 50) { check(false, 'capture loop runaway'); break; }
  }
  console.log('  [info] 阶段2 实际发生揪子手数 = ' + capTurns);

  logStep('阶段3: 走子阶段');
  check(eng.stage === Stage.MOVING, 'stage = MOVING(3)');
  check(eng.currentTurn === BLACK, 'move first = BLACK (继承 captureFirstPlayer)', 'got ' + eng.currentTurn);
  check(resolveStage(eng.stage) === 'move', 'client resolveStage -> move');

  let moveTurns = 0;
  while (eng.stage === Stage.MOVING) {
    const cur = eng.currentTurn;
    const uid = cur === BLACK ? black.openid : white.openid;
    const mv = pickMove(eng, cur);
    if (!mv) { check(false, 'no legal move for ' + cur + ' but stage still MOVING'); break; }
    const res = eng.movePiece(uid, mv.fromR, mv.fromC, mv.toR, mv.toC);
    if (!res.success) { check(false, 'movePiece success (turn ' + moveTurns + ')', JSON.stringify(res)); break; }
    if (res.settled) { check(eng.stage === Stage.SETTLED, 'move led to SETTLED'); break; }
    if (res.linkedCapture) {
      const cv = clientView(eng, res, uid);
      check(cv.cmd === 'linked_capture', 'linked capture cmd=linked_capture', 'cmd=' + cv.cmd);
      let lc = 0;
      while (eng.currentTurn === cur && eng.stage === Stage.MOVING) {
        const k = cur === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
        if (eng[k] <= 0) break;
        const enemy = cur === BLACK ? WHITE : BLACK;
        const caps = pickCapturable(eng, enemy);
        let lr;
        if (caps.length > 0) lr = eng.linkedCapturePiece(uid, caps[0].r, caps[0].c);
        else lr = eng.skipLinkedCapture(uid);
        if (!lr || !lr.success) { check(false, 'linked capture success', JSON.stringify(lr)); break; }
        if (lr.settled) { check(eng.stage === Stage.SETTLED, 'linked capture led to SETTLED'); break; }
        if (eng.currentTurn !== cur) break;
        lc++; if (lc > 30) break;
      }
      if (eng.stage === Stage.SETTLED) break;
    } else {
      const cv = clientView(eng, res, uid);
      check(cv.cmd === 'move_made', 'move broadcast cmd=move_made (turn ' + moveTurns + ')', 'cmd=' + cv.cmd);
      check(cv.phase === 'move', 'client phase=move during moving');
    }
    moveTurns++;
    if (moveTurns > 300) { check(false, 'move loop runaway (draw logic?)'); break; }
  }

  logStep('阶段4: 结算');
  check(eng.stage === Stage.SETTLED, '最终 stage = SETTLED(4)');
  check(resolveStage(eng.stage) === 'settled', 'client resolveStage -> settled');

  logStep('边界A: 单方揪子数=0 自动跳过');
  {
    const e2 = new GameEngine('G_A', black, white); e2.init();
    e2.blackCatchNum = 0; e2.whiteCatchNum = 2;
    e2.captureFirstPlayer = BLACK; e2.currentTurn = BLACK;
    e2.stage = Stage.CAPTURING;
    e2._advanceCaptureTurn();
    check(e2.blackCatchNum === 0, 'blackCatchNum=0 (构造)', 'got ' + e2.blackCatchNum);
    check(e2.whiteCatchNum === 2, 'whiteCatchNum=2 (构造)', 'got ' + e2.whiteCatchNum);
    check(e2.currentTurn === WHITE, 'auto skip BLACK(0次) -> currentTurn=WHITE', 'got ' + e2.currentTurn);
    check(e2.captureFirstPlayer === BLACK, 'captureFirstPlayer 仍=BLACK', 'got ' + e2.captureFirstPlayer);
    check(e2.stage === Stage.CAPTURING, '仍处 CAPTURING(跳过未结束)', 'got ' + e2.stage);
  }

  logStep('边界B: 双方有方块 实际揪子 + 切换');
  {
    const e3 = new GameEngine('G_B2', black, white); e3.init();
    // 黑2x2 @ (0,0)，白2x2 @ (0,4)，其余交替填防成块
    e3.board[0][0] = BLACK; e3.board[0][1] = BLACK; e3.board[1][0] = BLACK; e3.board[1][1] = BLACK;
    e3.board[0][4] = WHITE; e3.board[0][5] = WHITE; e3.board[1][4] = WHITE; e3.board[1][5] = WHITE;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      if (e3.board[r][c] === EMPTY) e3.board[r][c] = ((r + c) % 2 === 0) ? BLACK : WHITE;
    }
    // 防止交替区产生额外方块：清除 (r,c) 同色相邻块 (直接覆盖为对方色)
    const r = e3.enterCaptureStage();
    check(r.success, 'enterCaptureStage ok (有方块)');
    const expectB = e3.blackCatchNum, expectW = e3.whiteCatchNum;
    check(expectB >= 1 && expectW >= 1, '双方可揪数 >=1 (黑=' + expectB + ' 白=' + expectW + ')', 'got ' + expectB + '/' + expectW);
    let t = 0;
    while (e3.stage === Stage.CAPTURING) {
      const cur = e3.currentTurn;
      const uid = cur === BLACK ? black.openid : white.openid;
      const enemy = cur === BLACK ? WHITE : BLACK;
      const caps = pickCapturable(e3, enemy);
      let res = null;
      if (caps.length > 0) for (const cc of caps) { res = e3.capturePiece(uid, cc.r, cc.c); if (res && res.success) break; }
      if (!res || !res.success) { const k = cur === BLACK ? 'blackCatchNum' : 'whiteCatchNum'; e3[k] = 0; res = e3.capturePiece(uid, 0, 0); }
      if (!res || !res.success) { check(false, 'B-scenario capture fail (turn ' + t + ')', JSON.stringify(res)); break; }
      if (res.stageChanged) { check(res.stage === Stage.MOVING, 'B: 揪完进 MOVING'); break; }
      t++;
      if (t > 50) { check(false, 'B: capture loop runaway'); break; }
    }
    check(t >= 1, 'B: 阶段2 实际发生 >=1 手揪子 (实际=' + t + ')', 'got ' + t);
  }

  logStep('边界C: 双方无成型 兜底各+1 进走子');
  {
    const e3 = new GameEngine('G_B', black, white); e3.init();
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) e3.board[r][c] = ((r + c) % 2 === 0) ? BLACK : WHITE;
    e3.enterCaptureStage();
    check(e3.blackCatchNum === 1 && e3.whiteCatchNum === 1, '兜底各+1 -> 1/1', 'got ' + e3.blackCatchNum + '/' + e3.whiteCatchNum);
  }

  logStep('边界C/D: 阶段防护');
  {
    const e4 = new GameEngine('G_C', black, white); e4.init(); e4.enterMoveStage(BLACK);
    const pr = e4.placePiece(black.openid, 0, 0);
    check(!pr.success, '走子阶段拒绝 place_piece (errMsg="' + pr.errMsg + '")', JSON.stringify(pr));
    const cr = e4.capturePiece(black.openid, 0, 0);
    check(!cr.success && cr.errMsg.includes('不是揪子'), '走子阶段拒绝 capture_piece', JSON.stringify(cr));
  }
  {
    const e5 = new GameEngine('G_D', black, white); e5.init();
    const cr = e5.capturePiece(white.openid, 0, 0);
    check(!cr.success, '下子阶段拒绝 capture_piece', JSON.stringify(cr));
    const mr = e5.movePiece(white.openid, 0, 0, 1, 1);
    check(!mr.success, '下子阶段拒绝 move_piece', JSON.stringify(mr));
  }

  logStep('汇总');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  if (issues.length) { console.log('\n发现的可疑点 / 失败项:'); issues.forEach(i => console.log('  - ' + i)); }
  else console.log('\n全流程无失败项。');
  process.exit(fail > 0 ? 1 : 0);
}

run();
