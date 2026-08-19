/**
 * 下六儿 小游戏版 — 对局场景
 * （对应小程序版 pages/match/match，UI 由 WXML 改为 Canvas 绘制）
 * 设计风格：暖金棕国风（figma 设计稿）。
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const ui = require('../utils/ui');
const { PALETTE, drawText, drawButton, drawCard, drawAvatar, hit, roundRect, PIECE_SKINS } = ui;
const { setPieceSkin } = require('../state');
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
  showDrawRequest: false, showGiveUpConfirm: false, showSettings: false, boardFlipped: false,
  timerText: '00:00', timeLow: false, timerProgress: 100,
};

let boardGeo = { ox: 0, oy: 0, step: 0, size: 0 };

// 各阶段标识底色（设计稿：蓝/红/绿/金）
const PHASE_COLORS = {
  place: PALETTE.blue,
  capture: PALETTE.red,
  move: PALETTE.green,
  settled: PALETTE.gold,
};

function calcTimerProgress(remainingTime) {
  const total = game.timeTotal || 15;
  const t = Math.max(0, Math.min(total, remainingTime || 0));
  return Math.round((t / total) * 100);
}

function onEnter(payload) {
  const gameData = (payload && payload.gameId) ? payload : state.currentGame;
  // 进入新对局前，先清掉旧对局残留的 WS 监听器，避免收到旧消息
  removeWs();
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
  const timeTotalSec = Math.ceil((gameData.timeLimit || 15000) / 1000); // 统一为秒
  const remainingTime = gameData.remainingTime || timeTotalSec;
  const phase = gameCore.resolveStage(gameData.stage);

  Object.assign(game, {
    gameId: gameData.gameId, phase,
    phaseLabel: gameCore.STAGE_LABELS[phase] || '下子阶段',
    currentTurn: gameData.currentTurn, myColor, myOpenid,
    myInfo: { nickName: myInfo.nickName || '', avatarUrl: myInfo.avatarUrl || '', rankScore: myInfo.rankScore || 0 },
    opponentInfo: { nickName: oppInfo.nickName || '', avatarUrl: oppInfo.avatarUrl || '', rankScore: oppInfo.rankScore || 0 },
    myTurn, boardFlipped, remainingTime, timeTotal: timeTotalSec,
    timerText: gameCore.formatTime(remainingTime),
    timeLow: remainingTime > 0 && remainingTime <= 10,
    timerProgress: calcTimerProgress(remainingTime),
    catchNums: { black: 0, white: 0 }, board: [], boardPieces: [],
    legalCells: [], selectedPieceIndex: -1, skipAvailable: false,
    showSettle: false, drawPaused: false, showDrawRequest: false, showGiveUpConfirm: false, showSettings: false,
  });

  updateBoardPieces(gameData.board || []);
  updateCatchNums(gameData.catchNums || { black: 0, white: 0 });
  registerWs();
  state.currentGame = null;
}

function onLeave() {
  // 如果用户主动离开对局且尚未结算，自动判负（避免对手无限等待）
  if (game.phase !== 'settled' && game.gameId) {
    wsManager.send('give_up');
  }
  removeWs();
}

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
  wsManager.on('game_snapshot', onGameSnapshot);
  wsManager.on('timeout_warning', () => wx.showToast({ title: '已超时，系统将自动操作', icon: 'none' }));
  wsManager.on('resource_update', onResourceUpdate);
  wsManager.on('error', onError);
  wsManager.on('opponent_disconnected', () => wx.showToast({ title: '对手已掉线，30秒后判你胜', icon: 'none' }));
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
  wsManager.off('game_snapshot', onGameSnapshot);
  wsManager.off('timeout_warning');
  wsManager.off('resource_update', onResourceUpdate);
  wsManager.off('opponent_disconnected');
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
  // 只处理当前对局的结算，忽略旧对局/其它对局的消息
  if (data && data.gameId && game.gameId && data.gameId !== game.gameId) {
    console.log('[Match] 收到非当前对局的结算消息，已忽略:', data.gameId);
    return;
  }
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

function onGameSnapshot(data) {
  console.log('[Match] 收到游戏快照，恢复对局状态');
  const payload = data && data.gameId ? data : state.currentGame;
  if (!payload) return;
  state.currentGame = payload;
  sceneMgr.goto('match', payload);
}

function onResourceUpdate(data) {
  if (data.energy !== undefined) state.energy.current = data.energy;
  if (data.energyRecoverAt !== undefined) state.energy.nextRecoverAt = data.energyRecoverAt;
  if (data.energyMax !== undefined) state.energy.max = data.energyMax;
  if (data.rankScore !== undefined) state.rankScore = data.rankScore;
  if (data.rankName) state.rankName = data.rankName;
}

function onError(data) {
  const msg = data && data.errMsg ? data.errMsg : '操作失败';
  // 对局状态丢失时，先尝试 reconnect 同步快照，避免误弹窗
  if (msg.indexOf('不在对局') >= 0 || msg.indexOf('未找到') >= 0) {
    if (!game._reconnectTried) {
      game._reconnectTried = true;
      console.log('[Match] 收到未找到对局错误，尝试 reconnect');
      wsManager.send('reconnect', { gameId: game.gameId });
      // 2 秒后若仍处于异常则提示返回
      setTimeout(() => {
        if (game.phase !== 'settled') {
          wx.showModal({
            title: '对局已结束',
            content: '当前对局已不在进行中，请返回大厅重新开始。',
            showCancel: false,
            success: () => sceneMgr.goto('home'),
          });
        }
      }, 2000);
      return;
    }
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

  drawPlayerCards(ctx);
  drawBottomActions(ctx);

  if (game.showDrawRequest) drawDrawRequest(ctx);
  if (game.showGiveUpConfirm) drawGiveUpConfirm(ctx);
  if (game.showSettings) drawSetModal(ctx);
  if (game.showSettle) drawSettle(ctx);
}

// 设置弹窗：音效/震动开关 + 棋子皮肤选择（四套预览，含树枝·石子组合）
function drawSetModal(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.86, ph = Math.max(400, Math.round(H * 0.64)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 18 });
  drawText(ctx, '对局设置', W / 2, py + 34, { fontSize: 30,
    color: PALETTE.text, align: 'center', bold: true });

  // 棋子皮肤（2 列 × 2 行）
  drawText(ctx, '棋子皮肤', px + 24, py + 78, { fontSize: 22,
    color: PALETTE.textDim, align: 'left' });
  drawText(ctx, '材质组合', px + 24, py + 102, { fontSize: 13,
    color: PALETTE.textDim, align: 'left' });
  const skins = ['classic', 'warm', 'nature', 'twig'];
  const cols = 2;
  const gap = 16;
  const sw = (pw - 48 - gap) / cols;
  const sh = 96;
  rects.skinBtns = [];
  skins.forEach((key, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const bx = px + 24 + c * (sw + gap);
    const by = py + 120 + r * (sh + gap);
    const selected = state.pieceSkin === key;
    drawCard(ctx, { x: bx, y: by, w: sw, h: sh, radius: 12,
      border: selected ? PALETTE.green : PALETTE.panelBorder,
      borderWidth: selected ? 3 : 1.5 });
    // 黑白两子预览
    ui.drawPiece(ctx, { x: bx + sw / 2 - 18, y: by + 38, r: 15, color: 'black', skinKey: key });
    ui.drawPiece(ctx, { x: bx + sw / 2 + 18, y: by + 38, r: 15, color: 'white', skinKey: key });
    drawText(ctx, ui.PIECE_SKINS[key].label, bx + sw / 2, by + 78,
      { fontSize: 18, color: PALETTE.text, align: 'center' });
    rects.skinBtns.push({ x: bx, y: by, w: sw, h: sh, key });
  });

  // 关闭
  rects.closeSettings = drawButton(ctx, { text: '完成', x: px + 24, y: py + ph - 64,
    w: pw - 48, h: 48, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 24 });
}

// 段位名（依据积分区间，与服务端 config 一致）
function rankNameFromScore(score) {
  const s = score || 0;
  if (s < 200) return '初级小六';
  if (s < 400) return '中级小六';
  if (s < 600) return '高级小六';
  if (s < 800) return '初级老六';
  if (s < 1000) return '中级老六';
  if (s < 1200) return '高级老六';
  return '资深老六';
}

// 双方姓名卡 + 15秒倒计时环 + 棋子数/段位 + 执子颜色
// 布局（参照 figma 对局页）：对手卡在棋盘上方、己方卡在棋盘下方，整体垂直居中。
function drawPlayerCards(ctx) {
  const pad = 14;
  const cardH = 56;
  const sbh = state.statusBarHeight;

  // 阶段标签
  drawStagePill(ctx);

  // 棋盘尺寸：受限并留足间隔，避免超出屏幕/与姓名板重叠
  const boardSize = Math.max(150, Math.min(W - 108, 235, (H - 240) * 0.5));

  // 垂直居中的可用区间：阶段标签之下 → 底部操作区(含跳过按钮)之上
  // 注：drawBoard 的棋盘外卡自带 16px 边距，坐标计算需为它留空间
  const availTop = sbh + 48;
  const availBottom = H - 88 - 48 - 56; // 底部操作区 + 跳过按钮预留
  const totalH = cardH + 18 + (boardSize + 32) + 18 + cardH; // 含棋盘卡16*2边距
  let startTop = availTop + (availBottom - availTop - totalH) / 2;
  startTop = Math.max(startTop, availTop);

  const oppTop = startTop;
  drawPlayerCard(ctx, {
    x: pad, y: oppTop, w: W - pad * 2, h: cardH,
    name: game.opponentInfo.nickName || '对手',
    avatar: game.opponentInfo.avatarUrl || '',
    rank: game.opponentInfo.rankScore || 0,
    remain: game.opponentRemainText,
    remainNum: game.opponentCatchNum,
    isMy: false, isTurn: !game.myTurn,
    pieceColor: game.myColor === 1 ? 'white' : 'black',
  });

  const boardTop = oppTop + cardH + 18; // 18px 间隔，避开棋盘外卡 16px 边距
  drawBoard(ctx, boardTop, boardSize);

  drawPlayerCard(ctx, {
    x: pad, y: boardTop + boardSize + 18 + 32, w: W - pad * 2, h: cardH,
    name: game.myInfo.nickName || '我',
    avatar: game.myInfo.avatarUrl || '',
    rank: game.myInfo.rankScore || 0,
    remain: game.myRemainText,
    remainNum: game.myCatchNum,
    isMy: true, isTurn: game.myTurn,
    pieceColor: game.myColor === 1 ? 'black' : 'white',
  });
}

function drawPlayerCard(ctx, o) {
  drawCard(ctx, { x: o.x, y: o.y, w: o.w, h: o.h, radius: 14,
    border: o.isTurn ? PALETTE.gold : PALETTE.panelBorder });
  const cy = o.y + o.h / 2;

  // 头像（右下角叠加执子颜色小圆）
  drawAvatar(ctx, { x: o.x + 30, y: cy, r: 20, label: o.name, avatar: o.avatar || '', ring: o.isTurn });
  // 执子颜色小圆（头像右下角），颜色联动当前棋子皮肤
  const skin = ui.PIECE_SKINS[state.pieceSkin] || ui.PIECE_SKINS.classic;
  const pieceC = o.pieceColor === 'black' ? skin.black : skin.white;
  const markX = o.x + 48, markY = cy + 16, markR = 9;
  ctx.beginPath();
  ctx.arc(markX, markY, markR, 0, Math.PI * 2);
  ctx.fillStyle = pieceC.fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pieceC.stroke;
  ctx.stroke();

  // 名字 + 段位
  drawText(ctx, o.name, o.x + 62, cy - 9, { color: PALETTE.text, fontSize: 18, bold: true });
  drawText(ctx, '段位 ' + rankNameFromScore(o.rank), o.x + 62, cy + 14, { color: PALETTE.textDim, fontSize: 14 });

  // 右侧倒计时环（当前回合方显示剩余秒数并高亮，非回合方置灰）
  const cdR = 13;
  const cdX = o.x + o.w - 24;
  const cdY = cy;
  const cdColor = o.isTurn ? (game.timeLow ? PALETTE.red : PHASE_COLORS[game.phase] || PALETTE.gold) : PALETTE.panelBorder;
  ctx.beginPath();
  ctx.arc(cdX, cdY, cdR, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = cdColor;
  ctx.stroke();
  const cdText = o.isTurn ? String(Math.ceil(game.remainingTime || 0)) : '--';
  drawText(ctx, cdText, cdX, cdY + 1, { color: cdColor, fontSize: 13, align: 'center', baseline: 'middle', bold: o.isTurn });
  drawText(ctx, '秒', cdX, cdY + cdR + 12, { color: PALETTE.textDim, fontSize: 9, align: 'center', baseline: 'middle' });

  // 右侧：棋子 XX/18 + 可揪/剩余
  const badgeW = 60;
  const badgeX = o.x + o.w - 24 - cdR * 2 - 16 - badgeW;
  roundRect(ctx, badgeX, cy - 22, badgeW, 20, 10);
  ctx.fillStyle = o.isTurn ? 'rgba(139,105,20,0.10)' : '#F2EEE6';
  ctx.fill();
  drawText(ctx, '棋子 ' + o.remain, badgeX + badgeW / 2, cy - 12, {
    color: PALETTE.text, fontSize: 11, align: 'center', baseline: 'middle',
  });
  const remText = game.phase === 'move' ? '剩余 ' + o.remainNum : '可揪 ' + o.remainNum;
  const remColor = game.phase === 'move' ? PALETTE.green : PALETTE.gold;
  roundRect(ctx, badgeX, cy + 2, badgeW, 20, 10);
  ctx.fillStyle = o.isTurn ? 'rgba(139,105,20,0.10)' : '#F2EEE6';
  ctx.fill();
  drawText(ctx, remText, badgeX + badgeW / 2, cy + 12, {
    color: remColor, fontSize: 11, align: 'center', baseline: 'middle',
  });
}

// 阶段标识（居中醒目，按阶段变色）
function drawStagePill(ctx) {
  const pw = 150;
  const ph = 32;
  const px = (W - pw) / 2;
  const py = state.statusBarHeight + 10;
  const color = PHASE_COLORS[game.phase] || PALETTE.gold;

  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = color;
  ctx.fill();
  drawText(ctx, game.phaseLabel, W / 2, py + ph / 2 + 1, {
    color: '#FFFFFF', fontSize: 20, align: 'center', bold: true,
  });
}

function drawBoard(ctx, topY, size) {
  const ox = (W - size) / 2;
  const oy = topY;
  const step = size / 5;
  boardGeo = { ox, oy, step, size };

  drawCard(ctx, { x: ox - 16, y: oy - 16, w: size + 32, h: size + 32, radius: 16 });

  // 棋盘点（深棕描边风格）
  ctx.fillStyle = PALETTE.boardDot;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.beginPath();
      ctx.arc(ox + c * step, oy + r * step, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const myColorStr = game.myColor === 1 ? 'black' : 'white';
  const pulse = (Date.now() % 1200) / 1200;

  game.boardPieces.forEach((p) => {
    const px = ox + p.c * step;
    const py = oy + p.r * step;
    const radius = step * 0.42; // 放大棋子以提升点击命中（设计稿 36px 基准）
    const isCapturable = game.phase === 'capture' && !game.moveCaptureMode && p.color !== myColorStr;
    const isSelected = game.phase === 'move' && p.selected;
    ui.drawPiece(ctx, {
      x: px, y: py, r: radius,
      color: p.color,
      skinKey: state.pieceSkin,
      selected: isSelected,
      capturable: isCapturable,
      formed: p.formed,
      pulse,
    });
  });

  // 走子阶段合法落点：浅绿虚线圈
  if (game.phase === 'move' && game.legalCells && game.legalCells.length) {
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(74,184,106,0.9)';
    game.legalCells.forEach((cell) => {
      ctx.beginPath();
      ctx.arc(ox + cell.x * step, oy + cell.y * step, step * 0.42 * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }
}

function drawBottomActions(ctx) {
  const btnW = (W - 80) / 3;
  const btnH = 48;
  const y = H - 88;
  const gap = 20;
  rects.actionBtns = [];

  const defs = [
    { text: '求和', color: PALETTE.gold },
    { text: '认输', color: PALETTE.red },
    { text: '设置', color: PALETTE.gold },
  ];
  defs.forEach((d, i) => {
    rects.actionBtns.push(drawButton(ctx, {
      text: d.text, x: 20 + i * (btnW + gap), y, w: btnW, h: btnH,
      fill: PALETTE.panel, textColor: d.color, fontSize: 20, border: d.color,
    }));
  });

  if (game.skipAvailable || game.moveCaptureMode) {
    rects.skipBtn = drawButton(ctx, { text: '跳过连揪', x: (W - 160) / 2, y: y - 52, w: 160, h: 42,
      fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
  } else {
    rects.skipBtn = null;
  }
}

function drawDrawRequest(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.8, ph = Math.max(200, Math.round(H * 0.34)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });
  drawText(ctx, '对方请求求和', W / 2, py + 70, { color: PALETTE.text, fontSize: 30, align: 'center', bold: true });
  drawText(ctx, game.drawRequestName || '', W / 2, py + 110, { color: PALETTE.textDim, fontSize: 22, align: 'center' });
  rects.acceptDraw = drawButton(ctx, { text: '同意', x: px + 30, y: py + ph - 80, w: (pw - 90) / 2, h: 56,
    fill: PALETTE.green, textColor: '#FFFFFF', fontSize: 26 });
  rects.rejectDraw = drawButton(ctx, { text: '拒绝', x: px + 60 + (pw - 90) / 2, y: py + ph - 80, w: (pw - 90) / 2, h: 56,
    fill: PALETTE.panel, textColor: PALETTE.red, fontSize: 26, border: PALETTE.red });
}

function drawGiveUpConfirm(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.8, ph = Math.max(180, Math.round(H * 0.30)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });
  drawText(ctx, '确定认输吗？', W / 2, py + 80, { color: PALETTE.text, fontSize: 30, align: 'center', bold: true });
  rects.confirmGiveUp = drawButton(ctx, { text: '确定', x: px + 30, y: py + ph - 80, w: (pw - 90) / 2, h: 56,
    fill: PALETTE.red, textColor: '#FFFFFF', fontSize: 26 });
  rects.cancelGiveUp = drawButton(ctx, { text: '取消', x: px + 60 + (pw - 90) / 2, y: py + ph - 80, w: (pw - 90) / 2, h: 56,
    fill: PALETTE.panel, textColor: PALETTE.text, fontSize: 26, border: PALETTE.panelBorder });
}

function drawSettle(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.6)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.82, ph = Math.max(280, Math.round(H * 0.46)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  const titleMap = { win: '胜利！', lose: '惜败', draw: '平局' };
  const titleColor = { win: PALETTE.gold, lose: PALETTE.red, draw: PALETTE.text }[game.myResult] || PALETTE.text;
  drawText(ctx, titleMap[game.myResult] || '对局结束', W / 2, py + 70, { color: titleColor, fontSize: 40, align: 'center', bold: true });
  drawText(ctx, (game.scoreChange >= 0 ? '+' : '') + game.scoreChange + ' 积分', W / 2, py + 120, { color: PALETTE.text, fontSize: 26, align: 'center' });
  if (game.rankName) drawText(ctx, '新段位：' + game.rankName, W / 2, py + 160, { color: PALETTE.textDim, fontSize: 22, align: 'center' });

  rects.settleBack = drawButton(ctx, { text: '返回大厅', x: px + 30, y: py + ph - 80, w: pw - 60, h: 56,
    fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 26 });
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
  if (game.showSettings) {
    if (rects.skinBtns) {
      for (const b of rects.skinBtns) {
        if (hit(b, x, y)) {
          setPieceSkin(b.key);
          game.showSettings = false;
          return;
        }
      }
    }
    if (hit(rects.closeSettings, x, y)) { game.showSettings = false; return; }
    return;
  }

  if (hit(rects.skipBtn, x, y) && (game.skipAvailable || game.moveCaptureMode)) {
    wsManager.send('skip_capture');
    return;
  }

  if (rects.actionBtns) {
    if (hit(rects.actionBtns[0], x, y)) { requestDraw(); return; }
    if (hit(rects.actionBtns[1], x, y)) { game.showGiveUpConfirm = true; return; }
    if (hit(rects.actionBtns[2], x, y)) { game.showSettings = true; return; }
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
  const myColorStr = game.myColor === 1 ? 'black' : 'white';

  // 点击己方棋子：选中并高亮可移动位置
  if (p && p.color === myColorStr) {
    const idx = game.boardPieces.findIndex((piece) => piece.r === r && piece.c === c);
    if (idx >= 0) selectPiece(idx);
    return;
  }

  if (game.selectedPieceIndex < 0) {
    wx.showToast({ title: '请先选择要移动的棋子', icon: 'none' });
    return;
  }

  if (p && p.color !== myColorStr) {
    wx.showToast({ title: '不能移动对方的棋子', icon: 'none' });
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

function selectPiece(index) {
  game.boardPieces.forEach((p, i) => { p.selected = (i === index); });
  game.selectedPieceIndex = index;
  const piece = game.boardPieces[index];
  if (!piece) {
    game.legalCells = [];
    return;
  }
  const moves = gameCore.computeLegalMoves(piece.r, piece.c, game.board || []);
  game.legalCells = moves.map((m) => ({ x: m.c, y: m.r }));
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
