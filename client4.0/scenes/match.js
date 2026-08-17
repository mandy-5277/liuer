/**
 * 六儿 小游戏版 — 对局场景
 * （对应小程序版 pages/match/match，UI 由 WXML 改为 Canvas 绘制）
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const { PALETTE, drawText, drawButton, hit, roundRect } = require('../utils/ui');
const gameCore = require('../utils/game-core');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};

const game = {
  gameId: '', phase: 'place', phaseLabel: '下子阶段', currentTurn: 0,
  board: [], remainingTime: 0, timeTotal: 15, myColor: 0, myOpenid: '',
  myInfo: {}, opponentInfo: {}, myTurn: false,
  myCatchNum: 0, opponentCatchNum: 0, catchNums: { black: 0, white: 0 },
  myRemainText: '18/18', opponentRemainText: '18/18',
  moveCaptureMode: false, boardPieces: [], legalCells: [], selectedPieceIndex: -1,
  skipAvailable: false, drawPaused: false, showSettle: false, settleData: {},
  myResult: '', scoreChange: 0, drawRequestBy: '', drawRequestName: '',
  showDrawRequest: false, showGiveUpConfirm: false, boardFlipped: false,
  timerText: '00:00', timeLow: false, timerProgress: 100,
};

let boardGeo = { ox: 0, oy: 0, step: 0, size: 0 };

function calcTimerProgress(remainingTime) {
  const total = game.timeTotal || 15;
  const t = Math.max(0, Math.min(total, remainingTime || 0));
  return Math.round((t / total) * 100);
}

function onEnter(payload) {
  const gameData = (payload && payload.gameId) ? payload : state.currentGame;
  if (!gameData) {
    wx.showToast({ title: '对局数据丢失', icon: 'none' });
    setTimeout(() => sceneMgr.goto('home'), 1500);
    return;
  }
  const myOpenid = state.openid;
  const myColor = gameData.blackPlayer.openid === myOpenid ? 1 : 2;
  const opponentColor = myColor === 1 ? 2 : 1;
  const myInfo = myColor === 1 ? gameData.blackPlayer : gameData.whitePlayer;
  const oppInfo = opponentColor === 1 ? gameData.blackPlayer : gameData.whitePlayer;
  const boardFlipped = myColor === 2;
  const myTurn = gameData.currentTurn === myColor;
  const remainingTime = gameData.remainingTime || gameData.timeLimit || 15;
  const phase = gameCore.resolveStage(gameData.stage);

  Object.assign(game, {
    gameId: gameData.gameId, phase,
    phaseLabel: gameCore.STAGE_LABELS[phase] || '下子阶段',
    currentTurn: gameData.currentTurn, myColor, myOpenid,
    myInfo: { nickName: myInfo.nickName || '', avatarUrl: myInfo.avatarUrl || '', rankScore: myInfo.rankScore || 0 },
    opponentInfo: { nickName: oppInfo.nickName || '', avatarUrl: oppInfo.avatarUrl || '', rankScore: oppInfo.rankScore || 0 },
    myTurn, boardFlipped, remainingTime, timeTotal: gameData.timeLimit || 15,
    timerText: gameCore.formatTime(remainingTime),
    timeLow: remainingTime > 0 && remainingTime <= 10,
    timerProgress: calcTimerProgress(remainingTime),
    catchNums: { black: 0, white: 0 }, board: [], boardPieces: [],
    legalCells: [], selectedPieceIndex: -1, skipAvailable: false,
    showSettle: false, drawPaused: false, showDrawRequest: false, showGiveUpConfirm: false,
  });

  updateBoardPieces(gameData.board || []);
  updateCatchNums(gameData.catchNums || { black: 0, white: 0 });
  registerWs();
  state.currentGame = null;
}

function onLeave() { removeWs(); }

// ========== WebSocket ==========

function registerWs() {
  wsManager.on('stage_change', onStageChange);
  wsManager.on('piece_placed', onBoardUpdate);
  wsManager.on('capture_made', onBoardUpdate);
  wsManager.on('move_made', onBoardUpdate);
  wsManager.on('linked_capture', onLinkedCapture);
  wsManager.on('draw_rejected', onDrawRejected);
  wsManager.on('draw_request', onDrawRequest);
  wsManager.on('game_settle', onGameSettle);
  wsManager.on('timeout_warning', () => wx.showToast({ title: '已超时，系统将自动操作', icon: 'none' }));
  wsManager.on('error', onError);
  wsManager.on('opponent_disconnected', () => wx.showToast({ title: '对手已掉线，等待重连...', icon: 'none' }));
}

function removeWs() {
  wsManager.off('stage_change', onStageChange);
  wsManager.off('piece_placed', onBoardUpdate);
  wsManager.off('capture_made', onBoardUpdate);
  wsManager.off('move_made', onBoardUpdate);
  wsManager.off('linked_capture', onLinkedCapture);
  wsManager.off('draw_rejected', onDrawRejected);
  wsManager.off('draw_request', onDrawRequest);
  wsManager.off('game_settle', onGameSettle);
  wsManager.off('error', onError);
}

function onBoardUpdate(data) {
  const remainingTime = data.remainingTime || 0;
  Object.assign(game, {
    currentTurn: data.currentTurn,
    remainingTime,
    timerText: gameCore.formatTime(remainingTime),
    timeLow: remainingTime > 0 && remainingTime <= 10,
    timerProgress: calcTimerProgress(remainingTime),
    myTurn: data.currentTurn === game.myColor,
    legalCells: [], selectedPieceIndex: -1, skipAvailable: false,
  });
  updateBoardPieces(data.board || []);
  updateCatchNums(data.catchNums || { black: 0, white: 0 });
}

function onStageChange(data) {
  const phase = gameCore.resolveStage(data.stage);
  Object.assign(game, {
    phase,
    phaseLabel: gameCore.STAGE_LABELS[phase] || game.phaseLabel,
    currentTurn: data.currentTurn,
    remainingTime: data.remainingTime || 0,
    timerText: gameCore.formatTime(data.remainingTime || 0),
    timeLow: (data.remainingTime || 0) > 0 && (data.remainingTime || 0) <= 10,
    myTurn: data.currentTurn === game.myColor,
    legalCells: [], selectedPieceIndex: -1, skipAvailable: false,
  });
  updateBoardPieces(data.board || []);
  updateCatchNums(data.catchNums || { black: 0, white: 0 });
}

function onLinkedCapture(data) {
  const remainingTime = data.remainingTime || 0;
  Object.assign(game, {
    currentTurn: data.currentTurn, remainingTime,
    timerText: gameCore.formatTime(remainingTime),
    timeLow: remainingTime > 0 && remainingTime <= 10,
    myTurn: data.currentTurn === game.myColor,
    legalCells: [], selectedPieceIndex: -1,
    skipAvailable: !!data.linkedCapture,
  });
  updateBoardPieces(data.board || []);
  updateCatchNums(data.catchNums || { black: 0, white: 0 });
}

function onDrawRejected(data) {
  wx.showToast({ title: '对方拒绝了求和', icon: 'none' });
  game.drawPaused = false;
  onBoardUpdate(data);
}

function onDrawRequest(data) {
  game.drawRequestBy = data.by;
  game.drawRequestName = data.nickName || '';
  game.showDrawRequest = true;
  game.drawPaused = true;
}

function onGameSettle(data) {
  const myColor = game.myColor;
  let myResult = '';
  let scoreChange = 0;
  const endReason = data.endReason || '';
  if (data.result === 'black' && myColor === 1) { myResult = 'win'; scoreChange = data.blackRatingChange || 10; }
  else if (data.result === 'white' && myColor === 2) { myResult = 'win'; scoreChange = data.whiteRatingChange || 10; }
  else if (data.result === 'draw') { myResult = 'draw'; scoreChange = myColor === 1 ? (data.blackRatingChange || -1) : (data.whiteRatingChange || -1); }
  else { myResult = 'lose'; scoreChange = myColor === 1 ? (data.blackRatingChange || -3) : (data.whiteRatingChange || -3); }

  const rankKey = myColor === 1 ? 'blackNewRank' : 'whiteNewRank';
  const rankScoreKey = myColor === 1 ? 'blackAfterScore' : 'whiteAfterScore';
  Object.assign(game, {
    showSettle: true,
    settleData: Object.assign({}, data, { endReason }),
    myResult, scoreChange, myTurn: false, drawPaused: false,
    phase: 'settled', phaseLabel: '已结束',
    rankName: data[rankKey] || '', rankScore: data[rankScoreKey] || 0,
  });
}

function onError(data) {
  const msg = data && data.errMsg ? data.errMsg : '操作失败';
  if (msg.indexOf('不在对局') >= 0 || msg.indexOf('未找到') >= 0) {
    wx.showModal({
      title: '对局已结束',
      content: '当前对局已不在进行中，请返回大厅重新开始。',
      showCancel: false,
      success: () => sceneMgr.goto('home'),
    });
    return;
  }
  wx.showToast({ title: msg, icon: 'none' });
}

// ========== 棋盘数据转换 ==========

function updateBoardPieces(board) {
  if (!board || !board.length) return;
  const pieces = [];
  const myColor = game.myColor;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const colorVal = board[r] ? board[r][c] : 0;
      if (colorVal === 0) continue;
      const color = colorVal === 1 ? 'black' : 'white';
      pieces.push({ r, c, color, selected: false });
    }
  }
  game.boardPieces = pieces;
  game.board = board;
  updateRemainCounts();
}

function updateRemainCounts() {
  const board = game.board || [];
  const { black, white } = gameCore.countPieces(board);
  const myCount = game.myColor === 1 ? black : white;
  const oppCount = game.myColor === 1 ? white : black;
  game.myRemainText = myCount + '/18';
  game.opponentRemainText = oppCount + '/18';
}

function updateCatchNums(catchNums) {
  const myColor = game.myColor;
  game.catchNums = catchNums;
  game.myCatchNum = myColor === 1 ? (catchNums.black || 0) : (catchNums.white || 0);
  game.opponentCatchNum = myColor === 1 ? (catchNums.white || 0) : (catchNums.black || 0);
  updateCaptureMode();
}

function updateCaptureMode() {
  const moveCaptureMode = game.phase === 'move' && game.myTurn && game.myCatchNum > 0;
  if (moveCaptureMode !== game.moveCaptureMode) {
    game.moveCaptureMode = moveCaptureMode;
    game.legalCells = [];
    game.selectedPieceIndex = -1;
  }
}

// ========== 绘制 ==========

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawTopBar(ctx);
  drawBoard(ctx);
  drawBottomActions(ctx);

  if (game.showDrawRequest) drawDrawRequest(ctx);
  if (game.showGiveUpConfirm) drawGiveUpConfirm(ctx);
  if (game.showSettle) drawSettle(ctx);
}

function drawTopBar(ctx) {
  const y = state.statusBarHeight + 10;
  drawText(ctx, game.myInfo.nickName || '我', 20, y + 14, { color: PALETTE.text, fontSize: 22, bold: true });
  drawText(ctx, game.phaseLabel, W / 2, y + 14, { color: PALETTE.gold, fontSize: 24, align: 'center', bold: true });
  drawText(ctx, game.opponentInfo.nickName || '对手', W - 20, y + 14, { color: PALETTE.text, fontSize: 22, align: 'right' });

  const barY = y + 30;
  drawText(ctx, game.timerText, W / 2, barY + 8, { color: game.timeLow ? PALETTE.red : PALETTE.text, fontSize: 22, align: 'center', bold: true });
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(40, barY + 20, W - 80, 6);
  ctx.fillStyle = game.timeLow ? PALETTE.red : PALETTE.green;
  ctx.fillRect(40, barY + 20, (W - 80) * (game.timerProgress / 100), 6);
}

function drawBoard(ctx) {
  const size = Math.min(W * 0.86, H * 0.5);
  const ox = (W - size) / 2;
  const oy = H * 0.28;
  const step = size / 5;
  boardGeo = { ox, oy, step, size };

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, ox - 14, oy - 14, size + 28, size + 28, 16);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.beginPath();
      ctx.arc(ox + c * step, oy + r * step, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (game.legalCells && game.legalCells.length) {
    ctx.fillStyle = PALETTE.green;
    game.legalCells.forEach((cell) => {
      ctx.beginPath();
      ctx.arc(ox + cell.x * step, oy + cell.y * step, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  game.boardPieces.forEach((p) => {
    const px = ox + p.c * step;
    const py = oy + p.r * step;
    const radius = step * 0.38;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color === 'black' ? PALETTE.blackPiece : PALETTE.whitePiece;
    ctx.fill();
    if (p.selected) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.gold;
      ctx.stroke();
    }
  });
}

function drawBottomActions(ctx) {
  const btnW = (W - 80) / 3;
  const btnH = 50;
  const y = H - 90;
  const gap = 20;
  rects.actionBtns = [];

  rects.actionBtns.push(drawButton(ctx, { text: '求和', x: 20, y, w: btnW, h: btnH, fill: PALETTE.panelSolid, fontSize: 24 }));
  rects.actionBtns.push(drawButton(ctx, { text: '认输', x: 20 + (btnW + gap), y, w: btnW, h: btnH, fill: PALETTE.panelSolid, fontSize: 24 }));
  rects.actionBtns.push(drawButton(ctx, { text: '退出', x: 20 + 2 * (btnW + gap), y, w: btnW, h: btnH, fill: 'rgba(255,107,107,0.25)', textColor: PALETTE.red, fontSize: 24 }));

  if (game.skipAvailable || game.moveCaptureMode) {
    rects.skipBtn = drawButton(ctx, { text: '跳过连揪', x: (W - 160) / 2, y: y - 64, w: 160, h: 48, fill: PALETTE.accent, fontSize: 24 });
  } else {
    rects.skipBtn = null;
  }
}

function drawDrawRequest(ctx) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.8, ph = 220, px = (W - pw) / 2, py = (H - ph) / 2;
  ctx.fillStyle = PALETTE.panelSolid;
  roundRect(ctx, px, py, pw, ph, 24); ctx.fill();
  drawText(ctx, '对方请求求和', W / 2, py + 70, { color: PALETTE.text, fontSize: 32, align: 'center', bold: true });
  drawText(ctx, game.drawRequestName || '', W / 2, py + 110, { color: PALETTE.textDim, fontSize: 24, align: 'center' });
  rects.acceptDraw = drawButton(ctx, { text: '同意', x: px + 30, y: py + ph - 80, w: (pw - 90) / 2, h: 56, fill: PALETTE.green, fontSize: 28 });
  rects.rejectDraw = drawButton(ctx, { text: '拒绝', x: px + 60 + (pw - 90) / 2, y: py + ph - 80, w: (pw - 90) / 2, h: 56, fill: PALETTE.red, fontSize: 28 });
}

function drawGiveUpConfirm(ctx) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.8, ph = 200, px = (W - pw) / 2, py = (H - ph) / 2;
  ctx.fillStyle = PALETTE.panelSolid;
  roundRect(ctx, px, py, pw, ph, 24); ctx.fill();
  drawText(ctx, '确定认输吗？', W / 2, py + 80, { color: PALETTE.text, fontSize: 32, align: 'center', bold: true });
  rects.confirmGiveUp = drawButton(ctx, { text: '确定', x: px + 30, y: py + ph - 80, w: (pw - 90) / 2, h: 56, fill: PALETTE.red, fontSize: 28 });
  rects.cancelGiveUp = drawButton(ctx, { text: '取消', x: px + 60 + (pw - 90) / 2, y: py + ph - 80, w: (pw - 90) / 2, h: 56, fill: PALETTE.panelSolid, fontSize: 28 });
}

function drawSettle(ctx) {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.82, ph = 320, px = (W - pw) / 2, py = (H - ph) / 2;
  ctx.fillStyle = PALETTE.panelSolid;
  roundRect(ctx, px, py, pw, ph, 24); ctx.fill();

  const titleMap = { win: '胜利！', lose: '惜败', draw: '平局' };
  const titleColor = { win: PALETTE.gold, lose: PALETTE.red, draw: PALETTE.text }[game.myResult] || PALETTE.text;
  drawText(ctx, titleMap[game.myResult] || '对局结束', W / 2, py + 70, { color: titleColor, fontSize: 42, align: 'center', bold: true });
  drawText(ctx, (game.scoreChange >= 0 ? '+' : '') + game.scoreChange + ' 积分', W / 2, py + 120, { color: PALETTE.text, fontSize: 28, align: 'center' });
  if (game.rankName) drawText(ctx, '新段位：' + game.rankName, W / 2, py + 160, { color: PALETTE.textDim, fontSize: 24, align: 'center' });

  rects.settleBack = drawButton(ctx, { text: '返回大厅', x: px + 30, y: py + ph - 80, w: pw - 60, h: 56, fill: PALETTE.accent, fontSize: 28 });
}

// ========== 触摸 ==========

function onTouch(x, y) {
  if (game.showSettle) {
    if (hit(rects.settleBack, x, y)) sceneMgr.goto('home');
    return;
  }
  if (game.showDrawRequest) {
    if (hit(rects.acceptDraw, x, y)) {
      wsManager.send('respond_draw', { agree: true });
      game.showDrawRequest = false; game.drawPaused = false;
    } else if (hit(rects.rejectDraw, x, y)) {
      wsManager.send('respond_draw', { agree: false });
      game.showDrawRequest = false; game.drawPaused = false;
    }
    return;
  }
  if (game.showGiveUpConfirm) {
    if (hit(rects.confirmGiveUp, x, y)) { wsManager.send('give_up'); game.showGiveUpConfirm = false; }
    else if (hit(rects.cancelGiveUp, x, y)) { game.showGiveUpConfirm = false; }
    return;
  }

  if (hit(rects.skipBtn, x, y) && (game.skipAvailable || game.moveCaptureMode)) {
    wsManager.send('skip_capture');
    return;
  }

  if (rects.actionBtns) {
    if (hit(rects.actionBtns[0], x, y)) { requestDraw(); return; }
    if (hit(rects.actionBtns[1], x, y)) { game.showGiveUpConfirm = true; return; }
    if (hit(rects.actionBtns[2], x, y)) { sceneMgr.goto('home'); return; }
  }

  const { ox, oy, step } = boardGeo;
  if (x < ox - step || x > ox + step * 6 || y < oy - step || y > oy + step * 6) return;
  const c = Math.round((x - ox) / step);
  const r = Math.round((y - oy) / step);
  if (r < 0 || r > 5 || c < 0 || c > 5) return;

  if (game.drawPaused) { wx.showToast({ title: '等待对方响应中...', icon: 'none' }); return; }
  if (!game.myTurn) { wx.showToast({ title: '不是你的回合', icon: 'none' }); return; }

  if (game.phase === 'place') {
    wsManager.send('place_piece', { r, c });
  } else if (game.phase === 'capture') {
    handleCaptureTouch(r, c);
  } else if (game.phase === 'move') {
    handleMoveTouch(r, c);
  }
}

function handleCaptureTouch(r, c) {
  if (game.moveCaptureMode) {
    const p = pieceAt(r, c);
    const myColorStr = game.myColor === 1 ? 'black' : 'white';
    if (!p || p.color === myColorStr) {
      wx.showToast({ title: '请先揪掉对方棋子', icon: 'none' });
      return;
    }
    wsManager.send('linked_capture', { r, c });
    return;
  }
  const p = pieceAt(r, c);
  if (!p) return;
  const myColorStr = game.myColor === 1 ? 'black' : 'white';
  if (p.color === myColorStr) {
    wx.showToast({ title: '不能揪自己的棋子', icon: 'none' });
    return;
  }
  wsManager.send('capture_piece', { r, c });
}

function handleMoveTouch(r, c) {
  if (game.moveCaptureMode) { handleCaptureTouch(r, c); return; }
  const p = pieceAt(r, c);
  if (!p) return;
  const myColorStr = game.myColor === 1 ? 'black' : 'white';
  if (p.color !== myColorStr) {
    wx.showToast({ title: '不能移动对方的棋子', icon: 'none' });
    return;
  }
  if (game.selectedPieceIndex < 0) {
    wx.showToast({ title: '请先选择要移动的棋子', icon: 'none' });
    return;
  }
  const piece = game.boardPieces[game.selectedPieceIndex];
  if (!piece) return;
  const isLegal = game.legalCells.some((cell) => cell.x === c && cell.y === r);
  if (!isLegal) {
    wx.showToast({ title: '只能向上下左右相邻空位移动', icon: 'none' });
    return;
  }
  wsManager.send('move_piece', { fromR: piece.r, fromC: piece.c, toR: r, toC: c });
}

function pieceAt(r, c) {
  return game.boardPieces.find((p) => p.r === r && p.c === c);
}

function requestDraw() {
  if (game.showDrawRequest) { wx.showToast({ title: '已有待处理的和棋请求', icon: 'none' }); return; }
  wx.showModal({
    title: '求和',
    content: '确定向对方求和吗？',
    success: (res) => {
      if (res.confirm) { wsManager.send('request_draw'); game.drawPaused = true; }
    },
  });
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs: () => {} };
