/**
 * 六儿 客户端 — 服务端地址配置
 *
 * 迁移到自建服务器后，只需修改此处：
 *  - 开发：SERVER_BASE = 'http://localhost:3000'，WS_BASE = 'ws://localhost:3000'
 *  - 生产：SERVER_BASE = 'https://你的域名或IP:3000'，WS_BASE = 'wss://你的域名或IP:3000'
 *          （若用 nginx 反代到 443 端口，则去掉 ':3000'）
 */
const SERVER_BASE = 'http://47.93.96.20:3000';
const WS_BASE = 'ws://47.93.96.20:3000';

module.exports = {
  SERVER_BASE,   // HTTP 接口基址（含 /api/auth/wx-login）
  WS_BASE,       // WebSocket 基址
};
