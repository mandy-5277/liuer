/**
 * 下六儿 小游戏版 — 对局场景
 * （对应小程序版 pages/match/match，UI 由 WXML 改为 Canvas 绘制）
 * 设计风格：暖金棕国风（figma 设计稿）。
 */

const { wsManager } = require('../utils/websocket');
const { state, syncUserData } = require('../state');
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
  reconnectRemaining: 0, // 对手掉线后判负倒计时（秒），>0 时显示非阻塞横幅
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
    showSettle: false, drawPaused: false, showDrawRequest: false, showRequestDraw: false, showGiveUpConfirm: false, showSettings: false, reconnectRemaining: 0,
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
  wsManager.on('opponent_disconnected', () => {
    // 启动非阻塞倒计时横幅：30s 后判我方胜（与 reconnectWindow 一致）
    game.reconnectRemaining = 30;
    audio.playTick();
  });
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
  // 换手检测：currentTurn 变化时，本回合重新从完整时长倒计时（服务端每次换手重置 15s）
  const turnChanged = data.currentTurn !== game.currentTurn;
  let remainingTime = data.remainingTime || 0;
  if (turnChanged) {
    remainingTime = game.timeTotal || 15; // 每次换手重新完整倒计时
  }
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

  // 兜底：应揪数多于对方实际可揪棋子（剩余皆成型），多余次数作废并自动跳过
  if (data.captureSkipped) {
    wx.showToast({ title: '对方已无可揪棋子，揪子已自动跳过', icon: 'none' });
  }

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
  // 阶段切换视为换手，重新从完整时长倒计时
  const remainingTime = game.timeTotal || 15;
  Object.assign(game, {
    phase,
    phaseLabel: gameCore.STAGE_LABELS[phase] || game.phaseLabel,
    currentTurn: data.currentTurn,
    remainingTime,
    timerText: gameCore.formatTime(remainingTime),
    timeLow: false,
    myTurn: data.currentTurn === game.myColor,
    legalCells: [], selectedPieceIndex: -1, skipAvailable: false,
  });
  updateBoardPieces(data.board || []);
  updateCatchNums(data.catchNums || { black: 0, white: 0 });

  // 兜底：进入揪子阶段时若某方应揪数多于对方实际可揪棋子，多余次数作废
  if (data.captureSkipped) {
    wx.showToast({ title: '对方已无可揪棋子，揪子已自动跳过', icon: 'none' });
  }
}

