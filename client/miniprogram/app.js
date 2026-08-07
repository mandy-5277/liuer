// app.js
const { wsManager, wsConfig } = require('./utils/websocket');
const { SERVER_BASE } = require('./config');

// 自建服务器 HTTP 地址（统一见 config.js）
const SERVER_URL = SERVER_BASE;

App({
  onLaunch: function () {
    this.getSystemInfo();
    this.loginAndConnect();
  },

  globalData: {
    // 用户信息（由服务端同步）
    userInfo: null,
    openid: null,
    // 游戏数据（由服务端 resource_update 事件同步更新）
    energy: { current: 5, max: 30 },
    coins: 280,
    copper: 100,
    rankName: '初级小六',
    rankScore: 0,
    winRate: 0,
    // 系统信息
    systemInfo: null,
    statusBarHeight: 0,
    navBarHeight: 44,
    // WebSocket 管理器
    wsManager,
    // 服务器地址
    serverUrl: SERVER_URL,
  },

  /**
   * 登录流程：
   * 1. wx.login() 获取临时 code
   * 2. POST /api/auth/wx-login 发送 code 换取 openid
   * 3. 用 openid 连接 WebSocket 游戏服务器
   */
  loginAndConnect() {
    // 第一步：wx.login 获取 code
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          console.error('[App] wx.login 未返回 code');
          this.fallbackInit();
          return;
        }

        console.log('[App] wx.login 成功, code:', loginRes.code.slice(0, 10) + '...');

        // 第二步：用 code 换取 openid
        this.exchangeCodeForOpenid(loginRes.code);
      },
      fail: (err) => {
        console.error('[App] wx.login 失败:', err);
        this.fallbackInit();
      },
    });
  },

  /** 用 code 向服务端换取 openid */
  exchangeCodeForOpenid(code) {
    wx.request({
      url: SERVER_URL + '/api/auth/wx-login',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { code },
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.ok) {
          const { openid, unionid } = res.data;
          this.globalData.openid = openid;
          if (res.data.isMock) {
            console.warn('[App] 使用模拟登录（服务端未配置 WX_APPSECRET）');
          }
          console.log('[App] 获取 openid 成功:', openid);

          // 初始化用户信息
          this.globalData.userInfo = {
            openid,
            unionid: unionid || '',
          };

          // 第三步：连接游戏 WebSocket 服务器
          this.connectGameServer();
        } else {
          console.error('[App] 换取 openid 失败:', res.data);
          this.fallbackInit();
        }
      },
      fail: (err) => {
        console.error('[App] HTTP 请求失败:', err);
        this.fallbackInit();
      },
    });
  },

  /** 降级初始化（当服务不可用时，用本地标识保证小程序不崩溃） */
  fallbackInit() {
    console.warn('[App] 使用降级模式初始化');
    if (!this.globalData.openid) {
      this.globalData.openid = 'local_' + Date.now();
    }
    this.globalData.userInfo = { nickName: '离线模式', openid: this.globalData.openid };
  },

  /** 连接到 WebSocket 游戏服务器 */
  connectGameServer() {
    const { openid, userInfo } = this.globalData;

    // 监听登录成功
    wsManager.on('login_success', (data) => {
      console.log('[App] 游戏服务器登录成功:', data);
      this.syncUserData(data);
    });

    // 监听数据同步
    wsManager.on('resource_update', (data) => {
      this.syncUserData(data);
    });

    // 监听服务器关闭
    wsManager.on('server_shutdown', () => {
      console.log('[App] 服务器维护中');
    });

    // 监听连接失败（含重连耗尽）
    wsManager.on('connection_failed', (err) => {
      console.error('[App] WebSocket 连接失败:', err);
      if (err.errCode === -601027) {
        wx.showModal({
          title: '服务器连接失败',
          content: '无法连接到游戏服务器，请检查 config.js 中的服务器地址是否正确，或稍后再试。',
          showCancel: false,
          confirmText: '我知道了',
        });
      } else if (err.reason === 'max_retries') {
        wx.showToast({
          title: '服务器连接失败，请稍后再试',
          icon: 'none',
          duration: 3000,
        });
      }
    });

    wsManager.connect(openid, userInfo?.nickName || '', userInfo?.avatarUrl || '')
      .then(() => {
        console.log('[App] WebSocket 游戏服务器已连接');
      })
      .catch((err) => {
        console.error('[App] WebSocket 连接失败:', err);
      });
  },

  /** 同步服务端数据到 globalData */
  syncUserData(data) {
    if (data.nickName !== undefined) {
      this.globalData.userInfo = {
        ...this.globalData.userInfo,
        nickName: data.nickName,
        avatarUrl: data.avatarUrl,
      };
    }
    if (data.rankScore !== undefined) this.globalData.rankScore = data.rankScore;
    if (data.rankName !== undefined) this.globalData.rankName = data.rankName;
    if (data.winRate !== undefined) this.globalData.winRate = data.winRate;
    if (data.copper !== undefined) this.globalData.coins = data.copper;
    if (data.energy !== undefined) {
      this.globalData.energy.current = data.energy;
    }
    if (data.energyMax !== undefined) {
      this.globalData.energy.max = data.energyMax;
    }
  },

  getSystemInfo() {
    const info = wx.getSystemInfoSync();
    this.globalData.systemInfo = info;
    this.globalData.statusBarHeight = info.statusBarHeight;
  },

  consumeEnergy(amount) {
    const e = this.globalData.energy;
    if (e.current >= amount) {
      e.current -= amount;
      return true;
    }
    return false;
  },

  addEnergy(amount) {
    const e = this.globalData.energy;
    e.current = Math.min(e.current + amount, e.max);
  },

  getEnergy() {
    return this.globalData.energy;
  },

  getCoins() {
    return this.globalData.coins;
  },
});
