/**
 * 六儿 小游戏版 — 排行榜场景
 * （对应小程序版 pages/rank/rank）
 */

const { state } = require('../state');
const { PALETTE, drawText, drawButton, drawCard, hit, roundRect, drawBottomNav } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};
let tabIndex = 0;
let displayList = [];

const RANK_LIST = [
  { name: '围棋大师', rankName: '资深老六', score: 1250, winRate: 85 },
  { name: '落子如风', rankName: '高级老六', score: 1120, winRate: 78 },
  { name: '棋魂再现', rankName: '高级老六', score: 1080, winRate: 76 },
  { name: '步步为赢', rankName: '中级老六', score: 960, winRate: 72 },
  { name: '六六大顺', rankName: '中级老六', score: 920, winRate: 70 },
  { name: '棋胜一筹', rankName: '初级老六', score: 860, winRate: 68 },
  { name: '妙手连连', rankName: '初级老六', score: 820, winRate: 65 },
  { name: '棋开得胜', rankName: '高级小六', score: 760, winRate: 62 },
  { name: '老六来了', rankName: '高级小六', score: 720, winRate: 60 },
  { name: '棋逢对手', rankName: '中级小六', score: 680, winRate: 58 },
];

function onEnter() {
  tabIndex = 0;
  displayList = RANK_LIST.map((it, i) => ({ ...it, rankNo: i + 1 }));
}

function switchTab(idx) {
  tabIndex = idx;
  let list = [...RANK_LIST];
  if (idx === 1) {
    list.sort((a, b) => b.score - a.score);
    list = list.map((it, i) => ({ ...it, rankNo: i + 1 }));
  } else if (idx === 2) {
    list.sort((a, b) => b.winRate - a.winRate);
    list = list.map((it, i) => ({ ...it, rankNo: i + 1 }));
  }
  displayList = list;
}

function onDraw(ctx) {
  W = ctx.canvas.width;
  H = ctx.canvas.height;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.bgGradientTop);
  g.addColorStop(1, PALETTE.bgGradientBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawText(ctx, '排行榜', W / 2, state.statusBarHeight + 36, {
    color: PALETTE.text, fontSize: 36, align: 'center', bold: true,
  });

  // 三个 tab
  const tabs = ['段位榜', '积分榜', '胜率榜'];
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
      color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 24, align: 'center', bold: active,
    });
    rects.tabs.push({ key: i, x, y: state.statusBarHeight + 56, w: tw, h: 44 });
  });

  // 列表
  const listTop = state.statusBarHeight + 120;
  const rowH = 64;
  displayList.forEach((it, i) => {
    const y = listTop + i * rowH;
    drawCard(ctx, { x: 16, y, w: W - 32, h: rowH - 8, radius: 12 });

    drawText(ctx, '#' + it.rankNo, 40, y + rowH / 2 - 4, {
      color: i < 3 ? PALETTE.gold : PALETTE.textDim, fontSize: 26, bold: true,
    });
    drawText(ctx, it.name, 90, y + 26, { color: PALETTE.text, fontSize: 26, bold: true });
    drawText(ctx, it.rankName, 90, y + 50, { color: PALETTE.textDim, fontSize: 20 });
    drawText(ctx, '积分 ' + it.score, W - 40, y + 26, {
      color: PALETTE.gold, fontSize: 24, align: 'right', bold: true,
    });
    drawText(ctx, '胜率 ' + it.winRate + '%', W - 40, y + 50, {
      color: PALETTE.textDim, fontSize: 20, align: 'right',
    });
  });

  rects.W = W; rects.H = H;
  drawBottomNav(ctx, 'rank', rects);
}

function onTouch(x, y) {
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'rank') { sceneMgr.goto(t.key); return; }
    }
  }
}

module.exports = { onEnter, onDraw, onTouch, onWs: () => {} };
