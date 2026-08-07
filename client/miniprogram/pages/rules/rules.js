// pages/rules/rules.js - 规则说明
Page({
  data: {
    tabIndex: 0,
    gridDots: [],
  },

  onLoad() {
    this.initGridDots();
  },

  // 生成6×6共36个交叉点
  initGridDots() {
    const size = 240; // rpx
    const spacing = size / 5;
    const dots = [];
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        dots.push({
          x: col * spacing,
          y: row * spacing,
        });
      }
    }
    this.setData({ gridDots: dots });
  },

  switchTab(e) {
    const tabIndex = parseInt(e.currentTarget.dataset.index);
    this.setData({ tabIndex });
  },
});
