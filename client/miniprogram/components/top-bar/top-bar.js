// components/top-bar/top-bar.js
Component({
  properties: {
    title: {
      type: String,
      value: '六儿',
    },
    energy: {
      type: Object,
      value: { current: 5, max: 30 },
    },
    coins: {
      type: Number,
      value: 0,
    },
    cdText: {
      type: String,
      value: '',
    },
  },

  data: {
    statusBarHeight: 0,
  },

  lifetimes: {
    attached() {
      const app = getApp();
      this.setData({
        statusBarHeight: app.globalData.statusBarHeight || 0,
      });
    },
  },

  methods: {},
});
