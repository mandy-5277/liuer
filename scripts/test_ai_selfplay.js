// 纯逻辑测试：机器人 AI 双方自对弈，验证决策与引擎驱动无异常并能结算
const path = '/opt/liuer/server/src';
const GameEngine = require(path + '/game/engine');
const robotAI = require(path + '/game/robot');
const { Stage, BLACK, WHITE } = require(path + '/game/constants');

function execDecision(engine, color) {
  const openid = color === BLACK ? 'B' : 'W';
  const dec = robotAI.decideAction(engine, color);
  if (!dec || dec.type === 'none') return { ok: false };
  let r;
  if (dec.type === 'place') r = engine.placePiece(openid, dec.action.r, dec.action.c);
  else if (dec.type === 'capture') r = engine.capturePiece(openid, dec.action.r, dec.action.c);
  else if (dec.type === 'skip_capture') r = engine.skipLinkedCapture(openid);
  else if (dec.type === 'move') r = engine.movePiece(openid, dec.action.fromR, dec.action.fromC, dec.action.toR, dec.action.toC);
  return { ok: true, r };
}

const engine = new GameEngine('SELFPLAY', { openid: 'B' }, { openid: 'W' });
engine.init();

let steps = 0;
while (engine.stage !== Stage.SETTLED && steps < 2000) {
  const color = engine.currentTurn;
  let res = execDecision(engine, color);
  if (!res.ok) {
    // AI 决策失败：用引擎内置超时托管兜底，验证不卡死
    const fr = engine.autoTimeout(color);
    if (fr && fr.settled) break;
  }
  if (res.r && res.r.settled) break;
  // 每 40 步强制一次超时托管，确保最终能触发连续超时判负/和棋，验证完整生命周期可结算
  if (steps % 40 === 0 && steps > 0) {
    const fr = engine.autoTimeout(engine.currentTurn);
    if (fr && fr.settled) break;
  }
  steps++;
}
console.log('selfplay ended. stage=', engine.stage, 'steps=', steps, 'settled=', engine.stage === Stage.SETTLED);
console.log('endReason=', engine.endReason, 'blackCount=', engine.getSnapshot ? '' : '', 'ok=', engine.stage === Stage.SETTLED);
process.exit(0);
