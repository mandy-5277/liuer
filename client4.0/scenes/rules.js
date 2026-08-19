/**
 * 下六儿 小游戏版 — 规则说明场景
 * 参考 figma「棋盘组件说明」页：
 *   总览 tab = 棋盘图示（网格+交叉点+四态棋子）+ 棋子状态图例 + 棋盘规格
 *   其余 tab = 分组文本卡片（金色小标题 + 正文），内容区可上下滚动
 */

const { state } = require('../state');
const { PALETTE, drawText, drawCard, drawPiece, hit, roundRect, drawBottomNav, FONT_FAMILY } = require('../utils/ui');
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
let scrollOffset = 0;
let maxScroll = 0;

const CONTENT = {
  0: [], // 总览：棋盘组件说明（图示 + 图例 + 规格），见 drawOverview
  1: [
    '【游戏目标】',
    '在 6x6 棋盘对弈中，比对手保留更多棋子者获胜。',
    '',
    '【下子阶段】',
    '· 黑白双方轮流在空交叉点放置棋子。',
    '· 共需放置 18 子（每人 9 回合）。',
    '· 放置完成后进入揪子阶段。',
    '',
    '【成方/成六】',
    '· 己方 4 子连成正方形（2x2）即"成方"。',
    '· 己方 6 子连成一直线即"成六"。',
    '· 成方/成六后获得揪子机会。',
  ],
  2: [
    '【走子阶段】',
    '· 棋子只能上下左右移动到相邻空位。',
    '· 移动后若成方/成六，可揪掉对方 1 子（连揪可继续）。',
    '· 无连子时可"跳过"结束本轮。',
    '',
    '【胜负判定】',
    '· 时间耗尽或一方棋子被揪光即结算。',
    '· 剩余棋子多者获胜，平局则按段位积分判定。',
    '· 可主动"求和"或"认输"。',
  ],
};

