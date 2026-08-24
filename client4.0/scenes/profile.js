/**
 * 下六儿 小游戏版 — 个人主页场景
 * 设计依据：figma.html #page-profile（375×812 基准，暖金棕国风）
 * 布局：顶部深棕渐变头部 → 精力卡 → 每日签到卡 → 历史战绩 → 底部导航
 * 用 Canvas 绘制；签到等操作通过 WS 与服务端同步。
 */

const { state, saveProfile, AVATAR_PRESETS, syncUserData } = require('../state');
const { wsManager } = require('../utils/websocket');
const { PALETTE, drawText, drawCard, drawAvatar, hit, drawButton, roundRect, drawBottomNav, FONT_FAMILY } = require('../utils/ui');
const { SERVER_BASE, AD_UNIT_ID, AD_REWARD_DAILY, SHARE_REWARD_DAILY } = require('../config');
const audio = require('../utils/audio');
const settingsModal = require('../utils/settings-modal');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};
let checkedInToday = false;
// 每日看视频/分享已用次数（本地缓存，跨天重置）
let dailyAdCount = 0;
let dailyShareCount = 0;
let rewardedVideoAd = null; // 激励视频广告实例（复用）
let myHistory = [];         // 历史战绩（服务端返回）
let historyLoadedAll = false; // 是否已加载最近 50 条（查看全部）
// 页面滚动（整页内容上下滚动）
let pageScroll = 0;           // 当前页面滚动偏移
let pageScrollMax = 0;        // 页面最大可滚动距离
// 历史战绩内部滚动（展开 50 条时用）
let scrollOffset = 0;
let scrollMax = 0;
let dragStartY = 0;           // 拖动起始 Y
let dragStartPageScroll = 0;  // 拖动起始时页面滚动
let dragStartScroll = 0;      // 拖动起始时历史滚动
let dragging = false;         // 是否正在拖动
let dragMode = '';            // 'page' 整页 | 'history' 历史内部
let showSettings = false;     // 是否显示"设置"弹窗

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 读取本地每日次数缓存作为初始/降级值（跨天自动清零）。
 * 权威值来自服务端 login_success / reward 结果，会在后续由 state 同步覆盖。
 */
function loadDailyCounts() {
  const today = todayStr();
  let cache = {};
  try { cache = wx.getStorageSync('dailyReward') || {}; } catch (e) { cache = {}; }
  if (cache.date !== today) {
    cache = { date: today, adCount: 0, shareCount: 0 };
    try { wx.setStorageSync('dailyReward', cache); } catch (e) { /* ignore */ }
  }
  // 以服务端权威值为准（登录时已同步到 state.dailyAdCount / dailyShareCount）。
  // 注意：已用次数可能为 0（今天还没用过 / 跨天已恢复），0 是合法值，不能用假值判断回退本地缓存，
  // 否则会回退到旧缓存中"昨天用完"的次数，导致今天仍显示"已用完"。
  // 仅当服务端未下发（undefined）时才用本地缓存降级。
  dailyAdCount = (state.dailyAdCount !== undefined) ? state.dailyAdCount : (cache.adCount || 0);
  dailyShareCount = (state.dailyShareCount !== undefined) ? state.dailyShareCount : (cache.shareCount || 0);
}

/** 增加本地每日次数并持久化 */
function bumpDailyCount(type) {
  const today = todayStr();
  let cache = {};
  try { cache = wx.getStorageSync('dailyReward') || {}; } catch (e) { cache = {}; }
  if (cache.date !== today) cache = { date: today, adCount: 0, shareCount: 0 };
  if (type === 'ad') cache.adCount = (cache.adCount || 0) + 1;
  else cache.shareCount = (cache.shareCount || 0) + 1;
  dailyAdCount = cache.adCount || 0;
  dailyShareCount = cache.shareCount || 0;
  try { wx.setStorageSync('dailyReward', cache); } catch (e) { /* ignore */ }
}

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
  // 同步场次统计（与服务端资源更新保持一致）
  syncUserData(data);
}

// 登录成功后用服务端权威每日次数同步本地显示变量，登录即决定按钮是否可点
function onLoginSuccess(data) {
  if (data && data.dailyAdCount !== undefined) {
    dailyAdCount = data.dailyAdCount;
    state.dailyAdCount = data.dailyAdCount;
    // 同步本地缓存，保证跨天恢复后缓存也是正确值
    try {
      const c = wx.getStorageSync('dailyReward') || {};
      c.date = todayStr();
      c.adCount = data.dailyAdCount;
      wx.setStorageSync('dailyReward', c);
    } catch (e) { /* ignore */ }
  }
  if (data && data.dailyShareCount !== undefined) {
    dailyShareCount = data.dailyShareCount;
    state.dailyShareCount = data.dailyShareCount;
    try {
      const c = wx.getStorageSync('dailyReward') || {};
      c.date = todayStr();
      c.shareCount = data.dailyShareCount;
      wx.setStorageSync('dailyReward', c);
    } catch (e) { /* ignore */ }
  }
}

