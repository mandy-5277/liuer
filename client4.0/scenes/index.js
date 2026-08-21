/**
 * 下六儿 小游戏版 — 场景管理器
 *
 * 小游戏没有页面路由（wx.navigateTo），所有界面都在同一块 Canvas 上绘制。
 * 这里用一个简单的 "当前场景" 切换机制：
 *   - 每个场景是一个对象，提供 onEnter / onDraw(ctx) / onTouch(x,y) / onWs(cmd,data)
 *   - game.js 主循环每帧调用 当前场景.onDraw
 *   - 触摸事件转发给当前场景.onTouch
 *
 * 场景列表：
 *   home      首页大厅
 *   rank      排行榜
 *   profile   我的
 *   rules     规则说明
 *   match     对局（含 6x6 棋盘）
 *   (overlay) 匹配中弹窗等以 home 内的浮层实现
 */

const scenes = {};
let current = null;
let currentName = '';

function register(name, scene) {
  scenes[name] = scene;
}

function goto(name, payload) {
  if (!scenes[name]) {
    console.error('[Scene] 未注册场景:', name);
    return;
  }
  if (current && current.onLeave) current.onLeave();
  current = scenes[name];
  currentName = name;
  if (current.onEnter) current.onEnter(payload || {});
  console.log('[Scene] 切换到:', name);
}

function getCurrent() {
  return current;
}

function getCurrentName() {
  return currentName;
}

/** 主循环每帧调用 */
function draw(ctx) {
  if (current && current.onDraw) current.onDraw(ctx);
}

/** 触摸事件转发 */
function touch(x, y) {
  if (current && current.onTouch) current.onTouch(x, y);
}

/** 触摸移动转发（用于列表拖动等） */
function touchMove(x, y) {
  if (current && current.onTouchMove) current.onTouchMove(x, y);
}

/** 触摸结束转发 */
function touchEnd() {
  if (current && current.onTouchEnd) current.onTouchEnd();
}

/** WebSocket 消息转发 */
function dispatchWs(cmd, data) {
  if (current && current.onWs) current.onWs(cmd, data);
}

module.exports = {
  register,
  goto,
  getCurrent,
  getCurrentName,
  draw,
  touch,
  touchMove,
  touchEnd,
  dispatchWs,
};
