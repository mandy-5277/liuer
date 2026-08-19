/**
 * 下六儿 小游戏版 — 排行榜场景
 * 优化：
1. 积分榜 / 胜率榜 可点击切换
2. 显示 top100，支持列表滑动
3. 自己的信息固定在底部（不随列表滚动）；未进 top100 显示"未上榜"
4. 字体缩小 + 显示头像
 */

const { state } = require('../state');
const { wsManager } = require('../utils/websocket');
const { PALETTE, drawText, drawCard, drawAvatar, hit, roundRect, drawBottomNav } = require('../utils/ui');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};

// 顶部 tab：积分榜 / 胜率榜（去掉段位榜）
const TABS = [
  { key: 'score', label: '积分榜' },
  { key: 'winRate', label: '胜率榜' },
];

let tabKey = 'score';
let list = [];           // top100 数组
let scrollOffset = 0;    // 列表纵向滚动偏移（像素）
const rowH = 52;         // 每行高度（缩小字体后紧凑）

let myInfo = {
  rank: -1,
  nickName: '',
  avatarUrl: '',
  rankScore: 0,
  rankName: '初级小六',
  winRate: 0,
  totalGames: 0,
  sortBy: 'score',
  outOfTop: false,
};

// 胜率榜上榜最低场次门槛
const WINRATE_MIN_GAMES = 50;

function onEnter() {
  scrollOffset = 0;
  tabKey = 'score';
  requestRankList();
}

function onLeave() {
  wsManager.off('rank_list', onRankList);
}

function requestRankList() {
  wsManager.on('rank_list', onRankList);
  wsManager.send('get_rank_list', { type: tabKey, limit: 100 });
}

function onRankList(data) {
  list = data.rankList || [];
  myInfo = {
    rank: data.myRank || -1,
    nickName: (state.userInfo && state.userInfo.nickName) || '',
    avatarUrl: (state.userInfo && state.userInfo.avatarUrl) || '',
    rankScore: data.myRankScore || 0,
    rankName: data.myRankName || '初级小六',
    winRate: data.myWinRate || 0,
    totalGames: data.myTotalGames || 0,
    sortBy: data.sortBy || tabKey,
    // 未上榜条件：服务端无排名 或（胜率榜且场次不足）
    outOfTop: !(data.myRank && data.myRank > 0) ||
      (data.sortBy === 'winRate' && (data.myTotalGames || 0) < WINRATE_MIN_GAMES),
  };
 }

function switchTab(key) {
  if (key === tabKey) return;
  tabKey = key;
  scrollOffset = 0;
  requestRankList();
}

function drawTabs(ctx) {
  const sbh = state.statusBarHeight;
  const tabY = sbh + 60;
  const tabW = 96;
  const tabH = 38;
  const gap = 14;
  const totalW = tabW * TABS.length + gap * (TABS.length - 1);
  const startX = (W - totalW) / 2;
  rects.tabs = [];
  TABS.forEach((t, i) => {
    const x = startX + i * (tabW + gap);
    const active = t.key === tabKey;
    roundRect(ctx, x, tabY, tabW, tabH, tabH / 2);
    if (active) {
      ctx.fillStyle = PALETTE.gold;
      ctx.fill();
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PALETTE.panelBorder;
      ctx.stroke();
    }
    drawText(ctx, t.label, x + tabW / 2, tabY + tabH / 2 + 1, {
      color: active ? PALETTE.textOnGold : PALETTE.textDim,
      fontSize: 20, align: 'center', baseline: 'middle', bold: active,
    });
    rects.tabs.push({ key: t.key, x, y: tabY, w: tabW, h: tabH });
  });
}

function drawList(ctx, listTop, listBottom) {
  // 列表滚动区裁剪，避免与下方"自己"卡片重叠
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, listTop, W, listBottom - listTop);
  ctx.clip();

  const showScore = tabKey === 'score';
  list.forEach((it, i) => {
    const y = listTop + i * rowH - scrollOffset;
    if (y + rowH < listTop || y > listBottom) return; // 裁剪外不绘制
    drawCard(ctx, { x: 16, y, w: W - 32, h: rowH - 8, radius: 10 });

    // # 名次
    drawText(ctx, '#' + it.rank, 32, y + rowH / 2 - 4, {
      color: i < 3 ? PALETTE.gold : PALETTE.textDim, fontSize: 18, bold: true, baseline: 'middle',
    });
    // 头像
    drawAvatar(ctx, {
      x: 68, y: y + (rowH - 8) / 2, r: 16,
      label: (it.nickName || '').slice(0, 1), avatar: it.avatarUrl || '',
    });
    // 昵称
    drawText(ctx, (it.nickName || '匿名玩家'), 92, y + rowH / 2 - 10, {
      color: PALETTE.text, fontSize: 17, bold: true, baseline: 'middle',
    });
    // 段位
    drawText(ctx, it.rankName || '', 92, y + rowH / 2 + 12, {
      color: PALETTE.textDim, fontSize: 13, baseline: 'middle',
    });
    // 积分 / 胜率（内缩到卡片内）
    if (showScore) {
      drawText(ctx, '积分 ' + (it.rankScore || 0), W - 28, y + rowH / 2 + 1, {
        color: PALETTE.gold, fontSize: 16, align: 'right', baseline: 'middle', bold: true,
      });
    } else {
      drawText(ctx, '胜率 ' + (it.winRate || 0) + '%', W - 28, y + rowH / 2 + 1, {
        color: PALETTE.gold, fontSize: 16, align: 'right', baseline: 'middle', bold: true,
      });
    }
  });
  ctx.restore();
}

