/**
 * 六儿 服务端 — 游戏常量定义
 */
const { game, piece } = require('../config');

// ========== 游戏阶段 ==========
const Stage = {
  PLACING: 1,    // 下子阶段
  CAPTURING: 2,  // 揪子阶段
  MOVING: 3,     // 走子阶段
  SETTLED: 4,    // 结算阶段
};

// ========== 房间状态 ==========
const RoomStatus = {
  WAITING: 'waiting',     // 等待中
  MATCHED: 'matched',     // 已匹配
  PLAYING: 'playing',     // 对战进行中
  ENDED: 'ended',         // 已结束
  EXPIRED: 'expired',     // 已过期
  CANCELLED: 'cancelled', // 已取消
};

// ========== 对局结果 ==========
const GameResult = {
  BLACK_WIN: 'black',
  WHITE_WIN: 'white',
  DRAW: 'draw',
};

// ========== 结束原因 ==========
const EndReason = {
  CHECKMATE: 'checkmate',       // 绝杀（无棋可走或棋子为0）
  SURRENDER: 'surrender',       // 认输
  DRAW_AGREE: 'draw_agree',     // 同意求和
  STALEMATE: 'stalemate',       // 步数上限和棋（走子阶段长期拉锯兜底，不扣分）
  TIMEOUT: 'timeout',           // 超时判负
  DISCONNECT: 'disconnect',     // 掉线判负
};

// ========== 操作类型 ==========
const Action = {
  PLACE: 'place',     // 下子
  CAPTURE: 'capture', // 揪子
  MOVE: 'move',       // 走子
};

// ========== 方向（走子四向移动） ==========
const Directions = [
  { dx: 0, dy: -1 }, // 上
  { dx: 0, dy: 1 },  // 下
  { dx: -1, dy: 0 }, // 左
  { dx: 1, dy: 0 },  // 右
];

module.exports = {
  Stage,
  RoomStatus,
  GameResult,
  EndReason,
  Action,
  Directions,
  BOARD_SIZE: game.boardSize,
  MAX_PIECES: game.maxPieces,
  BLACK: piece.BLACK,
  WHITE: piece.WHITE,
  EMPTY: piece.EMPTY,
};
