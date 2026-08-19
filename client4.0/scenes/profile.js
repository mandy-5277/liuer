/**
 * 下六儿 小游戏版 — 个人主页场景
 * 设计依据：figma.html #page-profile（375×812 基准，暖金棕国风）
 * 布局：顶部深棕渐变头部 → 精力卡 → 每日签到卡 → 历史战绩 → 底部导航
 * 用 Canvas 绘制；签到等操作通过 WS 与服务端同步。
 */

const { state } = require('../state');
const { wsManager } = require('../utils/websocket');
const { PALETTE, drawText, drawCard, drawAvatar, hit, drawButton, roundRect, drawBottomNav, FONT_FAMILY } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};
let checkedInToday = false;

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

function todayStr() {
  const d = new Date();
  return (d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function onResourceUpdate(data) {
  if (data.energy !== undefined) state.energy.current = data.energy;
  if (data.energyRecoverAt !== undefined) state.energy.nextRecoverAt = data.energyRecoverAt;
  if (data.energyMax !== undefined) state.energy.max = data.energyMax;
  if (data.rankScore !== undefined) state.rankScore = data.rankScore;
  if (data.rankName !== undefined) state.rankName = data.rankName;
  if (data.winRate !== undefined) state.winRate = data.winRate;
}

function onEnter() {
  wsManager.on('resource_update', onResourceUpdate);
  wsManager.on('sign_in_result', onSignInResult);
  wsManager.on('error', onSignInError);
  try { checkedInToday = wx.getStorageSync('lastSignin') === todayStr(); } catch (e) { checkedInToday = false; }
}

function onSignInResult() {
  checkedInToday = true;
  try { wx.setStorageSync('lastSignin', todayStr()); } catch (e) { /* ignore */ }
  wx.showToast({ title: '签到成功 +5精力', icon: 'success' });
}

function onSignInError(data) {
  const msg = data && data.errMsg ? data.errMsg : '操作失败';
  // 已签到：标记本地并给出友好提示，避免重复请求
  if (msg.indexOf('已签到') >= 0) {
    checkedInToday = true;
    try { wx.setStorageSync('lastSignin', todayStr()); } catch (e) { /* ignore */ }
    wx.showToast({ title: '今日已签到，明天再来', icon: 'none' });
  }
}

function formatCd(ts) {
  if (!ts) return '00:00';
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

function drawHeader(ctx) {
  const sbh = state.statusBarHeight;
  const headH = 180;
  const g = ctx.createLinearGradient(0, 0, 0, headH);
  g.addColorStop(0, '#544339');
  g.addColorStop(1, '#3C2F28');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, headH);

  const cy = sbh + 84;

  // 左列：头像 + 昵称（限 6 字不换行）+ 段位徽章
  const leftW = Math.round(W * 0.58); // 左列占 58%，给右侧统计留位
  drawAvatar(ctx, {
    x: 40, y: cy, r: 30,
    label: ((state.userInfo && state.userInfo.nickName) || '玩').slice(0, 1),
    avatar: (state.userInfo && state.userInfo.avatarUrl) || '', ring: true,
  });
  const nickRaw = (state.userInfo && state.userInfo.nickName) || '玩家';
  const nick = nickRaw.slice(0, 6); // 限制昵称最多 6 个汉字（按显示宽度截断）
  const nickX = 82;
  drawText(ctx, nick, nickX, cy - 14, { color: '#FFFFFF', fontSize: 22, bold: true });
  const badgeX = nickX, badgeY = cy + 12;
  const badgeText = (state.rankName || '初级小六');
  const badgeW = Math.max(96, badgeText.length * 12 + 24);
  roundRect(ctx, badgeX, badgeY, badgeW, 24, 12);
  ctx.fillStyle = 'rgba(212,168,67,0.22)';
  ctx.fill();
  drawText(ctx, '🏅 ' + badgeText, badgeX + badgeW / 2, badgeY + 12, { color: '#D4A843', fontSize: 13, align: 'center', baseline: 'middle', bold: true });

  // 右列：积分 / 胜率 / 场次（紧凑三组，固定宽，互不重叠）
  const totalGames = (state.wins || 0) + (state.losses || 0) + (state.draws || 0);
  const stats = [
    { num: '' + (state.rankScore || 0), label: '积分' },
    { num: (state.winRate || 0) + '%', label: '胜率' },
    { num: '' + totalGames, label: '场次' },
  ];
  const rightX = leftW;             // 右列起始 x
  const rightW = W - rightX;        // 右列宽
  const itemW = Math.floor(rightW / stats.length);
  stats.forEach((s, i) => {
    const cx = rightX + i * itemW + itemW / 2;
    drawText(ctx, s.num, cx, cy - 14, { color: '#FFFFFF', fontSize: 20, align: 'center', bold: true });
    drawText(ctx, s.label, cx, cy + 14, { color: 'rgba(255,255,255,0.6)', fontSize: 12, align: 'center' });
  });
}

function drawEnergyCard(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 108;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });

  // 上半：左侧"⚡ 精力 30/30"，右侧"下次恢复 XX:XX"（不与精力条同行）
  drawText(ctx, '⚡ 精力', cardX + 16, topY + 30, { color: PALETTE.textDim, fontSize: 14, bold: true });
  drawText(ctx, (state.energy.current || 0) + '/' + (state.energy.max || 30), cardX + 16, topY + 58, { color: PALETTE.text, fontSize: 26, bold: true });

  // 右上：下次恢复与倒计时（纵向独立于精力条）
  drawText(ctx, '下次恢复', cardX + cardW - 16, topY + 26, { color: PALETTE.textDim, fontSize: 12, align: 'right' });
  drawText(ctx, formatCd(state.energy.nextRecoverAt), cardX + cardW - 16, topY + 56, { color: PALETTE.gold, fontSize: 22, align: 'right', bold: true });

  // 下半：精力条（满宽，与上方文字纵向分开 16px）
  const barX = cardX + 16, barY = topY + 80, barW = cardW - 32, barH = 10;
  roundRect(ctx, barX, barY, barW, barH, 5);
  ctx.fillStyle = PALETTE.panelBorder;
  ctx.fill();
  const pct = Math.max(0, Math.min(1, (state.energy.current || 0) / (state.energy.max || 30)));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, barH, 5);
    ctx.fillStyle = PALETTE.goldBright;
    ctx.fill();
  }
  return cardH;
}

