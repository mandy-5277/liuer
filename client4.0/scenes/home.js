/**
 * 下六儿 小游戏版 — 首页大厅场景
 * 设计依据：figma.md #page-home（375×812 基准，暖金棕国风）
 *
 * 布局：顶部资源栏 → 中央（标题+棋盘动画+按钮）→ 个人信息卡（段位/积分/胜率/精力条）→ 规则入口 → 底部导航
 * 用 Canvas 绘制；好友开局弹出双 Tab 浮层（复制房间号 / 进入房间）。
 */

const { wsManager } = require('../utils/websocket');
const { state } = require('../state');
const { PALETTE, drawButton, drawText, drawCard, drawAvatar, hit, roundRect, drawBottomNav } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 812;
let rects = {};

// 浮层状态
let overlay = null;          // null | 'matching' | 'room'
let overlayTab = 'create';   // 'create' 复制房间号 | 'join' 进入房间
let roomCode = '';           // 当前创建/加入的房间号
let joinInput = '';          // 进入房间输入的房间号
let joinError = '';
const inviters = [];         // 收到的邀请 { roomId, nickName }

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

function onLeave() {
  // 离开首页时清理 WS 监听，避免 game_start 等跳转类监听残留导致重复触发场景切换
  removeWs();
}

function registerWs() {
  // 进入场景前先清掉旧监听，避免重复注册导致一次 game_start 触发多次场景跳转
  removeWs();
  wsManager.on('match_status', (data) => {
    overlay = data.status === 'matching' ? 'matching' : (data.status === 'cancelled' ? null : overlay);
  });
  wsManager.on('game_start', (data) => {
    overlay = null;
    state.currentGame = data;
    sceneMgr.goto('match', data);
  });
  wsManager.on('room_created', (data) => {
    overlayTab = 'create';
    roomCode = data.roomId;
  });
  wsManager.on('join_room_success', (data) => {
    overlayTab = 'create';
    roomCode = data.roomId;
  });
  wsManager.on('room_cancelled', () => {
    if (overlay === 'room') {
      wx.showToast({ title: '对方已离开房间', icon: 'none' });
      overlay = null;
      roomCode = '';
      joinInput = '';
      joinError = '';
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
    if (data.energy !== undefined) state.energy.current = data.energy;
    if (data.energyRecoverAt !== undefined) state.energy.nextRecoverAt = data.energyRecoverAt;
    if (data.energyMax !== undefined) state.energy.max = data.energyMax;
    if (data.rankScore !== undefined) state.rankScore = data.rankScore;
    if (data.rankName) state.rankName = data.rankName;
  });
  wsManager.on('sign_in_result', (data) => {
    wx.showToast({ title: '签到成功 +' + ((data && data.energy) ? 5 : 0) + '精力', icon: 'success' });
  });
  wsManager.on('ad_reward_result', (data) => {
    wx.showToast({ title: '精力 +' + ((data && data.reward) || 10), icon: 'success' });
  });
  wsManager.on('share_reward_result', (data) => {
    wx.showToast({ title: '精力 +' + ((data && data.reward) || 5), icon: 'success' });
  });
  wsManager.on('error', (data) => {
    const msg = data && data.errMsg ? data.errMsg : '操作失败';
    wx.showToast({ title: msg, icon: 'none' });
    if (overlay === 'matching' && /房间/.test(msg)) overlay = null;
  });
}

function removeWs() {
  wsManager.off('match_status');
  wsManager.off('game_start');
  wsManager.off('room_created');
  wsManager.off('join_room_success');
  wsManager.off('room_cancelled');
  wsManager.off('room_expired');
  wsManager.off('invite_received');
  wsManager.off('resource_update');
  wsManager.off('error');
}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;
  drawBackground(ctx);
  drawTopBar(ctx);
  const btnBottom = drawCenter(ctx);
  const navTop = H - 64; // 底部导航顶
  drawBottomNav(ctx, 'home', rects);
  drawProfileCard(ctx, navTop - 152);
  drawRuleLink(ctx, navTop - 22);
  rects.W = W; rects.H = H;

  if (overlay === 'matching') drawMatchingOverlay(ctx);
  else if (overlay === 'room') drawRoomOverlay(ctx);
  else if (overlay === 'energy') drawEnergyOverlay(ctx);

  // 微信用户信息授权提示遮罩（授权浮层位于屏幕底部，这里仅作视觉提示）
  if (state.authPending) drawAuthMask(ctx);
}

