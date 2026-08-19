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
  const headH = 170;
  const g = ctx.createLinearGradient(0, 0, 0, headH);
  g.addColorStop(0, '#544339');
  g.addColorStop(1, '#3C2F28');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, headH);

  const cy = sbh + 78;
  // 头像
  drawAvatar(ctx, { x: 36, y: cy, r: 34, label: (state.userInfo && state.userInfo.nickName) || '玩', ring: true });
  // 昵称 + 段位徽章
  drawText(ctx, (state.userInfo && state.userInfo.nickName) || '玩家', 84, cy - 16, { color: '#FFFFFF', fontSize: 24, bold: true });
  const badgeX = 84, badgeY = cy + 8;
  roundRect(ctx, badgeX, badgeY, 110, 26, 13);
  ctx.fillStyle = 'rgba(212,168,67,0.22)';
  ctx.fill();
  drawText(ctx, '🏅 ' + (state.rankName || '初级小六'), badgeX + 55, badgeY + 19, { color: '#D4A843', fontSize: 15, align: 'center', baseline: 'middle', bold: true });

  // 右侧统计
  const stats = [
    { num: state.rankScore || 0, label: '积分' },
    { num: (state.winRate || 0) + '%', label: '胜率' },
    { num: (state.wins || 0) + (state.losses || 0) + (state.draws || 0) || 0, label: '场次' },
  ];
  let sx = W - 30 - 60;
  stats.forEach((s) => {
    drawText(ctx, '' + s.num, sx, cy - 8, { color: '#FFFFFF', fontSize: 22, align: 'center', bold: true });
    drawText(ctx, s.label, sx, cy + 16, { color: 'rgba(255,255,255,0.6)', fontSize: 12, align: 'center' });
    sx -= 62;
  });
}

function drawEnergyCard(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 96;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });
  drawText(ctx, '⚡ 精力', cardX + 16, topY + 30, { color: PALETTE.textDim, fontSize: 14, bold: true });
  drawText(ctx, (state.energy.current || 0) + '/' + (state.energy.max || 30), cardX + 16, topY + 62, { color: PALETTE.text, fontSize: 26, bold: true });

  // 精力条
  const barX = cardX + 120, barY = topY + 44, barW = cardW - 120 - 110 - 12, barH = 10;
  roundRect(ctx, barX, barY, barW, barH, 5);
  ctx.fillStyle = PALETTE.panelBorder;
  ctx.fill();
  const pct = Math.max(0, Math.min(1, (state.energy.current || 0) / (state.energy.max || 30)));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, barH, 5);
    ctx.fillStyle = PALETTE.goldBright;
    ctx.fill();
  }
  // 下次恢复
  drawText(ctx, '下次恢复', cardX + cardW - 100, topY + 38, { color: PALETTE.textDim, fontSize: 12, align: 'right' });
  drawText(ctx, formatCd(state.energy.nextRecoverAt), cardX + cardW - 100, topY + 62, { color: PALETTE.gold, fontSize: 22, align: 'right', bold: true });
  return cardH;
}

function drawSignInCard(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 132;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });
  drawText(ctx, '每日签到', cardX + 16, topY + 32, { color: PALETTE.text, fontSize: 18, bold: true });
  drawText(ctx, '+5 精力', cardX + 16, topY + 54, { color: PALETTE.gold, fontSize: 14, bold: true });

  // 7 天签到格（简单示意：金色为已签到/今天）
  const dayW = 30, dayGap = 5, startX = cardX + 16, dayY = topY + 74;
  WEEK.forEach((d, i) => {
    const dx = startX + i * (dayW + dayGap);
    roundRect(ctx, dx, dayY, dayW, 34, 6);
    ctx.fillStyle = i === 0 ? PALETTE.goldBright : '#F2EEE6';
    ctx.fill();
    drawText(ctx, d, dx + dayW / 2, dayY + 22, { color: i === 0 ? '#FFFFFF' : PALETTE.textDim, fontSize: 13, align: 'center', baseline: 'middle', bold: i === 0 });
  });

  // 签到按钮（右侧）：已签到则禁用
  rects.signInBtn = drawButton(ctx, {
    text: checkedInToday ? '今日已签 ✓' : '今日签到',
    x: cardX + cardW - 116, y: topY + 70, w: 100, h: 42,
    fill: checkedInToday ? PALETTE.panelBorder : PALETTE.gold,
    textColor: checkedInToday ? PALETTE.textDim : PALETTE.textOnGold,
    fontSize: 16, border: checkedInToday ? PALETTE.panelBorder : null,
  });
  return cardH;
}

function drawHistory(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 120;
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

  let topY = 170 + 12;
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
