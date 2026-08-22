/**
 * 六儿 服务端 — 主入口
 *
 * 启动 Express HTTP 服务器 + WebSocket 服务器
 * 部署方式：自建服务器（MySQL + Redis）
 *
 * HTTP 接口（辅助，用于健康检查和云托管端口探测）：
 *   GET  /health          — 健康检查
 *   GET  /api/stats       — 服务状态统计
 *
 * WebSocket 路径：/
 *   协议见 PRD.md 第四节 4.4 WebSocket 通信协议
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const express = require('express');
const { port, wsHeartbeatInterval, wechat } = require('./config');
const { dispatch } = require('./ws/handler');
const { wsMap, removeConnection, gameSessions, findActiveGameByPlayer, handlePlayerDisconnect, matchingQueue, joinMatching } = require('./services/session');
const robot = require('./services/robot');
const { initSchema } = require('./db/mysql');
const { ensureEnergySchema } = require('./services/data');
const redis = require('./db/redis');

// ========== Express HTTP 服务 ==========

const app = express();
// 头像上传走 base64，默认 100kb 限制会触发 413，放宽到 10mb
app.use(express.json({ limit: '10mb' }));

// 静态页面（隐私政策 / 服务协议，供小游戏备案链接访问）
// 访问路径：https://liuer.xin/privacy.html 和 https://liuer.xin/terms.html
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));
}

// 健康检查
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), time: Date.now() });
});

// 服务统计
app.get('/api/stats', (req, res) => {
  res.json({
    connections: wsMap.size,
    activeGames: gameSessions.size,
    uptime: Math.floor(process.uptime()),
  });
});

// 微信登录：用 code 换取 openid
// 客户端通过此接口获取 openid，无需依赖 wx.cloud SDK
app.post('/api/auth/wx-login', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ ok: false, errMsg: '缺少 code 参数' });
  }

  // 开发环境降级：如果没配置 app secret，返回模拟 openid 用于本地调试
  if (!wechat.secret) {
    console.warn('[Auth] 未配置 WX_APPSECRET，使用模拟登录');
    const mockOpenid = 'dev_' + (code.slice(-8) || Date.now());
    return res.json({
      ok: true,
      openid: mockOpenid,
      unionid: '',
      isMock: true,
    });
  }

  // 调用微信 jscode2session 接口
  const wxUrl = 'https://api.weixin.qq.com/sns/jscode2session'
    + '?appid=' + encodeURIComponent(wechat.appid)
    + '&secret=' + encodeURIComponent(wechat.secret)
    + '&js_code=' + encodeURIComponent(code)
    + '&grant_type=authorization_code';

  https.get(wxUrl, (wxRes) => {
    let body = '';
    wxRes.on('data', chunk => body += chunk);
    wxRes.on('end', () => {
      try {
        const result = JSON.parse(body);
        if (result.errcode) {
          console.error('[Auth] 微信登录失败:', result);
          return res.status(500).json({
            ok: false,
            errMsg: '微信登录失败: ' + (result.errmsg || ''),
          });
        }
        console.log('[Auth] 登录成功, openid:', result.openid);
        res.json({
          ok: true,
          openid: result.openid,
          unionid: result.unionid || '',
        });
      } catch (err) {
        console.error('[Auth] 解析微信返回失败:', err);
        res.status(500).json({ ok: false, errMsg: '微信接口返回异常' });
      }
    });
  }).on('error', (err) => {
    console.error('[Auth] 请求微信接口失败:', err);
    res.status(500).json({ ok: false, errMsg: '请求微信服务失败' });
  });
});

// 返回小程序 appid（供客户端 wx.login 使用）
app.get('/api/auth/config', (req, res) => {
  res.json({ appid: wechat.appid });
});

// ========== 头像上传（用户自定义头像） ==========

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
// 静态服务上传的头像（真机通过 https://liuer.xin/uploads/xxx 访问）
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

/**
 * POST /api/avatar/upload  { openid, base64, ext }
 * 接收小游戏上传的 base64 头像图片，保存到 uploads 目录并返回可访问 URL。
 * 限制单张 2MB，仅允许常见图片扩展名。
 */
app.post('/api/avatar/upload', (req, res) => {
  try {
    const { openid = 'anon', base64 = '', ext = 'png' } = req.body || {};
    if (!base64) {
      return res.status(400).json({ ok: false, errMsg: '缺少 base64 数据' });
    }
    // 去掉可能带有的 data:image/xxx;base64, 前缀
    const clean = base64.indexOf(',') >= 0 ? base64.slice(base64.indexOf(',') + 1) : base64;
    const buf = Buffer.from(clean, 'base64');
    if (buf.length > 2 * 1024 * 1024) {
      return res.status(400).json({ ok: false, errMsg: '头像图片不能超过 2MB' });
    }
    const allowedExt = /^(png|jpe?g|gif|webp)$/i.test(ext) ? ext : 'png';
    const name = 'a_' + crypto.randomBytes(8).toString('hex') + '.' + allowedExt;
    const absPath = path.join(UPLOAD_DIR, name);
    fs.writeFileSync(absPath, buf);
    console.log('[Upload] 头像已保存:', name, '来源:', openid);
    // 构造可访问的完整 URL（支持 Nginx 反代，返回 https://域名/uploads/xxx）
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'liuer.xin';
    const url = (process.env.PUBLIC_BASE_URL || (proto + '://' + host)) + '/uploads/' + name;
    res.json({ ok: true, url });
  } catch (err) {
    console.error('[Upload] 头像保存失败:', err);
    res.status(500).json({ ok: false, errMsg: '头像保存失败' });
  }
});

// ========== 进程级崩溃保护（防止未捕获异常导致进程退出） ==========

