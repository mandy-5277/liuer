/**
 * 下六儿 小游戏版 — 全局状态 + 登录流程
 * （对应小程序版 app.js 的 globalData 与 loginAndConnect 逻辑）
 *
 * 小游戏没有 App() 实例，这里用一个单例模块保存全局状态，
 * 并由 game.js 在启动时调用 init() 完成登录与 WS 连接。
 */

const { wsManager, wsConfig } = require('./utils/websocket');
const { SERVER_BASE } = require('./config');

const SERVER_URL = SERVER_BASE;

// ========== 完善资料配置 ==========

/** 预设头像（emoji，avatarUrl 存 "emoji:xxx" 前缀格式） */
const AVATAR_PRESETS = [
  '👨🌾', // 农村男孩
  '👩🌾', // 农村女孩
  '👴',   // 农村老头
  '👵',   // 农村老太
  '🕶️',   // 农村混混
  '💃',   // 农村美女
];

/** 随机昵称池（乡土/趣味风格） */
const RANDOM_NICKNAMES = [
  '快乐农夫', '麦田守望者', '大槐树下', '山野清风', '稻花香里',
  '老村长', '小芳', '二狗子', '铁蛋儿', '翠花儿',
  '黄土高坡', '溪边放牛', '田埂漫步', '晒谷场的风', '稻草人',
  '老屋炊烟', '打谷场上', '看门大黄', '篱笆院', '井台打水',
];

/** 随机生成一个昵称 */
function randomNickname() {
  const i = Math.floor(Math.random() * RANDOM_NICKNAMES.length);
  return RANDOM_NICKNAMES[i] + (Math.random() < 0.4 ? String(Math.floor(Math.random() * 90) + 10) : '');
}

const state = {
  // 用户信息（由服务端同步）
  userInfo: null,
  openid: null,

  // 需要引导用户完善资料（昵称/头像）时置 true，由首页弹出"完善资料"浮层
  showProfileSetup: false,

  // 游戏数据（由服务端 resource_update 事件同步更新）
  energy: { current: 5, max: 30, nextRecoverAt: 0 },
  rankName: '初级小六',
  rankScore: 0,
  winRate: 0,

  // 系统信息
  systemInfo: null,
  statusBarHeight: 20,

  // 当前对局（匹配成功后由 game_start 写入）
  currentGame: null,
  pendingRoom: '',   // 分享卡片带入的房间号，启动后自动加入

  // 排行榜/统计等缓存
  rankList: [],

  // 授权待确认标志：微信用户信息授权浮层显示期间为 true，
  // 在此阶段 home 场景的其它按钮点击应被禁用，避免与授权按钮重叠触发。
  authPending: false,

  // 棋子皮肤（用户自定义）：classic / warm / nature，本地持久化
  pieceSkin: (() => {
    try { return wx.getStorageSync('pieceSkin') || 'classic'; } catch (e) { return 'classic'; }
  })(),
};

/** 设置并持久化棋子皮肤 */
function setPieceSkin(skinKey) {
  state.pieceSkin = skinKey;
  try { wx.setStorageSync('pieceSkin', skinKey); } catch (e) { /* ignore */ }
}

/**
 * 登录流程：
 * 1. wx.login() 获取临时 code
 * 2. POST /api/auth/wx-login 发送 code 换取 openid
 * 3. 用 openid 连接 WebSocket 游戏服务器
 */
function init() {
  getSystemInfo();
  loginAndConnect();
}

function getSystemInfo() {
  try {
    const info = wx.getSystemInfoSync();
    state.systemInfo = info;
    state.statusBarHeight = info.statusBarHeight || 20;
  } catch (e) {
    state.statusBarHeight = 20;
  }
}

function loginAndConnect() {
  wx.login({
    success: (loginRes) => {
      if (!loginRes.code) {
        console.error('[State] wx.login 未返回 code');
        fallbackInit();
        return;
      }
      console.log('[State] wx.login 成功');
      exchangeCodeForOpenid(loginRes.code);
    },
    fail: (err) => {
      console.error('[State] wx.login 失败:', err);
      fallbackInit();
    },
  });
}