// 历史战绩返回
function onHistory(data) {
  const list = (data && data.games) || [];
  myHistory = list.map((g) => {
    const isBlack = g.blackOpenid === state.openid;
    const myResult = g.result === 'black' ? (isBlack ? 'win' : 'lose')
      : g.result === 'white' ? (isBlack ? 'lose' : 'win')
      : 'draw';
    const opponent = isBlack ? g.whiteOpenid : g.blackOpenid;
    const oppName = isBlack ? g.whiteNickName : g.blackNickName;
    return {
      result: myResult,
      opponent,
      // 优先真实昵称；为空时显示"对手"，不再截取 openid（避免出现 o0oDP5 这种乱码）
      opponentName: (oppName && oppName.trim()) ? oppName : '对手',
      // 以结算结束时间为准（endTime），fallback 到 createTime
      endTime: g.endTime || g.createTime,
      createTime: g.createTime,
    };
  });
}

function onEnter() {
  wsManager.on('resource_update', onResourceUpdate);
  wsManager.on('login_success', onLoginSuccess);
  wsManager.on('sign_in_result', onSignInResult);
  wsManager.on('ad_reward_result', onAdRewardResult);
  wsManager.on('share_reward_result', onShareRewardResult);
  wsManager.on('history', onHistory);
  wsManager.on('error', onSignInError);
  // 重置滚动/设置状态
  pageScroll = 0; pageScrollMax = 0;
  scrollOffset = 0; scrollMax = 0; dragging = false; dragMode = ''; showSettings = false; showAvatarPicker = false;
  loadDailyCounts();
  // 拉取历史战绩：一次性拉最近 50 条到本地，默认只显示前 5 条，
  // 这样只要有 5 条以上记录，"查看全部"就能正常出现。
  try { wsManager.send('get_history', { limit: 50 }); } catch (e) { /* ignore */ }
  // 签到状态优先以服务端为准（state.lastCheckin），本地缓存仅作降级
  const localSignin = (() => { try { return wx.getStorageSync('lastSignin'); } catch (e) { return ''; } })();
  const serverCheckin = state.lastCheckin ? state.lastCheckin.slice(0, 10) : '';
  checkedInToday = serverCheckin === todayStr() || localSignin === todayStr();
  // 当服务端已经返回精力（login_success 已先执行）时，若本地仍显示默认值/旧值，立即以服务端为准刷新


}

function onSignInResult(data) {
  checkedInToday = true;
  try { wx.setStorageSync('lastSignin', todayStr()); } catch (e) { /* ignore */ }
  // 服务端已返回最新精力，立即更新显示，避免依赖 resource_update 时序
  if (data && data.energy !== undefined) state.energy.current = data.energy;
  if (data && data.energyRecoverAt !== undefined) state.energy.nextRecoverAt = data.energyRecoverAt;
  const reward = data && data.bonus ? data.bonus : ((new Date().getDay() % 6 === 0) ? 10 : 5);
  wx.showToast({ title: '签到成功 +' + reward + '精力', icon: 'success' });
}

function onAdRewardResult(data) {
  if (data && data.energy !== undefined) state.energy.current = data.energy;
  // 以服务端返回的权威已用次数为准
  if (data && data.adCount !== undefined) {
    dailyAdCount = data.adCount;
    state.dailyAdCount = data.adCount;
  } else {
    bumpDailyCount('ad');
  }
  wx.hideLoading && wx.hideLoading();
  wx.showToast({ title: '精力 +' + (data && data.reward ? data.reward : 10), icon: 'success' });
}

function onShareRewardResult(data) {
  if (data && data.energy !== undefined) state.energy.current = data.energy;
  // 以服务端返回的权威已用次数为准
  if (data && data.shareCount !== undefined) {
    dailyShareCount = data.shareCount;
    state.dailyShareCount = data.shareCount;
  } else {
    bumpDailyCount('share');
  }
  wx.showToast({ title: '精力 +' + (data && data.reward ? data.reward : 5), icon: 'success' });
}

