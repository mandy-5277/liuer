/**
 * 六儿 联机端到端自动测试 (server 本机运行)
 * 两个 WS 客户端 -> login -> match_start -> 自动对弈 -> game_settle
 * -> 再次匹配 -> 验证新局 gameId 不同于旧局 (不弹旧结算页)
 *
 * 用法: 放到 server/ 下, node test_e2e_ws.js [wsUrl]
 * 默认 wsUrl = ws://127.0.0.1:3000
 */
const WebSocket = require('ws');
const path = require('path');

const WS_URL = process.argv[2] || 'ws://127.0.0.1:3000';
const _em = require('./src/game/engine.js');
const GameEngine = (_em.GameEngine || _em);
const { Stage, BLACK, WHITE, EMPTY } = require('./src/game/constants.js');
const board = require('./src/game/board.js');

let pass = 0, fail = 0;
const issues = [];
function check(cond, name, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  -> ' + detail : '')); issues.push(name + (detail ? ' :: ' + detail : '')); }
}

const TAG = 'T' + Date.now().toString().slice(-6);
const openidA = 'E2E_A_' + TAG;
const openidB = 'E2E_B_' + TAG;

function makeClient(openid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const client = { ws, openid, loggedIn: false, queue: [], handlers: {}, gameId: null, color: 0 };
    ws.on('open', () => {
      ws.send(JSON.stringify({ cmd: 'login', data: { openid, nickName: openid, avatarUrl: '' } }));
    });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.cmd === 'login_success') {
        client.loggedIn = true;
        (client._onLogin || []).forEach(f => f());
      }
      // 通用：推给注册的 handler
      (client.handlers[msg.cmd] || []).forEach(f => f(msg));
      (client.handlers['*any'] || []).forEach(f => f(msg));
      client.lastMsgs = client.lastMsgs || [];
      client.lastMsgs.push(msg);
    });
    ws.on('error', (e) => { console.log('  [WS-ERR] ' + openid + ' ' + e.message); });
    client.on = (cmd, fn) => { (client.handlers[cmd] = client.handlers[cmd] || []).push(fn); };
    client.send = (cmd, data) => ws.send(JSON.stringify({ cmd, data: data || {} }));
    client.waitLogin = () => new Promise(r => { if (client.loggedIn) return r(); client._onLogin = client._onLogin || []; client._onLogin.push(r); });
    client.waitMsg = (cmd, timeout = 20000) => new Promise((res, rej) => {
      const existing = (client.lastMsgs || []).find(m => m.cmd === cmd);
      if (existing) return res(existing);
      const h = (m) => { if (m.cmd === cmd) { client.off(cmd, h); clearTimeout(t); res(m); } };
      client.on(cmd, h);
      const t = setTimeout(() => { client.off(cmd, h); rej(new Error('timeout waiting ' + cmd)); }, timeout);
    });
    client.waitMsgPred = (pred, timeout = 20000) => new Promise((res, rej) => {
      const existing = (client.lastMsgs || []).find(pred);
      if (existing) return res(existing);
      const h = (m) => { if (pred(m)) { client.off('*any', h); clearTimeout(t); res(m); } };
      client.on('*any', h);
      const t = setTimeout(() => { client.off('*any', h); rej(new Error('timeout waiting pred')); }, timeout);
    });
    client.off = (cmd, fn) => { client.handlers[cmd] = (client.handlers[cmd] || []).filter(f => f !== fn); };
    resolve(client);
  });
}

function pickEmpty(b) { for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (b[r][c] === EMPTY) return { r, c }; return null; }
function pickCapturableLocal(eng, enemy) { return board.getCapturableCells(eng.board, enemy, board.getAllFormed(eng.board)); }
function pickMoveLocal(eng, color) { return board.getLegalMoves(eng.board, color)[0]; }

