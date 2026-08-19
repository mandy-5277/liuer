/**
 * 下六儿 小游戏版 — Canvas UI 工具
 * 设计风格：暖金棕国风（依据 figma 设计稿）
 *   底色  #F5F0E8 / #EAE2D5
 *   主色  #8B6914（金棕）  点缀  #D4A843（亮金）
 *   文字  #3C2F28（深棕）  次要  #9B8B7A
 *   卡片  白底 #FFFFFF + 描边 #E8E3DA，圆角 12~20
 *   阶段色：蓝 #4A90D9 / 红 #D94A4A / 绿 #4AB86A
 *
 * 所有坐标均为逻辑像素（与 wx.getSystemInfoSync().windowWidth 同坐标系）。
 */

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";

const PALETTE = {
  bg: '#F5F0E8',
  bgGradientTop: '#F5F0E8',
  bgGradientBottom: '#EAE2D5',

  panel: '#FFFFFF',
  panelSolid: '#FFFFFF',
  panelBorder: '#E8E3DA',

  gold: '#8B6914',        // 主色金棕
  goldBright: '#D4A843',  // 点缀亮金
  text: '#3C2F28',        // 主文字深棕
  textDim: '#9B8B7A',     // 次要文字
  textOnGold: '#FFF8E8',  // 金底上的文字

  // 阶段 / 状态色
  blue: '#4A90D9',
  red: '#D94A4A',
  green: '#4AB86A',

  // 装饰棋盘点
  boardDot: '#C9BBA4',
};

/**
 * 棋子皮肤（用户可自定义，设置页选择，本地持久化）。
 * 每套皮肤提供 black / white 两色，及各自描边色。
 * 默认 classic 对应设计稿近黑/近白。
 */
const PIECE_SKINS = {
  classic: {
    label: '经典',
    black: { fill: '#1A1A1A', stroke: '#000000' },
    white: { fill: '#FEFEFE', stroke: '#D0D0D0' },
  },
  warm: {
    label: '暖棕',
    black: { fill: '#3C2F28', stroke: '#2A2018' },
    white: { fill: '#FBF7EF', stroke: '#E0D6C4' },
  },
  nature: {
    label: '自然',
    black: { fill: '#6B6B6B', stroke: '#4A4A4A' },   // 石子灰
    white: { fill: '#E8D8B0', stroke: '#C9B58A' },   // 树枝米
  },
  twig: {
    label: '树枝·石子',
    black: { fill: '#7A5A3A', stroke: '#4E3621' },   // 树枝棕（黑子）
    white: { fill: '#9A9A9A', stroke: '#6E6E6E' },   // 石子灰（白子）
  },
};

const DEFAULT_PIECE_SKIN = 'classic';