function drawAuthMask(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.55)';
  ctx.fillRect(0, 0, W, H);
  const cy = state.statusBarHeight + 90;
  drawText(ctx, '请先授权微信昵称头像', W / 2, cy, { color: PALETTE.text, fontSize: 22, align: 'center', bold: true });
  drawText(ctx, '点击下方按钮完成授权后即可开始游戏', W / 2, cy + 32, { color: PALETTE.textDim, fontSize: 15, align: 'center' });
}

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// 顶部资源栏：精力值 + 下次恢复倒计时
function drawTopBar(ctx) {
  const y = state.statusBarHeight + 4;
  const right = W - 16;
  const recover = state.energy.nextRecoverAt > Date.now()
    ? formatCd(state.energy.nextRecoverAt)
    : '';
  drawText(ctx, '⚡ ' + state.energy.current + '/' + state.energy.max + (recover ? '  下次+' + recover : ''), right, y + 16, { color: PALETTE.green, fontSize: 15, align: 'right' });
}

// 中央：标题 + 棋盘动画 + 按钮
function drawCenter(ctx) {
  const cx = W / 2;
  const topY = state.statusBarHeight + 40;

  drawText(ctx, '下六儿', cx, topY + 16, { color: PALETTE.text, fontSize: 28, align: 'center', bold: true });

  // 棋盘动画卡 200x200（适配 667 高度）
  const bSize = 200;
  const bx = (W - bSize) / 2;
  const by = topY + 28;
  drawCard(ctx, { x: bx, y: by, w: bSize, h: bSize, radius: 16 });
  drawBoardAnimation(ctx, bx + 12, by + 12, bSize - 24);

  drawText(ctx, '落子布局 · 揪子博弈 · 走子决胜', cx, by + bSize + 20, { color: PALETTE.textDim, fontSize: 13, align: 'center' });

  // 按钮组
  const btnW = W - 94;
  const btnH = 44;
  const mx = (W - btnW) / 2;
  const y1 = by + bSize + 32;
  const y2 = y1 + btnH + 8;

  drawText(ctx, '消耗 5 点精力', cx, y1 - 6, { color: PALETTE.textDim, fontSize: 11, align: 'center' });
  rects.match = drawButton(ctx, { text: '⚔ 随机匹配', x: mx, y: y1, w: btnW, h: btnH, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 20 });
  rects.friend = drawButton(ctx, { text: '👥 邀请好友开局', x: mx, y: y2, w: btnW, h: btnH, fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 20, border: PALETTE.gold });
  return y2 + btnH;
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

// 个人信息卡（传入顶部 y，高度固定 120，参照 figma 首页个人信息卡）
function drawProfileCard(ctx, cardY) {
  const cardX = 16;
  const cardW = W - 32;
  const cardH = 120;
  drawCard(ctx, { x: cardX, y: cardY, w: cardW, h: cardH, radius: 16 });

  const cy = cardY + 30;
  drawAvatar(ctx, { x: cardX + 34, y: cy, r: 22, label: (state.userInfo && state.userInfo.nickName) || '我', ring: true });

  drawText(ctx, (state.userInfo && state.userInfo.nickName) || '我', cardX + 70, cy - 8, { color: PALETTE.text, fontSize: 19, bold: true });
  // 段位徽章
  const badgeW = 74;
  const badgeX = cardX + 70;
  const badgeY = cy + 8;
  roundRect(ctx, badgeX, badgeY, badgeW, 22, 11);
  ctx.fillStyle = PALETTE.goldBright;
  ctx.fill();
  drawText(ctx, state.rankName || '初级小六', badgeX + badgeW / 2, badgeY + 15, { color: PALETTE.textOnGold, fontSize: 12, align: 'center', bold: true });

  // 积分 / 胜率
  drawText(ctx, '' + (state.rankScore || 0), cardX + cardW - 90, cy - 4, { color: PALETTE.gold, fontSize: 22, align: 'center', bold: true });
  drawText(ctx, '积分', cardX + cardW - 90, cy + 16, { color: PALETTE.textDim, fontSize: 12, align: 'center' });
  drawText(ctx, (state.winRate || 0) + '%', cardX + cardW - 30, cy - 4, { color: PALETTE.green, fontSize: 22, align: 'center', bold: true });
  drawText(ctx, '胜率', cardX + cardW - 30, cy + 16, { color: PALETTE.textDim, fontSize: 12, align: 'center' });

  // 精力进度条
  const barX = cardX + 16;
  const barY = cardY + 72;
  const barW = cardW - 32;
  drawText(ctx, '精力 ' + state.energy.current + '/' + state.energy.max, barX, barY - 6, { color: PALETTE.text, fontSize: 12 });
  roundRect(ctx, barX, barY, barW, 8, 4);
  ctx.fillStyle = PALETTE.panelBorder;
  ctx.fill();
  const pct = Math.max(0, Math.min(1, state.energy.current / state.energy.max));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, 8, 4);
    ctx.fillStyle = PALETTE.green;
    ctx.fill();
  }
  drawText(ctx, '下次恢复 ⏳ ' + formatCd(state.energy.nextRecoverAt), W - 16, barY + 24, { color: PALETTE.textDim, fontSize: 11, align: 'right' });
}

