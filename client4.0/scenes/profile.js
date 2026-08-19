/**
 * 下六儿 小游戏版 — 个人主页场景
 * 设计依据：figma.html #page-profile（375×812 基准，暖金棕国风）
 * 布局：顶部深棕渐变头部 → 精力卡 → 每日签到卡 → 历史战绩 → 底部导航
 * 用 Canvas 绘制；签到等操作通过 WS 与服务端同步。
 */

const { state, saveProfile, AVATAR_PRESETS } = require('../state');
const { wsManager } = require('../utils/websocket');
const { PALETTE, drawText, drawCard, drawAvatar, hit, drawButton, roundRect, drawBottomNav, FONT_FAMILY } = require('../utils/ui');
const { SERVER_BASE, AD_UNIT_ID, AD_REWARD_DAILY, SHARE_REWARD_DAILY } = require('../config');
const sceneMgr = require('./index');

let W = 375;
let H = 667;
let rects = {};
let checkedInToday = false;
// 每日看视频/分享已用次数（本地缓存，跨天重置）
let dailyAdCount = 0;
let dailyShareCount = 0;
let rewardedVideoAd = null; // 激励视频广告实例（复用）

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

/** 读取/校验本地每日次数缓存（跨天自动清零） */
function loadDailyCounts() {
  const today = todayStr();
  let cache = {};
  try { cache = wx.getStorageSync('dailyReward') || {}; } catch (e) { cache = {}; }
  if (cache.date !== today) {
    cache = { date: today, adCount: 0, shareCount: 0 };
    try { wx.setStorageSync('dailyReward', cache); } catch (e) { /* ignore */ }
  }
  dailyAdCount = cache.adCount || 0;
  dailyShareCount = cache.shareCount || 0;
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
}

function onEnter() {
  wsManager.on('resource_update', onResourceUpdate);
  wsManager.on('sign_in_result', onSignInResult);
  wsManager.on('ad_reward_result', onAdRewardResult);
  wsManager.on('share_reward_result', onShareRewardResult);
  wsManager.on('error', onSignInError);
  loadDailyCounts();
  try { checkedInToday = wx.getStorageSync('lastSignin') === todayStr(); } catch (e) { checkedInToday = false; }
}

function onSignInResult(data) {
  checkedInToday = true;
  try { wx.setStorageSync('lastSignin', todayStr()); } catch (e) { /* ignore */ }
  // 服务端已返回最新精力，立即更新显示，避免依赖 resource_update 时序
  if (data && data.energy !== undefined) state.energy.current = data.energy;
  const reward = data && data.bonus ? data.bonus : ((new Date().getDay() % 6 === 0) ? 10 : 5);
  wx.showToast({ title: '签到成功 +' + reward + '精力', icon: 'success' });
}

function onAdRewardResult(data) {
  if (data && data.energy !== undefined) state.energy.current = data.energy;
  bumpDailyCount('ad');
  wx.hideLoading && wx.hideLoading();
  wx.showToast({ title: '精力 +' + (data && data.reward ? data.reward : 10), icon: 'success' });
}

