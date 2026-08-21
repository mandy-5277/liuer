/**
 * 下六儿 小游戏版 — 音频 / 震动 管理器
 *
 * 统一管理：
 *  - 背景音乐：用 InnerAudioContext 播放 assets/bgm.wav（欢快国风），循环
 *  - 音效：用 InnerAudioContext 播放 assets/sfx_*.wav（真实音频素材）
 *    - 下子/揪子/走子（围棋风格）
 *    - 成方/成六 奖励
 *    - 被揪子（配合震动）
 *    - 其他轻提示音仍用 WebAudio 合成
 *  - 震动反馈（wx.vibrateShort）
 *
 * 所有开关统一存到 state.settings（music / sound / vibrate），
 * 并在「设置」面板中提供开关控制。
 */

// 音频素材缓存（InnerAudioContext 实例池，避免重复创建）
const sfxPool = {};      // key = 文件名, value = InnerAudioContext
let bgmAudio = null;   // BGM 播放器
let settingsRef = null; // 指向 state.settings 的引用
let bgmPlaying = false; // BGM 是否在播

/** 绑定设置对象引用（由 state.js 调用） */
function bindSettings(settings) {
  settingsRef = settings;
}

/**
 * 播放一个 sfx 文件。每次播放用新实例（避免 onLoad 竞态），
 * 播放完自动销毁。settings.sound 为 false 时直接返回。
 */
function playSfx(name, opts) {
  if (!settingsRef || !settingsRef.sound) return;
  if (typeof wx.createInnerAudioContext !== 'function') return;
  try {
    const audio = wx.createInnerAudioContext();
    audio.src = 'assets/' + name;
    audio.volume = (opts && opts.volume) || 1;
    audio.onError((err) => { /* 加载失败静默 */ try { audio.destroy(); } catch (e) {} });
    audio.onEnded(() => { try { audio.destroy(); } catch (e) {} });
    audio.play();
  } catch (e) { /* ignore */ }
}

// ========== 背景音乐 ==========

/** 启动背景音乐（若开启） */
function startBgm() {
  if (!settingsRef || !settingsRef.music) { bgmPlaying = false; return; }
  if (bgmPlaying && bgmAudio) return;
  try {
    if (!bgmAudio && typeof wx.createInnerAudioContext === 'function') {
      bgmAudio = wx.createInnerAudioContext();
      bgmAudio.src = 'assets/bgm.wav';
      bgmAudio.loop = true;
      bgmAudio.volume = 0.45;
      bgmAudio.onError((err) => {
        console.warn('[Audio] BGM 加载失败:', err);
        bgmAudio = null;
      });
    }
    if (bgmAudio) {
      bgmAudio.play();
      bgmPlaying = true;
    }
  } catch (e) { /* ignore */ }
}

/** 停止背景音乐 */
function stopBgm() {
  bgmPlaying = false;
  if (bgmAudio) {
    try { bgmAudio.pause(); } catch (e) { /* ignore */ }
  }
}

/** 根据设置同步背景音乐播放/停止（设置变化时调用） */
function syncBgm() {
  if (settingsRef && settingsRef.music) {
    if (!bgmPlaying) startBgm();
  } else {
    stopBgm();
  }
}

// ========== 音效接口 ==========

/** 按钮点击/轻操作：轻快提示 */
function playClick() {
  playSfx('sfx_place.wav', { volume: 0.4 });  // 复用轻量点击音（更小巧）
}

/** 落子 */
function playPlace() {
  playSfx('sfx_place.wav');
}

/** 揪子 */
function playCapture() {
  playSfx('sfx_capture.wav');
}

/** 走子 */
function playMove() {
  playSfx('sfx_move.wav');
}

/** 胜利（上扬音 + 奖励叮咚） */
function playWin() {
  playSfx('sfx_reward.wav');
}

/** 失败（短促下行音，用被揪子的咚咚声表示挫败感） */
function playLose() {
  playSfx('sfx_captured.wav', { volume: 0.8 });
}

/** 和棋 */
function playDraw() {
  playSfx('sfx_reward.wav', { volume: 0.6 });
}

/** 倒计时警告（复用轻音） */
function playTick() {
  playSfx('sfx_move.wav', { volume: 0.35 });
}

/** 接收邀请/通知 */
function playNotify() {
  playSfx('sfx_reward.wav', { volume: 0.7 });
}

/** 被揪子（专门给对手揪掉我方棋子时使用） */
function playCaptured() {
  playSfx('sfx_captured.wav');
}

// ========== 震动反馈 ==========

/** 短震动 */
function vibrate(ms) {
  if (!settingsRef || !settingsRef.vibrate) return;
  try {
    wx.vibrateShort({ type: (ms && ms >= 30) ? 'heavy' : 'light', fail: () => {} });
  } catch (e) { /* ignore */ }
}

// ========== 对外统一 ==========

module.exports = {
  bindSettings,
  playClick,
  playPlace,
  playCapture,
  playMove,
  playWin,
  playLose,
  playDraw,
  playTick,
  playNotify,
  playCaptured,
  startBgm,
  stopBgm,
  syncBgm,
  vibrate,
};