function drawSignInCard(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 176;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });

  // 标题
  drawText(ctx, '每日签到', cardX + 16, topY + 32, { color: PALETTE.text, fontSize: 18, bold: true });
  drawText(ctx, '工作日 +5 精力 · 周末 +10 精力', cardX + 16, topY + 56, { color: PALETTE.textDim, fontSize: 12 });

  // 7 天签到格：一行排开，含"日 + 奖励金额"（周六/日为 +10）
  const dayW = (cardW - 32 - 6 * 6) / 7; // 7 格 + 6 间隙（4px），平均宽
  const dayGap = 6;
  const startX = cardX + 16;
  const dayY = topY + 76;
  const dayH = 48;
  const rewards = [5, 5, 5, 5, 5, 10, 10]; // 周一~日
  const todayIdx = (new Date().getDay() + 6) % 7; // getDay: 0=周日 → 6；周一=1 → 0
  WEEK.forEach((d, i) => {
    const dx = startX + i * (dayW + dayGap);
    const isToday = i === todayIdx;
    const isPast = i < todayIdx; // 简化为"已签过"的视觉提示（实际历史需服务端）
    // 背景：今天金色，过去的浅色，未到灰色
    ctx.fillStyle = isToday ? PALETTE.goldBright : (isPast ? '#E8E3DA' : '#F2EEE6');
    roundRect(ctx, dx, dayY, dayW, dayH, 8);
    ctx.fill();
    // 日（周几）
    drawText(ctx, d, dx + dayW / 2, dayY + 14, {
      color: isToday ? '#FFFFFF' : PALETTE.text, fontSize: 13, align: 'center', baseline: 'middle', bold: isToday,
    });
    // 奖励
    drawText(ctx, '+' + rewards[i], dx + dayW / 2, dayY + 34, {
      color: isToday ? '#FFFFFF' : PALETTE.text, fontSize: 15, align: 'center', baseline: 'middle', bold: true,
    });
  });

  // 签到按钮：单独一行在底部（全宽），与日格纵向分开
  rects.signInBtn = drawButton(ctx, {
    text: checkedInToday ? '今日已签到 ✓ 明天再来' : '今日签到 +' + (todayIdx >= 5 ? 10 : 5) + ' 精力',
    x: cardX + 16, y: topY + 136, w: cardW - 32, h: 26,
    fill: checkedInToday ? PALETTE.panelBorder : PALETTE.gold,
    textColor: checkedInToday ? PALETTE.textDim : PALETTE.textOnGold,
    fontSize: 16, border: checkedInToday ? PALETTE.panelBorder : null,
  });
  return cardH;
}

function drawHistory(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 100;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });
  drawText(ctx, '历史战绩', cardX + 16, topY + 32, { color: PALETTE.text, fontSize: 18, bold: true });
  // 空态占位
  drawText(ctx, '暂无对局记录，快去下六儿来一局吧', W / 2, topY + cardH / 2 + 14, { color: PALETTE.textDim, fontSize: 15, align: 'center' });
  return cardH;
}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawHeader(ctx);

  let topY = 180 + 12;
  topY += drawEnergyCard(ctx, topY) + 12;
  topY += drawSignInCard(ctx, topY) + 12;
  topY += drawHistory(ctx, topY);

  rects.W = W; rects.H = H;
  drawBottomNav(ctx, 'profile', rects);
}

function onTouch(x, y) {
  if (rects.signInBtn && hit(rects.signInBtn, x, y)) {
    if (checkedInToday) { wx.showToast({ title: '今日已签到，明天再来', icon: 'none' }); return; }
    wsManager.send('sign_in');
    return;
  }
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'profile') { sceneMgr.goto(t.key); return; }
    }
  }
}

function onWs() {}

function onLeave() {
  wsManager.off('resource_update', onResourceUpdate);
  wsManager.off('sign_in_result', onSignInResult);
  wsManager.off('error', onSignInError);
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs };
