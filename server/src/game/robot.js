/**
 * 六儿 服务端 — 机器人 AI 决策模块
 *
 * 机器人具备"初级智能"：基于当前局面做出相对合理的下子 / 揪子 / 走子决策，
 * 但在多个可行选项中引入随机性，避免套路单一（区别于 15s 超时代管的粗暴托管）。
 *
 * 核心策略：
 * 1. 下子阶段：优先堵住对方即将成方（方块）/ 成六（同行同列六连）的威胁点；
 *            否则在对手棋子周围下子以制造压力；最后在随机空位下子。
 * 2. 揪子阶段：优先揪掉对方"成型威胁最大"的棋子（非成型且靠近成方/成六的棋子）。
 * 3. 走子阶段：优先走子形成自己的方块/六连；其次随机走一步合法移动。
 *
 * 该模块不修改引擎状态，只负责"计算下一步该怎么做"，
 * 真正的执行由 robot 服务层通过 handleGameAction 完成。
 */

const {
  BOARD_SIZE, EMPTY, BLACK, WHITE, Stage,
} = require('./constants');
const {
  findShapes, calcCatchNum, getAllFormed, getLegalMoves,
  getCapturableCells, getAllEmptyCells, getStoneCount, cloneBoard,
} = require('./board');

const ENEMY = (color) => (color === BLACK ? WHITE : BLACK);

/** 随机取数组中的一个元素 */
function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 带权重的随机选择：items=[{v, w}] */
function pickWeighted(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  if (total <= 0) return pickRandom(items.map(i => i.v));
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.v;
  }
  return items[items.length - 1].v;
}

/** 四方向偏移（与上/下/左/右一致，供威胁检测使用） */
const DIRS = [
  { dr: 0, dc: 1 },   // 右
  { dr: 1, dc: 0 },   // 下
  { dr: 1, dc: 1 },   // 右下
  { dr: 1, dc: -1 },  // 左下
];

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/**
 * 检查某点是否为空
 */
function isEmpty(board, r, c) {
  return inBounds(r, c) && board[r][c] === EMPTY;
}

/**
 * 评估"在某个空位下子"的威胁缓解价值：
 * 1) 对方下在该点后立即形成方块/六连 → 最高优先级（100）
 * 2) 下在该点后形成"三角形三子"（差1子成方）或"五连"（差1子成六）
 *    即对方下一步再补一颗即成型的关键位置 → 次级优先级（30/50）
 * 用于找出"对方即将成方/成六"的危险点 —— 机器人应优先堵在这里。
 * @returns {number} 威胁值（越高越该堵）
 */
function threatValueIfEnemyAt(board, r, c, enemyColor) {
  const test = cloneBoard(board);
  test[r][c] = enemyColor;
  const { formedCells } = calcCatchNum(test);
  // 1) 直接成型
  if (formedCells.has(`${r},${c}`)) return 100;

  // 2) 是否形成"差1子成方"的三角形：该空位落子后，己方出现3子构成的L型/三角
  const squareThreat = countAlmostSquares(test, enemyColor, r, c);
  if (squareThreat > 0) return 30 + Math.min(20, squareThreat * 5);

  // 3) 是否形成"差1子成六"的五连：该空位落子后，己方出现5连
  const sixThreat = countAlmostSix(test, enemyColor, r, c);
  if (sixThreat > 0) return 50 + Math.min(20, sixThreat * 5);

  return 0;
}

/**
 * 统计以 (anchorR, anchorC) 为中心/顶点的、己方"差1子成2x2方块"的三子结构数量。
 * 下子后该点本身已经是己方颜色，若其周围存在另外2颗同色子且第4角为空，即形成"三角"。
 */
function countAlmostSquares(board, color, anchorR, anchorC) {
  let count = 0;
  // 枚举该点作为 2x2 方块的四个可能角色（左上角/右上角/左下角/右下角）
  const roles = [
    { r0: anchorR, c0: anchorC },       // 左上角
    { r0: anchorR, c0: anchorC - 1 },   // 右上角
    { r0: anchorR - 1, c0: anchorC },   // 左下角
    { r0: anchorR - 1, c0: anchorC - 1 }, // 右下角
  ];
  for (const { r0, c0 } of roles) {
    if (!inBounds(r0, c0)) continue;
    if (!inBounds(r0 + 1, c0 + 1)) continue;
    const cells = [
      { r: r0, c: c0 },
      { r: r0, c: c0 + 1 },
      { r: r0 + 1, c: c0 },
      { r: r0 + 1, c: c0 + 1 },
    ];
    const mine = cells.filter(p => board[p.r][p.c] === color).length;
    const empty = cells.filter(p => board[p.r][p.c] === EMPTY).length;
    // 必须包含刚落的子，且另外2子同色、第4角为空
    if (board[anchorR][anchorC] === color && mine === 3 && empty === 1) {
      count++;
    }
  }
  return count;
}

