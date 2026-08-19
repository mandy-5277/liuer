/**
 * 下六儿 小游戏版 — 首页大厅场景
 * 设计依据：figma.md #page-home（375×812 基准，暖金棕国风）
 *
 * 布局：顶部资源栏 → 中央（标题+棋盘动画+按钮）→ 个人信息卡（段位/积分/胜率/精力条）→ 规则入口 → 底部导航
 * 用 Canvas 绘制；好友开局弹出双 Tab 浮层（复制房间号 / 进入房间）。
 */

const { wsManager } = require('../utils/websocket');
const { state, saveProfile, AVATAR_PRESETS, randomNickname } = require('../state');
const { PALETTE, drawButton, drawText, drawCard, drawAvatar, hit, roundRect, drawBottomNav } = require('../utils/ui');
const { SERVER_BASE } = require('../config');
const sceneMgr = require('./index');

let W = 375;
let H = 812;
let rects = {};

// 浮层状态
let overlay = null;          // null | 'matching' | 'room' | 'energy' | 'profileSetup'
let overlayTab = 'create';   // 'create' 复制房间号 | 'join' 进入房间
let roomCode = '';           // 当前创建/加入的房间号
let joinInput = '';          // 进入房间输入的房间号
let joinError = '';
const inviters = [];         // 收到的邀请 { roomId, nickName }

// 完善资料浮层状态
let profileNick = '';
let profileAvatar = 'emoji:' + AVATAR_PRESETS[0];
let profileAvatarIndex = 0;

let fightPhase = 0;          // 棋盘打架动画相位

// ========== 生命周期 ==========

function onEnter() {
  overlay = null;
  overlayTab = 'create';
  roomCode = '';
  joinInput = '';
  joinError = '';
  registerWs();

  // 首次进入且未设置资料：弹出"完善资料"浮层
  if (state.showProfileSetup) {
    profileNick = randomNickname();
    profileAvatar = 'emoji:' + AVATAR_PRESETS[0];
    profileAvatarIndex = 0;
    overlay = 'profileSetup';
  }

  // 分享卡片带房间号 → 启动后自动进房
  handlePendingRoom();
}

