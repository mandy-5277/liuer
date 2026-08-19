/**
 * 下六儿 小游戏版 — 规则说明场景
 * 设计风格：暖金棕国风（figma），卡片分组布局更友好
 * 布局：标题 → 胶囊 Tab → 装饰棋盘 → 分组卡片（金色小标题 + 正文）
 */

const { state } = require('../state');
const { PALETTE, drawText, drawCard, hit, roundRect, drawBottomNav, FONT_FAMILY } = require('../utils/ui');
const sceneMgr = require('./index');

/** 按最大像素宽度折行，返回字符串数组 */
function wrapText(ctx, text, fontSize, maxWidth) {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const result = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      result.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) result.push(line);
  return result;
}

let W = 375;
let H = 667;
let rects = {};
let tabIndex = 0;
let gridDots = [];

const CONTENT = {
  0: [
    '【游戏目标】',
    '在 6x6 棋盘对弈中，比对手保留更多棋子者获胜。',
    '',
    '【三阶段】',
    '1. 下子阶段：轮流在交叉点落子，每人 18 子。',
    '2. 揪子阶段：轮流揪掉对方棋子形成 "方/六" 的连子。',
    '3. 走子阶段：轮流移动己方棋子，走成方/六可继续揪子。',
  ],
  1: [
    '【下子阶段】',
    '· 黑白双方轮流在空交叉点放置棋子。',
    '· 共需放置 18 子（每人 9 回合）。',
    '· 放置完成后进入揪子阶段。',
    '',
    '【成方/成六】',
    '· 己方 4 子连成正方形（2x2）即 "成方"。',
    '· 己方 6 子连成一直线即 "成六"。',
    '· 成方/成六后获得揪子机会。',
  ],
  2: [
    '【走子阶段】',
    '· 棋子只能上下左右移动到相邻空位。',
    '· 移动后若成方/成六，可揪掉对方 1 子（连揪可继续）。',
    '· 无连子时可 "跳过" 结束本轮。',
    '',
    '【胜负判定】',
    '· 时间耗尽或一方棋子被揪光即结算。',
    '· 剩余棋子多者获胜，平局则按段位积分判定。',
    '· 可主动 "求和" 或 "认输"。',
  ],
};

function onEnter() {
  tabIndex = 0;
  gridDots = [];
  const size = 120;
  const spacing = size / 5;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      gridDots.push({ x: col * spacing, y: row * spacing });
    }
  }
}

function drawTabs(ctx) {
  const tabs = ['总览', '下子&成方', '走子&胜负'];
  const tw = W / 3;
  const tabY = state.statusBarHeight + 64;
  rects.tabs = [];
  tabs.forEach((t, i) => {
    const x = i * tw;
    const active = i === tabIndex;
    // 胶囊 Tab
    roundRect(ctx, x + 8, tabY, tw - 16, 40, 20);
    ctx.fillStyle = active ? PALETTE.gold : '#FFFFFF';
    ctx.fill();
    if (!active) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PALETTE.panelBorder;
      ctx.stroke();
    }
    drawText(ctx, t, x + tw / 2, tabY + 26, {
      color: active ? PALETTE.textOnGold : PALETTE.textDim, fontSize: 20, align: 'center', baseline: 'middle', bold: active,
    });
    rects.tabs.push({ key: i, x, y: tabY, w: tw, h: 40 });
  });
}

function drawContentCard(ctx, lines) {
  const cardX = 16, cardW = W - 32;
  const sbh = state.statusBarHeight;
  // 装饰小棋盘
  const ds = 92;
  const dox = (W - ds) / 2;
  const doy = sbh + 118;
  ctx.fillStyle = PALETTE.boardDot;
  gridDots.forEach((d) => {
    ctx.beginPath();
    ctx.arc(dox + d.x * (ds / 120), doy + d.y * (ds / 120), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // 解析分组（标题 + 正文）
  const leftPad = cardX + 20;
  const maxW = cardW - 40;
  const rows = [];
  let curTitle = '';
  for (const line of lines) {
    if (line.startsWith('【')) {
      if (curTitle) rows.push({ title: curTitle, body: [] });
      curTitle = line;
    } else if (line !== '') {
      if (!rows.length || rows[rows.length - 1].title !== curTitle) rows.push({ title: curTitle, body: [] });
      rows[rows.length - 1].body.push(line);
    }
  }

  // 计算内容总高度
  let totalH = 24; // 上下内边距
  rows.forEach((row) => {
    totalH += 30; // 标题
    row.body.forEach((l) => {
      const wrapped = wrapText(ctx, l, 19, maxW);
      totalH += wrapped.length * (19 + 8);
    });
    totalH += 10;
  });

  // 内容卡片（高度自适应）
  const topY = doy + ds + 28;
  const navTop = H - 64;
  const cardH = Math.max(120, Math.min(totalH, navTop - topY - 16));
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });

  let ty = topY + 22;
  rows.forEach((row) => {
    drawText(ctx, row.title, leftPad, ty, { color: PALETTE.gold, fontSize: 24, bold: true });
    ty += 30;
    row.body.forEach((l) => {
      const fs = 19;
      const wrapped = wrapText(ctx, l, fs, maxW);
      wrapped.forEach((wl) => {
        ctx.fillStyle = PALETTE.text;
        ctx.font = `${fs}px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(wl, leftPad, ty);
        ty += fs + 8;
      });
    });
    ty += 10;
  });
}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawText(ctx, '游戏规则', W / 2, state.statusBarHeight + 38, {
    color: PALETTE.text, fontSize: 32, align: 'center', bold: true,
  });

  drawTabs(ctx);
  drawContentCard(ctx, CONTENT[tabIndex] || []);

  rects.W = W; rects.H = H;
  drawBottomNav(ctx, 'rules', rects);
}

function onTouch(x, y) {
  if (rects.tabs) {
    for (const t of rects.tabs) {
      if (hit(t, x, y)) { tabIndex = t.key; return; }
    }
  }
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'rules') { sceneMgr.goto(t.key); return; }
    }
  }
}

module.exports = { onEnter, onDraw, onTouch, onWs: () => {} };