/**
 * 统计以 (anchorR, anchorC) 为中心/端点的、己方"差1子成六连"的五连结构数量。
 * 由于棋盘仅6格，横向/纵向六连必须占满整行/整列；因此五连即"5颗同色+1颗空位"。
 */
function countAlmostSix(board, color, anchorR, anchorC) {
  let count = 0;
  // 横向：检查 anchorR 这一行
  let hMine = 0, hEmpty = 0;
  for (let c = 0; c < BOARD_SIZE; c++) {
    if (board[anchorR][c] === color) hMine++;
    else if (board[anchorR][c] === EMPTY) hEmpty++;
  }
  if (hMine === 5 && hEmpty === 1) count++;
  // 纵向：检查 anchorC 这一列
  let vMine = 0, vEmpty = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (board[r][anchorC] === color) vMine++;
    else if (board[r][anchorC] === EMPTY) vEmpty++;
  }
  if (vMine === 5 && vEmpty === 1) count++;
  return count;
}



/**
 * 阶段1：下子决策
 * @param {number[][]} board 当前棋盘
 * @param {number} myColor 机器人颜色
 * @returns {{r:number, c:number}}
 */
function decidePlace(board, myColor) {
  const enemyColor = ENEMY(myColor);
  const empties = getAllEmptyCells(board);
  if (empties.length === 0) return null;

  // 1) 找出对方"成方/成六"的威胁点，优先堵；同时按威胁值分级
  const threatGroups = { 100: [], 50: [], 30: [] };
  for (const cell of empties) {
    const tv = threatValueIfEnemyAt(board, cell.r, cell.c, enemyColor);
    if (tv >= 100) threatGroups[100].push(cell);
    else if (tv >= 50) threatGroups[50].push(cell);
    else if (tv >= 30) threatGroups[30].push(cell);
  }
  if (threatGroups[100].length > 0) return pickRandom(threatGroups[100]);
  if (threatGroups[50].length > 0) return pickRandom(threatGroups[50]);
  if (threatGroups[30].length > 0) return pickRandom(threatGroups[30]);

  // 2) 主动制造己方"差1子成方/成六"的威胁点（进攻）
  const myThreats = [];
  for (const cell of empties) {
    const tv = threatValueIfEnemyAt(board, cell.r, cell.c, myColor);
    if (tv >= 50) myThreats.push(cell);
  }
  if (myThreats.length > 0 && Math.random() < 0.7) {
    return pickRandom(myThreats);
  }

  // 3) 在对手棋子相邻空位下子（制造己方压力 / 干扰对方）
  const adjacentToEnemy = [];
  for (const cell of empties) {
    let near = false;
    for (const { dr, dc } of DIRS) {
      const nr = cell.r + dr, nc = cell.c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === enemyColor) { near = true; break; }
    }
    if (near) adjacentToEnemy.push(cell);
  }
  if (adjacentToEnemy.length > 0 && Math.random() < 0.6) {
    return pickRandom(adjacentToEnemy);
  }

  // 4) 随机空位下子（保留随机性，避免套路单一）
  return pickRandom(empties);
}

/**
 * 阶段2：揪子决策
 * @param {number[][]} board 当前棋盘
 * @param {number} myColor 机器人颜色
 * @returns {{r:number, c:number} | null} 返回 null 表示无合法目标（应跳过）
 */
function decideCapture(board, myColor) {
  const enemyColor = ENEMY(myColor);
  const formed = getAllFormed(board);
  const capturable = getCapturableCells(board, enemyColor, formed);
  if (capturable.length === 0) return null;

  // 优先揪掉"靠近成方/成六"的对方棋子（削弱对方成型潜力）
  const scored = capturable.map(cell => {
    let threat = 1;
    // 统计该棋子四向相邻同色棋子数（越多越可能成方/六）
    for (const { dr, dc } of DIRS) {
      const nr = cell.r + dr, nc = cell.c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === enemyColor) threat += 1;
    }
    return { v: cell, w: threat };
  });

  return pickWeighted(scored);
}

