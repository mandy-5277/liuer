/**
 * 下六儿 小游戏版 — 规则说明场景
 * 参考 figma「棋盘组件说明」页：
 *   总览 tab = 棋盘图示（网格+交叉点+四态棋子）+ 棋子状态图例 + 棋盘规格
 *   其余 tab = 分组白色卡片（金色小标题 + 正文），内容区可手指上下滑动
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

// 内容以「分组」为单元：每个分组一个白色卡片（金色标题 + 正文）
const SECTIONS = {
  1: [
    { title: '游戏目标', body: [
      '在 6×6 的棋盘上，与对手轮流落子、揪子、走子。对局结束时，揪掉对方所有的棋子或对方棋子无法移动则获胜。',
    ] },
    { title: '三个阶段玩法', body: [
      '① 下子阶段：双方轮流在空交叉点落子，每人 9 手共放置 18 子，目标为「成方」或「成六」，落子无悔。',
      '② 揪子阶段：若你在下子阶段「成方」或「成六」，可立即揪掉对方 1 或 2 颗棋子。',
      '③ 走子阶段：双方轮流把己方棋子向上下左右相邻空位移动；移动后若「成方」或「成六」可立即揪子。',
    ] },
    { title: '成方 / 成六 规则', body: [
      '· 成方：己方 4 颗棋子连成一个 2×2 的正方形（含横竖相邻），即「成方」。',
      '· 成六：己方 6 颗棋子在一条直线（横、竖）上连续排成，即「成六」。',
      '· 「成方」可揪掉对方 1 子；「成六」可揪掉对方 2 子。',
      '· 同一手同时触发多个「方」或「六」，按可揪总数累加；揪子可连续进行（连揪）。',
    ] },
  ],
  2: [
    { title: '胜负规则', body: [
      '· 一方棋子被全部揪光（无法行动），另一方直接获胜。',
      '· 双方均无可揪棋子，则判为平局。',
    ] },
    { title: '认输规则', body: [
      '· 对局中任意一方可主动「认输」，立即判负，对方获胜。',
      '· 认输后本局结束，按负方结算积分。',
    ] },
    { title: '求和规则', body: [
      '· 对局中可向对方发起「求和」请求，对方同意则本局判为平局。',
      '· 对方拒绝则继续对局。',
    ] },
    { title: '记分规则', body: [
      '· 胜局：段位积分 +10；负局：-3；平局：-1（以服务端结算为准）。',
      '· 发起求和：-1；同意求和：+1。',
      '· 积分越高段位越高，可在「排行榜」查看自己的名次。',
      '· 每日胜率、场次等数据在对局结算后实时更新。',
    ] },
  ],
};

// 拖动滚动状态
let dragging = false;
let dragStartY = 0;
let dragStartOffset = 0;
// 内容区可滚动区域（供 touch 命中判断）
let contentTop = 0;
let contentBottom = 0;

function onEnter() {
  tabIndex = 0;
  scrollOffset = 0;
  maxScroll = 0;
  dragging = false;
}

function drawTabs(ctx) {
  const tabs = ['总览', '游戏规则', '胜负规则'];
  const tw = W / 3;
  const tabY = state.statusBarHeight + 64;
  rects.tabs = [];
  tabs.forEach((t, i) => {
    const x = i * tw;
    const active = i === tabIndex;
    // 胶囊 Tab（加粗）
    roundRect(ctx, x + 6, tabY, tw - 12, 40, 20);
    ctx.fillStyle = active ? PALETTE.gold : '#FFFFFF';
    ctx.fill();
    if (!active) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PALETTE.panelBorder;
      ctx.stroke();
    }
    drawText(ctx, t, x + tw / 2, tabY + 20, {
      color: active ? PALETTE.textOnGold : PALETTE.textDim, fontSize: 15, align: 'center', baseline: 'middle', bold: true,
    });
    rects.tabs.push({ key: i, x, y: tabY, w: tw, h: 40 });
  });
}

/**
 * 绘制棋盘图示：6x6 网格 + 36 交叉点 + 四态棋子（放大版，便于看清）
 */
