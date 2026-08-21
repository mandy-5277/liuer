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
let myCreatedRoomCode = '';  // 自己创建的房间号（用于拦截"进自己房间"）
let joinInput = '';          // 进入房间输入的房间号
let joinError = '';
const inviters = [];         // 收到的邀请 { roomId, nickName }
let matchStartTs = 0;        // 匹配开始时间戳（ms），用于显示匹配计时

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
  // 阻断：不能进入自己创建的房间（自己点自己分享的卡片）
  if (myCreatedRoomCode && code.toUpperCase() === myCreatedRoomCode.toUpperCase()) {
    wx.showToast({ title: '不能进入自己创建的房间', icon: 'none' });
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
    const wasMatching = overlay === 'matching';
    overlay = data.status === 'matching' ? 'matching' : (data.status === 'cancelled' ? null : overlay);
    if (overlay === 'matching' && !wasMatching) {
      matchStartTs = Date.now();
    }
  });
  wsManager.on('game_start', (data) => {
    overlay = null;
    state.currentGame = data;
    sceneMgr.goto('match', data);
  });
  wsManager.on('room_created', (data) => {
    overlayTab = 'create';
    roomCode = data.roomId;
    myCreatedRoomCode = data.roomId;
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
    const msg = data && data.errMsg ? data.errMsg : '';
    // 过滤良性/瞬时错误：
    // 1) 空 errMsg（服务器发的 error = {} 探针，不影响游戏）
    // 2) 请先登录（重连/命令早于登录完成时的竞态）
    // 3) 未知指令（命令名拼写错误等开发期问题）
    if (!msg || msg === '请先登录' || /未知指令/.test(msg)) return;
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
  // ctx.canvas.width 为物理尺寸，需除以像素比得到逻辑尺寸
  const pr = state.pixelRatio || 1;
  W = ctx.canvas.width / pr;
  H = ctx.canvas.height / pr;

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
  // 绘制顺序（自上而下）：
  //   标题 + 棋盘 + slogan → 按钮 → 个人信息板 → 游戏规则
  const btnBottom = drawCenter(ctx);
  const navTop = H - 64; // 底部导航顶
  rects.W = W; rects.H = H;          // 先设置逻辑尺寸，供 drawBottomNav 使用
  drawBottomNav(ctx, 'home', rects);

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

// 中央：标题 → 棋盘 → slogan → 按钮 → 姓名板 → 游戏规则（整体垂直居中，间距均匀）
function drawCenter(ctx) {
  const cx = W / 2;
  const navTop = H - 64;      // 底部导航顶
  const ruleH = 28;           // 游戏规则行高
  const profileH = 120;       // 姓名板高度
  const btnH = 46, btnW = W - 84, mx = (W - btnW) / 2;

  // 各区块之间的间距（控制疏密）
  const gapTitleBoard = 20;   // 标题与棋盘间距
  const gapBoardSlogan = 20;  // 棋盘与 slogan 间距
  const gapSloganBtn = 72;    // slogan 与按钮间距
  const gapBtnProfile = 16;   // 按钮与姓名板间距
  const gapProfileRule = 8; // 姓名板与游戏规则间距
  const gapRuleNav = 8;     // 游戏规则与底部导航间距（= 姓名板-游戏规则间距）

  // 固定各区块高度
  const titleH = 46;          // 标题行高（含大字）
  const sloganH = 20;         // slogan 行高

  // 可用纵向范围：状态栏下方 ~ 底部导航上方
  const availTop = state.statusBarHeight + 8;
  const availBottom = navTop;
  const availH = availBottom - availTop;

  // 先计算除棋盘外的固定高度，反推棋盘尺寸（尽量大但留出上下留白）
  const fixedH = titleH + gapTitleBoard + gapBoardSlogan + sloganH
    + gapSloganBtn + (btnH * 2 + 12) + gapBtnProfile + profileH + gapProfileRule
    + ruleH + gapRuleNav;
  // 给棋盘留出边距（上标题下 slogan）。为了让按钮/姓名板/游戏规则明显下移，
  // 刻意把棋盘压小一些，把纵向空间让给下方的"按钮→姓名板→游戏规则"区块。
  // 棋盘边长 = 可用高 - 固定高 - 额外留白（这里的 extraTop 同时作为顶部下移量）
  const extraTop = 64 // ← 想下移更多就调大这个值（同时会压小棋盘）
  let boardH = Math.max(110, Math.min(200, availH - fixedH - extraTop));

  // 整个内容栈的总高度（含棋盘）
  let stackH = fixedH + boardH;
  // 若栈高超出可用区，压缩棋盘以确保不溢出（避免短屏被裁切）
  if (stackH > availH) {
    boardH = Math.max(100, boardH - (stackH - availH) - 8);
    stackH = fixedH + boardH;
  }
  // 栈顶 y：从顶部固定下移 extraTop，使按钮/姓名板/游戏规则整体下移
  const stackTop = availTop + extraTop;

  // 依序推算各区块 y
  const titleBaseline = stackTop + titleH;
  const boardY = stackTop + titleH + gapTitleBoard;
  const sloganY = boardY + boardH + gapBoardSlogan;
  const y1 = sloganY + sloganH + gapSloganBtn;              // 第一按钮顶
  const y2 = y1 + btnH + 12;                                 // 第二按钮顶
  const profileTop = y2 + btnH + gapBtnProfile;              // 姓名板顶
  const ruleY = profileTop + profileH + gapProfileRule + ruleH / 2; // 游戏规则基线

  // === 标题 ===
  drawTitlePlayful(ctx, cx, titleBaseline);

  // === 棋盘卡 ===
  const bx = (W - boardH) / 2;
  drawBoardAnimationCard(ctx, bx, boardY, boardH);

  // === Slogan ===
  drawText(ctx, '落子布局 · 揪子博弈 · 走子决胜', cx, sloganY, { color: PALETTE.textDim, fontSize: 13, align: 'center' });

  // === 按钮组（在姓名板【上方】） ===
  drawText(ctx, '消耗 5 点精力', cx, y1 - 7, { color: PALETTE.textDim, fontSize: 11, align: 'center' });
  rects.match = drawButton(ctx, { text: '⚔ 随机匹配', x: mx, y: y1, w: btnW, h: btnH, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 21 });
  rects.friend = drawButton(ctx, { text: '👥 邀请好友开局', x: mx, y: y2, w: btnW, h: btnH, fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 21, border: PALETTE.gold });

  // === 姓名板 ===
  drawProfileCard(ctx, profileTop);
  // === 游戏规则 ===
  drawRuleLink(ctx, ruleY);

  return y2 + btnH;
}

/**
 * 标题"下六儿"：调皮字体
 *  - "下六"：大字号 + 粗 + 卡通风（圆体首选）+ 主色棕
 *  - "儿"：小字号，靠在"六"的右下角略偏移
 */
function drawTitlePlayful(ctx, cx, y) {
  // "下六" 大字（圆体偏可爱，整体棕褐色）
  ctx.save();
  const mainSize = 36;
  const mainFont = '"Yuppy SC","Hiragino Maru Gothic ProN","Yuanti SC","Comic Sans MS","Marker Felt","PingFang SC","Microsoft YaHei",sans-serif';
  const mainColor = PALETTE.text; // 统一深棕
  ctx.font = `bold ${mainSize}px ${mainFont}`;
  ctx.fillStyle = mainColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const mainText = '下六';
  const mainW = ctx.measureText(mainText).width;
  ctx.fillText(mainText, cx, y);
  // 用对齐"下六"的右侧来定位"儿"，确保不与"六"重叠
  // "下六"以 cx 为中心，右边缘 = cx + mainW/2
  const sixRightEdge = cx + mainW / 2;
  // "儿" 小字：起点在"六"右边缘再往右 2px 处，向下落到基线附近，颜色统一深棕
  const subSize = 18;
  ctx.font = `bold ${subSize}px ${mainFont}`;
  const subText = '儿';
  ctx.textAlign = 'left';
  const subX = sixRightEdge + 2;
  const subY = y + 6;
  ctx.fillStyle = mainColor;
  ctx.fillText(subText, subX, subY);
  ctx.restore();
}

/**
 * 棋盘卡（figma 风格）
 *  外层：白底圆角卡（E8E3DA 描边）
 *  中层：暖米色 #E8DBCF 棋盘底（不超出边线，但外层白底做一圈留白）
 *  网格：深棕 #3C2F28，1.5px 细线
 *  交叉点：暖灰小圆 #C0B8A8
 *  棋子：实色（黑 #1A1A1A / 白 #FEFEFE + 灰描边）
 *  打架动画：两子左右来回 ±12px
 */
function drawBoardAnimationCard(ctx, bx, by, bSize) {
  // 外卡：白底 + 描边（白边距留大一点，让外圈白底清晰可见）
  drawCard(ctx, { x: bx, y: by, w: bSize, h: bSize, radius: 18, fill: '#FFFFFF', border: '#E8E3DA' });
  // 内棋盘：暖米色填充（缩进 12px，确保外圈白底清晰）
  const pad = 14;
  const ix = bx + pad, iy = by + pad, iw = bSize - pad * 2, ih = bSize - pad * 2;
  roundRect(ctx, ix, iy, iw, ih, 10);
  ctx.fillStyle = '#E8DBCF';
  ctx.fill();

  // 网格区：再向内缩进 10px，让网格线不贴米色边线
  const grid = 5; // 5 条线分隔 6 格
  const gridPad = iw * 0.10;
  const gx = ix + gridPad, gy = iy + gridPad, gw = iw - gridPad * 2, gh = ih - gridPad * 2;
  ctx.strokeStyle = '#3C2F28';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= grid; i++) {
    const p = (gw / grid) * i;
    ctx.beginPath();
    ctx.moveTo(gx + p, gy);
    ctx.lineTo(gx + p, gy + gh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx, gy + p);
    ctx.lineTo(gx + gw, gy + p);
    ctx.stroke();
  }
  // 交叉点小圆
  ctx.fillStyle = '#C0B8A8';
  for (let r = 0; r <= grid; r++) {
    for (let c = 0; c <= grid; c++) {
      ctx.beginPath();
      ctx.arc(gx + (gw / grid) * c, gy + (gh / grid) * r, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 打架棋子：实色（位于网格区中心偏上）
  const step = gw / grid;
  const off = Math.sin(Date.now() / 420) * 12;
  const r1 = Math.max(6, step * 0.34);
  drawSolidPiece(ctx, gx + 2 * step + off, gy + 2 * step, r1, '#1A1A1A', null);
  drawSolidPiece(ctx, gx + 3 * step - off, gy + 3 * step, r1, '#FEFEFE', '#D0D0D0');
}

/** 绘制实色棋子（figma 风格：轻微阴影 + 不透明填充 + 描边） */
function drawSolidPiece(ctx, x, y, r, fill, stroke) {
  // 轻微阴影（落地感）
  ctx.beginPath();
  ctx.arc(x, y + 1.5, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,47,40,0.22)';
  ctx.fill();
  // 主体
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
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

  // 积分 / 胜率（胜率最多保留一位小数，字号缩小避免溢出卡片右边界）
  const winRateText = (Number(state.winRate) || 0).toFixed(1) + '%';
  drawText(ctx, '' + (state.rankScore || 0), cardX + cardW - 88, cy - 4, { color: PALETTE.gold, fontSize: 20, align: 'center', bold: true });
  drawText(ctx, '积分', cardX + cardW - 88, cy + 16, { color: PALETTE.textDim, fontSize: 11, align: 'center' });
  drawText(ctx, winRateText, cardX + cardW - 30, cy - 4, { color: PALETTE.green, fontSize: 17, align: 'center', bold: true });
  drawText(ctx, '胜率', cardX + cardW - 30, cy + 16, { color: PALETTE.textDim, fontSize: 11, align: 'center' });

  // 精力进度条
  const barX = cardX + 16;
  const barY = cardY + 68;
  const barW = cardW - 32;
  roundRect(ctx, barX, barY, barW, 8, 4);
  ctx.fillStyle = PALETTE.panelBorder;
  ctx.fill();
  const pct = Math.max(0, Math.min(1, (state.energy.current || 0) / (state.energy.max || 30)));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, 8, 4);
    ctx.fillStyle = PALETTE.green;
    ctx.fill();
  }
  // 精力数字与下次恢复时间放在精力条【下方】，左右分列（避免与上方头像重叠）
  drawText(ctx, '精力 ' + (state.energy.current || 0) + '/' + (state.energy.max || 30), barX, barY + 22, { color: PALETTE.text, fontSize: 12, baseline: 'middle' });
  drawText(ctx, '下次恢复 ⏳ ' + formatCd(state.energy.nextRecoverAt), cardX + cardW - 16, barY + 22, { color: PALETTE.textDim, fontSize: 11, align: 'right', baseline: 'middle' });
}

function formatCd(ts) {
  if (!ts) return '00:00';
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

function drawRuleLink(ctx, y) {
  // 点击区域：高度 28，中心对齐文字基线（y 为点击框中心，也是文字 middle 基线）
  // 字体绘制用 baseline: 'middle' 且 y 与点击框中心一致，确保视觉与点击位置严格对齐
  rects.ruleLink = { x: 0, y: y - 14, w: W, h: 28 };
  drawText(ctx, '游戏规则 ▶', W / 2, y, { color: PALETTE.textDim, fontSize: 15, align: 'center', baseline: 'middle' });
}

// ========== 匹配浮层 ==========
function formatMatchElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function drawMatchingOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.8, ph = Math.max(220, Math.round(H * 0.36)), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 24 });
  drawText(ctx, '匹配中...', W / 2, py + 70, { color: PALETTE.text, fontSize: 32, align: 'center', bold: true });
  const elapsed = matchStartTs ? Date.now() - matchStartTs : 0;
  drawText(ctx, '已等待 ' + formatMatchElapsed(elapsed), W / 2, py + 120, { color: PALETTE.textDim, fontSize: 20, align: 'center' });
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

  // 底部导航优先判定（避免被"游戏规则"扩大区域误触）
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'home') { sceneMgr.goto(t.key); return; }
    }
  }

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
      // 阻断：不能进入自己创建的房间（否则双方为同一人，游戏异常）
      if (myCreatedRoomCode && code.toUpperCase() === myCreatedRoomCode.toUpperCase()) {
        joinError = '不能进入自己创建的房间';
        wx.showToast({ title: '不能进入自己创建的房间', icon: 'none' });
        return;
      }
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
  if ((state.energy.current || 0) < 5) { overlay = 'energy'; return; }
  wsManager.send('match_start');
  overlay = 'matching';
  matchStartTs = Date.now(); // 进入匹配即开始计时（避免服务端确认前显示 00:00 且不读秒）
}

