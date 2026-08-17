/**
 * 六儿 小游戏版 — 首页大厅场景
 * （对应小程序版 pages/index/index）
 *
 * 用 Canvas 绘制：顶部状态栏（段位/精力/铜板）、6x6 棋盘点阵装饰、
 * 随机匹配按钮、好友开局按钮，以及匹配中 / 房间弹窗浮层。
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const { PALETTE, drawButton, drawText, hit, roundRect } = require('../utils/ui');
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
  drawTopBar(ctx);
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

function drawTopBar(ctx) {
  const pad = 20;
  const y = state.statusBarHeight + 12;
  drawText(ctx, state.rankName || '初级小六', pad, y + 14, {
    color: PALETTE.gold, fontSize: 26, bold: true,
  });
  drawText(ctx, '积分 ' + (state.rankScore || 0), pad, y + 42, {
    color: PALETTE.textDim, fontSize: 20,
  });

  // 右侧：精力 + 铜板
  const right = W - pad;
  drawText(ctx, '精力 ' + state.energy.current + '/' + state.energy.max, right, y + 14, {
    color: PALETTE.green, fontSize: 20, align: 'right',
  });
  drawText(ctx, '铜板 ' + (state.coins || 0), right, y + 42, {
    color: PALETTE.gold, fontSize: 20, align: 'right',
  });
}

function drawDecoBoard(ctx) {
  // 缩小的装饰棋盘，居中偏上
  const size = W * 0.6;
  const ox = (W - size) / 2;
  const oy = H * 0.24;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  roundRect(ctx, ox - 16, oy - 16, size + 32, size + 32, 20);
  ctx.fill();

  const step = size / 5;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
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
    color: PALETTE.textDim, fontSize: 22, align: 'center',
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
    fill: PALETTE.gold, textColor: '#3a2c00', fontSize: 30,
  });
  rects.friend = drawButton(ctx, {
    text: '好友开局', x: cx, y: y2, w: btnW, h: btnH,
    fill: PALETTE.panelSolid, textColor: PALETTE.text, fontSize: 30,
  });

  // 底部 tab 栏
  drawTabBar(ctx);
}

function drawTabBar(ctx) {
  const tabH = 64;
  const y = H - tabH;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, y, W, tabH);
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
    drawText(ctx, it.label, ix + itemW / 2, y + tabH / 2 + 6, {
      color: active ? PALETTE.gold : PALETTE.textDim,
      fontSize: 22, align: 'center', bold: active,
    });
    rects.tabs.push({ key: it.key, x: ix, y, w: itemW, h: tabH });
  });
}

function drawMatchingOverlay(ctx) {
  // 半透明遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);

  const pw = W * 0.8;
  const ph = 240;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  ctx.fillStyle = PALETTE.panelSolid;
  roundRect(ctx, px, py, pw, ph, 24);
  ctx.fill();

  drawText(ctx, '匹配中...', W / 2, py + 70, {
    color: PALETTE.text, fontSize: 36, align: 'center', bold: true,
  });
  drawText(ctx, '正在为你寻找对手', W / 2, py + 120, {
    color: PALETTE.textDim, fontSize: 24, align: 'center',
  });

  // 旋转的提示点（简单动画靠帧计数）
  rects.cancelMatch = drawButton(ctx, {
    text: '取消匹配', x: px + 40, y: py + ph - 80, w: pw - 80, h: 56,
    fill: PALETTE.red, textColor: '#fff', fontSize: 28,
  });
}

function drawRoomOverlay(ctx) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);

  const pw = W * 0.8;
  const ph = 260;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  ctx.fillStyle = PALETTE.panelSolid;
  roundRect(ctx, px, py, pw, ph, 24);
  ctx.fill();

  drawText(ctx, '房间已创建', W / 2, py + 60, {
    color: PALETTE.text, fontSize: 34, align: 'center', bold: true,
  });
  drawText(ctx, '房间号', W / 2, py + 110, {
    color: PALETTE.textDim, fontSize: 22, align: 'center',
  });
  drawText(ctx, roomCode, W / 2, py + 150, {
    color: PALETTE.gold, fontSize: 44, align: 'center', bold: true,
  });

  rects.copyRoom = drawButton(ctx, {
    text: '复制房间号', x: px + 40, y: py + ph - 80, w: pw - 80, h: 56,
    fill: PALETTE.accent, textColor: '#fff', fontSize: 28,
  });
}

function onTouch(x, y) {
  // 浮层优先
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