function drawBoardDiagram(ctx, cx, cy) {
  const size = 168; // 放大（原 118）
  const cell = size / 5;
  const bw = size + 20;
  const bx = cx - bw / 2;
  const by = cy - (size + 16) / 2;

  // 白底圆角盒子
  roundRect(ctx, bx, by, bw, size + 16, 12);
  ctx.fillStyle = '#FDFBF4';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = PALETTE.panelBorder;
  ctx.stroke();

  const gx = bx + 10;
  const gy = by + 8;

  // 外框 + 内线（金棕）
  ctx.strokeStyle = '#A98C4E';
  ctx.lineWidth = 2;
  ctx.strokeRect(gx, gy, size, size);
  ctx.lineWidth = 1.2;
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
      ctx.arc(gx + c * cell, gy + r * cell, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 四态棋子 + 标签（放大），与游戏内实际视觉一致（无"成型🔒"状态）
  const pts = [
    { color: 'black', col: 1, row: 1, label: '普通黑', lc: PALETTE.text },
    { color: 'white', col: 3, row: 1, label: '普通白', lc: PALETTE.text },
    { color: 'black', col: 1, row: 3, label: '选中', lc: '#D4A843', selected: true },
    { color: 'white', col: 3, row: 3, label: '可揪', lc: '#D94A4A', capturable: true, pulse: 0.35 },
  ];
  const pieceR = 13;
  pts.forEach((p) => {
    const px = gx + p.col * cell;
    const py = gy + p.row * cell;
    drawPiece(ctx, { x: px, y: py, r: pieceR, color: p.color, capturable: p.capturable, pulse: p.pulse, formed: p.formed });
    if (p.selected) {
      ctx.beginPath();
      ctx.arc(px, py, pieceR + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#D4A843';
      ctx.stroke();
    }
    if (p.capturable) {
      ctx.beginPath();
      ctx.arc(px, py, pieceR + 2, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#D94A4A';
      ctx.stroke();
    }
    drawText(ctx, p.label, px, py + pieceR + 16, { color: p.lc, fontSize: 12, align: 'center' });
  });
}

/** 图例单项：solid=实心 / white=白棋 / ring=空心圈 / lock=🔒 */
function drawLegendItem(ctx, x, y, type, color, label) {
  if (type === 'solid') {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  } else if (type === 'white') {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#D0D0D0';
    ctx.stroke();
  } else if (type === 'ring') {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.font = `15px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒', x, y + 1);
  }
  drawText(ctx, label, x + 19, y, { color: PALETTE.text, fontSize: 13, baseline: 'middle' });
}

/** 总览：棋盘组件说明（图示卡 + 图例卡 + 规格卡） */
function drawOverview(ctx, cardX, cardW, topY) {
  const left = cardX + 20;

  // ---- 卡1：棋盘图示（放大） ----
  const c1h = 250;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: c1h, radius: 14 });
  drawText(ctx, '棋盘组件说明', left, topY + 30, { color: PALETTE.gold, fontSize: 22, bold: true });
  drawBoardDiagram(ctx, W / 2, topY + 132);
  drawText(ctx, '棋子置于交叉点而非格内', W / 2, topY + c1h - 14, { color: PALETTE.textDim, fontSize: 12, align: 'center' });

  // ---- 卡2：棋子状态图例 ----
  const c2y = topY + c1h + 8;
  const c2h = 96;
  drawCard(ctx, { x: cardX, y: c2y, w: cardW, h: c2h, radius: 14 });
  drawText(ctx, '棋子状态说明', left, c2y + 28, { color: PALETTE.gold, fontSize: 20, bold: true });
  drawLegendItem(ctx, left, c2y + 54, 'solid', '#1A1A1A', '普通黑棋');
  drawLegendItem(ctx, left + 110, c2y + 54, 'white', '', '普通白棋');
  drawLegendItem(ctx, left, c2y + 82, 'ring', '#D4A843', '选中态');
  drawLegendItem(ctx, left + 100, c2y + 82, 'ring', '#D94A4A', '可揪态');

  // ---- 卡3：棋盘规格 ----
  const c3y = c2y + c2h + 8;
  const c3h = 86;
  drawCard(ctx, { x: cardX, y: c3y, w: cardW, h: c3h, radius: 14 });
  drawText(ctx, '棋盘规格', left, c3y + 26, { color: PALETTE.gold, fontSize: 20, bold: true });
  drawText(ctx, '6行×6列=36交叉点 · 每方最多18颗 · 棋子φ28px', left, c3y + 50, { color: PALETTE.textDim, fontSize: 13 });
  drawText(ctx, '坐标范围 (0,0)~(5,5) · 棋盘线闭合，不外延', left, c3y + 70, { color: PALETTE.textDim, fontSize: 13 });

  // ---- 卡4：积分与段位规则 ----
  const c4y = c3y + c3h + 8;
  const c4h = 168;
  drawCard(ctx, { x: cardX, y: c4y, w: cardW, h: c4h, radius: 14 });
  drawText(ctx, '积分与段位规则', left, c4y + 28, { color: PALETTE.gold, fontSize: 20, bold: true });
  const lines = [
    '· 胜负积分：胜 +10 / 负 -3 / 平 -1',
    '· 发起求和 -1，同意求和 +1',
    '· 段位分级(按积分)：',
    '   <200 初级小六   <400 中级小六',
    '   <600 高级小六   <800 初级老六',
    '   <1000 中级老六  <1200 高级老六',
    '   ≥1200 资深老六',
  ];
  lines.forEach((t, i) => drawText(ctx, t, left, c4y + 56 + i * 16, { color: PALETTE.text, fontSize: 13 }));
}

/** 单个分组白色卡片（金色标题 + 正文，标题只显示一次） */
function drawSection(ctx, cardX, cardW, topY, section) {
  const left = cardX + 20;
  const maxW = cardW - 40;
  const fs = 16;

  // 先量算高度
  let bodyH = 0;
  const wrappedLines = section.body.map((l) => {
    const wl = wrapText(ctx, l, fs, maxW);
    bodyH += wl.length * (fs + 9);
    return wl;
  });
  const cardH = 28 + 34 + bodyH + 18;

  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });
  drawText(ctx, section.title, left, topY + 28, { color: PALETTE.gold, fontSize: 20, bold: true });
  let ty = topY + 28 + 34;
  wrappedLines.forEach((wl) => {
    ctx.fillStyle = PALETTE.text;
    ctx.font = `${fs}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    wl.forEach((line) => {
      ctx.fillText(line, left, ty);
      ty += fs + 9;
    });
  });
  return cardH;
}

/** 分组卡片列表（可滚动） */
function drawSections(ctx, cardX, cardW, topY, viewH, sections) {
  const totalH = sections.reduce((sum, s) => {
    // 估算高度用于 maxScroll（与绘制一致）
    let bodyH = 0;
    s.body.forEach((l) => { bodyH += wrapText(ctx, l, 16, cardW - 40).length * (16 + 9); });
    return sum + (28 + 34 + bodyH + 18 + 8);
  }, 0);

  maxScroll = Math.max(0, totalH - viewH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cardX, topY, cardW, viewH);
  ctx.clip();
  ctx.translate(0, -scrollOffset);

  let y = topY;
  sections.forEach((s) => {
    const h = drawSection(ctx, cardX, cardW, y, s);
    y += h + 8;
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
  contentTop = topY;
  contentBottom = navTop;
  if (tabIndex === 0) {
    const totalH = 250 + 8 + 96 + 8 + 86 + 8 + 168 + 8;
    maxScroll = Math.max(0, totalH - viewH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cardX, topY, cardW, viewH);
    ctx.clip();
    ctx.translate(0, -scrollOffset);
    drawOverview(ctx, cardX, cardW, topY);
    ctx.restore();
  } else {
    drawSections(ctx, cardX, cardW, topY, viewH, SECTIONS[tabIndex] || []);
  }
}

function onDraw(ctx) {
  // ctx.canvas.width 为物理尺寸，需除以像素比得到逻辑尺寸
  const pr = state.pixelRatio || 1;
  W = ctx.canvas.width / pr;
  H = ctx.canvas.height / pr;

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
  // 底部导航
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'rules') { sceneMgr.goto(t.key); return; }
    }
  }
  // 内容区：记录拖动起点（真正的滚动在 onTouchMove 中处理）
  if (y > contentTop && y < contentBottom) {
    dragging = true;
    dragStartY = y;
    dragStartOffset = scrollOffset;
  }
}

function onTouchMove(x, y) {
  if (!dragging) return;
  const dy = y - dragStartY;
  // 向上拖（dy<0）→ 内容向上 → scrollOffset 增大
  scrollOffset = dragStartOffset - dy;
  if (scrollOffset > maxScroll) scrollOffset = maxScroll;
  if (scrollOffset < 0) scrollOffset = 0;
}

function onTouchEnd() {
  dragging = false;
}

module.exports = { onEnter, onDraw, onTouch, onTouchMove, onTouchEnd, onWs: () => {} };