function onSignInError(data) {
  const msg = data && data.errMsg ? data.errMsg : '操作失败';
  wx.hideLoading && wx.hideLoading();
  // 已签到：标记本地并给出友好提示，避免重复请求
  if (msg.indexOf('已签到') >= 0) {
    checkedInToday = true;
    try { wx.setStorageSync('lastSignin', todayStr()); } catch (e) { /* ignore */ }
    wx.showToast({ title: '今日已签到，明天再来', icon: 'none' });
    return;
  }
  // 次数用尽：置满本地计数，让按钮变灰
  if (msg.indexOf('看视频') >= 0) {
    dailyAdCount = AD_REWARD_DAILY;
    state.dailyAdCount = AD_REWARD_DAILY;
    try { wx.setStorageSync('dailyReward', { date: todayStr(), adCount: dailyAdCount, shareCount: dailyShareCount }); } catch (e) { /* ignore */ }
    wx.showToast({ title: msg, icon: 'none' });
    return;
  }
  if (msg.indexOf('分享') >= 0) {
    dailyShareCount = SHARE_REWARD_DAILY;
    state.dailyShareCount = SHARE_REWARD_DAILY;
    try { wx.setStorageSync('dailyReward', { date: todayStr(), adCount: dailyAdCount, shareCount: dailyShareCount }); } catch (e) { /* ignore */ }
    wx.showToast({ title: msg, icon: 'none' });
    return;
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

  // 右列：积分 / 胜率 / 场次 + 齿轮，共用一个横向空间
  const totalGames = (state.wins || 0) + (state.losses || 0) + (state.draws || 0);
  const stats = [
    { num: '' + (state.rankScore || 0), label: '积分' },
    { num: (Number(state.winRate) || 0).toFixed(1) + '%', label: '胜率' },
    { num: '' + totalGames, label: '场次' },
  ];
  // 左列：头像 + 昵称 + 段位徽章（占 52%）
  const leftW = Math.round(W * 0.52);
  // 右侧预留：齿轮按钮 34px + 间距 8px 放最右，统计区在其左侧
  const rightReserve = 34 + 8;
  const rightW = W - leftW - rightReserve;          // 统计区宽
  const statsStartX = leftW;

  // 头像 + 昵称（缩小字号）+ 段位徽章
  rects.avatarHit = { x: 10, y: cy - 38, w: 56, h: 76 };
  drawAvatar(ctx, {
    x: 38, y: cy, r: 27,
    label: ((state.userInfo && state.userInfo.nickName) || '玩').slice(0, 1),
    avatar: (state.userInfo && state.userInfo.avatarUrl) || '', ring: true,
  });
  const nickRaw = (state.userInfo && state.userInfo.nickName) || '玩家';
  const nick = nickRaw.slice(0, 5); // 限 5 字
  const nickX = 74;
  rects.nickHit = { x: nickX - 4, y: cy - 30, w: 110, h: 28 };
  drawText(ctx, nick, nickX, cy - 14, { color: '#FFFFFF', fontSize: 18, bold: true });
  // 小铅笔提示
  drawText(ctx, '✎', nickX + ctx.measureText(nick).width + 6, cy - 14, { color: 'rgba(255,255,255,0.55)', fontSize: 12, baseline: 'middle' });
  const badgeX = nickX, badgeY = cy + 12;
  const badgeText = (state.rankName || '初级小六');
  const badgeW = Math.max(88, badgeText.length * 11 + 20);
  roundRect(ctx, badgeX, badgeY, badgeW, 22, 11);
  ctx.fillStyle = 'rgba(212,168,67,0.22)';
  ctx.fill();
  drawText(ctx, '🏅 ' + badgeText, badgeX + badgeW / 2, badgeY + 11, { color: '#D4A843', fontSize: 12, align: 'center', baseline: 'middle', bold: true });

  // 统计区（字号缩小，互不重叠）
  const itemW = Math.floor(rightW / stats.length);
  stats.forEach((s, i) => {
    const cx = statsStartX + i * itemW + itemW / 2;
    drawText(ctx, s.num, cx, cy - 14, { color: '#FFFFFF', fontSize: 15, align: 'center', bold: true });
    drawText(ctx, s.label, cx, cy + 13, { color: 'rgba(255,255,255,0.6)', fontSize: 10, align: 'center' });
  });

  // 设置（齿轮）入口：只保留齿轮图标（无框无底），放大，放最右侧 cy 水平居中
  const gearIconSize = 30;                       // 齿轮放大
  const gearX = W - 8 - gearIconSize / 2;        // 图标中心 x
  const gearY = cy;                              // 图标中心 y（与统计数字同水平）
  const gearHitPad = 6;                          // 命中区比图标略大，便于点按
  rects.settingsBtn = {
    x: gearX - gearIconSize / 2 - gearHitPad,
    y: gearY - gearIconSize / 2 - gearHitPad,
    w: gearIconSize + gearHitPad * 2,
    h: gearIconSize + gearHitPad * 2,
  };
  ctx.font = `${gearIconSize}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('⚙', gearX, gearY);
}

function drawEnergyCard(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 158;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });

  // 左上："⚡ 精力" + 精力数字
  drawText(ctx, '⚡ 精力', cardX + 16, topY + 28, { color: PALETTE.textDim, fontSize: 14, bold: true });
  drawText(ctx, (state.energy.current || 0) + '/' + (state.energy.max || 30), cardX + 16, topY + 54, { color: PALETTE.text, fontSize: 24, bold: true });

  // 右上：下次恢复与倒计时
  drawText(ctx, '下次恢复', cardX + cardW - 16, topY + 24, { color: PALETTE.textDim, fontSize: 12, align: 'right' });
  drawText(ctx, formatCd(state.energy.nextRecoverAt), cardX + cardW - 16, topY + 52, { color: PALETTE.gold, fontSize: 20, align: 'right', bold: true });

  // 精力条（满宽）
  const barX = cardX + 16, barY = topY + 72, barW = cardW - 32, barH = 10;
  roundRect(ctx, barX, barY, barW, barH, 5);
  ctx.fillStyle = PALETTE.panelBorder;
  ctx.fill();
  const pct = Math.max(0, Math.min(1, (state.energy.current || 0) / (state.energy.max || 30)));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, barH, 5);
    ctx.fillStyle = PALETTE.goldBright;
    ctx.fill();
  }

  // 两个恢复精力按钮：看视频 +10 / 分享 +5（超限变灰不可点）
  const btnY = topY + 94;
  const btnH = 32;
  const btnGap = 12;
  const btnW = (cardW - 32 - btnGap) / 2;
  const adUsedUp = dailyAdCount >= AD_REWARD_DAILY;
  const shareUsedUp = dailyShareCount >= SHARE_REWARD_DAILY;
  const adText = adUsedUp ? '看视频已用完' : '🎬 看视频 +10';
  const shareText = shareUsedUp ? '分享已用完' : '📤 分享 +5';
  rects.adEnergy = drawButton(ctx, {
    text: adText, x: cardX + 16, y: btnY, w: btnW, h: btnH,
    fill: adUsedUp ? '#EDE7DB' : PALETTE.panel,
    textColor: adUsedUp ? '#B9AFA0' : PALETTE.gold,
    fontSize: 14, border: adUsedUp ? '#E3DCCE' : PALETTE.goldBright,
  });
  rects.shareEnergy = drawButton(ctx, {
    text: shareText, x: cardX + 16 + btnW + btnGap, y: btnY, w: btnW, h: btnH,
    fill: shareUsedUp ? '#EDE7DB' : PALETTE.panel,
    textColor: shareUsedUp ? '#B9AFA0' : PALETTE.green,
    fontSize: 14, border: shareUsedUp ? '#E3DCCE' : PALETTE.green,
  });
  // 小字说明（含剩余次数）
  drawText(ctx, '看视频 +10（剩' + (AD_REWARD_DAILY - dailyAdCount) + '次）· 分享 +5（剩' + (SHARE_REWARD_DAILY - dailyShareCount) + '次）', cardX + 16, topY + cardH - 10, {
    color: PALETTE.textDim, fontSize: 11,
  });
  return cardH;
}

function drawSignInCard(ctx, topY) {
  const cardX = 16, cardW = W - 32, cardH = 170;
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
    x: cardX + 16, y: topY + 130, w: cardW - 32, h: 26,
    fill: checkedInToday ? PALETTE.panelBorder : PALETTE.gold,
    textColor: checkedInToday ? PALETTE.textDim : PALETTE.textOnGold,
    fontSize: 16, border: checkedInToday ? PALETTE.panelBorder : null,
  });
  return cardH;
}

function drawHistory(ctx, topY) {
  const cardX = 16, cardW = W - 32;
  const pad = 14;                 // 卡片内边距（对齐 figma）
  const titleH = 14 + 8;         // 标题行高 + 下边距
  const rowH = 32 + 16;          // 每条 头像32 + 上下 padding 8*2
  const show = (myHistory || []);
  const displayCount = historyLoadedAll ? Math.min(show.length, 50) : Math.min(show.length, 5);
  const hasMore = show.length > 5;
  // 内部"查看全部/收起"按钮区域：按 figma 风格做成带边框的圆角行（卡片内底部）
  const viewAllH = hasMore ? 40 : 0;
  const viewAllGap = hasMore ? 8 : 0; // 行底与按钮之间的间距

  // 卡片高度 = 内边距 + 标题 + 行 + 查看全部区 + 内边距
  const contentH = pad + titleH + displayCount * rowH + viewAllGap + viewAllH + pad;
  const cardH = Math.max(180, contentH);
  scrollMax = 0;

  ctx.save();
  rects.historyCard = { x: cardX, y: topY, w: cardW, h: cardH };
  roundRect(ctx, cardX, topY, cardW, cardH, 14);
  ctx.clip();

  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });

  if (show.length === 0) {
    drawText(ctx, '暂无对局记录，快去下六儿来一局吧', W / 2, topY + pad + titleH + 20, { color: PALETTE.textDim, fontSize: 13, align: 'center' });
    ctx.restore();
    return cardH;
  }

  const titleAreaBottom = topY + pad + titleH;
  const listTop = titleAreaBottom;
  const listBottom = topY + cardH - pad - viewAllH - viewAllGap;

  // 绘制列表行
  show.slice(0, displayCount).forEach((rec, i) => {
    const ry = listTop + i * rowH;
    if (ry + rowH < listTop || ry > listBottom) return;

    // 分隔线：绘制在【行顶】（即上一条的底部）
    if (i > 0) {
      const sepY = ry;
      if (sepY > listTop && sepY < listBottom) {
        ctx.strokeStyle = '#E8E3DA';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cardX + pad, sepY);
        ctx.lineTo(cardX + cardW - pad, sepY);
        ctx.stroke();
      }
    }
    const cy = ry + 8 + 16; // 头像中心
    // 左侧圆形头像占位
    ctx.beginPath();
    ctx.arc(cardX + pad + 16, cy, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#E8E3DA';
    ctx.fill();
    drawText(ctx, '👤', cardX + pad + 16, cy + 1, { color: PALETTE.textDim, fontSize: 14, align: 'center', baseline: 'middle' });
    // 昵称 + 日期（以结算结束时间为准，格式 MM-DD HH:MM）
    const t = rec.endTime ? new Date(rec.endTime) : (rec.createTime ? new Date(rec.createTime) : null);
    const ts = t ? (String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')) : '';
    drawText(ctx, (rec.opponentName || '对手'), cardX + pad + 40, cy - 8, { color: PALETTE.text, fontSize: 13, bold: true });
    drawText(ctx, ts, cardX + pad + 40, cy + 9, { color: '#B0B0B0', fontSize: 10 });
    // 右侧 胜/负/和
    const tag = rec.result === 'win' ? '胜' : rec.result === 'lose' ? '负' : '和';
    const tagColor = rec.result === 'win' ? PALETTE.green : rec.result === 'lose' ? PALETTE.red : '#4A90D9';
    drawText(ctx, tag, cardX + cardW - pad, cy, { color: tagColor, fontSize: 14, align: 'right', baseline: 'middle', bold: true });
  });

  // 标题白底带（绘制在行之上，避免被滚出的行穿透遮挡标题）
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(cardX + 1, topY + 1, cardW - 2, pad + titleH - 2);
  drawText(ctx, '历史战绩', cardX + pad, topY + pad + 10, { color: PALETTE.text, fontSize: 14, bold: true });
  ctx.strokeStyle = '#E8E3DA';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + pad, titleAreaBottom - 1);
  ctx.lineTo(cardX + cardW - pad, titleAreaBottom - 1);
  ctx.stroke();

  // === 「查看全部 / 收起」：作为历史战绩卡片内最下方的带边框按钮（figma 风格）===
  rects.viewAllHistory = null;
  if (hasMore) {
    const btnX = cardX + pad + 8;
    const btnY = listBottom + viewAllGap;
    const btnW = cardW - (pad + 8) * 2;
    const btnH = viewAllH;
    // 外边框（圆角矩形，金色描边 + 浅底）
    roundRect(ctx, btnX, btnY, btnW, btnH, 10);
    ctx.fillStyle = '#FAF6EE';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#D4A843'; // 金色描边
    ctx.stroke();
    // 文字
    const label = historyLoadedAll ? '收起 ↑' : '查看全部 ↓';
    drawText(ctx, label, btnX + btnW / 2, btnY + btnH / 2 + 1, {
      color: '#8B6914', fontSize: 14, align: 'center', baseline: 'middle', bold: true,
    });
    // 命中区
    rects.viewAllHistory = { x: btnX, y: btnY, w: btnW, h: btnH };
  }

  ctx.restore();
  return cardH;
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

  drawHeader(ctx);

  // === 内容区（头部之下、底部导航之上）整页滚动 ===
  const navH = 64;
  const contentTop = 180;                     // 头部高度
  const contentViewH = H - contentTop - navH; // 内容可视高度

  // 先量算内容总高度（与 drawHistory 高度算法一致），计算最大可滚动距离
  const histArr = (myHistory || []);
  const histCount = Math.min(histArr.length, historyLoadedAll ? 50 : 5);
  const histEmpty = histArr.length === 0;
  const histHasMore = histArr.length > 5;
  // 历史卡高度 = 内边距 + 标题 + 行 + (查看全部按钮40 + 间距8) + 内边距
  const histBtnH = histHasMore ? 48 : 0;
  const historyCardH = histEmpty ? 180 : Math.max(180, 14 + 22 + histCount * 48 + histBtnH + 14);
  const totalContentH = 12 + 158 + 12 + 170 + 12 + historyCardH + 12;
  pageScrollMax = Math.max(0, totalContentH - contentViewH);
  if (pageScroll > pageScrollMax) pageScroll = pageScrollMax;
  if (pageScroll < 0) pageScroll = 0;

  // 用 clip 限制可滚动内容出现在头部与底部导航之间
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, contentTop, W, contentViewH);
  ctx.clip();
  ctx.translate(0, -pageScroll);   // 整页上移实现滚动

  let topY = contentTop + 12;
  topY += drawEnergyCard(ctx, topY) + 12;
  topY += drawSignInCard(ctx, topY) + 12;
  topY += drawHistory(ctx, topY);

  ctx.restore();

  rects.W = W; rects.H = H;
  drawBottomNav(ctx, 'profile', rects);

  // 设置弹窗（覆盖在最上层）
  if (showSettings) settingsModal.drawSettingsModal(ctx, rects, {});
  // 换头像浮层（最上层）
  if (showAvatarPicker) drawAvatarPickerOverlay(ctx);
}

function onTouch(x, y) {
  // 换头像浮层打开时：只处理浮层交互
  if (showAvatarPicker) {
    handleAvatarPickerTouch(x, y);
    return;
  }
  // 设置弹窗打开时：只处理设置弹窗交互
  if (showSettings) {
    const r = settingsModal.onSettingsTouch(x, y, rects);
    if (r === 'close') { showSettings = false; return; }
    return; // 'changed' 或 null 都拦截，不穿透到下层
  }

  // 底部导航优先判定（避免被其它大区域命中区误触）
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'profile') { sceneMgr.goto(t.key); return; }
    }
  }
  // 右上角设置入口
  if (rects.settingsBtn && hit(rects.settingsBtn, x, y)) {
    audio.playClick();
    showSettings = true;
    return;
  }
  // 点击头像：更换头像
  if (rects.avatarHit && hit(rects.avatarHit, x, y)) {
    changeAvatar();
    return;
  }
  // 点击昵称：更换昵称
  if (rects.nickHit && hit(rects.nickHit, x, y)) {
    changeNickname();
    return;
  }

  // 内容区按钮的命中坐标需要加上 pageScroll（因为绘制时整页上移了）
  const cy = y + pageScroll;

  if (rects.signInBtn && hit(rects.signInBtn, x, cy)) {
    if (checkedInToday) { wx.showToast({ title: '今日已签到，明天再来', icon: 'none' }); return; }
    wsManager.send('sign_in');
    return;
  }
  // 看视频 +10 精力（超限不可点）
  if (rects.adEnergy && hit(rects.adEnergy, x, cy)) {
    if (dailyAdCount >= AD_REWARD_DAILY) { wx.showToast({ title: '今日看视频次数已用完', icon: 'none' }); return; }
    watchAdForEnergy();
    return;
  }
  // 分享 +5 精力（超限不可点）
  if (rects.shareEnergy && hit(rects.shareEnergy, x, cy)) {
    if (dailyShareCount >= SHARE_REWARD_DAILY) { wx.showToast({ title: '今日分享次数已用完', icon: 'none' }); return; }
    shareForEnergy();
    return;
  }
  // 查看全部 / 收起 历史战绩：按钮在历史战绩卡内，卡随整页滚动，故命中坐标需 +pageScroll
  if (rects.viewAllHistory && hit(rects.viewAllHistory, x, cy)) {
    historyLoadedAll = !historyLoadedAll;
    pageScroll = 0;           // 收起/展开后回到顶部
    // 数据已在 onEnter 时拉满 50 条，本地切换即可，无需重复请求
    return;
  }
  // 点击到内容区空白：开始整页拖动
  dragStartY = y;
  dragStartPageScroll = pageScroll;
  dragging = true;
  dragMode = 'page';
}

/** 触摸移动 - 整页滚动 */
function onTouchMove(x, y) {
  if (!dragging) return;
  const dy = y - dragStartY;
  pageScroll = dragStartPageScroll - dy;
  if (pageScroll > pageScrollMax) pageScroll = pageScrollMax;
  if (pageScroll < 0) pageScroll = 0;
}

/** 触摸结束 - 结束拖动 */
function onTouchEnd() {
  dragging = false;
  dragMode = '';
}

/** 看激励视频广告换精力：播放完成后才发请求 */
function watchAdForEnergy() {
  if (typeof wx.createRewardedVideoAd !== 'function') {
    // 环境不支持激励视频（开发者工具/低版本），直接模拟完成
    wx.showToast({ title: '当前环境不支持广告，已直接发放', icon: 'none' });
    wsManager.send('get_ad_reward');
    return;
  }
  if (!AD_UNIT_ID) {
    // 未配置广告位：模拟播放完成（便于联调），提示用户
    wx.showToast({ title: '未配置广告位，模拟播放完成', icon: 'none' });
    setTimeout(() => wsManager.send('get_ad_reward'), 300);
    return;
  }
  // 复用广告实例
  if (!rewardedVideoAd) {
    rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID });
    rewardedVideoAd.onClose((res) => {
      if (res && res.isEnded) {
        // 完整看完 → 发奖励请求
        wsManager.send('get_ad_reward');
      } else {
        wx.showToast({ title: '观看完整视频后才能领取', icon: 'none' });
      }
    });
    rewardedVideoAd.onError((err) => {
      wx.showToast({ title: '广告加载失败，请稍后再试', icon: 'none' });
    });
  }
  rewardedVideoAd.show().catch(() => {
    // 广告加载失败，尝试重新加载
    rewardedVideoAd.load().then(() => rewardedVideoAd.show()).catch(() => {
      wx.showToast({ title: '广告暂不可用，请稍后再试', icon: 'none' });
    });
  });
}

/**
 * 分享换精力：
 * 依赖微信 success/fail 回调。规则（按用户建议）：
 *  - success：直接发奖 + 提示「分享成功，精力 +5」
 *  - fail 且 点击→返回耗时 < 2s：弹「分享未成功，请再次分享」（取消 / 再次分享）
 *  - fail 且 耗时 ≥ 2s：视为已分享，直接发奖
 *  - 无任何回调（8s 兜底）：直接发奖，避免「没反应」
 * 用 done 守卫确保只处理一次，杜绝重复弹窗。
 */
function shareForEnergy() {
  if (dailyShareCount >= SHARE_REWARD_DAILY) {
    wx.showToast({ title: '今日分享次数已用完', icon: 'none' });
    return;
  }
  const t0 = Date.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    wx.hideLoading && wx.hideLoading();
  };
  const grant = () => {
    finish();
    wx.showToast({ title: '分享成功，精力 +5', icon: 'success' });
    try { wsManager.send('get_share_reward'); } catch (e) { /* ignore */ }
  };
  const onFail = () => {
    if (done) return;
    const dt = Date.now() - t0;
    if (dt < 2000) {
      // 太快返回：几乎肯定是没分享成功 → 提示再次分享
      finish();
      wx.showModal({
        title: '分享未成功',
        content: '分享好友后可获得 +5 精力，是否再次分享？',
        confirmText: '再次分享',
        cancelText: '取消',
        success: (r) => { if (r.confirm) shareForEnergy(); },
      });
    } else {
      // 停留较久才返回：视为已分享，直接发奖
      grant();
    }
  };

  wx.showLoading({ title: '请完成分享...', mask: true });
  const timer = setTimeout(() => { if (!done) grant(); }, 8000); // 无回调兜底

  if (typeof wx.shareAppMessage === 'function') {
    try {
      wx.shareAppMessage({
        title: '【下六儿】快来和我下六儿，赢取积分！',
        imageUrl: '',
        success: () => { clearTimeout(timer); grant(); },
        fail: () => { clearTimeout(timer); onFail(); },
      });
    } catch (e) {
      clearTimeout(timer);
      grantReward(); // 极端异常兜底
    }
  } else {
    clearTimeout(timer);
    wx.showToast({ title: '当前环境不支持分享，已直接发放', icon: 'none' });
    grantReward();
  }
}

/**
 * 换头像浮层状态。
 * 用 Canvas 浮层实现（而非 wx.showModal / wx.showActionSheet）：
 * 小游戏对 wx.showModal 的 confirmText/cancelText 及 wx.showActionSheet 兼容性差，
 * 会导致点击头像后"无反应"。改为在本场景内直接绘制一个预设头像选择浮层。
 */
let showAvatarPicker = false;

/** 点击头像：打开换头像浮层 */
function changeAvatar() {
  showAvatarPicker = true;
}

/** 选择预设 emoji 头像（单个图元，见 AVATAR_PRESETS） */
function choosePresetAvatar(emoji) {
  if (!emoji) return;
  const avatarUrl = 'emoji:' + emoji;
  const nickName = (state.userInfo && state.userInfo.nickName) || '';
  saveProfile(nickName, avatarUrl);
  wsManager.send('update_profile', { nickName, avatarUrl });
  wx.showToast({ title: '头像已更新', icon: 'success' });
  showAvatarPicker = false;
}

/** 全屏压暗背景 */
function dim(ctx) {
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);
}

/** 绘制"换头像"浮层（预设头像网格 + 上传相册 + 取消） */
function drawAvatarPickerOverlay(ctx) {
  dim(ctx);
  const pw = W * 0.86, ph = Math.round(H * 0.56), px = (W - pw) / 2, py = (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 20 });

  drawText(ctx, '更换头像', W / 2, py + 44, { color: PALETTE.text, fontSize: 26, align: 'center', bold: true });

  // 预设头像：9 个 emoji，排成 3×3
  const avatarR = 24;
  const gap = (pw - 48 - avatarR * 2 * 3) / 2;
  const startX = px + 24 + avatarR;
  const rowY = py + 86;
  const rowGap = avatarR * 2 + 14;
  rects.presetAvatars = [];
  AVATAR_PRESETS.forEach((emoji, i) => {
    const ax = startX + (i % 3) * (avatarR * 2 + gap);
    const ay = rowY + Math.floor(i / 3) * rowGap;
    const cur = (state.userInfo && state.userInfo.avatarUrl) === ('emoji:' + emoji);
    ctx.beginPath();
    ctx.arc(ax, ay, avatarR + 3, 0, Math.PI * 2);
    ctx.fillStyle = cur ? PALETTE.gold : '#F0E9DB';
    ctx.fill();
    drawAvatar(ctx, { x: ax, y: ay, r: avatarR, avatar: 'emoji:' + emoji, label: '' });
    rects.presetAvatars.push({ x: ax - avatarR - 3, y: ay - avatarR - 3, w: avatarR * 2 + 6, h: avatarR * 2 + 6, emoji });
  });

  // 上传相册 / 取消
  rects.avatarUploadBtn = drawButton(ctx, {
    text: '从相册上传', x: px + 40, y: py + ph - 108, w: pw - 80, h: 44,
    fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 18,
  });
  rects.avatarCancelBtn = drawButton(ctx, {
    text: '取消', x: px + 40, y: py + ph - 54, w: pw - 80, h: 40,
    fill: PALETTE.panel, textColor: PALETTE.textDim, fontSize: 16, border: PALETTE.panelBorder,
  });
}

/** 换头像浮层触摸处理，返回 true 表示已消费该触摸 */
function handleAvatarPickerTouch(x, y) {
  if (rects.presetAvatars) {
    for (let i = 0; i < rects.presetAvatars.length; i++) {
      if (hit(rects.presetAvatars[i], x, y)) {
        choosePresetAvatar(rects.presetAvatars[i].emoji);
        return true;
      }
    }
  }
  if (hit(rects.avatarUploadBtn, x, y)) { uploadAvatar(); return true; }
  if (hit(rects.avatarCancelBtn, x, y)) { showAvatarPicker = false; return true; }
  return false;
}

/**
 * 小游戏环境下没有 wx.canvasToTempFilePath（该 API 仅小程序可用），
 * 也无法把离屏 canvas 可靠导出为临时文件。因此头像上传直接读取
 * chooseMedia 返回的 tempFilePath 原图转 base64 上传即可；
 * 展示时的正方形/圆形裁切由前端 drawAvatar 在绘制阶段完成。
 */

/** 选择相册图片并上传，成功后作为头像（小游戏使用 wx.chooseMedia） */
function uploadAvatar() {
  if (typeof wx.chooseMedia !== 'function') {
    wx.showToast({ title: '当前环境不支持相册选择', icon: 'none' });
    return;
  }
  // 先关闭浮层再调起相册：浮层上的全屏 mask 会干扰 chooseMedia 弹窗，
  // 这是"第二次点上传失败"的根因。关闭后重绘一帧再调起。
  showAvatarPicker = false;
  const doPick = () => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        const tempPath = file && file.tempFilePath;
        if (!tempPath) { wx.showToast({ title: '未选择图片', icon: 'none' }); return; }
        wx.showLoading({ title: '处理中', mask: true });
        // 先压缩，避免 base64 体积过大触发服务端 413
        const readAndUpload = (finalPath) => {
          wx.getFileSystemManager().readFile({
          filePath: finalPath,
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
                  const avatarUrl = rr.data.url;
                  const nickName = (state.userInfo && state.userInfo.nickName) || '';
                  saveProfile(nickName, avatarUrl);
                  wsManager.send('update_profile', { nickName, avatarUrl });
                  wx.showToast({ title: '头像已更新', icon: 'success' });
                } else {
                  const errMsg = (rr.data && rr.data.errMsg) || '上传失败';
                  wx.showToast({ title: errMsg, icon: 'none' });
                }
              },
              fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }); },
            });
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '读取图片失败', icon: 'none' }); },
          });
        };
        // 优先压缩（compressImage 小游戏可用），失败则直接上传原图
        if (typeof wx.compressImage === 'function') {
          wx.compressImage({
            src: tempPath,
            quality: 70,
            compressedWidth: 512,
            success: (cr) => readAndUpload(cr.tempFilePath || tempPath),
            fail: () => readAndUpload(tempPath),
          });
        } else {
          readAndUpload(tempPath);
        }
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        console.error('[uploadAvatar] chooseMedia fail:', msg);
        // 用户主动取消：静默
        if (msg.indexOf('cancel') >= 0) return;
        // 权限/授权类错误（覆盖各机型不同文案）：引导去设置开启相册权限
        if (/auth|deny|permission|album|authorize/i.test(msg)) {
          wx.showModal({
            title: '需要相册权限',
            content: '上传头像需要访问相册，请在设置中开启相册权限后重试。',
            confirmText: '去设置',
            cancelText: '取消',
            success: (r) => { if (r.confirm) wx.openSetting && wx.openSetting(); },
          });
          return;
        }
        // 其它异常：打印真实错误，便于定位
        wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
      },
    });
  };
  // 先确认隐私授权（微信要求调用相册等接口前用户已同意隐私协议），
  // 再等当前帧渲染完（浮层已隐藏）调起相册，避免 mask 冲突。
  require('../utils/privacy').ensurePrivacyAuthorized(() => setTimeout(doPick, 60));
}

/** 点击昵称：输入新昵称 */
function changeNickname() {
  wx.showModal({
    title: '修改昵称',
    editable: true,
    placeholderText: '请输入昵称（最多10字）',
    success: (r) => {
      if (!r.confirm) return;
      const nickName = (r.content || '').trim().slice(0, 10);
      if (!nickName) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return; }
      const avatarUrl = (state.userInfo && state.userInfo.avatarUrl) || '';
      saveProfile(nickName, avatarUrl);
      wsManager.send('update_profile', { nickName, avatarUrl });
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    },
  });
}

function onWs() {}

function onLeave() {
  wsManager.off('resource_update', onResourceUpdate);
  wsManager.off('login_success', onLoginSuccess);
  wsManager.off('sign_in_result', onSignInResult);
  wsManager.off('ad_reward_result', onAdRewardResult);
  wsManager.off('share_reward_result', onShareRewardResult);
  wsManager.off('history', onHistory);
  wsManager.off('error', onSignInError);
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onTouchMove, onTouchEnd, onWs };