function handlePendingRoom() {
  if (!state.pendingRoom) return;
  const code = state.pendingRoom;
  state.pendingRoom = '';
  if (!wsManager.isConnected) {
    // 连接尚未就绪时延后重试（登录/WS 连接异步）
    setTimeout(handlePendingRoom, 300);
    state.pendingRoom = code;
    return;
  }
  wsManager.send('join_room', { roomId: code });
  overlay = 'matching';
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
    if (data && data.energy !== undefined) state.energy.current = data.energy;
    const reward = data && data.bonus ? data.bonus : ((new Date().getDay() % 6 === 0) ? 10 : 5);
    wx.showToast({ title: '签到成功 +' + reward + '精力', icon: 'success' });
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

  // 首次进入且未设置资料：即刻弹出"完善资料"浮层（login 异步完成前 onEnter 可能未命中，
  // 这里在每帧检测，保证一旦 showProfileSetup 置位立即引导，不先进入正常游戏）
  if (state.showProfileSetup && !overlay) {
    profileNick = randomNickname();
    profileAvatar = 'emoji:' + AVATAR_PRESETS[0];
    profileAvatarIndex = 0;
    overlay = 'profileSetup';
  }

  // 热启动：分享卡片带房间号且当前在首页时，自动加入房间
  handlePendingRoom();

  drawBackground(ctx);
  drawTopBar(ctx);
  const btnBottom = drawCenter(ctx);
  const navTop = H - 64; // 底部导航顶
  drawBottomNav(ctx, 'home', rects);
  drawProfileCard(ctx, navTop - 150);
  drawRuleLink(ctx, navTop - 24);
  rects.W = W; rects.H = H;

  if (overlay === 'matching') drawMatchingOverlay(ctx);
  else if (overlay === 'room') drawRoomOverlay(ctx);
  else if (overlay === 'energy') drawEnergyOverlay(ctx);
  else if (overlay === 'profileSetup') drawProfileSetupOverlay(ctx);

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

// 顶部资源栏：仅显示下次恢复倒计时（精力值已在个人信息卡展示，避免重复）
function drawTopBar(ctx) {
  const y = state.statusBarHeight + 4;
  const right = W - 16;
  const recover = state.energy.nextRecoverAt > Date.now()
    ? formatCd(state.energy.nextRecoverAt)
    : '';
  if (!recover) return;
  drawText(ctx, '⏳ 下次+' + recover, right, y + 16, { color: PALETTE.textDim, fontSize: 13, align: 'right' });
}

// 中央：标题 + 棋盘动画 + 按钮
function drawCenter(ctx) {
  const cx = W / 2;
  const topY = state.statusBarHeight + 40;

  // 标题：选用古朴/乡村气息的中文字体（楷体/华文中宋等）
  drawText(ctx, '下六儿', cx, topY + 16, {
    color: PALETTE.text, fontSize: 30, align: 'center', bold: true,
    family: '"KaiTi","STKaiti","楷体","STZhongsong","华文中宋","华文仿宋","Microsoft YaHei",sans-serif',
  });

  // 棋盘动画卡（随屏高自适应，为下方按钮与信息卡留位）
  const bSize = Math.min(165, Math.round(H * 0.24));
  const bx = (W - bSize) / 2;
  const by = topY + 28;
  drawCard(ctx, { x: bx, y: by, w: bSize, h: bSize, radius: 16 });
  drawBoardAnimation(ctx, bx + 12, by + 12, bSize - 24);

  drawText(ctx, '落子布局 · 揪子博弈 · 走子决胜', cx, by + bSize + 20, { color: PALETTE.textDim, fontSize: 13, align: 'center' });

  // 按钮组：增高 + 增大间隔 + 下移（相对底部导航自适应，按钮顶落在屏幕中下部，方便点按）
  const navTop = H - 64;
  const btnW = W - 84;
  const btnH = 52;
  const mx = (W - btnW) / 2;
  let y1 = navTop - 282;
  const sloganBottom = by + bSize + 24;
  if (y1 < sloganBottom + 22) y1 = sloganBottom + 22; // 避免与 slogan 重叠
  const y2 = y1 + btnH + 14;

  drawText(ctx, '消耗 5 点精力', cx, y1 - 8, { color: PALETTE.textDim, fontSize: 12, align: 'center' });
  rects.match = drawButton(ctx, { text: '⚔ 随机匹配', x: mx, y: y1, w: btnW, h: btnH, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });
  rects.friend = drawButton(ctx, { text: '👥 邀请好友开局', x: mx, y: y2, w: btnW, h: btnH, fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 22, border: PALETTE.gold });
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
  // 打架动画：两子左右来回（参考 figma fight1/fight2，幅度 ±12px）
  const off = Math.sin(Date.now() / 420) * 12;
  const r1 = step * 0.36;
  drawPieceAt(ctx, ox + 2 * step + off, oy + 2 * step, r1, 'black');
  drawPieceAt(ctx, ox + 3 * step - off, oy + 3 * step, r1, 'white');
}

function drawPieceAt(ctx, x, y, r, color) {
  // 阴影
  ctx.beginPath();
  ctx.arc(x, y + 1, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,47,40,0.18)';
  ctx.fill();
  // 棋子本体（半透明，呼应 figma 风格）
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (color === 'black') {
    ctx.fillStyle = 'rgba(26,26,26,0.55)';
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(254,254,254,0.55)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(208,208,208,0.7)';
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
  drawAvatar(ctx, { x: cardX + 34, y: cy, r: 22, label: (state.userInfo && state.userInfo.nickName) || '我', avatar: (state.userInfo && state.userInfo.avatarUrl) || '', ring: true });

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
  const pw = W * 0.8, ph = Math.max(220, Math.round(H * 0.36)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });
  drawText(ctx, '匹配中...', W / 2, py + 70, { color: PALETTE.text, fontSize: 32, align: 'center', bold: true });
  drawText(ctx, '正在为你寻找对手', W / 2, py + 120, { color: PALETTE.textDim, fontSize: 20, align: 'center' });
  rects.cancelMatch = drawButton(ctx, { text: '取消匹配', x: px + 40, y: py + ph - 80, w: pw - 80, h: 56, fill: PALETTE.red, textColor: '#FFFFFF', fontSize: 24 });
}

// ========== 好友开局浮层（双 Tab） ==========
function drawRoomOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.86, ph = Math.max(360, Math.round(H * 0.58)), px = (W - pw) / 2, py = (H - ph) / 2;
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
  if (overlay === 'profileSetup') { handleProfileSetupTouch(x, y); return; }

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
      wx.showToast({ title: '复制中...', icon: 'loading' });
      wx.setClipboardData({
        data: roomCode,
        success: () => {
          wx.showToast({ title: '房间号已复制', icon: 'success' });
        },
        fail: (err) => {
          console.error('[Home] 复制房间号失败:', err);
          wx.showModal({ title: '复制失败', content: '请手动复制房间号：' + roomCode, showCancel: false });
        },
      });
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
  const pw = W * 0.86, ph = Math.max(400, Math.round(H * 0.62)), px = (W - pw) / 2, py = (H - ph) / 2;
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

// ========== 完善资料浮层（引导设置昵称 + 头像） ==========
function drawProfileSetupOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.88, ph = Math.max(440, Math.round(H * 0.68)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });

  drawText(ctx, '完善资料', W / 2, py + 44, { color: PALETTE.text, fontSize: 28, align: 'center', bold: true });

  // 当前选中的头像（大圆）
  const bigR = 46;
  drawAvatar(ctx, { x: W / 2, y: py + 110, r: bigR, avatar: profileAvatar, label: profileNick.slice(0, 1), ring: true });

  // 预设头像排（6 个 emoji）
  const avatarR = 26;
  const gap = (pw - 48 - avatarR * 2 * 3) / 2; // 每行3个
  const startX = px + 24 + avatarR;
  const rowY = py + 175;
  rects.presetAvatars = [];
  AVATAR_PRESETS.forEach((emoji, i) => {
    const ax = startX + (i % 3) * ((avatarR * 2 + gap));
    const ay = rowY + Math.floor(i / 3) * (avatarR * 2 + 14);
    const selected = i === profileAvatarIndex;
    ctx.beginPath();
    ctx.arc(ax, ay, avatarR + 3, 0, Math.PI * 2);
    ctx.fillStyle = selected ? PALETTE.gold : '#F0E9DB';
    ctx.fill();
    drawAvatar(ctx, { x: ax, y: ay, r: avatarR, avatar: 'emoji:' + emoji, label: '' });
    rects.presetAvatars.push({ x: ax - avatarR - 3, y: ay - avatarR - 3, w: avatarR * 2 + 6, h: avatarR * 2 + 6, emoji });
  });

  // 上传相册按钮
  rects.uploadAvatar = drawButton(ctx, {
    text: '上传相册图片', x: px + 40, y: py + 252, w: pw - 80, h: 44,
    fill: PALETTE.panel, textColor: PALETTE.green, fontSize: 18, border: PALETTE.green,
  });

  // 昵称区
  drawText(ctx, '我的昵称', px + 24, py + 318, { color: PALETTE.textDim, fontSize: 16 });
  drawText(ctx, profileNick || '未设置', px + 24, py + 352, { color: PALETTE.text, fontSize: 24, bold: true });
  rects.nickShuffle = drawButton(ctx, {
    text: '换一个', x: px + pw - 180, y: py + 326, w: 80, h: 38,
    fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 16, border: PALETTE.gold,
  });
  rects.nickEdit = drawButton(ctx, {
    text: '输入昵称', x: px + pw - 92, y: py + 326, w: 72, h: 38,
    fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 16,
  });

  // 确定
  rects.profileConfirm = drawButton(ctx, {
    text: '开始游戏', x: px + 40, y: py + ph - 64, w: pw - 80, h: 48,
    fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22,
  });
}