// 根据服务端广播维护本地镜像引擎
function syncEngineFromMsg(localEng, msg) {
  if (msg.data && msg.data.board) {
    // 用服务端 board 覆盖本地（保证一致）
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) localEng.board[r][c] = msg.data.board[r][c];
  }
  if (msg.data && msg.data.currentTurn !== undefined) localEng.currentTurn = msg.data.currentTurn;
  if (msg.data && msg.data.stage !== undefined) localEng.stage = msg.data.stage;
  if (msg.data && msg.data.catchNums) { localEng.blackCatchNum = msg.data.catchNums.black; localEng.whiteCatchNum = msg.data.catchNums.white; }
}

async function playGame(clientA, clientB, localA, localB, label, preStart) {
  console.log('\n=== ' + label + ': 对弈 ===');
  let gsA, gsB;
  if (preStart) {
    // 复用调用方已收到的 game_start，避免二次等待竞态
    gsA = preStart.gsA; gsB = preStart.gsB;
  } else {
    // 等待 game_start：移除已见过的 game_start 缓存，接收下一个
    const clearSeenStart = (cl) => { cl.lastMsgs = (cl.lastMsgs || []).filter(m => !(m.cmd === 'game_start' && (cl._seenGameIds || new Set()).has(m.data && m.data.gameId))); };
    clearSeenStart(clientA); clearSeenStart(clientB);
    gsA = await clientA.waitMsg('game_start', 15000).catch(() => null);
    gsB = await clientB.waitMsg('game_start', 15000).catch(() => null);
  }
  if (!gsA || !gsB) { check(false, label + ' 收到 game_start', 'A=' + !!gsA + ' B=' + !!gsB); return null; }
  check(true, label + ' 双方收到 game_start');
  const gameId = gsA.data.gameId;
  const gameIdB = gsB.data.gameId;
  check(gameId === gameIdB, label + ' 双方 gameId 一致', gameId + ' vs ' + gameIdB);
  // 记录本局角色
  localA.gameId = gameId; localB.gameId = gameId;
  clientA._seenGameIds = clientA._seenGameIds || new Set(); clientA._seenGameIds.add(gameId);
  clientB._seenGameIds = clientB._seenGameIds || new Set(); clientB._seenGameIds.add(gameId);
  // 关联本地引擎（用 game_start 的 black/white openid 决定颜色）
  const aIsBlack = gsA.data.blackPlayer.openid === openidA;
  localA.color = aIsBlack ? BLACK : WHITE;
  localB.color = aIsBlack ? WHITE : BLACK;
  check(localA.color !== localB.color, label + ' 双方角色黑白互补', 'A=' + localA.color + ' B=' + localB.color);
  check(gsA.data.stage === Stage.PLACING, label + ' 开局 stage=PLACING');
  check(gsA.data.currentTurn === WHITE, label + ' 开局 currentTurn=WHITE (白先)');

  // 建立 color -> openid 映射（以 game_start 为准，不依赖本地镜像）
  const colorToOpenid = {
    [BLACK]: gsA.data.blackPlayer.openid,
    [WHITE]: gsA.data.whitePlayer.openid,
  };
  const clientByOpenid = { [openidA]: clientA, [openidB]: clientB };

  syncEngineFromMsg(localA, gsA);
  syncEngineFromMsg(localB, gsB);

  // 自动对弈：以"最近一次广播的 currentTurn"为准选 actor
  let step = 0;
  const MAX_STEP = 400;
  let settled = null;
  let lastTurn = gsA.data.currentTurn;
  let rejectedCount = 0;
  while (step < MAX_STEP) {
    const turn = lastTurn; // 用最近广播的 currentTurn，避免本地镜像错位
    const actorOpenid = colorToOpenid[turn];
    const actor = clientByOpenid[actorOpenid];
    const localActor = (actorOpenid === openidA) ? localA : localB;
    let cmd = null, data = null;
    if (localActor.stage === Stage.PLACING) {
      const cell = pickEmpty(localActor.board);
      cmd = 'place_piece'; data = { r: cell.r, c: cell.c };
    } else if (localActor.stage === Stage.CAPTURING) {
      const enemy = turn === BLACK ? WHITE : BLACK;
      const caps = pickCapturableLocal(localActor, enemy);
      if (caps.length > 0) { cmd = 'capture_piece'; data = { r: caps[0].r, c: caps[0].c }; }
      else { const k = turn === BLACK ? 'blackCatchNum' : 'whiteCatchNum'; localActor[k] = 0; cmd = 'skip_capture'; data = {}; }
    } else if (localActor.stage === Stage.MOVING) {
      const mv = pickMoveLocal(localActor, turn);
      if (mv) { cmd = 'move_piece'; data = { fromR: mv.fromR, fromC: mv.fromC, toR: mv.toR, toC: mv.toC }; }
      else { cmd = 'give_up'; data = {}; }
    } else break;

    const p = new Promise((res) => {
      const onAny = (m) => {
        if (['game_settle','stage_change','piece_placed','capture_made','move_made','linked_capture','error'].includes(m.cmd)) res(m);
      };
      ['game_settle','stage_change','piece_placed','capture_made','move_made','linked_capture','error'].forEach(c => actor.on(c, onAny));
      actor._cleanup = () => ['game_settle','stage_change','piece_placed','capture_made','move_made','linked_capture','error'].forEach(c => actor.off(c, onAny));
    });
    actor.send(cmd, data);
    const m = await p;
    actor._cleanup && actor._cleanup();

    if (m.cmd === 'error') {
      // 拒绝：用最近广播 board 覆盖本地，重算（不 step++ 死循环）
      const snap = (clientA.lastMsgs || []).slice(-1).reverse().find(x => x.data && x.data.board)
                || (clientB.lastMsgs || []).slice(-1).reverse().find(x => x.data && x.data.board);
      if (snap) { syncEngineFromMsg(localA, snap); syncEngineFromMsg(localB, snap); if (snap.data.currentTurn !== undefined) lastTurn = snap.data.currentTurn; }
      console.log('  [warn] ' + label + ' 指令 ' + cmd + ' 被拒: ' + JSON.stringify(m.data));
      rejectedCount++;
      if (rejectedCount > 30) { check(false, label + ' 连续被拒超过30次，可能本地镜像与服务端持续不一致'); break; }
      continue; // 重算下一手
    }
    // 同步本地状态 + 记录 currentTurn
    syncEngineFromMsg(localA, m);
    syncEngineFromMsg(localB, m);
    if (m.data && m.data.currentTurn !== undefined) lastTurn = m.data.currentTurn;
    if (m.cmd === 'game_settle') { settled = m; break; }
    step++;
  }

  if (settled) {
    check(true, label + ' 收到 game_settle');
    check(settled.data && settled.data.gameId === gameId, label + ' 结算 gameId 与开局一致', JSON.stringify(settled.data && settled.data.gameId));
    check(['black','white','draw'].includes(settled.data.result), label + ' 结算结果合法: ' + settled.data.result);
    // 客户端应在收到结算后清理（不残留监听）-> 模拟：记录
    return { gameId, result: settled.data.result };
  } else {
    check(false, label + ' 在 ' + MAX_STEP + ' 步内未结算 (可能和棋/卡死)', 'lastStage=' + localA.stage);
    return { gameId, result: null };
  }
}

