/**
 * 六儿 小游戏版 — 服务端地址配置
 * （与小程序版 client/miniprogram/config.js 保持一致）
 *
 * 环境切换：
 *  - 开发（微信开发者工具，勾选"不校验合法域名"）：USE_WSS = false
 *      WS_BASE = 'ws://47.93.96.20:3000'（明文直连 IP，工具可连）
 *  - 生产（真机体验版/正式版）：USE_WSS = true
 *      走 Nginx 反代：WS_BASE = 'wss://liuer.xin/ws'
 *      注意：真机要求 wss:// + 已备案域名，且需在微信公众平台
 *            "服务器域名 → socket合法域名" 配置 wss://liuer.xin
 *
 * 切生产只需把 USE_WSS 改为 true（域名/证书就绪后）。
 */
const PROD_DOMAIN = 'liuer.xin';
const USE_WSS = true; // 域名解析+ICP备案已完成，走 wss://liuer.xin/ws

const SERVER_BASE = USE_WSS
  ? 'https://' + PROD_DOMAIN
  : 'http://47.93.96.20:3000';
const WS_BASE = USE_WSS
  ? 'wss://' + PROD_DOMAIN + '/ws'   // Nginx 反代路径（见服务器 /etc/nginx/sites-available/game.conf）
  : 'ws://47.93.96.20:3000';

module.exports = {
  SERVER_BASE,   // HTTP 接口基址（含 /api/auth/wx-login）
  WS_BASE,       // WebSocket 基址
  USE_WSS,
  PROD_DOMAIN,
};
