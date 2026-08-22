/**
 * 六儿 服务端 — 游戏引擎（四阶段状态机）
 *
 * 阶段流转：
 *   PLACING(1) → CAPTURING(2) → MOVING(3) → SETTLED(4)
 *
 * 负责管理单局游戏的完整生命周期：
 * - 棋盘状态维护
 * - 阶段切换逻辑
 * - 合法性校验
 * - 超时管理
 * - 胜负判定
 */

const { Stage, GameResult, EndReason, BLACK, WHITE, EMPTY } = require('./constants');
const {
  cloneBoard, createEmptyBoard, isBoardFull,
  calcCatchNum, getAllFormed, checkNewForm,
  hasAvailableMove, getStoneCount,
  getAllEmptyCells, getLegalMoves, getCapturableCells, getRankName,
} = require('./board');
const { game: gameConfig } = require('../config');

class GameEngine {
  constructor(gameId, blackPlayer, whitePlayer) {
    this.gameId = gameId;
    this.blackPlayer = blackPlayer; // { openid, nickName, avatarUrl, rankScore }
    this.whitePlayer = whitePlayer; // { openid, nickName, avatarUrl, rankScore }

    // 棋盘状态
    this.board = createEmptyBoard();
    this.stage = Stage.PLACING;

    // 回合管理
    this.currentTurn = WHITE; // 白棋先手（下子阶段）
    this.turnStartTime = 0;

    // 揪子管理
    this.blackCatchNum = 0;
    this.whiteCatchNum = 0;
    this.captureFirstPlayer = null; // 揪子阶段先手（下子阶段的相反方先揪）
    this.captureOrderInitialized = false;

    // 走子阶段管理
    this.moveFirstPlayer = null; // 走子阶段先手（继承揪阶段最后操作者）
    this.noCatchRoundCount = 0; // 连续无有效揪回合计数

    // 超时管理
    this.consecutiveTimeouts = { [BLACK]: 0, [WHITE]: 0 };
    this.timeoutTimer = null;

    // 求和冷却
    this.lastDrawRequestBy = null;
    this.drawRequestCooldownUntil = 0;

    // 棋步记录
    this.moves = [];
    this.stepNumber = 0;

    // 对局开始时间
    this.startedAt = Date.now();
    this.endedAt = 0;
  }

  // ========== 初始化 ==========

  /** 棋盘初始化（空棋盘，下子阶段开始） */
  init() {
    this.board = createEmptyBoard();
    this.stage = Stage.PLACING;
    this.currentTurn = WHITE; // 白棋先手
    this.turnStartTime = Date.now();
    this.blackCatchNum = 0;
    this.whiteCatchNum = 0;
    this.captureFirstPlayer = null;
    this.captureOrderInitialized = false;
    this.noCatchRoundCount = 0;
    this.consecutiveTimeouts = { [BLACK]: 0, [WHITE]: 0 };
    this.moves = [];
    this.stepNumber = 0;
    this.lastDrawRequestBy = null;
    this.drawRequestCooldownUntil = 0;
    this.clearTimer();
  }

