/**
 * 六儿 小游戏版 — 规则说明场景
 * （对应小程序版 pages/rules/rules）
 */

const { state } = require('../state');
const { PALETTE, drawText, drawCard, hit, roundRect, FONT_FAMILY } = require('../utils/ui');
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
    '在 6x6 棋子对弈中，比对手保留更多棋子者获胜。',
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
  const size = 240;
  const spacing = size / 5;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      gridDots.push({ x: col * spacing, y: row * spacing });
    }
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

  drawText(ctx, '游戏规则', W / 2, state.statusBarHeight + 36, {
    color: PALETTE.text, fontSize: 36, align: 'center', bold: true,
  });

  // tab
  const tabs = ['总览', '下子&成方', '走子&胜负'];
  const tw = W / 3;
  rects.tabs = [];
  tabs.forEach((t, i) => {
    const x = i * tw;
    const active = i === tabIndex;
    if (active) {
      ctx.fillStyle = 'rgba(139,105,20,0.10)';
      ctx.fillRect(x, state.statusBarHeight + 56, tw, 44);
    }
    drawText(ctx, t, x + tw / 2, state.statusBarHeight + 84, {
      color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 22, align: 'center', bold: active,
    });
    rects.tabs.push({ key: i, x, y: state.statusBarHeight + 56, w: tw, h: 44 });
  });

  // 装饰小棋盘
  const ds = 120;
  const dox = (W - ds) / 2;
  const doy = state.statusBarHeight + 120;
  ctx.fillStyle = PALETTE.boardDot;
  gridDots.forEach((d) => {
    ctx.beginPath();
    ctx.arc(dox + d.x * (ds / 240), doy + d.y * (ds / 240), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // 文本
  const lines = CONTENT[tabIndex] || [];
  let ty = doy + ds + 50;
  const leftPad = 30;
  const maxW = W - leftPad * 2;
  lines.forEach((line) => {
    const isTitle = line.startsWith('【');
    const fs = isTitle ? 26 : 23;
    const color = isTitle ? PALETTE.gold : PALETTE.text;
    if (line === '') {
      ty += 20;
      return;
    }
    const wrapped = wrapText(ctx, line, fs, maxW);
    wrapped.forEach((wl) => {
      ctx.fillStyle = color;
      ctx.font = `${isTitle ? 'bold ' : ''}${fs}px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(wl, leftPad, ty);
      ty += fs + 10;
    });
    ty += isTitle ? 8 : 4;
  });

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
    const active = it.key === 'rules';
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
