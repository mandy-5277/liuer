const { BLACK, WHITE, EMPTY } = require('./src/game/constants.js');
const board = require('./src/game/board.js');
const b = Array.from({ length: 6 }, () => Array(6).fill(EMPTY));
b[0][0] = BLACK; b[0][1] = BLACK; b[1][0] = BLACK; b[1][1] = BLACK;
const formed = board.getAllFormed(b);
console.log('getAllFormed size=', formed.size, 'has 0,0?', formed.has('0,0'));
const caps = board.getCapturableCells(b, BLACK, formed);
console.log('getCapturableCells(BLACK) len=', caps.length, 'includes 0,0?', caps.some(p => p.r===0&&p.c===0));
console.log('getCapturableCells(WHITE) len=', board.getCapturableCells(b, WHITE, formed).length);
