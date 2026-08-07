// pages/match/match.js - 对局页面
const app = getApp();
const { wsManager } = require('../../utils/websocket');

// 棋盘布局参数（必须与 components/board/board.wxml 的 size 属性保持一致，单位 rpx）
const BOARD_SIZE = 680;
const BOARD_GRID_RATIO = 0.86;

/** 网格坐标 (r,c) -> 像素坐标 {x,y}（相对于 board-grid 左上角，与 board 组件一致） */
function coordToXY(r, c) {
  const gridSize = BOARD_SIZE * BOARD_GRID_RATIO;
  const spacing = gridSize / 5;
  return { x: c * spacing, y: r * spacing };
}

// 服务端 Stage 常量 → 字符串映射（匹配 Board 组件的 phase 值）
const STAGE_MAP = { 1: 'place', 2: 'capture', 3: 'move', 4: 'settled' };
const STAGE_LABELS = {
  place: '下子阶段',
  capture: '揪子阶段',
  move: '走子阶段',
  settled: '已结束',
};

/** 将服务端数字 stage 转为字符串 */
function resolveStage(stage) {
  if (typeof stage === 'string') {
    // 已经是字符串，检查是否为合法的 stage 值
    const validStages = new Set(Object.values(STAGE_MAP));
    return validStages.has(stage) ? stage : 'place';
  }
  return STAGE_MAP[stage] || 'place';
}

/** 将剩余秒数格式化为 MM:SS */
function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 计算走子阶段某棋子的合法移动点（上下左右相邻空位） */
function computeLegalMoves(r, c, board) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const moves = [];
  dirs.forEach(([dr, dc]) => {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < 6 && nc >= 0 && nc < 6 && board[nr] && board[nr][nc] === 0) {
      moves.push({ r: nr, c: nc });
    }
  });
  return moves;
}