/** 读取当前棋子颜色对（供棋盘绘制使用） */
function getPieceColors(skinKey) {
  const skin = PIECE_SKINS[skinKey] || PIECE_SKINS[DEFAULT_PIECE_SKIN];
  return {
    black: skin.black,
    white: skin.white,
    label: skin.label,
  };
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 绘制白底描边卡片，返回命中区域（等同传入的 rect）。
 * opts: { x, y, w, h, radius=16, border=PALETTE.panelBorder, fill=PALETTE.panel }
 */
function drawCard(ctx, opts) {
  const {
    x, y, w, h,
    radius = 16,
    fill = PALETTE.panel,
    border = PALETTE.panelBorder,
    borderWidth = 1.5,
  } = opts;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (border) {
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
  return { x, y, w, h };
}

/**
 * 绘制圆形头像占位（金棕渐变 + 首字母）。
 * opts: { x, y, r, label, ring }
 */
function drawAvatar(ctx, opts) {
  const { x, y, r, label = '', ring = false } = opts;
  ctx.save();
  if (ring) {
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.goldBright;
    ctx.fill();
  }
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, PALETTE.goldBright);
  g.addColorStop(1, PALETTE.gold);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  if (label) {
    ctx.fillStyle = PALETTE.textOnGold;
    ctx.font = `bold ${Math.round(r * 0.9)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 1), x, y + 1);
  }
  ctx.restore();
}

/**
 * 绘制一个按钮，返回命中区域 {x,y,w,h}
 * opts: { text, x, y, w, h, fill, textColor, fontSize, radius, border, bold }
 */
function drawButton(ctx, opts) {
  const {
    text = '', x, y, w, h,
    fill = PALETTE.gold,
    textColor = PALETTE.textOnGold,
    fontSize = 30,
    radius = 12,
    border = null,
    bold = true,
  } = opts;
  let tc = textColor;

  if (border) {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = PALETTE.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = border;
    ctx.stroke();
    tc = tc === PALETTE.textOnGold ? PALETTE.gold : tc;
  } else {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  if (text) {
    ctx.fillStyle = tc;
    ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  }

  return { x, y, w, h };
}

/**
 * 绘制居中/左对齐文本。默认使用设计稿字体。
 * opts: { color, fontSize, align, baseline, bold }
 */
function drawText(ctx, text, x, y, opts = {}) {
  const {
    color = PALETTE.text,
    fontSize = 26,
    align = 'left',
    baseline = 'alphabetic',
    bold = false,
  } = opts;
  ctx.fillStyle = color;
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
}

/** 判断点 (px,py) 是否落在区域 rect 内 */
function hit(rect, px, py) {
  if (!rect) return false;
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/**
 * 统一的底部导航栏（带图标 + 文字双行）。
 * 用法：const tabs = drawBottomNav(ctx, activeKey, rects);
 *       rects.bottomTabs 会被写入命中区域，供 onTouch 使用。
 * 样式与首页保持一致：icon fontSize20 在 y+26，文字 fontSize12 在 y+48，
 * active 高亮用 rgba(139,105,20,0.10) 背景 + 金色文字。
 * 注意：当前页自身项会被跳过（不响应点击），调用方自行处理。
 */
function drawBottomNav(ctx, activeKey, rects) {
  const tabH = 64;
  const y = (rects.H || ctx.canvas.height) - tabH;
  drawCard(ctx, { x: 0, y, w: rects.W || ctx.canvas.width, h: tabH, radius: 0, border: PALETTE.panelBorder });
  const items = [
    { key: 'home', label: '大厅', icon: '🏠' },
    { key: 'rank', label: '排行榜', icon: '🏆' },
    { key: 'profile', label: '我的', icon: '👤' },
  ];
  const itemW = (rects.W || ctx.canvas.width) / items.length;
  rects.bottomTabs = [];
  items.forEach((it, i) => {
    const ix = i * itemW;
    const active = it.key === activeKey;
    if (active) {
      ctx.fillStyle = 'rgba(139,105,20,0.10)';
      ctx.fillRect(ix, y, itemW, tabH);
    }
    drawText(ctx, it.icon, ix + itemW / 2, y + 26, { color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 20, align: 'center' });
    drawText(ctx, it.label, ix + itemW / 2, y + 48, { color: active ? PALETTE.gold : PALETTE.textDim, fontSize: 12, align: 'center', bold: active });
    rects.bottomTabs.push({ key: it.key, x: ix, y, w: itemW, h: tabH });
  });
  return rects.bottomTabs;
}

/**
 * 绘制一枚棋子（统一入口，棋盘与预览共用）。
 * opts:
 *   x, y, r       中心与半径（逻辑像素）
 *   color         'black' | 'white'
 *   skinKey       皮肤 key（默认 classic）
 *   selected      走子阶段选中 → 绿色外圈 2px
 *   capturable    揪子阶段可揪 → 红色脉冲光晕（pulse 0~1 控制扩缩）
 *   formed        成型棋子 → 加锁小角标
 *   pulse         脉冲动画相位 0~1（用于 capturable 光晕）
 */
function drawPiece(ctx, opts) {
  const {
    x, y, r,
    color = 'black',
    skinKey = DEFAULT_PIECE_SKIN,
    selected = false,
    capturable = false,
    formed = false,
    pulse = 0,
  } = opts;

  const colors = getPieceColors(skinKey)[color] || PIECE_SKINS[DEFAULT_PIECE_SKIN][color];

  // 可揪红色脉冲光晕
  if (capturable) {
    const t = (pulse % 1 + 1) % 1;
    const haloR = r + 4 + t * 8;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(217,74,74,${0.35 * (1 - t)})`;
    ctx.fill();
  }

  // 阴影
  ctx.beginPath();
  ctx.arc(x, y + 2, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,47,40,0.18)';
  ctx.fill();

  // 棋子本体
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.stroke;
  ctx.stroke();

  // 走子选中：绿色外圈
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = PALETTE.green;
    ctx.stroke();
  }

  // 成型锁角标
  if (formed) {
    ctx.fillStyle = 'rgba(60,47,40,0.55)';
    ctx.font = `${Math.round(r * 0.7)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒', x, y);
  }
}

module.exports = {
  PALETTE,
  FONT_FAMILY,
  PIECE_SKINS,
  DEFAULT_PIECE_SKIN,
  getPieceColors,
  roundRect,
  drawCard,
  drawAvatar,
  drawButton,
  drawText,
  drawPiece,
  hit,
  drawBottomNav,
};
