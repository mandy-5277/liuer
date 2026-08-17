/**
 * 六儿 小游戏版 — 入口 (game.js)
 *
 * 对应小程序版 app.js 的启动逻辑，但小游戏没有 App() 入口，
 * 而是直接在 game.js 中执行：
 *   1. 初始化全局状态 + 登录 + 连接 WS
 *   2. 创建 Canvas 2D 上下文
 *   3. 注册所有场景并进入首页
 *   4. 启动 requestAnimationFrame 主循环，每帧绘制当前场景
 *   5. 监听触摸事件，转发给当前场景
 *
 * 【架构说明】
 * 小游戏没有 WXML/页面路由，所有界面（首页/排行榜/我的/规则/对局）
 * 都在同一块 Canvas 上用代码绘制；场景切换只是换一个绘制对象。
 */

const { state, init } = require('./state');
const { wsManager } = require('./utils/websocket');
const sceneMgr = require('./scenes/index');

// 注册场景
sceneMgr.register('home', require('./scenes/home'));
sceneMgr.register('rank', require('./scenes/rank'));
sceneMgr.register('profile', require('./scenes/profile'));
sceneMgr.register('rules', require('./scenes/rules'));
sceneMgr.register('match', require('./scenes/match'));

// 主画布上下文
let ctx = null;
let canvas = null;

function main() {
  // 1. 登录并连接游戏服务器
  init();

  // 2. 获取 Canvas
  canvas = wx.createCanvas();
  ctx = canvas.getContext('2d');

  // 适配高清屏（逻辑像素 = 物理像素 / dpr，这里直接用逻辑尺寸即可，
  // 因为 wx.getSystemInfoSync().windowWidth 已是逻辑像素）
  const info = wx.getSystemInfoSync();
  canvas.width = info.windowWidth;
  canvas.height = info.windowHeight;

  // 3. 进入首页
  sceneMgr.goto('home');

  // 4. 触摸事件转发
  wx.onTouchStart((e) => {
    const t = e.touches[0];
    if (!t) return;
    sceneMgr.touch(t.x, t.y);
  });

  // 5. 主循环（各场景已在 onEnter 中自行注册 WS 监听）
  loop();
}

function loop() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sceneMgr.draw(ctx);
  requestAnimationFrame(loop);
}

// 启动
main();