function formatCd(ts) {
  if (!ts) return '00:00';
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

function drawRuleLink(ctx, y) {
  rects.ruleLink = { x: 0, y, w: W, h: 24 };
  drawText(ctx, '游戏规则 ▶', W / 2, y + 12, { color: PALETTE.textDim, fontSize: 15, align: 'center' });
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

function dim(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
}

// ========== 触摸 ==========
function onTouch(x, y) {
  // 微信用户信息授权浮层显示期间，禁用所有其它按钮，避免与授权按钮重叠触发
  if (state.authPending) return;

  if (overlay === 'matching') {
    if (hit(rects.cancelMatch, x, y)) { wsManager.send('match_cancel'); overlay = null; }
    return;
  }
  if (overlay === 'room') { handleRoomTouch(x, y); return; }
  if (overlay === 'energy') { handleEnergyTouch(x, y); return; }

  if (hit(rects.match, x, y)) { startMatch(); return; }
  if (hit(rects.friend, x, y)) { openInvite(); return; }
  if (hit(rects.ruleLink, x, y)) { sceneMgr.goto('rules'); return; }
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
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
      // 加入成功后服务端会自动 game_start，浮层由 game_start 事件关闭
    }
  }
}

function leaveRoom() {
  wsManager.send('leave_room', { roomId: roomCode });
  overlay = null;
  roomCode = '';
  joinInput = '';
  joinError = '';
}

function startMatch() {
  if (state.energy.current < 5) { overlay = 'energy'; return; }
  wsManager.send('match_start');
  overlay = 'matching';
}

function openInvite() {
  if (state.energy.current < 5) { overlay = 'energy'; return; }
  overlay = 'room';
  overlayTab = 'create';
  if (!roomCode) wsManager.send('invite_room');
}

function shareRoom() {
  if (!roomCode) return;
  // 小游戏分享给好友，带 query.room，好友点开可自动进房
  wx.shareAppMessage && wx.shareAppMessage({
    title: '【下六儿】邀你来对战！房间号 ' + roomCode,
    imageUrl: '',
    query: { room: roomCode },
    success: () => wx.showToast({ title: '已唤起分享', icon: 'success' }),
    fail: () => wx.showToast({ title: '分享取消', icon: 'none' }),
  });
}

// ========== 精力不足恢复浮层 ==========
function drawEnergyOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.86, ph = 420, px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  rects.closeEnergy = { x: px + pw - 40, y: py + 12, w: 28, h: 28 };
  drawText(ctx, '✕', px + pw - 26, py + 32, { color: PALETTE.textDim, fontSize: 22, align: 'center' });

  drawText(ctx, '精力不足', W / 2, py + 48, { color: PALETTE.text, fontSize: 28, align: 'center', bold: true });
  drawText(ctx, '每局消耗 5 点 · 每 5 分钟自动恢复 1 点（离线也计）', W / 2, py + 82, { color: PALETTE.textDim, fontSize: 14, align: 'center' });

  const bx = px + 40, bw = pw - 80, by = py + 116, bh = 52, gap = 14;
  rects.adEnergy = drawButton(ctx, { text: '看广告恢复精力 +10（每日3次）', x: bx, y: by, w: bw, h: bh, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 19 });
  rects.shareEnergy = drawButton(ctx, { text: '分享得精力 +5（每日5次）', x: bx, y: by + (bh + gap), w: bw, h: bh, fill: PALETTE.green, textColor: '#FFFFFF', fontSize: 19 });
  rects.signEnergy = drawButton(ctx, { text: '每日签到 +5', x: bx, y: by + (bh + gap) * 2, w: bw, h: bh, fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 19, border: PALETTE.gold });

  drawText(ctx, '也可等待自然恢复，关闭后继续', W / 2, py + ph - 26, { color: PALETTE.textDim, fontSize: 13, align: 'center' });
}

function handleEnergyTouch(x, y) {
  if (hit(rects.closeEnergy, x, y)) { overlay = null; return; }
  if (hit(rects.adEnergy, x, y)) {
    wx.showLoading && wx.showLoading({ title: '获取中', mask: true });
    wsManager.send('get_ad_reward');
    setTimeout(() => wx.hideLoading && wx.hideLoading(), 800);
    overlay = null;
    return;
  }
  if (hit(rects.shareEnergy, x, y)) {
    wsManager.send('get_share_reward');
    wx.showToast({ title: '已获得精力 +5', icon: 'success' });
    overlay = null;
    return;
  }
  if (hit(rects.signEnergy, x, y)) {
    wx.showLoading && wx.showLoading({ title: '签到中', mask: true });
    wsManager.send('sign_in');
    setTimeout(() => wx.hideLoading && wx.hideLoading(), 800);
    overlay = null;
    return;
  }
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs: () => {} };
