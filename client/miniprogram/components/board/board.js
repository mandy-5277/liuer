// components/board/board.js - 6×6 棋盘组件
Component({
  properties: {
    // 棋盘整体大小 rpx
    size: {
      type: Number,
      value: 580,
    },
    // 棋子列表 [{x,y,color:'black'|'white',selected,locked,capturable}]
    pieces: {
      type: Array,
      value: [],
    },
    // 合法落点高亮坐标 [{x,y}]
    legalCells: {
      type: Array,
      value: [],
    },
    // 是否为我的回合
    myTurn: {
      type: Boolean,
      value: false,
    },
    // 当前阶段 'place' | 'capture' | 'move'
    phase: {
      type: String,
      value: 'place',
    },
  },

  data: {
    cells: [],
    gridRows: [1, 2, 3, 4, 5],
  },

  lifetimes: {
    attached() {
      this.initCells();
    },
  },

  observers: {
    'size'(size) {
      this.initCells();
    },
    'legalCells'(legalCells) {
      this.updateCellHints(legalCells);
    },
  },

  methods: {
    // 初始化36个交叉点坐标（坐标相对于 board-grid 左上角）
    initCells() {
      const size = this.data.size;
      const gridSize = size * 0.86;          // 网格占棋盘比例，白边更小
      const gridOffset = (size - gridSize) / 2;
      const spacing = gridSize / 5;
      const cells = [];

      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 6; col++) {
          cells.push({
            x: col * spacing,
            y: row * spacing,
            legal: false,
          });
        }
      }

      this.setData({ cells, gridSize, gridOffset, spacing });
    },

    // 更新合法落点高亮（传入 {x:col, y:row} 网格坐标）
    updateCellHints(legalCells) {
      const cells = this.data.cells.map((cell) => ({
        ...cell,
        legal: false,
      }));

      if (legalCells && legalCells.length > 0) {
        const { spacing } = this.data;

        legalCells.forEach((pos) => {
          const row = pos.y;
          const col = pos.x;
          const index = row * 6 + col;
          if (index >= 0 && index < 36) {
            cells[index] = {
              ...cells[index],
              legal: true,
              x: col * spacing,
              y: row * spacing,
            };
          }
        });
      }

      this.setData({ cells });
    },

    // 点击交叉点（下子或走子）
    onCellTap(e) {
      if (!this.data.myTurn) return;
      const index = e.currentTarget.dataset.index;
      const cell = this.data.cells[index];
      const col = Math.round(cell.x / this.data.spacing);
      const row = Math.round(cell.y / this.data.spacing);

      this.triggerEvent('celltap', { row, col, index });
    },

    // 点击棋子（选中或揪子）
    onPieceTap(e) {
      const pieceIndex = e.currentTarget.dataset.index;
      const piece = this.data.pieces[pieceIndex];

      this.triggerEvent('piecetap', {
        index: pieceIndex,
        piece,
      });
    },
  },
});
