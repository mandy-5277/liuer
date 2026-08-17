/**
 * 六儿 小游戏版 — 对局核心算法
 * （由小程序版 client/miniprogram/pages/match/match.js 中的纯函数平移而来）
 *
 * 只保留与棋盘/阶段/落子计算相关的纯逻辑，不涉及任何 UI。
 * 对局场景（scene.match）会调用这里的函数计算坐标与合法走子点。
 */

// 棋盘布局参数（小游戏用 px 绘制，此处只提供比例换算 helper）
const BOARD_SIZE = 680;
const BOARD_GRID_RATIO = 0.86;

/** 网格坐标 (r,c) -> 像素坐标 {x,y}（相对于 board-grid 左上角） */
function coordToXY(r, c) {
  const gridSize = BOARD_SIZE * BOARD_GRID_RATIO;
  const spacing = gridSize / 5;
  return { x: c * spacing, y: r * spacing };
}

// 服务端 Stage 常量 → 字符串映射
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

/** 统计棋盘上黑白双方剩余棋子数 */
function countPieces(board) {
  let black = 0;
  let white = 0;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const v = board[r] ? board[r][c] : 0;
      if (v === 1) black++;
      else if (v === 2) white++;
    }
  }
  return { black, white };
}

module.exports = {
  STAGE_MAP,
  STAGE_MAP_ALIAS: STAGE_MAP,
  STAGE_LABELS,
  BOARD_SIZE,
  BOARD_GRID_RATIO,
  coordToXY,
  resolveStage,
  formatTime,
  computeLegalMoves,
  countPieces,
};