function handleProfileSetupTouch(x, y) {
  // 预设头像选择
  if (rects.presetAvatars) {
    for (let i = 0; i < rects.presetAvatars.length; i++) {
      if (hit(rects.presetAvatars[i], x, y)) {
        profileAvatarIndex = i;
        profileAvatar = 'emoji:' + AVATAR_PRESETS[i];
        return;
      }
    }
  }
  // 上传相册图片
  if (hit(rects.uploadAvatar, x, y)) { uploadAvatar(); return; }
  // 随机昵称
  if (hit(rects.nickShuffle, x, y)) { profileNick = randomNickname(); return; }
  // 输入昵称
  if (hit(rects.nickEdit, x, y)) {
    wx.showModal({
      title: '设置昵称',
      editable: true,
      placeholderText: '请输入昵称（最多10字）',
      success: (r) => { if (r.confirm && r.content && r.content.trim()) profileNick = r.content.trim().slice(0, 10); },
    });
    return;
  }
  // 确定
  if (hit(rects.profileConfirm, x, y)) {
    if (!profileNick.trim()) { wx.showToast({ title: '请先设置昵称', icon: 'none' }); return; }
    saveProfile(profileNick.trim(), profileAvatar);
    wsManager.send('update_profile', { nickName: profileNick.trim(), avatarUrl: profileAvatar });
    overlay = null;
    return;
  }
}

/** 选择相册图片并上传，成功后作为头像 */
function uploadAvatar() {
  wx.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album'],
    success: (res) => {
      const tempPath = res.tempFilePaths && res.tempFilePaths[0];
      if (!tempPath) return;
      wx.showLoading({ title: '上传中', mask: true });
      // 转 base64
      wx.getFileSystemManager().readFile({
        filePath: tempPath,
        encoding: 'base64',
        success: (fr) => {
          wx.request({
            url: SERVER_BASE + '/api/avatar/upload',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: { openid: state.openid || '', base64: fr.data || '' },
            success: (rr) => {
              wx.hideLoading();
              if (rr.statusCode === 200 && rr.data && rr.data.ok && rr.data.url) {
                profileAvatar = rr.data.url;
                profileAvatarIndex = -1;
                wx.showToast({ title: '头像已更新', icon: 'success' });
              } else {
                wx.showToast({ title: '上传失败', icon: 'none' });
              }
            },
            fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }); },
          });
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '读取图片失败', icon: 'none' }); },
      });
    },
  });
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs: () => {} };
