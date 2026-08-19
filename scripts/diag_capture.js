const _em = require('./src/game/engine.js');
const GameEngine = (_em.GameEngine || _em);
const { BLACK, WHITE, EMPTY } = require('./src/game/constants.js');
const board = require('./src/game/board.js');
const b = { openid: 'B', nickName: '', avatarUrl: '', rankScore: 1 };
const w = { openid: 'W', nickName: '', avatarUrl: '', rankScore: 1 };
const e = new GameEngine('g', b, w);
e.init();
for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { const uid = e.currentTurn; e.placePiece(uid, r, c); }
const formed = board.getAllFormed(e.board);
console.log('formed types:', formed.map(f => f.type).join(','));
const cb = board.getCapturableCells(e.board, BLACK, formed);
console.log('capturableBlack len=', cb.length);
if (cb.length) {
  const f0 = cb[0];
  const isFormed = formed.some(g => g.cells.some(p => p.r === f0.r && p.c === f0.c));
  console.log('first black capturable=', JSON.stringify(f0), 'isInFormed?', isFormed);
  console.log('try capture ->', JSON.stringify(e.capturePiece(b.openid, f0.r, f0.c)).slice(0, 120));
}
const cw = board.getCapturableCells(e.board, WHITE, formed);
console.log('capturableWhite len=', cw.length);