function onEnter() {
  tabIndex = 0;
  scrollOffset = 0;
  maxScroll = 0;
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

/**
 * 绘制棋盘图示：6x6 网格 + 36 交叉点 + 四态棋子（对齐 figma）
 * 普通黑 / 选中白(金圈) / 可揪黑(红圈) / 成型白(🔒)
 */
function drawBoardDiagram(ctx, cx, cy) {
  const size = 118;
  const cell = size / 5;
  const bw = size + 16;
  const bx = cx - bw / 2;
  const by = cy - (size + 12) / 2;

  // 白底圆角盒子
  roundRect(ctx, bx, by, bw, size + 12, 10);
  ctx.fillStyle = '#FDFBF4';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = PALETTE.panelBorder;
  ctx.stroke();

  const gx = bx + 8;
  const gy = by + 6;

  // 外框 + 内线（金棕）
  ctx.strokeStyle = '#A98C4E';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(gx, gy, size, size);
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(gx + i * cell, gy);
    ctx.lineTo(gx + i * cell, gy + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx, gy + i * cell);
    ctx.lineTo(gx + size, gy + i * cell);
    ctx.stroke();
  }

  // 36 个交叉点
  ctx.fillStyle = PALETTE.boardDot;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.beginPath();
      ctx.arc(gx + c * cell, gy + r * cell, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 四态棋子 + 标签（对齐 figma 布局：普通黑 / 选中白 / 可揪黑 / 成型白）
  const pts = [
    { color: 'black', col: 1, row: 1, label: '普通', lc: PALETTE.text },
    { color: 'white', col: 3, row: 1, label: '选中', lc: '#D4A843', selected: true },
    { color: 'black', col: 1, row: 3, label: '可揪', lc: '#D94A4A', capturable: true, pulse: 0.35 },
    { color: 'white', col: 3, row: 3, label: '成型🔒', lc: PALETTE.text, formed: true },
  ];
  const pieceR = 10;
  pts.forEach((p) => {
    const px = gx + p.col * cell;
    const py = gy + p.row * cell;
    drawPiece(ctx, { x: px, y: py, r: pieceR, color: p.color, capturable: p.capturable, pulse: p.pulse, formed: p.formed });
    // 选中：金色外圈；可揪：红色外圈
    if (p.selected) {
      ctx.beginPath();
      ctx.arc(px, py, pieceR + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#D4A843';
      ctx.stroke();
    }
    if (p.capturable) {
      ctx.beginPath();
      ctx.arc(px, py, pieceR + 2, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#D94A4A';
      ctx.stroke();
    }
    drawText(ctx, p.label, px, py + pieceR + 14, { color: p.lc, fontSize: 11, align: 'center' });
  });
}

/** 图例单项：solid=实心 / white=白棋 / ring=空心圈 / lock=🔒 */
function drawLegendItem(ctx, x, y, type, color, label) {
  if (type === 'solid') {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  } else if (type === 'white') {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#D0D0D0';
    ctx.stroke();
  } else if (type === 'ring') {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒', x, y + 1);
  }
  drawText(ctx, label, x + 17, y, { color: PALETTE.text, fontSize: 13, baseline: 'middle' });
}

/** 总览：棋盘组件说明（图示卡 + 图例卡 + 规格卡） */
function drawOverview(ctx, cardX, cardW, topY) {
  const left = cardX + 20;

  // ---- 卡1：棋盘图示 ----
  const c1h = 186;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: c1h, radius: 14 });
  drawText(ctx, '棋盘组件说明', left, topY + 28, { color: PALETTE.gold, fontSize: 22, bold: true });
  drawBoardDiagram(ctx, W / 2, topY + 99);
  drawText(ctx, '棋子置于交叉点而非格内', W / 2, topY + c1h - 12, { color: PALETTE.textDim, fontSize: 12, align: 'center' });

  // ---- 卡2：棋子状态图例 ----
  const c2y = topY + c1h + 8;
  const c2h = 92;
  drawCard(ctx, { x: cardX, y: c2y, w: cardW, h: c2h, radius: 14 });
  drawText(ctx, '棋子状态说明', left, c2y + 26, { color: PALETTE.gold, fontSize: 20, bold: true });
  drawLegendItem(ctx, left, c2y + 50, 'solid', '#1A1A1A', '普通黑棋');
  drawLegendItem(ctx, left + 105, c2y + 50, 'white', '', '普通白棋');
  drawLegendItem(ctx, left, c2y + 76, 'ring', '#D4A843', '选中态');
  drawLegendItem(ctx, left + 100, c2y + 76, 'ring', '#D94A4A', '可揪态');
  drawLegendItem(ctx, left + 200, c2y + 76, 'lock', '', '成型(不可揪)');

  // ---- 卡3：棋盘规格 ----
  const c3y = c2y + c2h + 8;
  const c3h = 86;
  drawCard(ctx, { x: cardX, y: c3y, w: cardW, h: c3h, radius: 14 });
  drawText(ctx, '棋盘规格', left, c3y + 26, { color: PALETTE.gold, fontSize: 20, bold: true });
  drawText(ctx, '6行×6列=36交叉点 · 每方最多18颗 · 棋子φ28px', left, c3y + 50, { color: PALETTE.textDim, fontSize: 13 });
  drawText(ctx, '坐标范围 (0,0)~(5,5) · 棋盘线闭合，不外延', left, c3y + 70, { color: PALETTE.textDim, fontSize: 13 });
}

/** 分组文本卡片（可滚动） */
function drawTextCard(ctx, cardX, cardW, topY, viewH, lines) {
  const left = cardX + 20;
  const maxW = cardW - 40;

  // 解析分组（标题 + 正文）
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
  let totalH = 26;
  rows.forEach((row) => {
    totalH += 34;
    row.body.forEach((l) => {
      totalH += wrapText(ctx, l, 17, maxW).length * (17 + 9);
    });
    totalH += 12;
  });

  maxScroll = Math.max(0, totalH - viewH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cardX, topY, cardW, viewH);
  ctx.clip();
  ctx.translate(0, -scrollOffset);

  const cardH = Math.max(totalH, viewH);
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });

  let ty = topY + 28;
  rows.forEach((row) => {
    drawText(ctx, row.title, left, ty, { color: PALETTE.gold, fontSize: 20, bold: true });
    ty += 34;
    row.body.forEach((l) => {
      const fs = 17;
      const wrapped = wrapText(ctx, l, fs, maxW);
      wrapped.forEach((wl) => {
        ctx.fillStyle = PALETTE.text;
        ctx.font = `${fs}px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(wl, left, ty);
        ty += fs + 9;
      });
    });
    ty += 12;
  });

  ctx.restore();
}

function drawContentCard(ctx) {
  const cardX = 16;
  const cardW = W - 32;
  const sbh = state.statusBarHeight;
  const topY = sbh + 64 + 40 + 12; // tab 栏下方
  const navTop = H - 64;
  const viewH = navTop - topY - 10;
  if (tabIndex === 0) {
    const totalH = 380;
    maxScroll = Math.max(0, totalH - viewH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cardX, topY, cardW, viewH);
    ctx.clip();
    ctx.translate(0, -scrollOffset);
    drawOverview(ctx, cardX, cardW, topY);
    ctx.restore();
  } else {
    drawTextCard(ctx, cardX, cardW, topY, viewH, CONTENT[tabIndex] || []);
  }
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
  drawContentCard(ctx);
  scrollOffset = Math.min(Math.max(0, scrollOffset), maxScroll);

  rects.W = W; rects.H = H;
  drawBottomNav(ctx, 'rules', rects);
}

function onTouch(x, y) {
  // Tab 切换
  if (rects.tabs) {
    for (const t of rects.tabs) {
      if (hit(t, x, y)) {
        tabIndex = t.key;
        scrollOffset = 0;
        return;
      }
    }
  }
  // 内容区上下半区滚动
  const sbh = state.statusBarHeight;
  const topY = sbh + 64 + 40 + 12;
  const navTop = H - 64;
  if (y > topY && y < navTop) {
    const step = Math.max(60, Math.round((navTop - topY) * 0.4));
    scrollOffset += y < (topY + navTop) / 2 ? -step : step;
    scrollOffset = Math.min(Math.max(0, scrollOffset), maxScroll);
    return;
  }
  // 底部导航
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'rules') { sceneMgr.goto(t.key); return; }
    }
  }
}

module.exports = { onEnter, onDraw, onTouch, onWs: () => {} };