function onShareRewardResult(data) {
  if (data && data.energy !== undefined) state.energy.current = data.energy;
  bumpDailyCount('share');
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
    try { wx.setStorageSync('dailyReward', { date: todayStr(), adCount: dailyAdCount, shareCount: dailyShareCount }); } catch (e) { /* ignore */ }
    wx.showToast({ title: msg, icon: 'none' });
    return;
  }
  if (msg.indexOf('分享') >= 0) {
    dailyShareCount = SHARE_REWARD_DAILY;
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

  // 左列：头像 + 昵称（限 6 字不换行）+ 段位徽章
  const leftW = Math.round(W * 0.58); // 左列占 58%，给右侧统计留位
  rects.avatarHit = { x: 10, y: cy - 40, w: 60, h: 80 };
  drawAvatar(ctx, {
    x: 40, y: cy, r: 30,
    label: ((state.userInfo && state.userInfo.nickName) || '玩').slice(0, 1),
    avatar: (state.userInfo && state.userInfo.avatarUrl) || '', ring: true,
  });
  const nickRaw = (state.userInfo && state.userInfo.nickName) || '玩家';
  const nick = nickRaw.slice(0, 6); // 限制昵称最多 6 个汉字（按显示宽度截断）
  const nickX = 82;
  rects.nickHit = { x: nickX - 4, y: cy - 34, w: 120, h: 30 };
  drawText(ctx, nick, nickX, cy - 14, { color: '#FFFFFF', fontSize: 22, bold: true });
  // 小铅笔提示，暗示可点击编辑
  drawText(ctx, '✎', nickX + ctx.measureText(nick).width + 10, cy - 14, { color: 'rgba(255,255,255,0.55)', fontSize: 14, baseline: 'middle' });
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
  const adText = adUsedUp ? '🎬 看视频已用完' : ('🎬 看视频 +10 (' + (AD_REWARD_DAILY - dailyAdCount) + ')');
  const shareText = shareUsedUp ? '📤 分享已用完' : ('📤 分享 +5 (' + (SHARE_REWARD_DAILY - dailyShareCount) + ')');
  rects.adEnergy = drawButton(ctx, {
    text: adText, x: cardX + 16, y: btnY, w: btnW, h: btnH,
    fill: adUsedUp ? '#EDE7DB' : PALETTE.panel,
    textColor: adUsedUp ? '#B9AFA0' : PALETTE.gold,
    fontSize: 13, border: adUsedUp ? '#E3DCCE' : PALETTE.goldBright,
  });
  rects.shareEnergy = drawButton(ctx, {
    text: shareText, x: cardX + 16 + btnW + btnGap, y: btnY, w: btnW, h: btnH,
    fill: shareUsedUp ? '#EDE7DB' : PALETTE.panel,
    textColor: shareUsedUp ? '#B9AFA0' : PALETTE.green,
    fontSize: 13, border: shareUsedUp ? '#E3DCCE' : PALETTE.green,
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
  const cardX = 16, cardW = W - 32, cardH = 60;
  drawCard(ctx, { x: cardX, y: topY, w: cardW, h: cardH, radius: 14 });
  drawText(ctx, '历史战绩', cardX + 16, topY + 20, { color: PALETTE.text, fontSize: 16, bold: true });
  // 空态占位
  drawText(ctx, '暂无对局记录，快去下六儿来一局吧', W / 2, topY + 42, { color: PALETTE.textDim, fontSize: 13, align: 'center' });
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
  if (rects.signInBtn && hit(rects.signInBtn, x, y)) {
    if (checkedInToday) { wx.showToast({ title: '今日已签到，明天再来', icon: 'none' }); return; }
    wsManager.send('sign_in');
    return;
  }
  // 看视频 +10 精力（超限不可点）
  if (rects.adEnergy && hit(rects.adEnergy, x, y)) {
    if (dailyAdCount >= AD_REWARD_DAILY) { wx.showToast({ title: '今日看视频次数已用完', icon: 'none' }); return; }
    watchAdForEnergy();
    return;
  }
  // 分享 +5 精力（超限不可点）
  if (rects.shareEnergy && hit(rects.shareEnergy, x, y)) {
    if (dailyShareCount >= SHARE_REWARD_DAILY) { wx.showToast({ title: '今日分享次数已用完', icon: 'none' }); return; }
    shareForEnergy();
    return;
  }
  if (rects.bottomTabs) {
    for (const t of rects.bottomTabs) {
      if (hit(t, x, y) && t.key !== 'profile') { sceneMgr.goto(t.key); return; }
    }
  }
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

/** 分享换精力：分享完成后发请求 */
function shareForEnergy() {
  if (typeof wx.shareAppMessage !== 'function') {
    wx.showToast({ title: '当前环境不支持分享，已直接发放', icon: 'none' });
    wsManager.send('get_share_reward');
    return;
  }
  wx.shareAppMessage({
    title: '【下六儿】快来和我下六儿，赢取积分！',
    imageUrl: '',
    success: () => {
      // 分享成功后发奖励请求
      wsManager.send('get_share_reward');
    },
    fail: () => {
      wx.showToast({ title: '分享取消，未获得奖励', icon: 'none' });
    },
  });
}

/** 点击头像：选择预设 emoji 或从相册上传 */
function changeAvatar() {
  wx.showActionSheet({
    itemList: ['选择预设头像', '从相册上传'],
    success: (res) => {
      if (res.tapIndex === 0) choosePresetAvatar();
      else if (res.tapIndex === 1) uploadAvatar();
    },
  });
}

/** 选择预设 emoji 头像 */
function choosePresetAvatar() {
  wx.showActionSheet({
    itemList: AVATAR_PRESETS,
    success: (res) => {
      const emoji = AVATAR_PRESETS[res.tapIndex];
      if (!emoji) return;
      const avatarUrl = 'emoji:' + emoji;
      const nickName = (state.userInfo && state.userInfo.nickName) || '';
      saveProfile(nickName, avatarUrl);
      wsManager.send('update_profile', { nickName, avatarUrl });
      wx.showToast({ title: '头像已更新', icon: 'success' });
    },
  });
}

/** 选择相册图片并上传，成功后作为头像 */
function uploadAvatar() {
  wx.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album'],
    success: (res) => {
      const tempPath = res.tempFilePaths && res.tempFilePaths[0];
      if (!tempPath) return;
      wx.showLoading({ title: '上传中', mask: true });
      wx.getFileSystemManager().readFile({
        filePath: tempPath,
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
                wx.showToast({ title: '上传失败', icon: 'none' });
              }
            },
            fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }); },
          });
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '读取图片失败', icon: 'none' }); },
      });
    },
  });
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
  wsManager.off('sign_in_result', onSignInResult);
  wsManager.off('ad_reward_result', onAdRewardResult);
  wsManager.off('share_reward_result', onShareRewardResult);
  wsManager.off('error', onSignInError);
}

module.exports = { onEnter, onLeave, onDraw, onTouch, onWs };