async function main() {
  console.log('WS URL = ' + WS_URL);
  const clientA = await makeClient(openidA);
  const clientB = await makeClient(openidB);
  await clientA.waitLogin();
  await clientB.waitLogin();
  check(clientA.loggedIn && clientB.loggedIn, '两客户端 login_success');

  // 本地镜像引擎（openid 角色由 game_start 决定，这里先 new 占位）
  const localA = new GameEngine('L_A', { openid: openidA }, { openid: openidB });
  const localB = new GameEngine('L_B', { openid: openidA }, { openid: openidB });
  localA.init(); localB.init();

  // ---------- 第一局 ----------
  clientA.send('match_start', {});
  clientB.send('match_start', {});
  const g1 = await playGame(clientA, clientB, localA, localB, '第一局');

  // ---------- 验证：结算后重新匹配不弹旧结算页 ----------
  console.log('\n=== 验证: 新局弹旧结算页 ===');
  if (!g1) { check(false, '第一局未完成，跳过新局验证'); }
  else {
    // 立即再次匹配（不清空 lastMsgs，以真实反映 WS 接收顺序）
    clientA.send('match_start', {});
    clientB.send('match_start', {});
    // 第二局必须等到 gameId 与第一局不同的新 game_start
    const pred2a = (m) => m.cmd === 'game_start' && m.data && m.data.gameId !== g1.gameId;
    const pred2b = (m) => m.cmd === 'game_start' && m.data && m.data.gameId !== g1.gameId;
    const gs2a = await clientA.waitMsgPred(pred2a, 15000).catch(() => null);
    const gs2b = await clientB.waitMsgPred(pred2b, 15000).catch(() => null);
    if (gs2a) { clientA._seenGameIds = clientA._seenGameIds || new Set(); clientA._seenGameIds.add(gs2a.data.gameId); }
    if (gs2b) { clientB._seenGameIds = clientB._seenGameIds || new Set(); clientB._seenGameIds.add(gs2b.data.gameId); }
    if (gs2a && gs2b) {
      const newId = gs2a.data.gameId;
      check(newId !== g1.gameId, '新局 gameId 不同于上一局 (防弹旧结算页)', 'old=' + g1.gameId + ' new=' + newId);
      check(gs2a.data.stage === Stage.PLACING, '新局 stage=PLACING (全新开始)');
      check(gs2a.data.gameId === gs2b.data.gameId, '新局双方 gameId 一致');
      // 关键：第二局 game_start 到达【之后】，不得再收到任何"旧局(gameId!=新局)的 game_settle"
      // （game_start 之前的旧结算是 WS 顺序保证的正常现象，客户端应在 game_start 时关闭结算页）
      const idx = (clientA.lastMsgs || []).findIndex(m => m === gs2a || (m.cmd === 'game_start' && m.data && m.data.gameId === newId));
      const after = (clientA.lastMsgs || []).slice(idx + 1);
      const strayAfter = after.find(m => m.cmd === 'game_settle' && m.data && m.data.gameId !== newId);
      check(!strayAfter, '第二局 game_start 之后未再收到旧局 game_settle (真·弹旧页判定)', strayAfter ? 'gameId=' + strayAfter.data.gameId : '');
      // 统计 game_start 之前是否有旧结算（用于提示客户端侧处理）
      const before = (clientA.lastMsgs || []).slice(0, idx);
      const settleBefore = before.filter(m => m.cmd === 'game_settle' && m.data && m.data.gameId === g1.gameId);
      if (settleBefore.length) {
        console.log('  [info] 第二局 game_start 之前收到第一局 game_settle(' + settleBefore.length + '条)，属 WS 顺序正常现象；客户端需在 game_start 时关闭结算页');
      }
      // 把第二局也打完，确保整体链路稳定（复用已收到的 game_start，避免二次等待竞态）
      const localA2 = new GameEngine('L_A2', { openid: openidA }, { openid: openidB }); localA2.init();
      const localB2 = new GameEngine('L_B2', { openid: openidA }, { openid: openidB }); localB2.init();
      localA._seenGameIds = localA._seenGameIds || new Set(); localA._seenGameIds.add(newId);
      localB._seenGameIds = localB._seenGameIds || new Set(); localB._seenGameIds.add(newId);
      await playGame(clientA, clientB, localA2, localB2, '第二局', { gsA: gs2a, gsB: gs2b });
    } else {
      check(false, '新局未收到 game_start (可能 server 匹配异常)', 'A=' + !!gs2a + ' B=' + !!gs2b);
    }
  }

  console.log('\n=== 汇总 ===');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  if (issues.length) { console.log('\n可疑点 / 失败项:'); issues.forEach(i => console.log('  - ' + i)); }
  else console.log('\n联机端到端无失败项。');
  clientA.ws.close(); clientB.ws.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('E2E 异常:', e); process.exit(2); });
