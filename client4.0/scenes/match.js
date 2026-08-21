/**
 * 下六儿 小游戏版 — 对局场景
 * （对应小程序版 pages/match/match，UI 由 WXML 改为 Canvas 绘制）
 * 设计风格：暖金棕国风（figma 设计稿）。
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const ui = require('../utils/ui');
const { PALETTE, drawText, drawButton, drawCard, drawAvatar, hit, roundRect, PIECE_SKINS } = ui;
const gameCore = require('../utils/game-core');
const audio = require('../utils/audio');
const settingsModal = require('../utils/settings-modal');
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
  showDrawRequest: false, showRequestDraw: false, showGiveUpConfirm: false, showSettings: false, boardFlipped: false,
  timerText: '00:00', timeLow: false, timerProgress: 100,
};

let boardGeo = { ox: 0, oy: 0, step: 0, size: 0 };
// 本地倒计时 tick：用本地时间递减，保证秒数字每秒变化（不等服务端推）
let lastTickTs = 0;

// 各阶段配色（下子蓝/揪子红/走子绿）：每项含主色 main、深色 dark（渐变/阴影用）
const PHASE_COLORS = {
  place:   { main: '#3B82C4', dark: '#2A5F96' },  // 下子·蓝（高级靛蓝）
  capture: { main: '#D5484A', dark: '#A9383A' },  // 揪子·红（朱红）
  move:    { main: '#3FA768', dark: '#2C7D4E' },  // 走子·绿（青竹绿）
  settled: { main: PALETTE.gold, dark: '#6B5210' },
};

/** 获取当前阶段的配色对象 */
function phaseColor() {
  return PHASE_COLORS[game.phase] || PHASE_COLORS.settled;
}

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
    myInfo: { nickName: myInfo.nickName || '', avatarUrl: myInfo.avatarUrl || '', rankScore: myInfo.rankScore || 0, isBot: !!myInfo.isBot },
    opponentInfo: { nickName: oppInfo.nickName || '', avatarUrl: oppInfo.avatarUrl || '', rankScore: oppInfo.rankScore || 0, isBot: !!oppInfo.isBot },
    myTurn, boardFlipped, remainingTime, timeTotal: timeTotalSec,
    timerText: gameCore.formatTime(remainingTime),
    timeLow: remainingTime > 0 && remainingTime <= 10,
    timerProgress: calcTimerProgress(remainingTime),
    catchNums: { black: 0, white: 0 }, board: [], boardPieces: [],
    legalCells: [], selectedPieceIndex: -1, skipAvailable: false,
    showSettle: false, drawPaused: false, showDrawRequest: false, showRequestDraw: false, showGiveUpConfirm: false, showSettings: false,
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
  wsManager.on('timeout_warning', () => {
    wx.showToast({ title: '已超时，系统将自动操作', icon: 'none' });
    audio.playTick();
  });
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

  // 音效：根据上一步操作类型播放（lastMove.player 是执子方 color，action 是 place/move/capture）
  const lm = data.lastMove;
  if (lm && typeof lm.action === 'string') {
    if (lm.action === 'place') audio.playPlace();
    else if (lm.action === 'move') audio.playMove();
    // capture 由 updateCatchNums 内部的"我方被揪"逻辑播放 playCaptured+震动
  }
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
  // 结算音效 + 震动反馈
  if (myResult === 'win') { audio.playWin(); audio.vibrate(30); }
  else if (myResult === 'draw') { audio.playDraw(); }
  else { audio.playLose(); audio.vibrate(15); }
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
  // 过滤良性/瞬时错误（请先登录等重连竞态），不打断正常游戏
  if (msg === '请先登录' || /未知指令/.test(msg)) return;
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
  const prevOpp = game.opponentCatchNum || 0;
  game.catchNums = catchNums;
  game.myCatchNum = myColor === 1 ? (catchNums.black || 0) : (catchNums.white || 0);
  game.opponentCatchNum = myColor === 1 ? (catchNums.white || 0) : (catchNums.black || 0);
  // 我方棋子被揪走：触发被揪音效 + 震动
  if (game.opponentCatchNum > prevOpp) {
    audio.playCaptured();
    audio.vibrate(20);
  }
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
  // ctx.canvas.width 为物理尺寸，需除以像素比得到逻辑尺寸
  const pr = state.pixelRatio || 1;
  W = ctx.canvas.width / pr;
  H = ctx.canvas.height / pr;

  // 本地倒计时自减：保证环形进度和秒数字每秒实时变化
  const nowTs = Date.now();
  if (lastTickTs > 0) {
    const dt = (nowTs - lastTickTs) / 1000;
    if (dt > 0 && game.remainingTime > 0) {
      game.remainingTime = Math.max(0, game.remainingTime - dt);
      game.timeLow = game.remainingTime > 0 && game.remainingTime <= 10;
      game.timerProgress = calcTimerProgress(game.remainingTime);
    }
  }
  lastTickTs = nowTs;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawPlayerCards(ctx);
  drawBottomActions(ctx);

  // 设置 rects.W/H（逻辑尺寸），供所有弹窗（drawDrawRequest/drawSetModal/drawSettle 等）使用
  rects.W = W; rects.H = H;

  if (game.showDrawRequest) drawDrawRequest(ctx);
  if (game.showRequestDraw) drawRequestDrawConfirm(ctx);
  if (game.showGiveUpConfirm) drawGiveUpConfirm(ctx);
  if (game.showSettings) drawSetModal(ctx);
  if (game.showSettle) drawSettle(ctx);
}