/**
 * 阶段3：走子决策（含联动揪子后的走子）
 * @param {number[][]} board 当前棋盘
 * @param {number} myColor 机器人颜色
 * @returns {{fromR:number, fromC:number, toR:number, toC:number} | null}
 */
function decideMove(board, myColor) {
  const legal = getLegalMoves(board, myColor);
  if (legal.length === 0) return null;

  // 1) 优先走子能"立即形成方块/六连"的移动
  for (const m of legal) {
    const test = cloneBoard(board);
    test[m.fromR][m.fromC] = EMPTY;
    test[m.toR][m.toC] = myColor;
    const before = getAllFormed(board);
    const after = getAllFormed(test);
    // 新形成的成型棋子中是否包含落点
    if (after.has(`${m.toR},${m.toC}`) && !before.has(`${m.toR},${m.toC}`)) {
      return m;
    }
  }

  // 2) 优先走子能"堵住对方下一步成方/成六"的移动（含三角形/五连缺一）
  const enemyColor = ENEMY(myColor);
  for (const m of legal) {
    const test = cloneBoard(board);
    test[m.fromR][m.fromC] = EMPTY;
    test[m.toR][m.toC] = myColor;
    // 移动后，对手在哪些空位下子会形成威胁
    let blocksThreat = false;
    const empties = getAllEmptyCells(test);
    for (const e of empties) {
      const tv = threatValueIfEnemyAt(test, e.r, e.c, enemyColor);
      if (tv >= 30) {
        blocksThreat = true;
        break;
      }
    }
    if (blocksThreat) return m;
  }

  // 3) 主动走子制造己方"差1子成方/成六"威胁
  const offensive = [];
  for (const m of legal) {
    const test = cloneBoard(board);
    test[m.fromR][m.fromC] = EMPTY;
    test[m.toR][m.toC] = myColor;
    const empties = getAllEmptyCells(test);
    for (const e of empties) {
      const tv = threatValueIfEnemyAt(test, e.r, e.c, myColor);
      if (tv >= 30) {
        offensive.push(m);
        break;
      }
    }
  }
  if (offensive.length > 0 && Math.random() < 0.6) {
    return pickRandom(offensive);
  }

  // 4) 随机走一步（保留随机性）
  return pickRandom(legal);
}

/**
 * 统一入口：根据引擎当前阶段返回机器人要执行的动作描述。
 * @param {object} engine GameEngine 实例
 * @param {number} myColor 机器人颜色
 * @returns {{ type: string, action: object } | null}
 *   type: 'place' | 'capture' | 'move' | 'skip_capture' | 'none'
 */
function decideAction(engine, myColor) {
  switch (engine.stage) {
    case Stage.PLACING: {
      const pos = decidePlace(engine.board, myColor);
      if (!pos) return { type: 'none' };
      return { type: 'place', action: pos };
    }
    case Stage.CAPTURING: {
      const target = decideCapture(engine.board, myColor);
      if (!target) return { type: 'skip_capture' };
      return { type: 'capture', action: target };
    }
    case Stage.MOVING: {
      // 关键：走子阶段可能存在"联动揪子"待执行（本方 catchNum>0）。
      // 此时必须先完成揪子（指令 capture_piece 会被引擎路由到 linkedCapturePiece），
      // 不能直接走子，否则引擎会因回合仍属于本方 catchNum>0 而逻辑错乱。
      const myCatchKey = myColor === BLACK ? 'blackCatchNum' : 'whiteCatchNum';
      if (engine[myCatchKey] > 0) {
        const target = decideCapture(engine.board, myColor);
        if (!target) return { type: 'skip_capture' };
        return { type: 'capture', action: target };
      }
      const move = decideMove(engine.board, myColor);
      if (!move) return { type: 'none' };
      return { type: 'move', action: move };
    }
    default:
      return { type: 'none' };
  }
}

module.exports = {
  decideAction,
  decidePlace,
  decideCapture,
  decideMove,
};
