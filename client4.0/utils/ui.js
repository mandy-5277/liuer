/**
 * 六儿 小游戏版 — Canvas UI 工具
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

  blackPiece: '#3C2F28',  // 黑子（深棕，比纯黑柔和）
  whitePiece: '#FBF7EF',  // 白子（米白）

  // 阶段 / 状态色
  blue: '#4A90D9',
  red: '#D94A4A',
  green: '#4AB86A',

  // 装饰棋盘点
  boardDot: '#C9BBA4',
};

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

  if (border) {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = PALETTE.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = border;
    ctx.stroke();
    textColor = textColor === PALETTE.textOnGold ? PALETTE.gold : textColor;
  } else {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  if (text) {
    ctx.fillStyle = textColor;
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

module.exports = {
  PALETTE,
  FONT_FAMILY,
  roundRect,
  drawCard,
  drawAvatar,
  drawButton,
  drawText,
  hit,
};
