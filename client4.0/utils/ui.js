/**
 * 六儿 小游戏版 — Canvas UI 工具
 * 提供常用绘制封装与触摸命中检测，供各场景复用。
 *
 * 所有坐标均为逻辑像素（与 wx.getSystemInfoSync().windowWidth 同坐标系）。
 */

const PALETTE = {
  bg: '#1b1530',
  bgGradientTop: '#2a2150',
  bgGradientBottom: '#15102a',
  panel: 'rgba(255,255,255,0.08)',
  panelSolid: '#2c2452',
  gold: '#ffcf5c',
  goldDark: '#e0a93a',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.6)',
  blackPiece: '#2b2b3a',
  whitePiece: '#f4f4f8',
  accent: '#7c5cff',
  green: '#3ddc97',
  red: '#ff6b6b',
};

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 绘制一个按钮，并返回其命中区域 {x,y,w,h}
 * opts: { text, x, y, w, h, fill, textColor, fontSize, radius, border }
 */
function drawButton(ctx, opts) {
  const {
    text = '', x, y, w, h,
    fill = PALETTE.accent,
    textColor = PALETTE.text,
    fontSize = 32,
    radius = 16,
    border = null,
    bold = true,
  } = opts;

  if (border) {
    roundRect(ctx, x, y, w, h, radius);
    ctx.lineWidth = 2;
    ctx.strokeStyle = border;
    ctx.stroke();
  } else {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  if (text) {
    ctx.fillStyle = textColor;
    ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  }

  return { x, y, w, h };
}

/** 绘制居中/左对齐文本 */
function drawText(ctx, text, x, y, opts = {}) {
  const {
    color = PALETTE.text,
    fontSize = 28,
    align = 'left',
    baseline = 'alphabetic',
    bold = false,
  } = opts;
  ctx.fillStyle = color;
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
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
  roundRect,
  drawButton,
  drawText,
  hit,
};