function onLinkedCapture(data) {
  // 换手检测：currentTurn 变化时重新完整倒计时
  const turnChanged = data.currentTurn !== game.currentTurn;
  let remainingTime = data.remainingTime || 0;
  if (turnChanged) remainingTime = game.timeTotal || 15;
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

  // 兜底：联动揪时对方已无可揪棋子，多余次数作废并自动跳过
  if (data.captureSkipped) {
    wx.showToast({ title: '对方已无可揪棋子，揪子已自动跳过', icon: 'none' });
  }
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
  // 结算后清除掉线倒计时横幅
  game.reconnectRemaining = 0;
  const myColor = game.myColor;
  let myResult = '';
  let scoreChange = 0;
  const endReason = data.endReason || '';
  if (data.result === 'black' && myColor === 1) { myResult = 'win'; scoreChange = data.blackRatingChange || 10; }
  else if (data.result === 'white' && myColor === 2) { myResult = 'win'; scoreChange = data.whiteRatingChange || 10; }
  else if (data.result === 'draw') { myResult = 'draw'; scoreChange = myColor === 1 ? (data.blackRatingChange || -1) : (data.whiteRatingChange || -1); }
  else { myResult = 'lose'; scoreChange = myColor === 1 ? (data.blackRatingChange || -3) : (data.whiteRatingChange || -3); }

  // 步数上限和棋兜底提示（长期拉锯自动判和，不扣分）
  if (endReason === 'stalemate') {
    wx.showToast({ title: '对局僵持，已按步数上限判和', icon: 'none' });
  }

  const rankKey = myColor === 1 ? 'blackNewRank' : 'whiteNewRank';
  const oldRankKey = myColor === 1 ? 'blackOldRank' : 'whiteOldRank';
  const upKey = myColor === 1 ? 'blackRankUp' : 'whiteRankUp';
  const downKey = myColor === 1 ? 'blackRankDown' : 'whiteRankDown';
  const rankScoreKey = myColor === 1 ? 'blackAfterScore' : 'whiteAfterScore';

  // 段位升降绚丽弹窗（提供爽感/情绪价值）
  let rankUpModal = null;
  if (data[upKey]) {
    rankUpModal = { show: true, up: true, rank: data[rankKey] || '', old: data[oldRankKey] || '', t: Date.now() };
  } else if (data[downKey]) {
    rankUpModal = { show: true, up: false, rank: data[rankKey] || '', old: data[oldRankKey] || '', t: Date.now() };
  }

  Object.assign(game, {
    showSettle: true,
    settleData: Object.assign({}, data, { endReason }),
    myResult, scoreChange, myTurn: false, drawPaused: false,
    phase: 'settled', phaseLabel: '已结束',
    rankName: data[rankKey] || '', rankScore: data[rankScoreKey] || 0,
    rankUpModal,
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
  // 对手已重连/快照恢复，清除掉线倒计时横幅
  game.reconnectRemaining = 0;
  state.currentGame = payload;
  sceneMgr.goto('match', payload);
}

function onResourceUpdate(data) {
  if (data.energy !== undefined) state.energy.current = data.energy;
  if (data.energyRecoverAt !== undefined) state.energy.nextRecoverAt = data.energyRecoverAt;
  if (data.energyMax !== undefined) state.energy.max = data.energyMax;
  if (data.rankScore !== undefined) state.rankScore = data.rankScore;
  if (data.rankName) state.rankName = data.rankName;
  // 同步场次/胜率（服务端 finalizeGame 后会推送 winCount/loseCount/drawCount/winRate）
  syncUserData(data);
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
    // 对手掉线倒计时自减（非阻塞，不阻止本地操作）
    if (dt > 0 && game.reconnectRemaining > 0) {
      game.reconnectRemaining = Math.max(0, game.reconnectRemaining - dt);
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

  // 对手掉线非阻塞横幅（倒计时中仍可正常操作）
  if (game.reconnectRemaining > 0) drawReconnectBanner(ctx);

  // 设置 rects.W/H（逻辑尺寸），供所有弹窗（drawDrawRequest/drawSetModal/drawSettle 等）使用
  rects.W = W; rects.H = H;

  if (game.showDrawRequest) drawDrawRequest(ctx);
  if (game.showRequestDraw) drawRequestDrawConfirm(ctx);
  if (game.showGiveUpConfirm) drawGiveUpConfirm(ctx);
  if (game.showSettings) drawSetModal(ctx);
  if (game.showSettle) drawSettle(ctx);
  if (game.rankUpModal && game.rankUpModal.show) drawRankUpModal(ctx);
}

// 设置弹窗：统一复用通用设置组件（音乐/音效/震动开关 + 棋子皮肤）
function drawSetModal(ctx) {
  settingsModal.drawSettingsModal(ctx, rects, { title: '对局设置' });
}

// 段位名（依据积分区间，与服务端 config 一致）
// 每100分一档：负分「还未入门」；0-1399 为小方/老方/小六/老六体系；≥1400 固定「资深老六」（星星另算）
function rankNameFromScore(score) {
  const s = score || 0;
  if (s < 0) return '还未入门';
  if (s < 0) return '还未入门';
  if (s < 10) return '初级小方';
  if (s < 20) return '中级小方';
  if (s < 40) return '高级小方';
  if (s < 60) return '初级老方';
  if (s < 80) return '中级老方';
  if (s < 100) return '高级老方';
  if (s < 130) return '资深老方';
  if (s < 180) return '初级小六';
  if (s < 230) return '中级小六';
  if (s < 280) return '高级小六';
  if (s < 380) return '初级老六';
  if (s < 480) return '中级老六';
  if (s < 580) return '高级老六';
  return '资深老六';
}

// 星星展示（仅 ≥680 使用）：按「分数」四进制换算 星→月→日→皇冠
// 星星数 = floor((score - 680) / 100)；4星=1月，4月=1日(☀️)，4日=1皇冠(👑)
function starBadgeFromScore(score) {
  let stars = Math.floor((score - 680) / 100);
  if (stars < 0) stars = 0;
  const crown = Math.floor(stars / 64);
  stars %= 64;
  const sun = Math.floor(stars / 16);
  stars %= 16;
  const moon = Math.floor(stars / 4);
  const star = stars % 4;
  let badge = '';
  if (crown > 0) badge += '👑'.repeat(Math.min(crown, 3));
  if (sun > 0) badge += '☀️'.repeat(Math.min(sun, 3));
  if (moon > 0) badge += '🌙'.repeat(Math.min(moon, 3));
  if (star > 0) badge += '⭐'.repeat(star);
  return badge || '⭐';
}

// 段位 + 星星徽章完整显示（≥680 时叠加徽章，强化爽感）
function rankDisplayFromScore(score) {
  const base = rankNameFromScore(score);
  if ((score || 0) >= 680) return base + ' ' + starBadgeFromScore(score);
  return base;
}

// 双方姓名卡 + 15秒倒计时环 + 棋子数/段位 + 执子颜色
// 布局：对手卡在棋盘上方、己方卡在棋盘下方，整个「姓名板-棋盘-姓名板」作为一个整体
// 在【阶段标签下方】与【底部操作按钮上方】之间严格垂直居中。
// 关键：棋盘白卡自身有外边距(extend+pad)，需把这段外边距算进间距，
// 否则白卡顶会向上侵入上方姓名板 → 视觉重叠。故「姓名板↔白卡边」间距统一为 gap。
function drawPlayerCards(ctx) {
  const pad = 14;
  const cardH = 66;      // 姓名板高度
  const gap = 24;        // 姓名板与棋盘白卡（视觉）间距，上、下相等
  const sbh = state.statusBarHeight;

  // 阶段标签
  drawStagePill(ctx);

  // 可用区间：阶段标签底部(高44) + 10 → 底部操作按钮顶部 - 12
  const availTop = sbh + 10 + 44 + 10;
  const availBottom = H - 88 - 12;
  const availH = Math.max(0, availBottom - availTop);

  // 棋盘基础尺寸（受宽/高限制）
  let boardSize = Math.max(160, Math.min(W - 92, 258, (H - 270) * 0.52));
  // 白卡额外边距（与 drawBoard 完全一致：extend=step*0.35, pad=20）
  let boardExtend = (boardSize / 5) * 0.35 + 20;
  let boardOuterH = boardSize + boardExtend * 2;

  // 整体需占高度：上卡 + gap + 白卡 + gap + 下卡
  const totalH = cardH + gap + boardOuterH + gap + cardH;
  if (totalH > availH) {
    // 压缩棋盘，保证整体放下且不压按钮（不低于 160）
    const maxOuter = availH - (cardH * 2 + gap * 2);
    boardSize = Math.max(160, Math.floor((maxOuter - 40) / 1.14));
    boardExtend = (boardSize / 5) * 0.35 + 20;
    boardOuterH = boardSize + boardExtend * 2;
  }

  const stackH = cardH + gap + boardOuterH + gap + cardH;
  const startTop = availTop + (availH - stackH) / 2;

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

  // 白卡顶 = 上姓名板底边 + gap；网格顶 = 白卡顶 + boardExtend
  const whiteTop = oppTop + cardH + gap;
  const boardTop = whiteTop + boardExtend;
  drawBoard(ctx, boardTop, boardSize);

  // 白卡底 = boardTop + boardOuterH；下姓名板顶 = 白卡底 + gap（与上方相等）
  const whiteBottom = boardTop + boardOuterH;
  drawPlayerCard(ctx, {
    x: pad, y: whiteBottom + gap, w: W - pad * 2, h: cardH,
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
  drawText(ctx, rankDisplayFromScore(o.rank) + ' · ' + (o.rank || 0), o.x + 64, cy + 14, {
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
  // 圆内数字（严格居中于圆圈）
  const cdText = o.isTurn ? String(Math.ceil(game.remainingTime || 0)) : '--';
  drawText(ctx, cdText, cdX, cdY, { color: cdColor, fontSize: 13, align: 'center', baseline: 'middle', bold: o.isTurn });
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
  const pw = 220;
  const ph = 44;   // 加高，更醒目
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
    color: '#FFFFFF', fontSize: 21, align: 'center', baseline: 'middle', bold: true,
  });
}

function drawBoard(ctx, topY, size) {
  const ox = (W - size) / 2;
  const oy = topY;
  const step = size / 5;
  boardGeo = { ox, oy, step, size };

  // 修复：保持棋子/交叉点与网格线严格对齐（ox + c*step），
  // 仅让暖米色棋盘底向外延伸一段距离，外侧再加白色边框。
  const extend = step * 0.35; // 米色底延伸出网格线的距离
  const pad = 20;             // 外侧白边宽度（扩大，让棋盘更清爽）

  // 1) 外层白底卡（白边加宽，直角描边，整体仍作圆角卡以柔和视觉）
  drawCard(ctx, {
    x: ox - extend - pad, y: oy - extend - pad,
    w: size + (extend + pad) * 2, h: size + (extend + pad) * 2,
    radius: 16, fill: '#FFFFFF', border: '#E8E3DA'
  });

  // 2) 暖米色棋盘底（延伸超出网格线，圆角）
  roundRect(ctx, ox - extend, oy - extend, size + extend * 2, size + extend * 2, 12);
  ctx.fillStyle = '#E8DBCF';
  ctx.fill();

  // 3) 深棕网格线（与棋子坐标严格对齐，直角直线，无圆角）
  ctx.strokeStyle = '#3C2F28';
  ctx.lineWidth = 1.5;
  // 外框（闭合，直线）
  ctx.strokeRect(ox, oy, size, size);
  // 内线
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

  // 4) 交叉点（与棋子坐标一致）
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

  // 揪子阶段(含连揪与普通揪子)均可跳过；走子阶段的连揪也保留
  if (game.phase === 'capture' || game.skipAvailable || game.moveCaptureMode) {
    rects.skipBtn = drawButton(ctx, { text: '跳过揪子', x: (W - 160) / 2, y: y - 52, w: 160, h: 42,
      fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
  } else {
    rects.skipBtn = null;
  }
}

/** 对手掉线非阻塞横幅：顶部居中提示倒计时，不拦截任何点击（掉线方由 15s 托管继续操作） */
function drawReconnectBanner(ctx) {
  const bw = W - 32;
  const bh = 40;
  const bx = 16;
  const by = state.statusBarHeight + 8;
  // 半透明暖金底色胶囊
  roundRect(ctx, bx, by, bw, bh, 18);
  ctx.fillStyle = 'rgba(212,168,67,0.18)';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = PALETTE.gold;
  ctx.stroke();
  const sec = Math.ceil(game.reconnectRemaining);
  drawText(ctx, `对手已掉线，${sec} 秒后判你胜（重连中可继续操作）`, W / 2, by + bh / 2, {
    color: PALETTE.gold, fontSize: 13, align: 'center', baseline: 'middle', bold: true,
  });
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

function drawSettle(ctx) {  ctx.fillStyle = 'rgba(60,47,40,0.6)';
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

// 段位升降绚丽弹窗（升级金色光晕 / 降级灰蓝，自动2.6s消失）
function drawRankUpModal(ctx) {
  const m = game.rankUpModal;
  if (!m) return;
  const elapsed = Date.now() - m.t;
  const life = 2600;
  if (elapsed > life) { m.show = false; return; } // 自动消失

  // 入场缩放缓动（前300ms弹出，后段保持）
  const k = Math.min(1, elapsed / 300);
  const ease = 1 - Math.pow(1 - k, 3);
  const scale = 0.7 + 0.3 * ease;
  const cx = W / 2, cy = H * 0.34;
  const pw = 300 * scale, ph = 150 * scale;
  const px = cx - pw / 2, py = cy - ph / 2;

  ctx.save();
  // 光晕
  const glow = m.up ? 'rgba(255,196,84,0.35)' : 'rgba(140,160,180,0.32)';
  const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, pw * 0.8);
  grad.addColorStop(0, glow);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - pw * 0.8, cy - ph * 0.8, pw * 1.6, ph * 1.6);

  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 22, fill: m.up ? '#2C2438' : '#26303A' });

  const title = m.up ? '🎉 恭喜升级' : '📉 遗憾降级';
  const titleColor = m.up ? PALETTE.gold : '#9FB4C8';
  drawText(ctx, title, cx, py + ph * 0.34, { color: titleColor, fontSize: 26 * scale, align: 'center', bold: true });
  drawText(ctx, m.rank, cx, py + ph * 0.66, { color: PALETTE.text, fontSize: 34 * scale, align: 'center', bold: true });
  // 升级时小字鼓励
  if (m.up) {
    drawText(ctx, '再接再厉，向前冲！', cx, py + ph * 0.9, { color: PALETTE.textDim, fontSize: 14 * scale, align: 'center' });
  } else {
    drawText(ctx, '稳住心态，下次翻盘', cx, py + ph * 0.9, { color: PALETTE.textDim, fontSize: 14 * scale, align: 'center' });
  }
  ctx.restore();
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
    // 落子音效统一由 onBoardUpdate 的 WS 回显播放，避免本地+回显双播
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
    // 揪子音效统一由 onBoardUpdate 的 WS 回显播放
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
  // 揪子音效统一由 onBoardUpdate 的 WS 回显播放
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
  // 走子音效统一由 onBoardUpdate 的 WS 回显播放
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
