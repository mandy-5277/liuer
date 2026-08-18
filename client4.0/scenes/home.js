/**
 * 六儿 小游戏版 — 首页大厅场景
 * （对应小程序版 pages/index/index）
 *
 * 用 Canvas 绘制：顶部状态栏（段位/精力/铜板）、6x6 棋盘点阵装饰、
 * 随机匹配按钮、好友开局按钮，以及匹配中 / 房间弹窗浮层。
 * 设计风格：暖金棕国风（figma 设计稿）。
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const { PALETTE, drawButton, drawText, drawCard, drawAvatar, hit, roundRect } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 667;

// 可点击区域（每帧根据布局重算，onTouch 时命中判断）
let rects = {};

// 浮层状态
let overlay = null; // null | 'matching' | 'room'
let roomCode = '';
let matchingCanceled = false;
let boardDots = [];

function buildBoardDots() {
  boardDots = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      boardDots.push({ x: 12.5 + c * 18.75, y: 12.5 + r * 18.75 });
    }
  }
}

function onEnter() {
  buildBoardDots();
  overlay = null;
  roomCode = '';
  matchingCanceled = false;
  registerWs();
}

function registerWs() {
  wsManager.on('match_status', (data) => {
    if (data.status === 'matching') {
      overlay = 'matching';
      matchingCanceled = false;
    } else if (data.status === 'cancelled') {
      overlay = null;
    }
  });

  wsManager.on('game_start', (data) => {
    overlay = null;
    state.currentGame = data;
    sceneMgr.goto('match', data);
  });

  wsManager.on('room_created', (data) => {
    overlay = 'room';
    roomCode = data.roomId;
  });

  wsManager.on('opponent_joined', (data) => {
    roomCode = data.roomId;
  });

  wsManager.on('room_expired', () => {
    overlay = null;
    roomCode = '';
  });

  wsManager.on('resource_update', (data) => {
    if (data.copper !== undefined) state.coins = data.copper;
    if (data.energy !== undefined) state.energy.current = data.energy;
    if (data.rankScore !== undefined) state.rankScore = data.rankScore;
    if (data.rankName) state.rankName = data.rankName;
  });
}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;

  drawBackground(ctx);
  drawTopCard(ctx);
  drawDecoBoard(ctx);
  drawSlogan(ctx);
  drawBottomButtons(ctx);

  if (overlay === 'matching') drawMatchingOverlay(ctx);
  else if (overlay === 'room') drawRoomOverlay(ctx);
}

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// 顶部：白底描边状态卡（段位 / 精力 / 铜板）
function drawTopCard(ctx) {
  const pad = 16;
  const y = state.statusBarHeight + 12;
  const cardH = 72;
  drawCard(ctx, { x: pad, y, w: W - pad * 2, h: cardH, radius: 16 });

  const cy = y + cardH / 2;
  // 左侧：段位昵称 + 积分
  drawText(ctx, state.rankName || '初级小六', pad + 18, cy - 10, {
    color: PALETTE.gold, fontSize: 22, bold: true,
  });
  drawText(ctx, '积分 ' + (state.rankScore || 0), pad + 18, cy + 18, {
    color: PALETTE.textDim, fontSize: 16,
  });

  // 右侧：精力 + 铜板
  const right = W - pad - 18;
  drawText(ctx, '精力 ' + state.energy.current + '/' + state.energy.max, right, cy - 10, {
    color: PALETTE.green, fontSize: 16, align: 'right',
  });
  drawText(ctx, '铜板 ' + (state.coins || 0), right, cy + 18, {
    color: PALETTE.gold, fontSize: 16, align: 'right',
  });
}

function drawDecoBoard(ctx) {
  // 缩小装饰棋盘，居中偏上，描边白卡
  const size = W * 0.6;
  const ox = (W - size) / 2;
  const oy = H * 0.24;
  drawCard(ctx, { x: ox - 16, y: oy - 16, w: size + 32, h: size + 32, radius: 20 });

  const step = size / 5;
  ctx.fillStyle = PALETTE.boardDot;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.beginPath();
      ctx.arc(ox + c * step, oy + r * step, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSlogan(ctx) {
  drawText(ctx, '六儿', W / 2, H * 0.5, {
    color: PALETTE.text, fontSize: 52, align: 'center', bold: true,
  });
  drawText(ctx, '下子布局 · 揪子博弈 · 走子决胜', W / 2, H * 0.5 + 36, {
    color: PALETTE.textDim, fontSize: 18, align: 'center',
  });
}

function drawBottomButtons(ctx) {
  const btnW = W * 0.7;
  const btnH = 56;
  const cx = (W - btnW) / 2;
  const y1 = H * 0.66;
  const y2 = y1 + btnH + 20;

  rects.match = drawButton(ctx, {
    text: '随机匹配', x: cx, y: y1, w: btnW, h: btnH,
    fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 28,
  });
  rects.friend = drawButton(ctx, {
    text: '好友开局', x: cx, y: y2, w: btnW, h: btnH,
    fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 28,
    border: PALETTE.gold,
  });

  drawTabBar(ctx);
}

function drawTabBar(ctx) {
  const tabH = 64;
  const y = H - tabH;
  drawCard(ctx, { x: 0, y, w: W, h: tabH, radius: 0, border: PALETTE.panelBorder });
  const items = [
    { key: 'home', label: '大厅' },
    { key: 'rank', label: '排行榜' },
    { key: 'profile', label: '我的' },
    { key: 'rules', label: '规则' },
  ];
  const itemW = W / items.length;
  rects.tabs = [];
  items.forEach((it, i) => {
    const ix = i * itemW;
    const active = it.key === 'home';
    if (active) {
      ctx.fillStyle = 'rgba(139,105,20,0.10)';
      ctx.fillRect(ix, y, itemW, tabH);
    }
    drawText(ctx, it.label, ix + itemW / 2, y + tabH / 2 + 6, {
      color: active ? PALETTE.gold : PALETTE.textDim,
      fontSize: 20, align: 'center', bold: active,
    });
    rects.tabs.push({ key: it.key, x: ix, y, w: itemW, h: tabH });
  });
}

function drawMatchingOverlay(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);

  const pw = W * 0.8;
  const ph = 240;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  drawText(ctx, '匹配中...', W / 2, py + 70, {
    color: PALETTE.text, fontSize: 34, align: 'center', bold: true,
  });
  drawText(ctx, '正在为你寻找对手', W / 2, py + 120, {
    color: PALETTE.textDim, fontSize: 22, align: 'center',
  });

  rects.cancelMatch = drawButton(ctx, {
    text: '取消匹配', x: px + 40, y: py + ph - 80, w: pw - 80, h: 56,
    fill: PALETTE.red, textColor: '#FFFFFF', fontSize: 26,
  });
}

function drawRoomOverlay(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);

  const pw = W * 0.8;
  const ph = 260;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  drawText(ctx, '房间已创建', W / 2, py + 60, {
    color: PALETTE.text, fontSize: 32, align: 'center', bold: true,
  });
  drawText(ctx, '房间号', W / 2, py + 110, {
    color: PALETTE.textDim, fontSize: 22, align: 'center',
  });
  drawText(ctx, roomCode, W / 2, py + 150, {
    color: PALETTE.gold, fontSize: 44, align: 'center', bold: true,
  });

  rects.copyRoom = drawButton(ctx, {
    text: '复制房间号', x: px + 40, y: py + ph - 80, w: pw - 80, h: 56,
    fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 26,
  });
}

function onTouch(x, y) {
  if (overlay === 'matching') {
    if (hit(rects.cancelMatch, x, y)) {
      wsManager.send('match_cancel');
      overlay = null;
    }
    return;
  }
  if (overlay === 'room') {
    if (hit(rects.copyRoom, x, y)) {
      wx.setClipboardData({
        data: roomCode,
        success: () => wx.showToast({ title: '房间号已复制', icon: 'success' }),
      });
    }
    return;
  }

  if (hit(rects.match, x, y)) {
    if (state.energy.current < 5) {
      wx.showToast({ title: '精力不足，请等待恢复', icon: 'none' });
      return;
    }
    wsManager.send('match_start');
    overlay = 'matching';
    return;
  }

  if (hit(rects.friend, x, y)) {
    if (state.energy.current < 5) {
      wx.showToast({ title: '精力不足，请等待恢复', icon: 'none' });
      return;
    }
    wsManager.send('invite_room');
    return;
  }

  if (rects.tabs) {
    for (const t of rects.tabs) {
      if (hit(t, x, y)) {
        if (t.key === 'home') return;
        sceneMgr.goto(t.key);
        return;
      }
    }
  }
}

module.exports = { onEnter, onDraw, onTouch, onWs: () => {} };