process.on('uncaughtException', (err) => {
  console.error('[PROCESS] uncaughtException:', err.stack || err.message);
  // 不退出进程，继续运行
});

process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] unhandledRejection:', reason?.stack || reason);
  // 不退出进程，继续运行
});

// ========== HTTP + WebSocket 共用端口 ==========

const server = http.createServer(app);

// ========== WebSocket 服务 ==========

const wss = new WebSocketServer({ noServer: true });

// 显式处理 HTTP Upgrade 请求（nginx 反向代理依赖此机制）
server.on('upgrade', (request, socket, head) => {
  console.log(`[HTTP] Upgrade 请求: ${request.url} 来源: ${socket.remoteAddress}`);

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// 根路径健康检查（nginx 代理可能先发 HTTP GET 探测）
app.get('/', (req, res) => {
  // 检查是否为 WebSocket 升级请求
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    return; // 由 upgrade 事件处理
  }
  res.json({ ok: true, uptime: process.uptime(), type: 'liuer-game-server' });
});

wss.on('connection', (ws, req) => {
  console.log(`[WS] 新连接: ${req.socket.remoteAddress} 路径: ${req.url}`);

  // 心跳保活
  ws.isAlive = true;
  ws.lastPing = Date.now();

  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastPing = Date.now();
  });

  // 消息处理
  ws.on('message', (raw) => {
    (async () => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`[WS] 收到消息: cmd=${msg.cmd} 来自: ${req.socket.remoteAddress}`);
        await dispatch(ws, msg);
      } catch (err) {
        console.error('[WS] 消息处理失败:', err.message || err);
      }
    })().catch(err => {
      console.error('[WS] 消息处理未捕获错误:', err);
    });
  });

  // 连接关闭
  ws.on('close', (code) => {
    console.log(`[WS] 连接关闭, code=${code}`);
    const openid = ws.openid;
    if (openid && wsMap.get(openid)) {
      console.log(`[WS] 清理用户连接: ${openid}`);
      removeConnection(openid);
    }
  });

  // 错误处理
  ws.on('error', (err) => {
    console.error('[WS] 连接错误:', err.message);
  });
});

// ========== 心跳检测定时器 ==========
// 注意：不使用 ws.ping() 协议帧，因为微信小程序不会自动回复 pong
// 改为依赖客户端应用层 { cmd: 'ping' } 消息（在 handler.js 中更新 ws.isAlive）

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('[WS] 心跳超时，断开连接');
      // 如果该连接已绑定玩家且在游戏中，直接触发掉线判胜流程
      //（避免某些客户端 close 事件不触发导致对手无限等待）
      if (ws.openid) {
        const activeGame = findActiveGameByPlayer(ws.openid);
        if (activeGame) {
          console.log(`[WS] 心跳超时玩家仍在对局中: ${ws.openid}，启动掉线判胜`);
          handlePlayerDisconnect(activeGame, ws.openid);
        }
      }
      return ws.terminate();
    }

    ws.isAlive = false;
  });
}, wsHeartbeatInterval * 1000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ========== 启动服务 ==========

async function start() {
  // 初始化数据库表结构
  try {
    await initSchema();
  } catch (err) {
    console.error('[MySQL] 初始化表结构失败:', err.message);
    console.error('请检查 MySQL 连接配置（.env 中的 MYSQL_*）');
    process.exit(1);
  }

  // 确保精力恢复时间戳字段存在
  try {
    await ensureEnergySchema();
  } catch (err) {
    console.error('[MySQL] 精力字段初始化失败:', err.message);
  }

  // 确认 Redis 可用
  try {
    await redis.ping();
  } catch (err) {
    console.error('[Redis] 连接失败:', err.message);
    console.error('请检查 Redis 连接配置（.env 中的 REDIS_*）');
    process.exit(1);
  }

  // 启动机器人匹配看门狗（真人匹配超时后机器人介入）
  try {
    robot.startMatchWatchdog(matchingQueue, joinMatching);
  } catch (err) {
    console.error('[Robot] 启动匹配看门狗失败:', err.message);
  }

  server.listen(port, () => {
    console.log('='.repeat(50));
    console.log('  六儿 游戏服务端 v1.0');
    console.log('='.repeat(50));
    console.log(`  HTTP 服务: http://0.0.0.0:${port}`);
    console.log(`  WebSocket: ws://0.0.0.0:${port}`);
    console.log(`  心跳间隔: ${wsHeartbeatInterval}s`);
    console.log('  存储: MySQL + Redis');
    console.log('='.repeat(50));
  });
}

start();

// ========== 优雅关闭 ==========

process.on('SIGTERM', () => {
  console.log('[Server] 收到 SIGTERM，正在关闭...');
  gracefulShutdown();
});

process.on('SIGINT', () => {
  console.log('[Server] 收到 SIGINT，正在关闭...');
  gracefulShutdown();
});

function gracefulShutdown() {
  // 停止机器人匹配看门狗
  try { robot.stopMatchWatchdog(); } catch (_) { /* ignore */ }

  // 通知所有在线玩家
  for (const [openid, session] of wsMap) {
    try {
      session.ws.send(JSON.stringify({
        cmd: 'server_shutdown',
        data: { message: '服务器维护中，请稍后重试' },
      }));
      session.ws.close();
    } catch (_) { /* ignore */ }
  }

  wss.close(() => {
    console.log('[Server] WebSocket 服务已关闭');
    server.close(() => {
      console.log('[Server] HTTP 服务已关闭');
      process.exit(0);
    });
  });

  // 5秒强制退出
  setTimeout(() => {
    console.log('[Server] 强制退出');
    process.exit(1);
  }, 5000);
}
