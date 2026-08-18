/**
 * 六儿 小游戏版 — 首页大厅场景
 * 设计依据：figma.md #page-home（375×812 基准，暖金棕国风）
 *
 * 布局：顶部资源栏 → 中央（标题+棋盘动画+按钮）→ 个人信息卡（段位/积分/胜率/精力条）→ 规则入口 → 底部导航
 * 用 Canvas 绘制；好友开局弹出双 Tab 浮层（复制房间号 / 进入房间）。
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const { PALETTE, drawButton, drawText, drawCard, drawAvatar, hit, roundRect } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 812;
let rects = {};

// 浮层状态
let overlay = null;          // null | 'matching' | 'room' | 'inroom'
let overlayTab = 'create';   // 'create' 复制房间号 | 'join' 进入房间
let roomCode = '';
let roomRole = '';           // 'creator' | 'joiner'（等待房间时）
let joinInput = '';           // 进入房间输入的房间号
let joinError = '';
const inviters = [];          // 收到的邀请 { roomId, nickName }

let fightPhase = 0;          // 棋盘打架动画相位

// ========== 生命周期 ==========

function onEnter() {
  overlay = null;
  overlayTab = 'create';
  roomCode = '';
  joinInput = '';
  joinError = '';
  registerWs();

  // 分享卡片带房间号 → 启动后自动进房
  if (state.pendingRoom) {
    const code = state.pendingRoom;
    state.pendingRoom = '';
    wsManager.send('join_room', { roomId: code });
    overlay = 'matching';
  }
}

function registerWs() {
  wsManager.on('match_status', (data) => {
    overlay = data.status === 'matching' ? 'matching' : (data.status === 'cancelled' ? null : overlay);
  });
  wsManager.on('game_start', (data) => {
    overlay = null;
    state.currentGame = data;
    sceneMgr.goto('match', data);
  });
  wsManager.on('room_created', (data) => {
    overlay = 'inroom';
    roomRole = 'creator';
    roomCode = data.roomId;
  });
  wsManager.on('opponent_joined', (data) => {
    roomCode = data.roomId;
  });
  wsManager.on('join_room_success', (data) => {
    overlay = 'inroom';
    roomRole = 'joiner';
    roomCode = data.roomId;
  });
  wsManager.on('room_cancelled', () => {
    if (overlay === 'inroom') {
      wx.showToast({ title: '对方已离开房间', icon: 'none' });
      overlay = null;
      roomCode = '';
      roomRole = '';
    }
  });
  wsManager.on('room_expired', () => {
    if (overlay === 'inroom' && roomRole === 'creator') {
      wx.showToast({ title: '房间已过期，请重新创建', icon: 'none' });
      overlay = null;
      roomCode = '';
      roomRole = '';
    }
  });
  wsManager.on('invite_received', (data) => {
    inviters.push({ roomId: data.roomId, nickName: data.nickName || '好友' });
  });
  wsManager.on('resource_update', (data) => {
    if (data.copper !== undefined) state.coins = data.copper;
    if (data.energy !== undefined) state.energy.current = data.energy;
    if (data.rankScore !== undefined) state.rankScore = data.rankScore;
    if (data.rankName) state.rankName = data.rankName;
  });
  wsManager.on('error', (data) => {
    const msg = data && data.errMsg ? data.errMsg : '操作失败';
    wx.showToast({ title: msg, icon: 'none' });
    if (overlay === 'matching' && /房间/.test(msg)) overlay = null;
  });
}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;
  drawBackground(ctx);
  drawTopBar(ctx);
  drawCenter(ctx);
  drawProfileCard(ctx);
  drawRuleLink(ctx);
  drawBottomNav(ctx);

  if (overlay === 'matching') drawMatchingOverlay(ctx);
  else if (overlay === 'room') drawRoomOverlay(ctx);
  else if (overlay === 'inroom') drawInRoomOverlay(ctx);
}

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// 顶部资源栏：Logo + 精力/倒计时/铜板
function drawTopBar(ctx) {
  const y = state.statusBarHeight + 4;
  drawText(ctx, '六儿', 16, y + 22, { color: PALETTE.gold, fontSize: 24, bold: true });
  const right = W - 16;
  drawText(ctx, '⚡ ' + state.energy.current + '/' + state.energy.max, right, y + 16, { color: PALETTE.green, fontSize: 15, align: 'right' });
  drawText(ctx, '🪙 ' + (state.coins || 0), right, y + 38, { color: PALETTE.goldBright, fontSize: 15, align: 'right' });
}

// 中央：标题 + 棋盘动画 + 按钮
function drawCenter(ctx) {
  const cx = W / 2;
  const topY = state.statusBarHeight + 52;

  drawText(ctx, '六儿', cx, topY + 18, { color: PALETTE.text, fontSize: 30, align: 'center', bold: true });

  // 棋盘动画卡 224x224
  const bSize = 224;
  const bx = (W - bSize) / 2;
  const by = topY + 36;
  drawCard(ctx, { x: bx, y: by, w: bSize, h: bSize, radius: 16 });
  drawBoardAnimation(ctx, bx + 12, by + 12, bSize - 24);

  drawText(ctx, '落子布局 · 揪子博弈 · 走子决胜', cx, by + bSize + 24, { color: PALETTE.textDim, fontSize: 14, align: 'center' });

  // 按钮组
  const btnW = W - 94;
  const btnH = 52;
  const mx = (W - btnW) / 2;
  const y1 = by + bSize + 44;
  const y2 = y1 + btnH + 12;

  drawText(ctx, '消耗 5 点精力', cx, y1 - 10, { color: PALETTE.textDim, fontSize: 12, align: 'center' });
  rects.match = drawButton(ctx, { text: '⚔ 随机匹配', x: mx, y: y1, w: btnW, h: btnH, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
  rects.friend = drawButton(ctx, { text: '👥 邀请好友开局', x: mx, y: y2, w: btnW, h: btnH, fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 22, border: PALETTE.gold });
}

function drawBoardAnimation(ctx, ox, oy, area) {
  const step = area / 5;
  // 棋盘线
  ctx.strokeStyle = PALETTE.panelBorder;
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + i * step);
    ctx.lineTo(ox + area, oy + i * step);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox + i * step, oy);
    ctx.lineTo(ox + i * step, oy + area);
    ctx.stroke();
  }
  // 交叉点
  ctx.fillStyle = PALETTE.boardDot;
  for (let r = 0; r <= 5; r++) {
    for (let c = 0; c <= 5; c++) {
      ctx.beginPath();
      ctx.arc(ox + c * step, oy + r * step, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 打架动画：两子左右来回
  const off = Math.sin(Date.now() / 400) * 10;
  const r1 = step * 0.36;
  drawPieceAt(ctx, ox + 2 * step + off, oy + 2 * step, r1, 'black');
  drawPieceAt(ctx, ox + 3 * step - off, oy + 3 * step, r1, 'white');
}

function drawPieceAt(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y + 1, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,47,40,0.18)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color === 'black' ? PALETTE.blackPiece : PALETTE.whitePiece;
  ctx.fill();
  if (color === 'white') {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE.panelBorder;
    ctx.stroke();
  }
}

// 个人信息卡
function drawProfileCard(ctx) {
  const cardX = 16;
  const cardW = W - 32;
  const cardY = H - 230;
  const cardH = 150;
  drawCard(ctx, { x: cardX, y: cardY, w: cardW, h: cardH, radius: 16 });

  const cy = cardY + 38;
  drawAvatar(ctx, { x: cardX + 36, y: cy, r: 26, label: (state.userInfo && state.userInfo.nickName) || '我', ring: true });

  drawText(ctx, (state.userInfo && state.userInfo.nickName) || '我', cardX + 76, cy - 8, { color: PALETTE.text, fontSize: 20, bold: true });
  // 段位徽章
  const badgeW = 76;
  const badgeX = cardX + 76;
  const badgeY = cy + 8;
  roundRect(ctx, badgeX, badgeY, badgeW, 24, 12);
  ctx.fillStyle = PALETTE.goldBright;
  ctx.fill();
  drawText(ctx, state.rankName || '初级小六', badgeX + badgeW / 2, badgeY + 17, { color: PALETTE.textOnGold, fontSize: 14, align: 'center', bold: true });

  // 积分 / 胜率
  drawText(ctx, '' + (state.rankScore || 0), cardX + cardW - 90, cy - 4, { color: PALETTE.gold, fontSize: 24, align: 'center', bold: true });
  drawText(ctx, '积分', cardX + cardW - 90, cy + 16, { color: PALETTE.textDim, fontSize: 13, align: 'center' });
  drawText(ctx, (state.winRate || 0) + '%', cardX + cardW - 30, cy - 4, { color: PALETTE.green, fontSize: 24, align: 'center', bold: true });
  drawText(ctx, '胜率', cardX + cardW - 30, cy + 16, { color: PALETTE.textDim, fontSize: 13, align: 'center' });

  // 精力进度条
  const barX = cardX + 16;
  const barY = cardY + 100;
  const barW = cardW - 32;
  drawText(ctx, '精力 ' + state.energy.current + '/' + state.energy.max, barX, barY - 6, { color: PALETTE.text, fontSize: 13 });
  roundRect(ctx, barX, barY, barW, 10, 5);
  ctx.fillStyle = PALETTE.panelBorder;
  ctx.fill();
  const pct = Math.max(0, Math.min(1, state.energy.current / state.energy.max));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, 10, 5);
    ctx.fillStyle = PALETTE.green;
    ctx.fill();
  }
  drawText(ctx, '下次恢复 ⏳ ' + formatCd(state.energy.nextRecoverAt), W - 16, barY + 26, { color: PALETTE.textDim, fontSize: 11, align: 'right' });
}

function formatCd(ts) {
  if (!ts) return '00:00';
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

function drawRuleLink(ctx) {
  rects.ruleLink = { x: 0, y: H - 76, w: W, h: 24 };
  drawText(ctx, '游戏规则 ▶', W / 2, H - 60, { color: PALETTE.textDim, fontSize: 15, align: 'center' });
}

function drawBottomNav(ctx) {
  const tabH = 64;
  const y = H - tabH;
  drawCard(ctx, { x: 0, y, w: W, h: tabH, radius: 0, border: PALETTE.panelBorder });
  const items = [
    { key: 'home', label: '首页', icon: '🏠' },
    { key: 'rank', label: '排行榜', icon: '🏆' },
    { key: 'profile', label: '我的', icon: '👤' },
    { key: 'rules', label: '规则', icon: '📖' },
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
    drawText(ctx, it.icon, ix + itemW / 2, y + 26, { color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 20, align: 'center' });
    drawText(ctx, it.label, ix + itemW / 2, y + 48, { color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 12, align: 'center', bold: active });
    rects.tabs.push({ key: it.key, x: ix, y, w: itemW, h: tabH });
  });
}

// ========== 匹配浮层 ==========
function drawMatchingOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.8, ph = 240, px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });
  drawText(ctx, '匹配中...', W / 2, py + 70, { color: PALETTE.text, fontSize: 32, align: 'center', bold: true });
  drawText(ctx, '正在为你寻找对手', W / 2, py + 120, { color: PALETTE.textDim, fontSize: 20, align: 'center' });
  rects.cancelMatch = drawButton(ctx, { text: '取消匹配', x: px + 40, y: py + ph - 80, w: pw - 80, h: 56, fill: PALETTE.red, textColor: '#FFFFFF', fontSize: 24 });
}

// ========== 好友开局浮层（双 Tab） ==========
function drawRoomOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.86, ph = 380, px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  // 关闭按钮
  rects.closeRoom = { x: px + pw - 40, y: py + 12, w: 28, h: 28 };
  drawText(ctx, '✕', px + pw - 26, py + 32, { color: PALETTE.textDim, fontSize: 22, align: 'center' });

  drawText(ctx, '好友开局', W / 2, py + 44, { color: PALETTE.text, fontSize: 26, align: 'center', bold: true });

  // Tab 切换
  const tabY = py + 64;
  const tabW = (pw - 48) / 2;
  const tabX1 = px + 24;
  const tabX2 = px + 24 + tabW + 0;
  rects.tabCreate = drawButton(ctx, { text: '复制房间号', x: tabX1, y: tabY, w: tabW, h: 42, fill: overlayTab === 'create' ? PALETTE.gold : PALETTE.panel, textColor: overlayTab === 'create' ? PALETTE.textOnGold : PALETTE.textDim, fontSize: 18, border: overlayTab === 'create' ? null : PALETTE.panelBorder });
  rects.tabJoin = drawButton(ctx, { text: '进入房间', x: tabX2, y: tabY, w: tabW, h: 42, fill: overlayTab === 'join' ? PALETTE.gold : PALETTE.panel, textColor: overlayTab === 'join' ? PALETTE.textOnGold : PALETTE.textDim, fontSize: 18, border: overlayTab === 'join' ? null : PALETTE.panelBorder });

  if (overlayTab === 'create') {
    drawCreateTab(ctx, px, py, pw);
  } else {
    drawJoinTab(ctx, px, py, pw);
  }
}

function drawCreateTab(ctx, px, py, pw) {
  const y = py + 130;
  if (!roomCode) {
    rects.doCreate = drawButton(ctx, { text: '创建房间', x: px + 40, y: y, w: pw - 80, h: 54, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 24 });
    drawText(ctx, '创建后分享房间号给好友', W / 2, y + 92, { color: PALETTE.textDim, fontSize: 16, align: 'center' });
    return;
  }
  // 房间号展示
  drawText(ctx, '房间号', W / 2, y + 10, { color: PALETTE.textDim, fontSize: 18, align: 'center' });
  drawText(ctx, roomCode, W / 2, y + 52, { color: PALETTE.gold, fontSize: 44, align: 'center', bold: true });
  rects.copyRoom = drawButton(ctx, { text: '复制房间号', x: px + 40, y: y + 78, w: pw - 80, h: 52, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
  rects.shareRoom = drawButton(ctx, { text: '分享房间号给好友', x: px + 40, y: y + 142, w: pw - 80, h: 52, fill: PALETTE.panel, textColor: PALETTE.green, fontSize: 22, border: PALETTE.green });
}

function drawJoinTab(ctx, px, py, pw) {
  const y = py + 130;
  drawText(ctx, '输入好友分享的房间号', W / 2, y + 6, { color: PALETTE.textDim, fontSize: 16, align: 'center' });
  // 输入框（模拟）
  const iw = pw - 80, ih = 52, ix = px + 40, iy = y + 22;
  roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.fillStyle = PALETTE.bg;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = PALETTE.panelBorder;
  ctx.stroke();
  rects.joinInput = { x: ix, y: iy, w: iw, h: ih };
  const placeholder = joinInput || '例如 ABC123';
  drawText(ctx, placeholder, ix + iw / 2, iy + ih / 2 + 6, { color: joinInput ? PALETTE.text : PALETTE.textDim, fontSize: 24, align: 'center', bold: !!joinInput });
  if (joinError) drawText(ctx, joinError, W / 2, iy + ih + 24, { color: PALETTE.red, fontSize: 14, align: 'center' });
  rects.doJoin = drawButton(ctx, { text: '进入房间', x: px + 40, y: iy + ih + 36, w: pw - 80, h: 52, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
}

// ========== 房间等待浮层（房主/加入者统一） ==========
function drawInRoomOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.86, ph = 360, px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  // 关闭（退出房间）
  rects.closeRoom = { x: px + pw - 40, y: py + 12, w: 28, h: 28 };
  drawText(ctx, '✕', px + pw - 26, py + 32, { color: PALETTE.textDim, fontSize: 22, align: 'center' });

  drawText(ctx, '房间等待中', W / 2, py + 46, { color: PALETTE.text, fontSize: 26, align: 'center', bold: true });

  const y = py + 120;
  drawText(ctx, '房间号', W / 2, y, { color: PALETTE.textDim, fontSize: 18, align: 'center' });
  drawText(ctx, roomCode, W / 2, y + 44, { color: PALETTE.gold, fontSize: 46, align: 'center', bold: true });

  const tip = roomRole === 'creator' ? '等待好友输入房间号加入…' : '已加入房间，等待房主开始…';
  drawText(ctx, tip, W / 2, y + 92, { color: PALETTE.textDim, fontSize: 16, align: 'center' });

  if (roomRole === 'creator') {
    rects.copyRoom = drawButton(ctx, { text: '复制房间号', x: px + 40, y: y + 116, w: pw - 80, h: 52, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
    rects.shareRoom = drawButton(ctx, { text: '分享房间号给好友', x: px + 40, y: y + 180, w: pw - 80, h: 52, fill: PALETTE.panel, textColor: PALETTE.green, fontSize: 22, border: PALETTE.green });
  } else {
    rects.shareRoom = drawButton(ctx, { text: '邀请好友一起来', x: px + 40, y: y + 116, w: pw - 80, h: 52, fill: PALETTE.panel, textColor: PALETTE.green, fontSize: 22, border: PALETTE.green });
  }

  rects.leaveRoom = drawButton(ctx, { text: '退出房间', x: px + 40, y: py + ph - 72, w: pw - 80, h: 52, fill: PALETTE.red, textColor: '#FFFFFF', fontSize: 22 });
}

function dim(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
}

// ========== 触摸 ==========
function onTouch(x, y) {
  if (overlay === 'matching') {
    if (hit(rects.cancelMatch, x, y)) { wsManager.send('match_cancel'); overlay = null; }
    return;
  }
  if (overlay === 'room') { handleRoomTouch(x, y); return; }
  if (overlay === 'inroom') { handleInRoomTouch(x, y); return; }

  if (hit(rects.match, x, y)) { startMatch(); return; }
  if (hit(rects.friend, x, y)) { openInvite(); return; }
  if (hit(rects.ruleLink, x, y)) { sceneMgr.goto('rules'); return; }
  if (rects.tabs) {
    for (const t of rects.tabs) {
      if (hit(t, x, y) && t.key !== 'home') { sceneMgr.goto(t.key); return; }
    }
  }
}

function handleRoomTouch(x, y) {
  if (hit(rects.closeRoom, x, y)) { overlay = null; return; }
  if (hit(rects.tabCreate, x, y)) { overlayTab = 'create'; return; }
  if (hit(rects.tabJoin, x, y)) { overlayTab = 'join'; return; }

  if (overlayTab === 'create') {
    if (!roomCode) {
      if (hit(rects.doCreate, x, y)) { wsManager.send('invite_room'); }
      return;
    }
    if (hit(rects.copyRoom, x, y)) {
      wx.setClipboardData({ data: roomCode, success: () => wx.showToast({ title: '房间号已复制', icon: 'success' }) });
    } else if (hit(rects.shareRoom, x, y)) {
      shareRoom();
    }
    return;
  }

  if (overlayTab === 'join') {
    if (hit(rects.joinInput, x, y)) {
      wx.showKeyboard ? null : null;
      wx.showModal({
        title: '输入房间号',
        editable: true,
        placeholderText: '例如 ABC123',
        success: (r) => {
          if (r.confirm && r.content) { joinInput = (r.content || '').toUpperCase().trim(); joinError = ''; }
        },
      });
      return;
    }
    if (hit(rects.doJoin, x, y)) {
      const code = joinInput.trim();
      if (!code) { joinError = '请输入房间号'; return; }
      wsManager.send('join_room', { roomId: code });
      overlay = 'inroom';
      roomRole = 'joiner';
    }
  }
}

function handleInRoomTouch(x, y) {
  if (hit(rects.closeRoom, x, y)) { leaveRoom(); return; }
  if (hit(rects.copyRoom, x, y)) {
    wx.setClipboardData({ data: roomCode, success: () => wx.showToast({ title: '房间号已复制', icon: 'success' }) });
    return;
  }
  if (hit(rects.shareRoom, x, y)) { shareRoom(); return; }
  if (hit(rects.leaveRoom, x, y)) { leaveRoom(); return; }
}

function leaveRoom() {
  wsManager.send('leave_room', { roomId: roomCode });
  overlay = null;
  roomCode = '';
  roomRole = '';
}

function startMatch() {
  if (state.energy.current < 5) { wx.showToast({ title: '精力不足，请等待恢复', icon: 'none' }); return; }
  wsManager.send('match_start');
  overlay = 'matching';
}

function openInvite() {
  if (state.energy.current < 5) { wx.showToast({ title: '精力不足，请等待恢复', icon: 'none' }); return; }
  // 已创建房间仍在等待 → 直接回到等待界面
  if (roomCode && overlay === 'inroom' && roomRole === 'creator') { overlay = 'inroom'; return; }
  overlay = 'room';
  overlayTab = 'create';
  if (!roomCode) wsManager.send('invite_room');
}

function shareRoom() {
  if (!roomCode) return;
  // 小游戏分享给好友，带 query.room，好友点开可自动进房
  wx.shareAppMessage && wx.shareAppMessage({
    title: '【六儿】邀你来对战！房间号 ' + roomCode,
    imageUrl: '',
    query: { room: roomCode },
    success: () => wx.showToast({ title: '已唤起分享', icon: 'success' }),
    fail: () => wx.showToast({ title: '分享取消', icon: 'none' }),
  });
}

module.exports = { onEnter, onDraw, onTouch, onWs: () => {} };
