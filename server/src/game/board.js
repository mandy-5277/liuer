/**
 * 六儿 服务端 — 棋盘算法
 *
 * 棋盘为 6×6 交叉点（36个下子位），坐标范围 (0,0) 到 (5,5)
 * board[r][c]: 0=空, 1=黑棋, 2=白棋
 *
 * 五大核心算法：
 * 1. calcCatchNum      — 全局扫描方块/六连，计算揪子数
 * 2. getAllFormed      — 返回所有成型棋子坐标集合
 * 3. checkNewForm      — 对比移动前后，计算新增构型揪子数
 * 4. hasAvailableMove  — 判断某色是否存在可移动棋子
 * 5. getStoneCount     — 统计指定颜色棋子数
 */

const {
  BOARD_SIZE, EMPTY, BLACK, WHITE, Directions,
} = require('./constants');

// ========== 工具函数 ==========

/** 深拷贝棋盘 */
function cloneBoard(board) {
  return board.map(row => [...row]);
}

/** 创建空棋盘 */
function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

/** 判断坐标是否在棋盘范围内 */
function isValidPos(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/** 获取相邻格子的目标坐标（用于方块检测） */
function getAdjacentCells(r, c) {
  const cells = [];
  const offsets = [
    { dr: 0, dc: 1 },  // 右
    { dr: 1, dc: 0 },  // 下
    { dr: 1, dc: 1 },  // 右下
    { dr: 1, dc: -1 }, // 左下
  ];
  for (const { dr, dc } of offsets) {
    const nr = r + dr, nc = c + dc;
    if (isValidPos(nr, nc)) {
      cells.push({ r, c, nr, nc });
    }
  }
  return cells;
}

// ========== 核心算法 1: calcCatchNum ==========

/**
 * 扫描棋盘中的所有成型形状（方块/六连）
 * @param {number[][]} board - 当前棋盘
 * @returns {Array<{ type: string, color: number, value: number, cells: Set<string>, key: string }>}
 */
function findShapes(board) {
  const shapes = [];

  // ---- 方块（2×2 四颗同色棋子） ----
  for (let r = 0; r < BOARD_SIZE - 1; r++) {
    for (let c = 0; c < BOARD_SIZE - 1; c++) {
      const a = board[r][c];
      if (a === EMPTY) continue;
      const b = board[r][c + 1];
      const d = board[r + 1][c];
      const e = board[r + 1][c + 1];

      if (a === b && b === d && d === e) {
        const cells = new Set([
          `${r},${c}`,
          `${r},${c + 1}`,
          `${r + 1},${c}`,
          `${r + 1},${c + 1}`,
        ]);
        shapes.push({
          type: 'square',
          color: a,
          value: 1,
          cells,
          key: [...cells].sort().join('|'),
        });
      }
    }
  }

  // ---- 横向六连 ----
  for (let r = 0; r < BOARD_SIZE; r++) {
    let count = 1;
    let startC = 0;
    for (let c = 1; c <= BOARD_SIZE; c++) {
      if (c < BOARD_SIZE && board[r][c] !== EMPTY && board[r][c] === board[r][c - 1]) {
        count++;
      } else {
        if (count >= 6) {
          const cells = new Set();
          for (let k = startC; k < startC + count; k++) {
            cells.add(`${r},${k}`);
          }
          const color = board[r][startC];
          shapes.push({
            type: 'h-six',
            color,
            value: 2,
            cells,
            key: [...cells].sort().join('|'),
          });
        }
        if (c < BOARD_SIZE) {
          count = 1;
          startC = c;
        }
      }
    }
  }

  // ---- 纵向六连 ----
  for (let c = 0; c < BOARD_SIZE; c++) {
    let count = 1;
    let startR = 0;
    for (let r = 1; r <= BOARD_SIZE; r++) {
      if (r < BOARD_SIZE && board[r][c] !== EMPTY && board[r][c] === board[r - 1][c]) {
        count++;
      } else {
        if (count >= 6) {
          const cells = new Set();
          for (let k = startR; k < startR + count; k++) {
            cells.add(`${k},${c}`);
          }
          const color = board[startR][c];
          shapes.push({
            type: 'v-six',
            color,
            value: 2,
            cells,
            key: [...cells].sort().join('|'),
          });
        }
        if (r < BOARD_SIZE) {
          count = 1;
          startR = r;
        }
      }
    }
  }

  return shapes;
}

/**
 * 全局扫描方块（2×2）和六连（同行/同列6颗同色），计算双方揪子次数
 * @param {number[][]} board - 当前棋盘
 * @returns {{ black: number, white: number, formedCells: Set<string> }}
 *   black/white: 揪子次数
 *   formedCells: 所有成型棋子的坐标集合（"r,c"格式），这些棋子不可被揪
 */
function calcCatchNum(board) {
  const shapes = findShapes(board);
  let blackCount = 0;
  let whiteCount = 0;
  const formedCells = new Set();

  for (const shape of shapes) {
    if (shape.color === BLACK) blackCount += shape.value;
    else whiteCount += shape.value;
    for (const cell of shape.cells) {
      formedCells.add(cell);
    }
  }

  return { black: blackCount, white: whiteCount, formedCells };
}

// ========== 核心算法 2: getAllFormed ==========

/**
 * 返回所有成型棋子的坐标集合（不可被揪的棋子）
 * @param {number[][]} board - 当前棋盘
 * @returns {Set<string>} 成型棋子坐标集（"r,c"格式）
 */
function getAllFormed(board) {
  const { formedCells } = calcCatchNum(board);
  return formedCells;
}

// ========== 核心算法 3: checkNewForm ==========

/**
 * 对比移动前后棋盘，计算某颜色新增的构型揪子次数
 * @param {number[][]} oldBoard - 移动前棋盘
 * @param {number[][]} newBoard - 移动后棋盘
 * @param {number} color - 要检测的颜色 (BLACK/WHITE)
 * @returns {{ count: number, formedCells: Set<string> }} 新增揪子次数和成型棋子
 */
function checkNewForm(oldBoard, newBoard, color) {
  const oldShapes = findShapes(oldBoard);
  const newShapes = findShapes(newBoard);

  // 用形状 key 集合判断哪些是新形成的
  const oldKeys = new Set(oldShapes.map(s => s.key));
  const addedShapes = newShapes.filter(s => s.color === color && !oldKeys.has(s.key));

  const count = addedShapes.reduce((sum, s) => sum + s.value, 0);
  const addedCells = new Set();
  for (const s of addedShapes) {
    for (const cell of s.cells) {
      addedCells.add(cell);
    }
  }

  return { count: Math.max(0, count), formedCells: addedCells };
}

// ========== 核心算法 4: hasAvailableMove ==========

/**
 * 判断某颜色是否存在任一棋子有可移动空位
 * @param {number} color - 要检测的颜色
 * @param {number[][]} board - 当前棋盘
 * @returns {boolean} 是否存在合法移动
 */
function hasAvailableMove(color, board) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === color) {
        for (const { dx, dy } of Directions) {
          const nr = r + dy;
          const nc = c + dx;
          if (isValidPos(nr, nc) && board[nr][nc] === EMPTY) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// ========== 核心算法 5: getStoneCount ==========

/**
 * 统计指定颜色棋子数
 * @param {number[][]} board - 当前棋盘
 * @param {number} color - 要统计的颜色
 * @returns {number} 棋子数量
 */
function getStoneCount(board, color) {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === color) count++;
    }
  }
  return count;
}

