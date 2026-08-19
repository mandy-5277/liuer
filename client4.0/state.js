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

const state = {
  // 用户信息（由服务端同步）
  userInfo: null,
  openid: null,

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
 * 首次登录时请求微信用户信息授权。
 * 小游戏没有 WXML，使用 wx.createUserInfoButton 创建原生授权按钮浮在 Canvas 上方。
 * 授权成功后把 nickName/avatarUrl 写入 state 和本地缓存，再连接游戏服务器完成同步注册。
 * 若用户拒绝、超时或环境不支持授权按钮，则直接用空昵称连接，保证游戏可继续。
 */
function ensureUserInfoAndConnect() {
  let stored = null;
  try {
    stored = wx.getStorageSync('userInfo');
  } catch (e) { /* ignore */ }
  if (stored && (stored.nickName || stored.avatarUrl)) {
    state.userInfo = Object.assign({}, state.userInfo, stored);
    connectGameServer();
    return;
  }

  if (typeof wx.createUserInfoButton !== 'function') {
    console.log('[State] 当前环境不支持 createUserInfoButton，直接连接');
    connectGameServer();
    return;
  }

  const info = wx.getSystemInfoSync();
  const btnW = 240;
  const btnH = 52;
  const left = Math.round((info.windowWidth - btnW) / 2);
  // 按钮放在屏幕底部空白处（"游戏规则"链接上方），避免与中央的匹配/邀请按钮重叠。
  const top = Math.round(info.windowHeight - btnH - 130);

  state.authPending = true;
  console.log('[State] 请求微信用户信息授权');
  const btn = wx.createUserInfoButton({
    type: 'text',
    text: '授权微信昵称头像',
    style: {
      left,
      top,
      width: btnW,
      height: btnH,
      lineHeight: btnH,
      backgroundColor: '#8B6914',
      color: '#FFFFFF',
      textAlign: 'center',
      fontSize: 18,
      borderRadius: 8,
    },
  });

  let handled = false;
  const finish = (userInfo) => {
    if (handled) return;
    handled = true;
    state.authPending = false;
    try { btn.destroy(); } catch (e) { /* ignore */ }
    if (userInfo) {
      const { nickName, avatarUrl } = userInfo;
      state.userInfo = Object.assign({}, state.userInfo, { nickName, avatarUrl });
      try { wx.setStorageSync('userInfo', { nickName, avatarUrl }); } catch (e) { /* ignore */ }
      console.log('[State] 获取用户信息成功:', nickName);
    } else {
      console.log('[State] 用户未授权或获取失败，使用空昵称继续');
    }
    connectGameServer();
  };

  const timer = setTimeout(() => finish(null), 5000);

  btn.onTap((res) => {
    clearTimeout(timer);
    if (res.userInfo) {
      finish(res.userInfo);
    } else {
      console.log('[State] 授权结果:', res);
      finish(null);
    }
  });
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
  getState: () => state,
};