function drawMyCard(ctx, cardY) {
  const cardX = 16, cardW = W - 32, cardH = 64;
  // 高亮底色（区别于普通行）
  ctx.fillStyle = 'rgba(139,105,20,0.08)';
  roundRect(ctx, cardX, cardY, cardW, cardH, 10);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.gold;
  ctx.stroke();

  // 固定显示：自己的排名（#名次 / 未上榜）
  if (myInfo.outOfTop) {
    drawText(ctx, '#--', 32, cardY + cardH / 2 + 1, {
      color: PALETTE.textDim, fontSize: 18, bold: true, baseline: 'middle',
    });
  } else {
    drawText(ctx, '#' + myInfo.rank, 32, cardY + cardH / 2 + 1, {
      color: PALETTE.gold, fontSize: 18, bold: true, baseline: 'middle',
    });
  }
  // 头像
  drawAvatar(ctx, {
    x: 68, y: cardY + cardH / 2, r: 18,
    label: (myInfo.nickName || '我').slice(0, 1), avatar: myInfo.avatarUrl || '',
    ring: true,
  });
  // 昵称 + 段位
  drawText(ctx, myInfo.nickName || '我', 94, cardY + cardH / 2 - 10, {
    color: PALETTE.text, fontSize: 18, bold: true, baseline: 'middle',
  });
  drawText(ctx, myInfo.rankName || '', 94, cardY + cardH / 2 + 12, {
    color: PALETTE.textDim, fontSize: 13, baseline: 'middle',
  });
  // "未上榜"标记 / 数值
  const showScore = tabKey === 'score';
  if (myInfo.outOfTop) {
    drawText(ctx, '未上榜', W - 28, cardY + cardH / 2 - 6, {
      color: PALETTE.red, fontSize: 15, align: 'right', baseline: 'middle', bold: true,
    });
    // 副信息：当前积分/胜率
    drawText(ctx, showScore ? ('积分 ' + myInfo.rankScore) : ('胜率 ' + myInfo.winRate + '%'), W - 28, cardY + cardH / 2 + 14, {
      color: PALETTE.textDim, fontSize: 12, align: 'right', baseline: 'middle',
    });
  } else if (showScore) {
    drawText(ctx, '积分 ' + myInfo.rankScore, W - 28, cardY + cardH / 2 + 1, {
      color: PALETTE.gold, fontSize: 17, align: 'right', baseline: 'middle', bold: true,
    });
  } else {
    drawText(ctx, '胜率 ' + myInfo.winRate + '%', W - 28, cardY + cardH / 2 + 1, {
      color: PALETTE.gold, fontSize: 17, align: 'right', baseline: 'middle', bold: true,
    });
  }
}

function drawScrollHint(ctx, listTop, listBottom) {
  // 顶部/底部渐变遮罩，提示可滚动
  const hintH = 18;
  ctx.fillStyle = 'rgba(245,240,232,0.9)';
  ctx.fillRect(0, listTop, W, hintH);
  ctx.fillRect(0, listBottom - hintH, W, hintH);
  drawText(ctx, '↑ 上滑查看更多', W / 2, listTop + 12, {
    color: PALETTE.textDim, fontSize: 12, align: 'center', baseline: 'middle',
  });
  drawText(ctx, '↓ 下滑查看更多', W / 2, listBottom - 12, {
    color: PALETTE.textDim, fontSize: 12, align: 'center', baseline: 'middle',
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

  // 标题
  drawText(ctx, '排行榜', W / 2, state.statusBarHeight + 30, {
    color: PALETTE.text, fontSize: 28, align: 'center', bold: true,
  });
  drawTabs(ctx);

  // 自己卡片：固定显示在导航上方
  const navTop = H - 64;
  const myH = 64;
  const myTop = navTop - myH - 10;
  drawMyCard(ctx, myTop);

  // 列表区：从 tab 底部到自己卡片上方
  const sbh = state.statusBarHeight;
  const listTop = sbh + 60 + 38 + 14; // tab 底部 + 间隔
  const listBottom = myTop - 8;

  const listH = listBottom - listTop;
  const totalListH = list.length * rowH;
  // 限制滚动范围
  const maxOffset = Math.max(0, totalListH - listH);
  if (scrollOffset > maxOffset) scrollOffset = maxOffset;
  if (scrollOffset < 0) scrollOffset = 0;

  drawList(ctx, listTop, listBottom);

  // 当列表超出可视区域时显示滚动提示
  if (totalListH > listH) {
    drawScrollHint(ctx, listTop, listBottom);
  }

  rects.W = W; rects.H = H;
  drawBottomNav(ctx, 'rank', rects);
}

function onTouch(x, y) {
  // tab 切换
  if (rects.tabs) {
    for (const t of rects.tabs) {
      if (hit(t, x, y)) { switchTab(t.key); return; }
    }
  }
  // 列表区滑动：单次 tap 向上/向下滚动 3 行
  const sbh = state.statusBarHeight;
  const navTop = H - 64;
  const myTop = navTop - 64 - 10;
  const listTop = sbh + 60 + 38 + 14;
  const listBottom = myTop - 8;
  if (y > listTop && y < listBottom) {
    // 上半部 tap → 上滚（看后面的），下半部 → 下滚
    if (y < (listTop + listBottom) / 2) {
      scrollOffset = Math.min(scrollOffset + rowH * 3, Math.max(0, list.length * rowH - (listBottom - listTop)));
    } else {
      scrollOffset = Math.max(0, scrollOffset - rowH * 3);
    }
    return;
  }
  // 底部导航
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'rank') { sceneMgr.goto(t.key); return; }
    }
  }
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs: () => {} };