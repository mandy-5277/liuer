/**
 * 六儿 小游戏版 — 个人主页场景
 * （对应小程序版 pages/profile/profile）
 */

const { state } = require('../state');
const { PALETTE, drawText, drawCard, drawAvatar, hit } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};

function onEnter() {}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const cy = state.statusBarHeight + 80;
  drawAvatar(ctx, { x: W / 2, y: cy, r: 46, label: (state.userInfo && state.userInfo.nickName) || '玩家', ring: true });
  drawText(ctx, (state.userInfo && state.userInfo.nickName) || '玩家', W / 2, cy + 80, {
    color: PALETTE.text, fontSize: 30, align: 'center', bold: true,
  });

  // 数据卡
  const cards = [
    { label: '段位', value: state.rankName || '初级小六' },
    { label: '积分', value: '' + (state.rankScore || 0) },
    { label: '胜率', value: (state.winRate || 0) + '%' },
    { label: '铜板', value: '' + (state.coins || 0) },
  ];
  const cw = (W - 80) / 2;
  const ch = 90;
  const gx = 40;
  const gy = cy + 120;
  cards.forEach((c, i) => {
    const x = gx + (i % 2) * (cw + 0);
    const y = gy + Math.floor(i / 2) * (ch + 16);
    drawCard(ctx, { x, y, w: cw, h: ch, radius: 14 });
    drawText(ctx, c.label, x + 16, y + 36, { color: PALETTE.textDim, fontSize: 22 });
    drawText(ctx, c.value, x + 16, y + 72, { color: PALETTE.gold, fontSize: 30, bold: true });
  });

  // 规则入口
  rects.rulesBtn = {
    x: gx, y: gy + 2 * (ch + 16), w: W - 80, h: 60,
  };
  drawCard(ctx, { x: rects.rulesBtn.x, y: rects.rulesBtn.y, w: rects.rulesBtn.w, h: rects.rulesBtn.h, radius: 14 });
  drawText(ctx, '游戏规则说明', gx + 16, rects.rulesBtn.y + 38, { color: PALETTE.text, fontSize: 26, bold: true });

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
  rects.bottomTabs = [];
  items.forEach((it, i) => {
    const ix = i * itemW;
    const active = it.key === 'profile';
    if (active) {
      ctx.fillStyle = 'rgba(139,105,20,0.10)';
      ctx.fillRect(ix, y, itemW, tabH);
    }
    drawText(ctx, it.label, ix + itemW / 2, y + tabH / 2 + 6, {
      color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 20, align: 'center', bold: active,
    });
    rects.bottomTabs.push({ key: it.key, x: ix, y, w: itemW, h: tabH });
  });
}

function onTouch(x, y) {
  if (rects.rulesBtn && hit(rects.rulesBtn, x, y)) {
    sceneMgr.goto('rules');
    return;
  }
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'profile') { sceneMgr.goto(t.key); return; }
    }
  }
}

module.exports = { onEnter, onDraw, onTouch, onWs: () => {} };
