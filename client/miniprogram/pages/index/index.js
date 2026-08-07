// pages/index/index.js - 首页大厅
const app = getApp();
const { wsManager } = require('../../utils/websocket');

Page({
  data: {
    energy: { current: 5, max: 30 },
    coins: 280,
    cdText: '00:45',
    rankName: '初级小六',
    rankScore: 68,
    winRate: 58,
    userInfo: {},
    showEnergyModal: false,
    energyPercent: 16.7,
    navTopOffset: 88,
    boardDots: [],

    // 匹配状态
    showMatching: false,
    matchingCanceled: false,

    // 房间状态
    showRoomModal: false,
    roomCode: '',
    roomCreated: false,
  },

  onLoad() {
    const boardDots = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        boardDots.push({ x: 12.5 + c * 18.75, y: 12.5 + r * 18.75 });
      }
    }
    const appData = app.globalData;
    this.setData({
      energy: appData.energy,
      coins: appData.coins,
      userInfo: appData.userInfo || {},
      boardDots,
    });
    this.updateEnergyPercent();
    this.startCDTimer();

    const statusBarH = app.globalData.statusBarHeight || 20;
    this.setData({ navTopOffset: statusBarH + 44 });

    // 注册 WebSocket 事件监听
    this._setupWsListeners();
  },

  onShow() {
    this.updateEnergyPercent();
    // 刷新用户数据
    const appData = app.globalData;
    if (appData.coins !== undefined) {
      this.setData({ coins: appData.coins });
    }
  },

  // ========== WebSocket 事件 ==========

  _setupWsListeners() {
    // 匹配状态更新
    wsManager.on('match_status', (data) => {
      if (data.status === 'matching') {
        this.setData({ showMatching: true, matchingCanceled: false });
      } else if (data.status === 'cancelled') {
        this.setData({ showMatching: false });
      }
    });

    // 游戏开始（匹配成功或房间满）
    wsManager.on('game_start', (data) => {
      this.setData({ showMatching: false, showRoomModal: false });
      app.globalData.currentGame = data;
      wx.navigateTo({
        url: '/pages/match/match?gameId=' + data.gameId,
      });
    });

    // 房间创建成功
    wsManager.on('room_created', (data) => {
      this.setData({
        showRoomModal: true,
        roomCode: data.roomId,
        roomCreated: true,
      });
    });

    // 对手加入房间
    wsManager.on('opponent_joined', (data) => {
      this.setData({ roomCode: data.roomId });
      wx.showToast({ title: '对手已加入！', icon: 'success' });
    });

    // 房间过期
    wsManager.on('room_expired', (data) => {
      this.setData({ showRoomModal: false, roomCreated: false });
      wx.showToast({ title: '房间已过期', icon: 'none' });
    });

    // 资源更新
    wsManager.on('resource_update', (data) => {
      if (data.rankScore !== undefined) {
        this.setData({ rankScore: data.rankScore });
        app.globalData.rankScore = data.rankScore;
      }
      if (data.copper !== undefined) {
        this.setData({ coins: data.copper });
        app.globalData.coins = data.copper;
      }
      if (data.energy !== undefined) {
        this.setData({ energy: { ...this.data.energy, current: data.energy } });
        app.globalData.energy = { ...app.globalData.energy, current: data.energy };
        this.updateEnergyPercent();
      }
      if (data.rankName) this.setData({ rankName: data.rankName });
    });
  },

  // ========== 随机匹配 ==========

  onRandomMatch() {
    const { energy } = this.data;
    if (energy.current < 5) {
      this.setData({ showEnergyModal: true });
      return;
    }
    // 发送匹配请求给服务器
    wsManager.send('match_start');
    this.setData({ showMatching: true, matchingCanceled: false });
  },

  // 取消匹配
  onCancelMatching() {
    wsManager.send('match_cancel');
    this.setData({ showMatching: false, matchingCanceled: true });
  },

  // ========== 好友开局（创建房间） ==========

  onCreateRoom() {
    const { energy } = this.data;
    if (energy.current < 5) {
      this.setData({ showEnergyModal: true });
      return;
    }
    wsManager.send('invite_room');
    this.setData({ roomCreated: false });
  },

  // 关闭房间弹窗
  onCloseRoomModal() {
    this.setData({ showRoomModal: false, roomCreated: false });
  },

  // 分享房间给微信好友
  onShareRoom() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage'],
    });
  },

  // 复制房间号
  onCopyRoomCode() {
    wx.setClipboardData({
      data: this.data.roomCode,
      success: () => {
        wx.showToast({ title: '房间号已复制', icon: 'success' });
      },
    });
  },

  // 分享到聊天（在 onShareAppMessage 中设置）
  onShareAppMessage() {
    if (this.data.roomCode) {
      return {
        title: '来和我玩一局六儿吧！',
        path: `/pages/index/index?roomId=${this.data.roomCode}`,
        imageUrl: '',
      };
    }
    return {
      title: '六儿 - 下子布局·揪子博弈·走子决胜',
      path: '/pages/index/index',
    };
  },

  // ========== 精力管理 ==========

  onCloseEnergyModal() {
    this.setData({ showEnergyModal: false });
  },

  onWatchAd() {
    wx.showToast({ title: '广告加载中...', icon: 'loading' });
    this.setData({ showEnergyModal: false });
    const e = this.data.energy;
    e.current = Math.min(e.current + 10, e.max);
    const c = this.data.coins + 20;
    this.setData({ energy: e, coins: c });
    this.updateEnergyPercent();
  },

  onBuyEnergy() {
    const { coins } = this.data;
    if (coins < 30) {
      wx.showToast({ title: '铜板不足', icon: 'none' });
      return;
    }
    this.setData({ showEnergyModal: false, coins: coins - 30 });
    const e = this.data.energy;
    e.current = Math.min(e.current + 10, e.max);
    this.setData({ energy: e });
    this.updateEnergyPercent();
  },

  // ========== 辅助方法 ==========

  updateEnergyPercent() {
    const { current, max } = this.data.energy;
    this.setData({ energyPercent: (current / max * 100).toFixed(1) });
  },

  startCDTimer() {
    let remainSec = 45;
    this.cdTimer = setInterval(() => {
      if (remainSec <= 0) {
        remainSec = 90;
        const e = this.data.energy;
        if (e.current < e.max) {
          e.current += 1;
          this.setData({ energy: e });
          this.updateEnergyPercent();
        }
      }
      const m = Math.floor(remainSec / 60);
      const s = remainSec % 60;
      this.setData({ cdText: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` });
      remainSec -= 1;
    }, 1000);
  },

  onUnload() {
    if (this.cdTimer) clearInterval(this.cdTimer);
  },
});