  /** 获取对手颜色 */
  getOpponentColor(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  /** 获取当前回合玩家的 openid */
  getCurrentPlayerUid() {
    return this.currentTurn === BLACK ? this.blackPlayer.openid : this.whitePlayer.openid;
  }

  /** 获取指定颜色的玩家信息 */
  getPlayerByColor(color) {
    return color === BLACK ? this.blackPlayer : this.whitePlayer;
  }

  /** 根据 openid 获取颜色 */
  getColorByUid(openid) {
    if (openid === this.blackPlayer.openid) return BLACK;
    if (openid === this.whitePlayer.openid) return WHITE;
    return null;
  }

  // ========== 超时管理 ==========

  clearTimer() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** 启动回合超时计时器，cb 为超时回调（系统自动操作），duration 可选覆盖默认超时时长 */
  startTurnTimer(cb, duration) {
    this.clearTimer();
    this.turnStartTime = Date.now();
    this.timeoutTimer = setTimeout(() => {
      cb(this.currentTurn);
    }, duration || gameConfig.moveTimeout);
  }

  /** 获取剩余时间（毫秒） */
  getRemainingTime() {
    const elapsed = Date.now() - this.turnStartTime;
    return Math.max(0, gameConfig.moveTimeout - elapsed);
  }

  // ========== 阶段1：下子 ==========

  /**
   * 下子校验与执行
   * @param {string} openid - 操作者
   * @param {number} r - 行坐标
   * @param {number} c - 列坐标
   * @returns {{ success: boolean, errMsg?: string, board?: number[][], nextTurn?: number, stageChanged?: boolean, catchNums?: object }}
   */
  placePiece(openid, r, c) {
    if (this.stage !== Stage.PLACING) {
      if (this.stage === Stage.MOVING) {
        return { success: false, errMsg: '当前是走子阶段，不能落子' };
      }
      if (this.stage === Stage.CAPTURING) {
        return { success: false, errMsg: '当前是揪子阶段，不能落子' };
      }
      return { success: false, errMsg: '当前不是下子阶段' };
    }

    const color = this.getColorByUid(openid);
    if (color !== this.currentTurn) {
      return { success: false, errMsg: '现在不是你的回合' };
    }

    if (r < 0 || r >= 6 || c < 0 || c >= 6) {
      return { success: false, errMsg: '坐标超出棋盘范围' };
    }

    if (this.board[r][c] !== EMPTY) {
      return { success: false, errMsg: '该位置已有棋子' };
    }

    // 执行下子
    this.board[r][c] = color;
    this.stepNumber++;
    this.moves.push({
      step: this.stepNumber,
      stage: Stage.PLACING,
      player: color === BLACK ? 'black' : 'white',
      action: 'place',
      fromX: -1, fromY: -1,
      toX: c, toY: r,
      durationMs: Date.now() - this.turnStartTime,
    });

    this.consecutiveTimeouts[color] = 0;

    // 检查棋盘是否填满
    if (isBoardFull(this.board)) {
      return this.enterCaptureStage();
    }

    // 切换回合
    this.currentTurn = this.getOpponentColor(color);
    this.turnStartTime = Date.now();

    // 实时计算当前棋盘的揪子次数，供下子阶段预览
    const { black, white } = calcCatchNum(this.board);

    return {
      success: true,
      lastAction: 'place',
      board: cloneBoard(this.board),
      nextTurn: this.currentTurn,
      catchNums: { black, white },
    };
  }

  /** 下子阶段结束，进入揪子阶段 */
  enterCaptureStage() {
    // 全局扫描构型，计算双方揪子次数
    const { black, white, formedCells } = calcCatchNum(this.board);

    this.blackCatchNum = black;
    this.whiteCatchNum = white;

    // 兜底：双方揪数都为0各+1
    if (this.blackCatchNum === 0 && this.whiteCatchNum === 0) {
      this.blackCatchNum = 1;
      this.whiteCatchNum = 1;
    }

    // 揪子先手：与下子先手相反（白先下→黑先揪）
    this.captureFirstPlayer = BLACK; // 下子白先→揪子黑先
    this.currentTurn = this.captureFirstPlayer;

    // 自动跳过揪子次数为 0 的玩家（无需手动点一下）
    this._advanceCaptureTurn();

    this.stage = Stage.CAPTURING;
    this.turnStartTime = Date.now();

    return {
      success: true,
      stageChanged: true,
      stage: Stage.CAPTURING,
      board: cloneBoard(this.board),
      catchNums: {
        black: this.blackCatchNum,
        white: this.whiteCatchNum,
      },
      currentTurn: this.currentTurn,
      formedCells: [...formedCells], // 转为数组方便传输
    };
  }

  /**
   * 自动推进揪子回合：跳过揪子次数已耗尽的玩家。
   * 当 currentTurn 指向揪子数为 0 的玩家时，直接切换到另一方，
   * 无需该玩家手动点击。注意：不改变 captureFirstPlayer（阶段3先手基准）。
   */
  _advanceCaptureTurn() {
    const startColor = this.currentTurn;
    let guard = 0;
    while (guard < 4) {
      guard++;
      const k = this.currentTurn === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
      if (this[k] > 0) return; // 当前玩家还有次数，正常轮到他
      // 当前玩家无次数，切换到对手
      const opponent = this.getOpponentColor(this.currentTurn);
      const oppKey = opponent === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
      if (this[oppKey] <= 0) {
        // 双方都已无次数，进入走子阶段
        this.enterMoveStage(this.currentTurn);
        return;
      }
      this.currentTurn = opponent;
      if (this.currentTurn === startColor) {
        // 绕回起点，说明双方都无有效次数
        const k2 = this.currentTurn === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
        if (this[k2] <= 0) {
          this.enterMoveStage(this.currentTurn);
          return;
        }
      }
    }
  }

  // ========== 阶段2：揪子 ==========

  /**
   * 揪子校验与执行
   * @param {string} openid - 操作者
   * @param {number} r - 目标棋子行坐标
   * @param {number} c - 目标棋子列坐标
   */
  capturePiece(openid, r, c) {
    if (this.stage !== Stage.CAPTURING) {
      return { success: false, errMsg: '当前不是揪子阶段' };
    }

    const color = this.getColorByUid(openid);
    if (color !== this.currentTurn) {
      return { success: false, errMsg: '现在不是你的揪子回合' };
    }

    if (r < 0 || r >= 6 || c < 0 || c >= 6) {
      return { success: false, errMsg: '坐标超出棋盘范围' };
    }

    // 校验：必须是敌方棋子
    const targetColor = this.board[r][c];
    const enemyColor = this.getOpponentColor(color);
    if (targetColor !== enemyColor) {
      return { success: false, errMsg: '只能揪取敌方棋子' };
    }

    // 校验：不能是成型棋子
    const formedCells = getAllFormed(this.board);
    if (formedCells.has(`${r},${c}`)) {
      return { success: false, errMsg: '该棋子属于成型构型，不可揪取' };
    }

    // 当前玩家揪子次数
    const myCatchKey = color === BLACK ? 'blackCatchNum' : 'whiteCatchNum';

    // 防御：轮到当前玩家时次数已为 0（理论不会，由 _advanceCaptureTurn 保证）
    if (this[myCatchKey] <= 0) {
      this[myCatchKey] = 0;
      this._advanceCaptureTurn();
      return {
        success: true,
        lastAction: 'capture',
        board: cloneBoard(this.board),
        catchNums: { black: this.blackCatchNum, white: this.whiteCatchNum },
        currentTurn: this.currentTurn,
        stage: this.stage,
        stageChanged: this.stage === Stage.MOVING,
        skipped: true,
      };
    }

    // 执行揪子
    this.board[r][c] = EMPTY;
    this[myCatchKey]--;
    this.stepNumber++;

    this.moves.push({
      step: this.stepNumber,
      stage: Stage.CAPTURING,
      player: color === BLACK ? 'black' : 'white',
      action: 'capture',
      fromX: c, fromY: r, // 被揪位置
      toX: -1, toY: -1,
      durationMs: Date.now() - this.turnStartTime,
    });

    this.consecutiveTimeouts[color] = 0;

    // 当前玩家揪子次数耗尽，自动推进（跳过无次数方，不改变阶段3先手基准）
    if (this[myCatchKey] <= 0) {
      this[myCatchKey] = 0;
      this._advanceCaptureTurn();
    }
    // 否则继续当前玩家揪子

    return {
      success: true,
      lastAction: 'capture',
      board: cloneBoard(this.board),
      catchNums: {
        black: this.blackCatchNum,
        white: this.whiteCatchNum,
      },
      currentTurn: this.currentTurn,
      stage: this.stage,
      stageChanged: this.stage === Stage.MOVING,
    };
  }

  /** 进入走子阶段 */
  enterMoveStage(lastCapturePlayer) {
    // 走子先手：与揪子阶段先手保持一致（白先下 → 黑先揪 → 黑先走）
    this.moveFirstPlayer = this.captureFirstPlayer;
    this.currentTurn = this.moveFirstPlayer;

    this.stage = Stage.MOVING;
    this.turnStartTime = Date.now();
    this.noCatchRoundCount = 0;

    return {
      success: true,
      stageChanged: true,
      stage: Stage.MOVING,
      board: cloneBoard(this.board),
      currentTurn: this.currentTurn,
      catchNums: { black: 0, white: 0 },
    };
  }

  // ========== 阶段3：走子 ==========

  /**
   * 走子校验与执行
   * @param {string} openid - 操作者
   * @param {number} fromR - 起始行
   * @param {number} fromC - 起始列
   * @param {number} toR - 目标行
   * @param {number} toC - 目标列
   */
  movePiece(openid, fromR, fromC, toR, toC) {
    if (this.stage !== Stage.MOVING) {
      return { success: false, errMsg: '当前不是走子阶段' };
    }

    const color = this.getColorByUid(openid);
    if (color !== this.currentTurn) {
      return { success: false, errMsg: '现在不是你的回合' };
    }

    if (this.board[fromR][fromC] !== color) {
      return { success: false, errMsg: '只能移动己方棋子' };
    }

    if (this.board[toR][toC] !== EMPTY) {
      return { success: false, errMsg: '目标位置必须为空' };
    }

    // 校验：仅上下左右相邻一格
    const dr = Math.abs(toR - fromR);
    const dc = Math.abs(toC - fromC);
    if (!((dr === 1 && dc === 0) || (dr === 0 && dc === 1))) {
      return { success: false, errMsg: '只能向上下左右相邻一格移动' };
    }

    // 执行走子
    const oldBoard = cloneBoard(this.board);
    this.board[fromR][fromC] = EMPTY;
    this.board[toR][toC] = color;

    // 走子后检测新构型
    const newFormResult = checkNewForm(oldBoard, this.board, color);

    this.stepNumber++;
    this.moves.push({
      step: this.stepNumber,
      stage: Stage.MOVING,
      player: color === BLACK ? 'black' : 'white',
      action: 'move',
      fromX: fromC, fromY: fromR,
      toX: toC, toY: toR,
      durationMs: Date.now() - this.turnStartTime,
    });

    this.consecutiveTimeouts[color] = 0;

    // 胜负判定（立即）
    const enemyColor = this.getOpponentColor(color);
    // 条件1: 对方棋子数为0
    if (getStoneCount(this.board, enemyColor) === 0) {
      return this.settleGame(color === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN, EndReason.CHECKMATE);
    }
    // 条件2: 对方无任何可移动棋子
    if (!hasAvailableMove(enemyColor, this.board)) {
      return this.settleGame(color === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN, EndReason.CHECKMATE);
    }

    // 处理联动揪子
    if (newFormResult.count > 0) {
      const myCatchKey = color === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
      this[myCatchKey] += newFormResult.count;
      this.noCatchRoundCount = 0;

      // 联动揪：形成构型后先由当前操作者揪子
      // 构建揪子状态
      return {
        success: true,
        lastAction: 'move',
        board: cloneBoard(this.board),
        linkedCapture: {
          player: color,
          count: newFormResult.count,
          formedCells: [...newFormResult.formedCells],
        },
        catchNums: {
          black: this.blackCatchNum,
          white: this.whiteCatchNum,
        },
        stageChanged: false,
        currentTurn: this.currentTurn,
      };
    }

    // 无新构型 → 直接切换对手
    // 注：已取消"连续N回合无有效揪自动和棋"(draw_five)。该规则会在走子阶段
    // 正常对局中误判平局并双-1，影响玩家体验。现仅保留双方主动求和(draw_agree)。
    this.noCatchRoundCount++;

    this.currentTurn = enemyColor;

    return {
      success: true,
      lastAction: 'move',
      board: cloneBoard(this.board),
      noNewForm: true,
      currentTurn: this.currentTurn,
    };
  }

  // ========== 揪子后的处理（走子阶段联动揪） ==========

  /**
   * 走子阶段联动揪子
   */
  linkedCapturePiece(openid, r, c) {
    const color = this.getColorByUid(openid);
    if (color !== this.currentTurn) {
      return { success: false, errMsg: '现在不是你的回合' };
    }

    const targetColor = this.board[r][c];
    const enemyColor = this.getOpponentColor(color);
    if (targetColor !== enemyColor) {
      return { success: false, errMsg: '只能揪取敌方棋子' };
    }

    const formedCells = getAllFormed(this.board);
    if (formedCells.has(`${r},${c}`)) {
      return { success: false, errMsg: '该棋子属于成型构型，不可揪取' };
    }

    const myCatchKey = color === BLACK ? 'blackCatchNum' : 'whiteCatchNum';

    this.board[r][c] = EMPTY;
    this[myCatchKey]--;
    this.stepNumber++;

    this.moves.push({
      step: this.stepNumber,
      stage: Stage.MOVING,
      player: color === BLACK ? 'black' : 'white',
      action: 'capture',
      fromX: c, fromY: r,
      toX: -1, toY: -1,
      durationMs: Date.now() - this.turnStartTime,
    });

    // 每揪掉一枚敌方棋子后立即检查：对手棋子被揪光则直接绝杀结算
    // （即使本回合还有剩余揪子次数，也无需继续等待）
    if (getStoneCount(this.board, enemyColor) === 0) {
      return this.settleGame(
        color === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
        EndReason.CHECKMATE
      );
    }

    if (this[myCatchKey] <= 0) {
      this[myCatchKey] = 0;

      // 揪完后切换对手
      const opponent = this.getOpponentColor(color);

      // 检查对手是否有可行动空间
      if (!hasAvailableMove(opponent, this.board)) {
        return this.settleGame(
          color === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
          EndReason.CHECKMATE
        );
      }

      this.currentTurn = opponent;
    }

    return {
      success: true,
      lastAction: 'capture',
      board: cloneBoard(this.board),
      catchNums: {
        black: this.blackCatchNum,
        white: this.whiteCatchNum,
      },
      currentTurn: this.currentTurn,
      stageChanged: false,
    };
  }

  /** 跳过揪子（无合法揪取目标时） */
  skipLinkedCapture(openid) {
    const color = this.getColorByUid(openid);
    if (color !== this.currentTurn) {
      return { success: false, errMsg: '现在不是你的回合' };
    }

    const myCatchKey = color === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
    this[myCatchKey] = 0;

    const opponent = this.getOpponentColor(color);

    // 检查对手是否有可行动空间
    if (getStoneCount(this.board, opponent) === 0) {
      return this.settleGame(
        color === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
        EndReason.CHECKMATE
      );
    }
    if (!hasAvailableMove(opponent, this.board)) {
      return this.settleGame(
        color === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
        EndReason.CHECKMATE
      );
    }

    this.currentTurn = opponent;

    return {
      success: true,
      lastAction: 'capture',
      board: cloneBoard(this.board),
      skipped: true,
      currentTurn: this.currentTurn,
    };
  }

  // ========== 特殊操作 ==========

  /** 认输 */
  surrender(openid) {
    const color = this.getColorByUid(openid);
    if (!color) return { success: false, errMsg: '无效玩家' };

    this.clearTimer();
    const winner = color === BLACK ? WHITE : BLACK;
    return this.settleGame(
      winner === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
      EndReason.SURRENDER
    );
  }

  /** 求和请求 */
  requestDraw(openid) {
    const color = this.getColorByUid(openid);
    if (!color) return { success: false, errMsg: '无效玩家' };

    // 检查冷却
    if (this.lastDrawRequestBy === openid && Date.now() < this.drawRequestCooldownUntil) {
      const remaining = Math.ceil((this.drawRequestCooldownUntil - Date.now()) / 1000);
      return { success: false, errMsg: `求和冷却中，还需等待 ${remaining} 秒` };
    }

    this.lastDrawRequestBy = openid;
    this.drawRequestCooldownUntil = Date.now() + gameConfig.drawRequestCooldown;

    return {
      success: true,
      drawRequestBy: openid,
      drawRequestColor: color,
    };
  }

  /** 响应求和 */
  respondDraw(openid, agree) {
    if (!this.lastDrawRequestBy) {
      return { success: false, errMsg: '没有待处理的求和请求' };
    }

    const requesterColor = this.getColorByUid(this.lastDrawRequestBy);
    const responderColor = this.getColorByUid(openid);

    if (responderColor === requesterColor) {
      return { success: false, errMsg: '不能响应自己的求和请求' };
    }

    this.clearTimer();

    if (agree) {
      return this.settleGame(GameResult.DRAW, EndReason.DRAW_AGREE);
    }

    // 拒绝求和
    this.lastDrawRequestBy = null;
    return {
      success: true,
      drawRejected: true,
    };
  }

  // ========== 超时托管 ==========

  /**
   * 超时代管揪子：一次性揪完当前玩家【剩余的所有可揪敌方棋子】。
   * 修复"本来可揪多子，揪 1 个后超时就被跳过剩余揪子"的问题。
   * - 循环调用 capturePiece，直到次数耗尽或无可揪目标；
   * - capturePiece 在次数耗尽时会自动推进回合（_advanceCaptureTurn），
   *   因此循环会在回合切走后自然停止；
   * - 若仍有剩余次数但已无可揪目标，则跳过并推进回合。
   * @returns 最后一次操作结果（含最新 board / catchNums / currentTurn / stage）
   */
  autoCaptureAll(color) {
    const openid = this.getPlayerByColor(color).openid;
    const enemyColor = this.getOpponentColor(color);
    const myCatchKey = color === BLACK ? 'blackCatchNum' : 'whiteCatchNum';

    let lastResult = null;
    let guard = 0;
    while (this[myCatchKey] > 0 && guard < 40) {
      guard++;
      const formedCells = getAllFormed(this.board);
      const capturable = getCapturableCells(this.board, enemyColor, formedCells);
      if (capturable.length === 0) break; // 无可揪目标
      const cell = capturable[0];
      const res = this.capturePiece(openid, cell.r, cell.c);
      if (!res.success) break;
      lastResult = res;
      if (this.currentTurn !== color) break; // 次数耗尽已切走 / 已结算
    }

    // 仍有剩余次数但已无可揪目标：跳过并推进（兼容原逻辑）
    if (this[myCatchKey] > 0 && this.currentTurn === color) {
      this[myCatchKey] = 0;
      this._advanceCaptureTurn();
      lastResult = {
        success: true,
        lastAction: 'capture',
        board: cloneBoard(this.board),
        catchNums: { black: this.blackCatchNum, white: this.whiteCatchNum },
        currentTurn: this.currentTurn,
        stage: this.stage,
        stageChanged: this.stage === Stage.MOVING,
        skipped: true,
      };
    }

    return lastResult || {
      success: true,
      lastAction: 'capture',
      board: cloneBoard(this.board),
      catchNums: { black: this.blackCatchNum, white: this.whiteCatchNum },
      currentTurn: this.currentTurn,
      stage: this.stage,
    };
  }

  /**
   * 超时代管走子：在走子阶段完整执行"走一步 + 完成走子产生的全部联动揪子"。
   * 修复"走子阶段超时只走一步，剩余的联动揪子未完成"的问题。
   * - 若当前有待处理揪子（myCatchNum>0，含走子后产生），先循环揪完；
   * - 否则走一步；若走子后产生联动揪子，继续完成揪子；
   * - 无合法移动 → 判负。
   * @returns 最后一次操作结果
   */
  autoMoveAll(color) {
    const openid = this.getPlayerByColor(color).openid;
    const enemyColor = this.getOpponentColor(color);
    const myCatchKey = color === BLACK ? 'blackCatchNum' : 'whiteCatchNum';

    let lastResult = null;
    let guard = 0;
    while (guard < 50) {
      guard++;

      // 1) 优先完成待处理的联动揪子（走子后产生 / 上一回合遗留）
      if (this[myCatchKey] > 0) {
        const formedCells = getAllFormed(this.board);
        const capturable = getCapturableCells(this.board, enemyColor, formedCells);
        if (capturable.length === 0) break; // 无可揪目标
        const cell = capturable[0];
        const res = this.linkedCapturePiece(openid, cell.r, cell.c);
        if (!res.success) break;
        lastResult = res;
        if (this.currentTurn !== color) break; // 揪完次数已切走 / 已结算
        continue;
      }

      // 2) 无待揪子 → 走一步
      const legalMoves = getLegalMoves(this.board, color);
      if (legalMoves.length === 0) {
        // 无合法移动 → 判负
        const winner = color === BLACK ? WHITE : BLACK;
        return this.settleGame(
          winner === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
          EndReason.CHECKMATE
        );
      }
      const move = legalMoves[0];
      const res = this.movePiece(openid, move.fromR, move.fromC, move.toR, move.toC);
      lastResult = res;
      if (this.currentTurn !== color) break; // 走子后切走 / 已结算
      // 走子后若未切走且产生联动揪子（myCatchNum>0），循环继续揪子
      if (this[myCatchKey] <= 0) break; // 无联动揪子，本次走子回合结束
    }

    return lastResult || {
      success: true,
      lastAction: 'move',
      board: cloneBoard(this.board),
      catchNums: { black: this.blackCatchNum, white: this.whiteCatchNum },
      currentTurn: this.currentTurn,
      stage: this.stage,
    };
  }

  /** 超时自动操作 */
  autoTimeout(color) {
    this.consecutiveTimeouts[color]++;

    // 连续3次超时 → 判负
    if (this.consecutiveTimeouts[color] >= gameConfig.timeoutForfeit) {
      this.clearTimer();
      const winner = color === BLACK ? WHITE : BLACK;
      return this.settleGame(
        winner === BLACK ? GameResult.BLACK_WIN : GameResult.WHITE_WIN,
        EndReason.TIMEOUT
      );
    }

    let autoResult;
    const openid = color === BLACK ? this.blackPlayer.openid : this.whitePlayer.openid;

    switch (this.stage) {
      case Stage.PLACING: {
        // 随机选一个空位下子
        const emptyCells = getAllEmptyCells(this.board);
        if (emptyCells.length > 0) {
          const cell = emptyCells[0]; // 取第一个可用空位
          autoResult = this.placePiece(openid, cell.r, cell.c);
        }
        break;
      }

      case Stage.CAPTURING: {
        // 一次性揪完当前玩家剩余的所有可揪敌方棋子（而非每次只揪 1 个）
        autoResult = this.autoCaptureAll(color);
        break;
      }

      case Stage.MOVING: {
        // 完整走子托管：走一步 + 完成走子产生的全部联动揪子
        autoResult = this.autoMoveAll(color);
        break;
      }

      default:
        autoResult = { success: false, errMsg: '无效阶段' };
    }

    return {
      auto: true,
      consecutiveTimeouts: this.consecutiveTimeouts[color],
      ...autoResult,
    };
  }

  // ========== 阶段4：结算 ==========

  /**
   * 结算对局
   */
  settleGame(result, endReason) {
    this.clearTimer();
    this.endedAt = Date.now();
    this.stage = Stage.SETTLED;

    const duration = Math.floor((this.endedAt - this.startedAt) / 1000);
    const blackCount = getStoneCount(this.board, BLACK);
    const whiteCount = getStoneCount(this.board, WHITE);
    const totalRounds = this.moves.length;

    // 计算积分变动
    let blackRatingChange = 0;
    let whiteRatingChange = 0;

    const { scoreChange } = gameConfig;

    if (result === GameResult.BLACK_WIN) {
      blackRatingChange = scoreChange.win;
      whiteRatingChange = scoreChange.lose;
    } else if (result === GameResult.WHITE_WIN) {
      whiteRatingChange = scoreChange.win;
      blackRatingChange = scoreChange.lose;
    } else {
      // 和棋
      if (endReason === EndReason.DRAW_AGREE) {
        // 同意求和：发起方 -1，同意方 +1
        if (this.lastDrawRequestBy === this.blackPlayer.openid) {
          blackRatingChange = scoreChange.drawRequest;
          whiteRatingChange = scoreChange.drawAgree;
        } else {
          whiteRatingChange = scoreChange.drawRequest;
          blackRatingChange = scoreChange.drawAgree;
        }
      } else {
        blackRatingChange = scoreChange.naturalDraw;
        whiteRatingChange = scoreChange.naturalDraw;
      }
    }

    // 允许积分为负（设计如此：连败可扣到 0 以下），不再钳制下限
    const blackNewScore = this.blackPlayer.rankScore + blackRatingChange;
    const whiteNewScore = this.whitePlayer.rankScore + whiteRatingChange;

    const settleData = {
      gameId: this.gameId,
      result,
      endReason,
      endStage: this.stage,
      totalRounds,
      duration,
      board: cloneBoard(this.board),
      blackPieceCount: blackCount,
      whitePieceCount: whiteCount,

      // 积分变动
      blackRatingChange,
      whiteRatingChange,
      blackBeforeScore: this.blackPlayer.rankScore,
      whiteBeforeScore: this.whitePlayer.rankScore,
      blackAfterScore: blackNewScore,
      whiteAfterScore: whiteNewScore,
      blackNewRank: getRankName(blackNewScore),
      whiteNewRank: getRankName(whiteNewScore),

      // 棋步记录
      moves: this.moves,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };

    return {
      success: true,
      settled: true,
      ...settleData,
    };
  }

  // ========== 状态快照（用于断线重连） ==========

  getSnapshot() {
    return {
      gameId: this.gameId,
      stage: this.stage,
      board: cloneBoard(this.board),
      currentTurn: this.currentTurn,
      blackCatchNum: this.blackCatchNum,
      whiteCatchNum: this.whiteCatchNum,
      blackPlayer: this.blackPlayer,
      whitePlayer: this.whitePlayer,
      remainingTime: Math.ceil(this.getRemainingTime() / 1000),
      noCatchRoundCount: this.noCatchRoundCount,
      moves: this.moves,
      startedAt: this.startedAt,
    };
  }
}

module.exports = GameEngine;