function exchangeCodeForOpenid(code) {
  wx.request({
    url: SERVER_URL + '/api/auth/wx-login',
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    data: { code },
    success: (res) => {
      if (res.statusCode === 200 && res.data && res.data.ok) {
        const { openid, unionid } = res.data;
        state.openid = openid;
        if (res.data.isMock) {
          console.warn('[State] 使用模拟登录（服务端未配置 WX_APPSECRET）');
        }
        console.log('[State] 获取 openid 成功:', openid);
        state.userInfo = { openid, unionid: unionid || '' };
        ensureUserInfoAndConnect();
      } else {
        console.error('[State] 换取 openid 失败:', res.data);
        fallbackInit();
      }
    },
    fail: (err) => {
      console.error('[State] HTTP 请求失败:', err);
      fallbackInit();
    },
  });
}

/** 降级初始化（当服务不可用时，用本地标识保证小游戏不崩溃） */
function fallbackInit() {
  console.warn('[State] 使用降级模式初始化');
  if (!state.openid) {
    state.openid = 'local_' + Date.now();
  }
  state.userInfo = { nickName: '离线模式', openid: state.openid };
}

/**
 * 首次进入时引导用户完善资料。
 * 小游戏无 WXML，且新版微信不再通过授权返回真实昵称头像，
 * 因此连接服务器后，由首页弹出"完善资料"浮层，让用户选择预设头像
 * （或上传相册图片）并设置昵称。
 */
function ensureUserInfoAndConnect() {
  let stored = null;
  try {
    stored = wx.getStorageSync('userInfo');
  } catch (e) { /* ignore */ }
  if (stored && (stored.nickName || stored.avatarUrl)) {
    state.userInfo = Object.assign({}, state.userInfo, stored);
    state.showProfileSetup = false;
    connectGameServer();
    return;
  }

  // 无本地资料：连接服务器（先以空昵称连接），并标记需要完善资料，由首页弹浮层引导。
  state.showProfileSetup = true;
  console.log('[State] 首次进入，引导完善昵称/头像');
  connectGameServer();
}

/** 保存用户自定的昵称/头像（完善资料浮层确定后调用） */
function saveProfile(nickName, avatarUrl) {
  state.userInfo = Object.assign({}, state.userInfo, { nickName, avatarUrl });
  try { wx.setStorageSync('userInfo', { nickName, avatarUrl }); } catch (e) { /* ignore */ }
  state.showProfileSetup = false;
}

function connectGameServer() {
  const { openid, userInfo } = state;

  // 避免重复注册监听
  wsManager.off('login_success');
  wsManager.off('resource_update');
  wsManager.off('server_shutdown');
  wsManager.off('connection_failed');

  wsManager.on('login_success', (data) => {
    console.log('[State] 游戏服务器登录成功:', data);
    syncUserData(data);
  });

  wsManager.on('resource_update', (data) => {
    syncUserData(data);
  });

  wsManager.on('server_shutdown', () => {
    console.log('[State] 服务器维护中');
  });

  wsManager.on('connection_failed', (err) => {
    console.error('[State] WebSocket 连接失败:', err);
  });

  wsManager.connect(openid, userInfo && userInfo.nickName ? userInfo.nickName : '', userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : '')
    .then(() => {
      console.log('[State] WebSocket 游戏服务器已连接');
    })
    .catch((err) => {
      console.error('[State] WebSocket 连接失败:', err);
    });
}

/** 同步服务端数据到 state */
function syncUserData(data) {
  if (data.nickName !== undefined) {
    state.userInfo = Object.assign({}, state.userInfo, {
      nickName: data.nickName,
      avatarUrl: data.avatarUrl,
    });
  }
  if (data.rankScore !== undefined) state.rankScore = data.rankScore;
  if (data.rankName !== undefined) state.rankName = data.rankName;
  if (data.winRate !== undefined) state.winRate = data.winRate;
  if (data.energy !== undefined) state.energy.current = data.energy;
  if (data.energyMax !== undefined) state.energy.max = data.energyMax;
  if (data.nextRecoverAt !== undefined) state.energy.nextRecoverAt = data.nextRecoverAt;
}

module.exports = {
  state,
  init,
  syncUserData,
  setPieceSkin,
  saveProfile,
  AVATAR_PRESETS,
  randomNickname,
  getState: () => state,
};
