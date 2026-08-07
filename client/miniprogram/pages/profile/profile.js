// pages/profile/profile.js - 个人主页
const app = getApp();

Page({
  data: {
    energy: { current: 5, max: 30 },
    coins: 280,
    cdText: '00:45',
    userInfo: {},
    rankName: '初级小六',
    rankScore: 68,
    winRate: 58,
    stats: {
      totalGames: 42,
      wins: 25,
      losses: 17,
    },
    navTopOffset: 88,
  },

  onLoad() {
    const appData = app.globalData;
    this.setData({
      energy: appData.energy,
      coins: appData.coins,
      userInfo: appData.userInfo || {},
      rankName: appData.rankName || '初级小六',
      rankScore: appData.rankScore || 0,
      winRate: appData.winRate || 0,
    });

    const statusBarH = app.globalData.statusBarHeight || 20;
    this.setData({ navTopOffset: statusBarH + 44 });
  },

  onShow() {
    // 每次显示页面时刷新数据
    const appData = app.globalData;
    this.setData({
      energy: appData.energy,
      coins: appData.coins,
    });
  },

  onSettings() {
    wx.showToast({ title: '设置页面开发中', icon: 'none' });
  },

  onRules() {
    wx.navigateTo({ url: '/pages/rules/rules' });
  },

  onFeedback() {
    wx.showToast({ title: '反馈页面开发中', icon: 'none' });
  },
});
