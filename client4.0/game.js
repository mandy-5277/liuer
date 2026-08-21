/**
 * 下六儿 小游戏版 — 入口 (game.js)
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
const audio = require('./utils/audio');
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
let logicalW = 0;   // 逻辑宽（windowWidth）
let logicalH = 0;   // 逻辑高（windowHeight）

function main() {
  // 0. 读取启动参数（分享卡片带 room 可自动进房）
  function readRoomFromLaunchOptions(opts) {
    if (opts && opts.query && opts.query.room) {
      state.pendingRoom = ('' + opts.query.room).toUpperCase().trim();
      console.log('[Game] 分享进入，pendingRoom=', state.pendingRoom);
    }
  }
  try {
    readRoomFromLaunchOptions((typeof wx.getLaunchOptionsSync === 'function') ? wx.getLaunchOptionsSync() : {});
  } catch (e) { /* ignore */ }

  // 热启动：好友从分享卡片点击进入已运行的小程序
  if (typeof wx.onShow === 'function') {
    wx.onShow((res) => readRoomFromLaunchOptions(res));
  }

  // 开启分享给好友（小游戏）
  if (typeof wx.showShareMenu === 'function') {
    wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] });
  }

  // 1. 登录并连接游戏服务器
  init();

  // 2. 获取 Canvas
  canvas = wx.createCanvas();
  ctx = canvas.getContext('2d');

  // 高清屏适配（关键：让画布按物理像素渲染，避免文字/图形模糊）
  // - canvas.width/height = 物理像素（逻辑像素 × devicePixelRatio）
  // - ctx.scale(dpr, dpr) 使后续绘制仍按逻辑坐标，但以物理分辨率输出
  const info = wx.getSystemInfoSync();
  const dpr = info.pixelRatio || (info.devicePixelRatio || 1);
  logicalW = info.windowWidth;
  logicalH = info.windowHeight;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  ctx.scale(dpr, dpr);

  // 3. 进入首页
  sceneMgr.goto('home');

  // 4. 触摸事件转发
  // 小游戏 wx.onTouchStart 的 Touch 对象坐标为 clientX/clientY（逻辑像素），
  // 与 canvas.width/height（= windowWidth/windowHeight）同一坐标系，直接使用即可。
  wx.onTouchStart((e) => {
    const t = e.touches[0];
    if (!t) return;
    const x = (t.x !== undefined) ? t.x : t.clientX;
    const y = (t.y !== undefined) ? t.y : t.clientY;
    // 首次交互后启动背景音乐（小游戏要求用户手势后才能播放音频）
    audio.startBgm();
    sceneMgr.touch(x, y);
  });

  wx.onTouchMove((e) => {
    const t = e.touches[0];
    if (!t) return;
    const x = (t.x !== undefined) ? t.x : t.clientX;
    const y = (t.y !== undefined) ? t.y : t.clientY;
    sceneMgr.touchMove(x, y);
  });

  wx.onTouchEnd((e) => {
    sceneMgr.touchEnd();
  });

  // 5. 主循环（各场景已在 onEnter 中自行注册 WS 监听）
  loop();
}

function loop() {
  if (!ctx) return;
  // 清除按逻辑尺寸（context 已 scale，画布物理尺寸在 canvas.width/height）
  ctx.clearRect(0, 0, logicalW, logicalH);
  sceneMgr.draw(ctx);
  requestAnimationFrame(loop);
}

// 启动
main();