// 设置弹窗：统一复用通用设置组件（音乐/音效/震动开关 + 棋子皮肤）
function drawSetModal(ctx) {
  settingsModal.drawSettingsModal(ctx, rects, { title: '对局设置' });
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
  const cardH = 66;      // 姓名板加高，更有质感
  const cardGap = 26;    // 姓名板与棋盘之间的间隔
  const sbh = state.statusBarHeight;

  // 阶段标签
  drawStagePill(ctx);

  // 棋盘尺寸：更大（参考 figma 走子阶段棋盘 250px 外层卡），但受屏高限制
  const boardSize = Math.max(160, Math.min(W - 92, 258, (H - 270) * 0.52));

  // 垂直居中的可用区间：阶段标签之下 → 底部操作区(含跳过按钮)之上
  // 注：drawBoard 的棋盘外卡自带 pad*2 边距，坐标计算需为它留空间
  const availTop = sbh + 48;
  const availBottom = H - 88 - 48 - 56; // 底部操作区 + 跳过按钮预留
  const totalH = cardH + cardGap + (boardSize + 36) + cardGap + cardH; // 含棋盘外卡18*2边距
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

  const boardTop = oppTop + cardH + cardGap; // 加大的间隔
  drawBoard(ctx, boardTop, boardSize);

  drawPlayerCard(ctx, {
    x: pad, y: boardTop + boardSize + cardGap + 18, w: W - pad * 2, h: cardH,
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
  // 当前操作方：阶段色加粗边框 + 明显底色（更强的立体区分）
  const isActive = o.isTurn;
  const pc = phaseColor();
  const activeColor = pc.main;
  const borderColor = isActive ? activeColor : PALETTE.panelBorder;
  const borderWidth = isActive ? 3 : 1.5;
  if (isActive) {
    // 更明显的底色 + 顶部渐变（阶段色淡化）
    roundRect(ctx, o.x, o.y, o.w, o.h, 14);
    const bg = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
    bg.addColorStop(0, 'rgba(255,255,255,0)');
    bg.addColorStop(1, hexToRgba(activeColor, 0.16));
    ctx.fillStyle = bg;
    ctx.fill();
    // 左侧阶段色竖条（强调当前操作方）
    roundRect(ctx, o.x, o.y + 10, 4, o.h - 20, 2);
    ctx.fillStyle = activeColor;
    ctx.fill();
  }
  drawCard(ctx, { x: o.x, y: o.y, w: o.w, h: o.h, radius: 14,
    border: borderColor, borderWidth: borderWidth });
  const cy = o.y + o.h / 2;

  // 头像
  drawAvatar(ctx, { x: o.x + 32, y: cy, r: 22, label: o.name, avatar: o.avatar || '', ring: isActive });
  // 右下角执子标识：用当前皮肤的真实形状绘制（树枝/石子/圆），皮肤联动
  ui.drawPiece(ctx, {
    x: o.x + 53, y: cy + 18, r: 9,
    color: o.pieceColor, skinKey: state.pieceSkin,
  });

  // 名字 + 段位（去掉"段位"前缀，改为"段位名 · 积分"）
  const displayName = (o.isBot ? '🤖 ' : '') + o.name;
  drawText(ctx, displayName, o.x + 64, cy - 9, { color: PALETTE.text, fontSize: 19, bold: true });
  drawText(ctx, rankNameFromScore(o.rank) + ' · ' + (o.rank || 0), o.x + 64, cy + 14, {
    color: PALETTE.textDim, fontSize: 14,
  });
  // 机器人角标：昵称右侧增加"机器人"小标签（后续正式上线时删除此块即可）
  if (o.isBot) {
    const tagText = '机器人';
    const tagW = 44, tagH = 18, tagX = o.x + 64 + (o.name ? o.name.length * 19 + 8 : 0), tagY = cy - 18;
    roundRect(ctx, tagX, tagY, tagW, tagH, 9);
    ctx.fillStyle = '#8A6FB0';
    ctx.fill();
    drawText(ctx, tagText, tagX + tagW / 2, tagY + tagH / 2, { color: '#FFFFFF', fontSize: 11, align: 'center', baseline: 'middle', bold: true });
  }

  // 右侧倒计时环（当前回合方用阶段色 + 数字，非回合方置灰）
  const cdR = 14;
  const cdX = o.x + o.w - 30;
  const cdY = cy;
  const cdColor = o.isTurn ? (game.timeLow ? PALETTE.red : activeColor) : PALETTE.panelBorder;
  const cdPct = o.isTurn ? Math.max(0, Math.min(1, (game.remainingTime || 0) / (game.timeTotal || 15))) : 0;
  // 底层轨道
  ctx.beginPath();
  ctx.arc(cdX, cdY, cdR, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = o.isTurn ? 'rgba(0,0,0,0.08)' : PALETTE.panelBorder;
  ctx.stroke();
  // 进度弧（阶段色）
  if (o.isTurn && cdPct > 0) {
    ctx.beginPath();
    ctx.arc(cdX, cdY, cdR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdPct, false);
    ctx.lineWidth = 3;
    ctx.strokeStyle = cdColor;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // 圆内数字（阶段色）
  const cdText = o.isTurn ? String(Math.ceil(game.remainingTime || 0)) : '--';
  drawText(ctx, cdText, cdX, cdY + 1, { color: cdColor, fontSize: 13, align: 'center', baseline: 'middle', bold: o.isTurn });
  // "秒"字移到圆圈右边，但缩进卡内避免溢出
  const cdTextW = ctx.measureText(cdText).width;
  const secX = cdX + cdR + 6;
  const rightPad = 8;
  if (secX + 14 < o.x + o.w - rightPad) {
    drawText(ctx, '秒', secX, cdY, { color: PALETTE.textDim, fontSize: 11, align: 'left', baseline: 'middle' });
  }

  // 右侧：棋子 XX/18 + 可揪/剩余
  const badgeW = 58;
  const badgeX = cdX - cdR - 8 - badgeW;
  roundRect(ctx, badgeX, cy - 24, badgeW, 20, 10);
  ctx.fillStyle = o.isTurn ? 'rgba(0,0,0,0.05)' : '#F2EEE6';
  ctx.fill();
  drawText(ctx, '棋子 ' + o.remain, badgeX + badgeW / 2, cy - 14, {
    color: PALETTE.text, fontSize: 11, align: 'center', baseline: 'middle',
  });
  // 可揪/剩余：可揪>0 用阶段色；剩余用绿
  const remText = game.phase === 'move' ? '剩余 ' + o.remainNum : '可揪 ' + o.remainNum;
  let remColor = PALETTE.textDim;
  if (game.phase === 'move') {
    remColor = PALETTE.green;
  } else {
    remColor = (o.remainNum > 0) ? activeColor : PALETTE.textDim;
  }
  roundRect(ctx, badgeX, cy, badgeW, 20, 10);
  ctx.fillStyle = o.isTurn ? 'rgba(0,0,0,0.05)' : '#F2EEE6';
  ctx.fill();
  drawText(ctx, remText, badgeX + badgeW / 2, cy + 10, {
    color: remColor, fontSize: 11, align: 'center', baseline: 'middle',
  });
}

/** 十六进制色转 rgba */
function hexToRgba(hex, alpha) {
  try {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  } catch (e) { return hex; }
}

// 阶段标识（居中醒目，按阶段变色，带立体感）
function drawStagePill(ctx) {
  const pw = 150;
  const ph = 34;
  const px = (W - pw) / 2;
  const py = state.statusBarHeight + 10;
  const pc = phaseColor();
  const color = pc.main;
  const dark = pc.dark;

  // 底部阴影（立体感，用深色）
  roundRect(ctx, px, py + 3, pw, ph, ph / 2);
  ctx.fillStyle = 'rgba(60,47,40,0.22)';
  ctx.fill();
  // 主体（垂直渐变：上亮下深，更有质感）
  const g = ctx.createLinearGradient(0, py, 0, py + ph);
  g.addColorStop(0, color);
  g.addColorStop(1, dark);
  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = g;
  ctx.fill();
  // 顶部高光线
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph - 2, pw / 2 - 4, Math.PI, 0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.stroke();
  // 文字垂直居中
  drawText(ctx, game.phaseLabel, W / 2, py + ph / 2 + 1, {
    color: '#FFFFFF', fontSize: 20, align: 'center', baseline: 'middle', bold: true,
  });
}

function drawBoard(ctx, topY, size) {
  const ox = (W - size) / 2;
  const oy = topY;
  const step = size / 5;
  boardGeo = { ox, oy, step, size };

  // 外层白底圆角卡（参照 figma 走子阶段棋盘）
  const pad = 18;
  drawCard(ctx, { x: ox - pad, y: oy - pad, w: size + pad * 2, h: size + pad * 2, radius: 16 });
  // 棋盘暖米色底（figma board-bg #E8DBCF）
  roundRect(ctx, ox, oy, size, size, 8);
  ctx.fillStyle = '#E8DBCF';
  ctx.fill();

  // 深棕闭合网格线（figma #3C2F28, 1.5px）
  ctx.strokeStyle = '#3C2F28';
  ctx.lineWidth = 1.5;
  // 外框（闭合，略粗）
  ctx.strokeRect(ox, oy, size, size);
  // 内线
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(ox + i * step, oy);
    ctx.lineTo(ox + i * step, oy + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, oy + i * step);
    ctx.lineTo(ox + size, oy + i * step);
    ctx.stroke();
  }

  // 交叉点（figma board-dot #C0B8A8）
  ctx.fillStyle = '#C0B8A8';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.beginPath();
      ctx.arc(ox + c * step, oy + r * step, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const myColorStr = game.myColor === 1 ? 'black' : 'white';
  const pulse = (Date.now() % 1200) / 1200;

  game.boardPieces.forEach((p) => {
    const px = ox + p.c * step;
    const py = oy + p.r * step;
    const radius = step * 0.36; // 棋子略缩小，更清爽
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

// 统一的二次确认弹窗（认输风格）：淡雅、字号偏小、按钮全宽圆角
function drawConfirmModal(ctx, opts) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.76, ph = Math.max(160, Math.round(H * 0.26));
  const px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 18 });
  // 标题（缩小、淡雅）
  drawText(ctx, opts.title || '', W / 2, py + 50, { color: PALETTE.text, fontSize: 18, align: 'center', bold: true });
  if (opts.subtitle) {
    drawText(ctx, opts.subtitle, W / 2, py + 78, { color: PALETTE.textDim, fontSize: 14, align: 'center' });
  }
  // 双按钮（全宽圆角，主按钮金色描边/副按钮红色描边，缩小字号）
  const btnY = py + ph - 56;
  const btnGap = 14;
  const btnW = (pw - 28 - btnGap) / 2;
  const btnH = 40;
  rects[opts.confirmKey] = drawButton(ctx, {
    text: opts.confirmText || '确定',
    x: px + 14, y: btnY, w: btnW, h: btnH,
    fill: PALETTE.panel, textColor: opts.confirmColor || PALETTE.gold,
    fontSize: 16, border: opts.confirmColor || PALETTE.gold,
  });
  rects[opts.cancelKey] = drawButton(ctx, {
    text: opts.cancelText || '取消',
    x: px + 14 + btnW + btnGap, y: btnY, w: btnW, h: btnH,
    fill: PALETTE.panel, textColor: PALETTE.textDim,
    fontSize: 16, border: PALETTE.panelBorder,
  });
}

function drawDrawRequest(ctx) {
  // 对方求和请求（接收方）：主按钮=同意（绿色）、副按钮=拒绝
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
  const pw = W * 0.76, ph = Math.max(180, Math.round(H * 0.28));
  const px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 18 });
  drawText(ctx, '对方请求求和', W / 2, py + 50, { color: PALETTE.text, fontSize: 18, align: 'center', bold: true });
  drawText(ctx, game.drawRequestName || '', W / 2, py + 78, { color: PALETTE.textDim, fontSize: 14, align: 'center' });
  const btnY = py + ph - 56;
  const btnGap = 14;
  const btnW = (pw - 28 - btnGap) / 2;
  const btnH = 40;
  rects.acceptDraw = drawButton(ctx, { text: '同意', x: px + 14, y: btnY, w: btnW, h: btnH,
    fill: PALETTE.panel, textColor: PALETTE.green, fontSize: 16, border: PALETTE.green });
  rects.rejectDraw = drawButton(ctx, { text: '拒绝', x: px + 14 + btnW + btnGap, y: btnY, w: btnW, h: btnH,
    fill: PALETTE.panel, textColor: PALETTE.red, fontSize: 16, border: PALETTE.red });
}

function drawRequestDrawConfirm(ctx) {
  drawConfirmModal(ctx, {
    title: '确定向对方求和吗？',
    confirmKey: 'confirmRequestDraw',
    cancelKey: 'cancelRequestDraw',
    confirmText: '求和',
    cancelText: '取消',
    confirmColor: PALETTE.gold,
  });
}

function drawGiveUpConfirm(ctx) {
  drawConfirmModal(ctx, {
    title: '确定认输吗？',
    confirmKey: 'confirmGiveUp',
    cancelKey: 'cancelGiveUp',
    confirmText: '认输',
    cancelText: '取消',
    confirmColor: PALETTE.red,
  });
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
  if (game.showRequestDraw) {
    if (hit(rects.confirmRequestDraw, x, y)) { wsManager.send('request_draw'); game.drawPaused = true; game.showRequestDraw = false; }
    else if (hit(rects.cancelRequestDraw, x, y)) { game.showRequestDraw = false; }
    return;
  }
  if (game.showSettings) {
    const r = settingsModal.onSettingsTouch(x, y, rects);
    if (r === 'close') { game.showSettings = false; return; }
    return; // 'changed' 或 null 都拦截，不穿透到棋盘
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
    audio.playPlace();       // 落子音效
    audio.vibrate(15);
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
    audio.playCapture();
    audio.vibrate(20);
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
  audio.playCapture();
  audio.vibrate(20);
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
  audio.playMove();
  audio.vibrate(15);
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
  if (game.drawPaused) { wx.showToast({ title: '等待对方响应中...', icon: 'none' }); return; }
  game.showRequestDraw = true;
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs: () => {} };