Page({
  data: {
    // 游戏状态
    gameId: '',
    phase: 'place',
    phaseLabel: '下子阶段',
    currentTurn: 0, // 1=BLACK, 2=WHITE
    board: [],
    remainingTime: 0,
    timeTotal: 15, // 每步总时间(s)

    // 玩家
    myColor: 0, // 1=BLACK, 2=WHITE
    myOpenid: '',
    myInfo: {},
    opponentInfo: {},
    myTurn: false,

    // 揪子计数
    myCatchNum: 0,
    opponentCatchNum: 0,
    catchNums: { black: 0, white: 0 },

    // 剩余棋子数（走子阶段在姓名卡显示"剩余 XX/18"）
    myRemainText: '18/18',
    opponentRemainText: '18/18',

    // 走子阶段联动揪子模式：己方走子成方/六后，需先揪掉对方棋子
    moveCaptureMode: false,

    // Board 组件
    boardPieces: [],
    legalCells: [],
    selectedPieceIndex: -1,
    skipAvailable: false,

    // 求和暂停
    drawPaused: false,

    // 结算
    showSettle: false,
    settleData: {},
    myResult: '',
    scoreChange: 0,

    // 求和
    drawRequestBy: '',
    drawRequestName: '',
    showDrawRequest: false,

    // 计时
    timerText: '00:00',
    timeLow: false,
    timerProgress: 100,

    // 认输确认
    showGiveUpConfirm: false,

    // 棋盘角度
    boardFlipped: false,
  },

  // 计算倒计时环进度（0-100）
  _calcTimerProgress(remainingTime) {
    const total = this.data.timeTotal || 15;
    const t = Math.max(0, Math.min(total, remainingTime || 0));
    return Math.round((t / total) * 100);
  },

  onLoad(options) {
    const gameData = app.globalData.currentGame;
    if (!gameData) {
      wx.showToast({ title: '对局数据丢失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const myOpenid = app.globalData.openid;
    const myColor = gameData.blackPlayer.openid === myOpenid ? 1 : 2;
    const opponentColor = myColor === 1 ? 2 : 1;

    const myInfo = myColor === 1 ? gameData.blackPlayer : gameData.whitePlayer;
    const oppInfo = opponentColor === 1 ? gameData.blackPlayer : gameData.whitePlayer;

    // 如果我是白棋，可以翻转棋盘视角
    const boardFlipped = myColor === 2;

    const myTurn = gameData.currentTurn === myColor;
    const remainingTime = gameData.remainingTime || gameData.timeLimit || 15;

    const phase = resolveStage(gameData.stage);
    this.setData({
      gameId: gameData.gameId,
      phase,
      phaseLabel: STAGE_LABELS[phase] || '下子阶段',
      currentTurn: gameData.currentTurn,
      myColor,
      myOpenid,
      myInfo: { nickName: myInfo.nickName || '', avatarUrl: myInfo.avatarUrl || '', rankScore: myInfo.rankScore || 0 },
      opponentInfo: { nickName: oppInfo.nickName || '', avatarUrl: oppInfo.avatarUrl || '', rankScore: oppInfo.rankScore || 0 },
      myTurn,
      boardFlipped,
      remainingTime,
      timeTotal: gameData.timeLimit || 15,
      timerText: formatTime(remainingTime),
      timeLow: remainingTime > 0 && remainingTime <= 10,
      timerProgress: this._calcTimerProgress(remainingTime),
      catchNums: { black: 0, white: 0 },
      energy: app.globalData.energy || { current: 5, max: 30 },
      coins: app.globalData.coins || 0,
    });

    // 初始化棋盘棋子
    this._updateBoardPieces(gameData.board || []);
    this._updateCatchNums(gameData.catchNums || { black: 0, white: 0 });

    // 注册 WebSocket 事件
    this._setupWsListeners();

    // 清理全局数据
    app.globalData.currentGame = null;
  },

  onUnload() {
    this._removeWsListeners();
  },

  // ========== WebSocket 事件处理 ==========

  /** 通用的下子/走子/揪子响应（更新棋盘和时间） */
  _onBoardUpdate(data) {
    const remainingTime = data.remainingTime || 0;
    this.setData({
      currentTurn: data.currentTurn,
      remainingTime,
      timerText: formatTime(remainingTime),
      timeLow: remainingTime > 0 && remainingTime <= 10,
      timerProgress: this._calcTimerProgress(remainingTime),
      myTurn: data.currentTurn === this.data.myColor,
      legalCells: [],
      selectedPieceIndex: -1,
      skipAvailable: false,
    });
    this._updateBoardPieces(data.board || []);
    this._updateCatchNums(data.catchNums || { black: 0, white: 0 });
  },

  _setupWsListeners() {
    // 阶段切换
    this._onStageChange = (data) => {
      const phase = resolveStage(data.stage);
      const remainingTime = data.remainingTime || 0;
      this.setData({
        phase,
        phaseLabel: STAGE_LABELS[phase] || this.data.phaseLabel,
        currentTurn: data.currentTurn,
        remainingTime,
        timerText: formatTime(remainingTime),
        timeLow: remainingTime > 0 && remainingTime <= 10,
        myTurn: data.currentTurn === this.data.myColor,
        legalCells: [],
        selectedPieceIndex: -1,
        skipAvailable: false,
      });
      this._updateBoardPieces(data.board || []);
      this._updateCatchNums(data.catchNums || { black: 0, white: 0 });
    };
    wsManager.on('stage_change', this._onStageChange);

    // 下子阶段放置棋子
    this._onPiecePlaced = (data) => { this._onBoardUpdate(data); };
    wsManager.on('piece_placed', this._onPiecePlaced);

    // 揪子阶段操作
    this._onCaptureMade = (data) => { this._onBoardUpdate(data); };
    wsManager.on('capture_made', this._onCaptureMade);

    // 走子阶段操作
    this._onMoveMade = (data) => { this._onBoardUpdate(data); };
    wsManager.on('move_made', this._onMoveMade);

    // 连揪
    this._onLinkedCapture = (data) => {
      const remainingTime = data.remainingTime || 0;
      this.setData({
        currentTurn: data.currentTurn,
        remainingTime,
        timerText: formatTime(remainingTime),
        timeLow: remainingTime > 0 && remainingTime <= 10,
        myTurn: data.currentTurn === this.data.myColor,
        legalCells: [],
        selectedPieceIndex: -1,
        skipAvailable: !!data.linkedCapture,
      });
      this._updateBoardPieces(data.board || []);
      this._updateCatchNums(data.catchNums || { black: 0, white: 0 });
    };
    wsManager.on('linked_capture', this._onLinkedCapture);

    // 求和被拒绝（恢复对局）
    this._onDrawRejected = (data) => {
      wx.showToast({ title: '对方拒绝了求和', icon: 'none' });
      this.setData({ drawPaused: false });
      this._onBoardUpdate(data);
    };
    wsManager.on('draw_rejected', this._onDrawRejected);

    // 求和请求
    this._onDrawRequest = (data) => {
      this.setData({
        drawRequestBy: data.by,
        drawRequestName: data.nickName || '',
        showDrawRequest: true,
        drawPaused: true,
      });
    };
    wsManager.on('draw_request', this._onDrawRequest);

    // 结算
    this._onGameSettle = (data) => {
      const myColor = this.data.myColor;
      let myResult = '';
      let scoreChange = 0;
      const endReason = data.endReason || '';

      if (data.result === 'draw') {
        myResult = 'draw';
        scoreChange = myColor === 1 ? (data.blackRatingChange || -1) : (data.whiteRatingChange || -1);
      } else if (data.result === 'black' && myColor === 1) {
        myResult = 'win';
        scoreChange = data.blackRatingChange || 10;
      } else if (data.result === 'white' && myColor === 2) {
        myResult = 'win';
        scoreChange = data.whiteRatingChange || 10;
      } else {
        myResult = 'lose';
        scoreChange = myColor === 1 ? (data.blackRatingChange || -3) : (data.whiteRatingChange || -3);
      }

      const rankKey = myColor === 1 ? 'blackNewRank' : 'whiteNewRank';
      const rankScoreKey = myColor === 1 ? 'blackAfterScore' : 'whiteAfterScore';

      this.setData({
        showSettle: true,
        settleData: {
          ...data,
          endReason,
        },
        myResult,
        scoreChange,
        myTurn: false,
        drawPaused: false,
        phase: 'settled',
        phaseLabel: '已结束',
        rankName: data[rankKey] || '',
        rankScore: data[rankScoreKey] || 0,
      });
    };
    wsManager.on('game_settle', this._onGameSettle);

    // 超时警告（服务端只会发给当前超时的一方，无需判断对方）
    this._onTimeoutWarning = (data) => {
      wx.showToast({ title: '已超时，系统将自动操作', icon: 'none' });
    };
    wsManager.on('timeout_warning', this._onTimeoutWarning);

    // 服务端操作错误提示
    this._onError = (data) => {
      const msg = data && data.errMsg ? data.errMsg : '操作失败';
      // 对局已不在服务端（如服务器重启、已被结算），提示用户并返回大厅
      if (msg.includes('不在对局') || msg.includes('未找到')) {
        wx.showModal({
          title: '对局已结束',
          content: '当前对局已不在进行中，请返回大厅重新开始。',
          showCancel: false,
          success: () => {
            wx.redirectTo({ url: '/pages/index/index' });
          },
        });
        return;
      }
      wx.showToast({ title: msg, icon: 'none' });
    };
    wsManager.on('error', this._onError);

    // 对手掉线
    this._onOpponentDisconnected = (data) => {
      wx.showToast({ title: '对手已掉线，等待重连...', icon: 'none' });
    };
    wsManager.on('opponent_disconnected', this._onOpponentDisconnected);
  },

  _removeWsListeners() {
    if (this._onStageChange) wsManager.off('stage_change', this._onStageChange);
    if (this._onPiecePlaced) wsManager.off('piece_placed', this._onPiecePlaced);
    if (this._onCaptureMade) wsManager.off('capture_made', this._onCaptureMade);
    if (this._onMoveMade) wsManager.off('move_made', this._onMoveMade);
    if (this._onLinkedCapture) wsManager.off('linked_capture', this._onLinkedCapture);
    if (this._onDrawRejected) wsManager.off('draw_rejected', this._onDrawRejected);
    if (this._onDrawRequest) wsManager.off('draw_request', this._onDrawRequest);
    if (this._onGameSettle) wsManager.off('game_settle', this._onGameSettle);
    if (this._onTimeoutWarning) wsManager.off('timeout_warning', this._onTimeoutWarning);
    if (this._onError) wsManager.off('error', this._onError);
    if (this._onOpponentDisconnected) wsManager.off('opponent_disconnected', this._onOpponentDisconnected);
  },

  // ========== 棋盘数据转换 ==========

  /** 将服务器 board[r][c] 转换为 Board 组件的 pieces 列表 */
  _updateBoardPieces(board) {
    if (!board || !board.length) return;

    const pieces = [];
    const myColor = this.data.myColor;
    const opponentColor = myColor === 1 ? 2 : 1;

    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const colorVal = board[r] ? board[r][c] : 0;
        if (colorVal === 0) continue;

        const color = colorVal === 1 ? 'black' : 'white';
        const isMine = colorVal === myColor;
        const isOpponent = colorVal === opponentColor;

        const { x, y } = coordToXY(r, c);
        pieces.push({
          r, c,
          x,
          y,
          color,
          selected: false,
          locked: false,
          capturable: false, // 由 _updateCatchNums 后续设置
        });
      }
    }

    this.setData({ boardPieces: pieces, board });
    this._updateRemainCounts();
  },

  /** 计算并更新双方剩余棋子数文本（走子阶段显示剩余 XX/18） */
  _updateRemainCounts() {
    const board = this.data.board || [];
    let blackCount = 0;
    let whiteCount = 0;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const v = board[r] ? board[r][c] : 0;
        if (v === 1) blackCount++;
        else if (v === 2) whiteCount++;
      }
    }
    const myColor = this.data.myColor;
    const myCount = myColor === 1 ? blackCount : whiteCount;
    const oppCount = myColor === 1 ? whiteCount : blackCount;
    this.setData({
      myRemainText: `${myCount}/18`,
      opponentRemainText: `${oppCount}/18`,
    });
  },

  /** 更新可揪标记（敌方棋子被高亮） */
  _updateCatchNums(catchNums) {
    const myColor = this.data.myColor;
    const myCatchNum = myColor === 1 ? catchNums.black : catchNums.white;
    const opponentCatchNum = myColor === 1 ? catchNums.white : catchNums.black;

    this.setData({
      catchNums,
      myCatchNum: myCatchNum || 0,
      opponentCatchNum: opponentCatchNum || 0,
    });

    this._updateCaptureMode();
  },

  /**
   * 计算走子阶段联动揪子模式：
   * 走子阶段 + 己方回合 + 己方仍有可揪次数 → 必须先揪掉对方棋子才能继续走子
   */
  _updateCaptureMode() {
    const { phase, myTurn, myCatchNum } = this.data;
    const moveCaptureMode = phase === 'move' && myTurn && myCatchNum > 0;
    if (moveCaptureMode !== this.data.moveCaptureMode) {
      // 进入/退出联动揪子模式时，清除走子高亮与选中，避免误移动
      this.setData({
        moveCaptureMode,
        legalCells: [],
        selectedPieceIndex: -1,
      });
    }
  },

  // ========== 棋盘操作 ==========

  /** 点击交叉点 */
  onCellTap(e) {
    const { row, col } = e.detail;
    console.log('[Match] onCellTap', { row, col }, 'drawPaused', this.data.drawPaused, 'myTurn', this.data.myTurn, 'phase', this.data.phase, 'myColor', this.data.myColor, 'currentTurn', this.data.currentTurn);
    if (this.data.drawPaused) {
      wx.showToast({ title: '等待对方响应中...', icon: 'none' });
      return;
    }
    if (!this.data.myTurn) {
      wx.showToast({ title: '不是你的回合', icon: 'none' });
      return;
    }

    const phase = this.data.phase;

    if (phase === 'place') {
      // 下子阶段
      wsManager.send('place_piece', { r: row, c: col }, (err) => {
        if (err) {
          console.error('[Match] place_piece 发送失败', err);
        } else {
          console.log('[Match] place_piece 发送成功', { r: row, c: col });
        }
      });
    } else if (phase === 'move') {
      // 走子阶段：若处于联动揪子模式，必须先揪掉对方棋子
      if (this.data.moveCaptureMode) {
        wx.showToast({ title: '请先揪掉对方棋子', icon: 'none' });
        return;
      }
      // 走子阶段：必须有选中棋子且目标为合法移动点
      if (this.data.selectedPieceIndex < 0) {
        wx.showToast({ title: '请先选择要移动的棋子', icon: 'none' });
        return;
      }
      const piece = this.data.boardPieces[this.data.selectedPieceIndex];
      if (!piece) return;

      const isLegal = this.data.legalCells.some(cell => cell.x === col && cell.y === row);
      if (!isLegal) {
        wx.showToast({ title: '只能向上下左右相邻空位移动', icon: 'none' });
        return;
      }

      wsManager.send('move_piece', {
        fromR: piece.r,
        fromC: piece.c,
        toR: row,
        toC: col,
      });
    } else if (phase === 'capture') {
      // 揪子阶段直接发送揪子操作
      wsManager.send('capture_piece', { r: row, c: col });
    }
  },

  /** 点击棋子 */
  onPieceTap(e) {
    const { index, piece } = e.detail;
    const phase = this.data.phase;
    const myTurn = this.data.myTurn;

    if (this.data.drawPaused) {
      wx.showToast({ title: '等待对方响应中...', icon: 'none' });
      return;
    }
    if (!myTurn) {
      wx.showToast({ title: '不是你的回合', icon: 'none' });
      return;
    }

    if (phase === 'capture') {
      // 揪子：只能揪对方棋子
      const myColorStr = this.data.myColor === 1 ? 'black' : 'white';
      if (piece.color === myColorStr) {
        wx.showToast({ title: '不能揪自己的棋子', icon: 'none' });
        return;
      }
      // 发送揪子指令
      wsManager.send('capture_piece', { r: piece.r, c: piece.c });
    } else if (phase === 'move') {
      const myColorStr = this.data.myColor === 1 ? 'black' : 'white';

      // 走子阶段联动揪子模式：点击敌方棋子进行揪子
      if (this.data.moveCaptureMode) {
        if (piece.color === myColorStr) {
          wx.showToast({ title: '请先揪掉对方棋子', icon: 'none' });
          return;
        }
        wsManager.send('linked_capture', { r: piece.r, c: piece.c });
        return;
      }

      // 走子：选中自己的棋子
      if (piece.color !== myColorStr) {
        wx.showToast({ title: '不能移动对方的棋子', icon: 'none' });
        return;
      }

      // 切换选中，并计算合法移动点
      const newSelected = !piece.selected;
      const pieces = this.data.boardPieces.map((p, i) => ({
        ...p,
        selected: i === index ? newSelected : false,
      }));

      let legalCells = [];
      if (newSelected) {
        legalCells = computeLegalMoves(piece.r, piece.c, this.data.board).map(m => ({ x: m.c, y: m.r }));
      }

      this.setData({
        boardPieces: pieces,
        selectedPieceIndex: newSelected ? index : -1,
        legalCells,
      });
    } else if (phase === 'place') {
      // 下子阶段点击棋子无意义
      wx.showToast({ title: '请点击空交叉点下子', icon: 'none' });
    }
  },

  /** 跳过连揪 */
  onSkipCapture() {
    if (this.data.skipAvailable || this.data.moveCaptureMode) {
      wsManager.send('skip_capture');
    }
  },

  // ========== 游戏操作 ==========

  /** 请求求和 */
  onRequestDraw() {
    if (this.data.showDrawRequest) {
      wx.showToast({ title: '已有待处理的和棋请求', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '求和',
      content: '确定向对方求和吗？',
      success: (res) => {
        if (res.confirm) {
          wsManager.send('request_draw');
          this.setData({ drawPaused: true });
        }
      },
    });
  },

  /** 响应求和 - 同意 */
  onAcceptDraw() {
    wsManager.send('respond_draw', { agree: true });
    this.setData({ showDrawRequest: false, drawPaused: false });
  },

  /** 响应求和 - 拒绝 */
  onRejectDraw() {
    wsManager.send('respond_draw', { agree: false });
    this.setData({ showDrawRequest: false, drawPaused: false });
  },

  /** 认输 */
  onGiveUp() {
    this.setData({ showGiveUpConfirm: true });
  },

  confirmGiveUp() {
    wsManager.send('give_up');
    this.setData({ showGiveUpConfirm: false });
  },

  cancelGiveUp() {
    this.setData({ showGiveUpConfirm: false });
  },

  /** 退出游戏 */
  onExitGame() {
    wx.navigateBack();
  },

  /** 再来一局 */
  onRematch() {
    wx.navigateBack();
    // 回到首页后可重新匹配
  },

  // ========== 结算事件 ==========

  onSettleClose(e) {
    this.setData({ showSettle: false });
    wx.navigateBack();
  },

  onSettleRematch(e) {
    this.setData({ showSettle: false });
    wx.navigateBack();
  },
});