// ========== 辅助函数 ==========

/**
 * 获取某颜色的所有空相邻位置（用于下子阶段的合法位置提示）
 */
function getEmptyAdjacent(board, r, c) {
  const result = [];
  for (const { dx, dy } of Directions) {
    const nr = r + dy;
    const nc = c + dx;
    if (isValidPos(nr, nc) && board[nr][nc] === EMPTY) {
      result.push({ r: nr, c: nc });
    }
  }
  return result;
}

/**
 * 获取所有可下子的空位（下子阶段）
 */
function getAllEmptyCells(board) {
  const cells = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === EMPTY) cells.push({ r, c });
    }
  }
  return cells;
}

/**
 * 获取某颜色所有可揪的非成型棋子坐标
 */
function getCapturableCells(board, color, formedCells) {
  const cells = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === color && !formedCells.has(`${r},${c}`)) {
        cells.push({ r, c });
      }
    }
  }
  return cells;
}

/**
 * 获取某颜色的所有合法移动
 * @returns {Array<{fromR, fromC, toR, toC}>}
 */
function getLegalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === color) {
        for (const { dx, dy } of Directions) {
          const nr = r + dy;
          const nc = c + dx;
          if (isValidPos(nr, nc) && board[nr][nc] === EMPTY) {
            moves.push({ fromR: r, fromC: c, toR: nr, toC: nc });
          }
        }
      }
    }
  }
  return moves;
}

/**
 * 判断棋盘是否已填满
 */
function isBoardFull(board) {
  return getAllEmptyCells(board).length === 0;
}

/**
 * 根据积分计算段位名称
 */
function getRankName(score) {
  const { ranks } = require('../config').game;
  for (const rank of ranks) {
    if (score >= rank.min && score <= rank.max) {
      return rank.name;
    }
  }
  return '初级小六';
}

module.exports = {
  // 五大核心算法
  calcCatchNum,
  getAllFormed,
  checkNewForm,
  hasAvailableMove,
  getStoneCount,

  // 辅助函数
  cloneBoard,
  createEmptyBoard,
  isValidPos,
  getEmptyAdjacent,
  getAllEmptyCells,
  getCapturableCells,
  getLegalMoves,
  isBoardFull,
  getRankName,
};