function openInvite() {
  if ((state.energy.current || 0) < 5) { overlay = 'energy'; return; }
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
  rects.adEnergy = drawButton(ctx, { text: '🎬 看广告 +10 精力', x: bx, y: by, w: bw, h: bh, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 19 });
  rects.shareEnergy = drawButton(ctx, { text: '📤 分享 +5 精力', x: bx, y: by + (bh + gap), w: bw, h: bh, fill: PALETTE.green, textColor: '#FFFFFF', fontSize: 19 });
  rects.signEnergy = drawButton(ctx, { text: '📅 每日签到 +5', x: bx, y: by + (bh + gap) * 2, w: bw, h: bh, fill: PALETTE.panel, textColor: PALETTE.gold, fontSize: 19, border: PALETTE.gold });

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
    // 分享成功后才发放奖励（避免"点分享按钮就加精力"）
    if (typeof wx.shareAppMessage === 'function') {
      try {
        wx.shareAppMessage({
          title: '【下六儿】快来和我下六儿，赢取积分！',
          imageUrl: '',
          success: () => {
            wsManager.send('get_share_reward');
            overlay = null;
            wx.showToast({ title: '已获得精力 +5', icon: 'success' });
          },
          fail: () => {
            wx.showToast({ title: '分享未完成，未发放奖励', icon: 'none' });
          },
        });
        return;
      } catch (e) {
        // shareAppMessage 抛错，兜底发放并关闭浮层
        wsManager.send('get_share_reward');
        overlay = null;
        wx.showToast({ title: '已获得精力 +5', icon: 'success' });
        return;
      }
    } else {
      // 环境不支持分享，直接发放
      wsManager.send('get_share_reward');
      overlay = null;
      wx.showToast({ title: '已获得精力 +5', icon: 'success' });
      return;
    }
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
  // 小游戏环境不支持 wx.chooseImage，需用 wx.chooseMedia
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sizeType: ['compressed'],
    sourceType: ['album'],
    success: (res) => {
      const file = res.tempFiles && res.tempFiles[0];
      const tempPath = file && file.tempFilePath;
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
    fail: (err) => { wx.showToast({ title: '取消选择', icon: 'none' }); },
  });
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs: () => {} };
