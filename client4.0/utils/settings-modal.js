/**
 * 下六儿 小游戏版 — 通用「设置」弹窗（Canvas 绘制）
 *
 * 在首页/我的等场景中复用，让用户在开始游戏前即可调整：
 *  - 背景音乐开关
 *  - 音效开关
 *  - 震动反馈开关
 *  - 棋子皮肤
 *
 * 用法：
 *   1. drawSettingsModal(ctx, { w, h })  绘制并返回状态（写入 rects）
 *   2. onSettingsTouch(x, y) 处理点击；返回 'changed'（值有变）/ 'close'（点完成）
 *
 * 命中区域写入传入的 rects 对象：settingsToggleMusic / settingsToggleSound
 *  / settingsToggleVibrate / settingsSkinBtns / settingsClose
 */
const { state, setPieceSkin, setSetting } = require('../state');
const { PALETTE, drawText, drawCard, drawButton, hit, roundRect } = require('../utils/ui');
const ui = require('../utils/ui');
const audio = require('../utils/audio');

let W = 375, H = 667;

/** 绘制开关（圆角背景 + 圆钮），返回命中区 */
function drawToggle(ctx, x, y, w, h, on) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = on ? PALETTE.green : '#D8D2C6';
  ctx.fill();
  const knubR = h / 2 - 3;
  const kx = on ? x + w - knubR - 3 : x + knubR + 3;
  const ky = y + h / 2;
  ctx.beginPath();
  ctx.arc(kx, ky, knubR, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  return { x, y, w, h };
}

/**
 * 绘制设置弹窗。
 * opts: { w, h, px, py } 弹窗尺寸与位置（不传则自动居中）
 * 返回当前弹窗的几何信息供点击判定。
 */
function drawSettingsModal(ctx, rects, opts) {
  W = rects.W || ctx.canvas.width;
  H = rects.H || ctx.canvas.height;

  // 遮罩
  ctx.fillStyle = 'rgba(60,47,40,0.5)';
  ctx.fillRect(0, 0, W, H);

  const pw = opts && opts.w ? opts.w : W * 0.86;
  const ph = opts && opts.h ? opts.h : Math.max(420, Math.round(H * 0.62));
  const px = opts && opts.px !== undefined ? opts.px : (W - pw) / 2;
  const py = opts && opts.py !== undefined ? opts.py : (H - ph) / 2;
  drawCard(ctx, { x: px, y: py, w: pw, h: ph, radius: 18 });

  drawText(ctx, opts && opts.title ? opts.title : '设置', W / 2, py + 38, { fontSize: 28, color: PALETTE.text, align: 'center', bold: true });

  // === 音效/音乐/震动 开关 ===
  const swRowH = 52;
  const labelX = px + 24;
  const swX = px + pw - 78, swW = 54, swH = 28;

  // 背景音乐
  const musicTop = py + 76;
  drawText(ctx, '背景音乐', labelX, musicTop + swRowH / 2 + 2, { fontSize: 18, color: PALETTE.text, baseline: 'middle' });
  rects.settingsToggleMusic = drawToggle(ctx, swX, musicTop + swRowH / 2 - swH / 2, swW, swH, state.settings.music);

  // 音效
  const soundTop = musicTop + swRowH;
  drawText(ctx, '音效', labelX, soundTop + swRowH / 2 + 2, { fontSize: 18, color: PALETTE.text, baseline: 'middle' });
  rects.settingsToggleSound = drawToggle(ctx, swX, soundTop + swRowH / 2 - swH / 2, swW, swH, state.settings.sound);

  // 震动反馈
  const vibrateTop = soundTop + swRowH;
  drawText(ctx, '震动反馈', labelX, vibrateTop + swRowH / 2 + 2, { fontSize: 18, color: PALETTE.text, baseline: 'middle' });
  rects.settingsToggleVibrate = drawToggle(ctx, swX, vibrateTop + swRowH / 2 - swH / 2, swW, swH, state.settings.vibrate);

  // === 棋子皮肤 ===
  const skinTop = vibrateTop + swRowH + 6;
  drawText(ctx, '棋子皮肤', px + 24, skinTop, { fontSize: 14, color: PALETTE.textDim });
  const skins = ['classic', 'warm', 'nature', 'twig'];
  const cols = 2;
  const gap = 16;
  const swSkinW = (pw - 48 - gap) / cols;
  const swSkinH = 84;
  rects.settingsSkinBtns = [];
  skins.forEach((key, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const bx = px + 24 + c * (swSkinW + gap);
    const by = skinTop + 18 + r * (swSkinH + gap);
    const selected = state.pieceSkin === key;
    drawCard(ctx, { x: bx, y: by, w: swSkinW, h: swSkinH, radius: 12,
      border: selected ? PALETTE.green : PALETTE.panelBorder, borderWidth: selected ? 3 : 1.5 });
    ui.drawPiece(ctx, { x: bx + swSkinW / 2 - 16, y: by + 32, r: 14, color: 'black', skinKey: key });
    ui.drawPiece(ctx, { x: bx + swSkinW / 2 + 16, y: by + 32, r: 14, color: 'white', skinKey: key });
    drawText(ctx, ui.PIECE_SKINS[key].label, bx + swSkinW / 2, by + 68, { fontSize: 16, color: PALETTE.text, align: 'center' });
    rects.settingsSkinBtns.push({ x: bx, y: by, w: swSkinW, h: swSkinH, key });
  });

  // === 完成按钮 ===
  rects.settingsClose = drawButton(ctx, { text: '完成', x: px + 24, y: py + ph - 60, w: pw - 48, h: 46, fill: PALETTE.gold, textColor: PALETTE.textOnGold, fontSize: 22 });

  return { px, py, pw, ph };
}

/**
 * 处理设置弹窗点击。
 * 返回：'changed'（某个开关/皮肤被改动） | 'close'（点了完成） | null（未命中）
 */
function onSettingsTouch(x, y, rects) {
  if (rects.settingsClose && hit(rects.settingsClose, x, y)) {
    audio.playClick();
    return 'close';
  }
  if (rects.settingsToggleMusic && hit(rects.settingsToggleMusic, x, y)) {
    setSetting('music', !state.settings.music);
    audio.playClick();
    return 'changed';
  }
  if (rects.settingsToggleSound && hit(rects.settingsToggleSound, x, y)) {
    setSetting('sound', !state.settings.sound);
    audio.playClick();
    return 'changed';
  }
  if (rects.settingsToggleVibrate && hit(rects.settingsToggleVibrate, x, y)) {
    setSetting('vibrate', !state.settings.vibrate);
    audio.playClick();
    return 'changed';
  }
  if (rects.settingsSkinBtns) {
    for (const b of rects.settingsSkinBtns) {
      if (hit(b, x, y)) {
        if (b.key !== state.pieceSkin) {
          setPieceSkin(b.key);
          audio.playClick();
          return 'changed';
        }
        return 'changed';
      }
    }
  }
  return null;
}

module.exports = { drawSettingsModal, onSettingsTouch };
