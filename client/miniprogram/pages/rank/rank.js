// pages/rank/rank.js - 排行榜
const app = getApp();

Page({
  data: {
    energy: { current: 5, max: 30 },
    coins: 280,
    cdText: '00:45',
    tabIndex: 0,
    userInfo: {},
    rankList: [],
    displayList: [],
    myRank: 42,
    myRankName: '初级小六',
    myRankScore: 68,
    navTopOffset: 88,
  },

  onLoad() {
    const appData = app.globalData;
    this.setData({
      energy: appData.energy,
      coins: appData.coins,
      userInfo: appData.userInfo || {},
    });

    const statusBarH = app.globalData.statusBarHeight || 20;
    this.setData({ navTopOffset: statusBarH + 44 });

    this.loadRankData();
  },

  // 加载排行榜数据
  loadRankData() {
    // 模拟排行榜数据
    const rankList = [
      { id: 1, rankNo: 1, name: '围棋大师', avatar: '', rankName: '资深老六', score: 1250, winRate: 85 },
      { id: 2, rankNo: 2, name: '落子如风', avatar: '', rankName: '高级老六', score: 1120, winRate: 78 },
      { id: 3, rankNo: 3, name: '棋魂再现', avatar: '', rankName: '高级老六', score: 1080, winRate: 76 },
      { id: 4, rankNo: 4, name: '步步为赢', avatar: '', rankName: '中级老六', score: 960, winRate: 72 },
      { id: 5, rankNo: 5, name: '六六大顺', avatar: '', rankName: '中级老六', score: 920, winRate: 70 },
      { id: 6, rankNo: 6, name: '棋胜一筹', avatar: '', rankName: '初级老六', score: 860, winRate: 68 },
      { id: 7, rankNo: 7, name: '妙手连连', avatar: '', rankName: '初级老六', score: 820, winRate: 65 },
      { id: 8, rankNo: 8, name: '棋开得胜', avatar: '', rankName: '高级小六', score: 760, winRate: 62 },
      { id: 9, rankNo: 9, name: '老六来了', avatar: '', rankName: '高级小六', score: 720, winRate: 60 },
      { id: 10, rankNo: 10, name: '棋逢对手', avatar: '', rankName: '中级小六', score: 680, winRate: 58 },
    ];

    this.setData({ rankList, displayList: rankList });
  },

  switchTab(e) {
    const tabIndex = parseInt(e.currentTarget.dataset.index);
    const { rankList } = this.data;

    let displayList = [...rankList];

    if (tabIndex === 1) {
      // 积分榜 - 按分数排序
      displayList.sort((a, b) => b.score - a.score);
      displayList = displayList.map((item, i) => ({ ...item, rankNo: i + 1 }));
    } else if (tabIndex === 2) {
      // 胜率榜 - 按胜率排序
      displayList.sort((a, b) => b.winRate - a.winRate);
      displayList = displayList.map((item, i) => ({ ...item, rankNo: i + 1 }));
    }
    // tabIndex === 0 是段位榜，保持原有排名

    this.setData({ tabIndex, displayList });
  },
});
