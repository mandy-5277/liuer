/**
 * 六儿 服务端 — 全局配置
 */
require('dotenv').config();

module.exports = {
  // ========== 服务配置 ==========
  port: parseInt(process.env.SERVER_PORT, 10) || 3000,
  wsHeartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL, 10) || 30,

  // ========== 数据库配置（自建服务器：MySQL + Redis） ==========
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    user: process.env.MYSQL_USER || 'liuer',
    password: process.env.MYSQL_PASSWORD || 'liuer123456',
    database: process.env.MYSQL_DATABASE || 'liuer',
    connectionLimit: parseInt(process.env.MYSQL_POOL_SIZE, 10) || 10,
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  // ========== 微信小程序配置 ==========
  wechat: {
    appid: process.env.WX_APPID || 'wxccefff03956286b1',
    secret: process.env.WX_APPSECRET || '',
  },

  // ========== 游戏常量 ==========
  game: {
    boardSize: 6,          // 6×6交叉点，36下子位
    maxPieces: 36,         // 总下子位
    moveTimeout: 15000,    // 操作超时 15秒（毫秒）
    timeoutForfeit: 3,     // 连续超时判负次数
    drawNoCatchRounds: 5,  // 无有效揪回合数和棋
    drawRequestCooldown: 15000, // 求和冷却 15秒
    roomExpire: 60000,     // 房间过期 60秒
    reconnectWindow: 30000, // 断线重连窗口30秒，超时判掉线方负
    energyPerGame: 5,      // 每局消耗精力
    energyMax: 30,         // 精力上限
    energyRecoverMinutes: 5, // 每 5 分钟自然恢复 1 点精力（离线也按时间戳累计）
    maxAdPerDay: 3,        // 每日广告次数上限（看广告恢复精力）
    adReward: 10,          // 看广告恢复精力点数
    shareReward: 5,        // 分享恢复精力点数
    signInReward: 5,       // 每日签到恢复精力点数

    // 段位体系（积分区间 -> 段位名称）
    ranks: [
      { min: 0,     max: 199,  name: '初级小六', icon: '⭐' },
      { min: 200,   max: 399,  name: '中级小六', icon: '⭐⭐' },
      { min: 400,   max: 599,  name: '高级小六', icon: '⭐⭐⭐' },
      { min: 600,   max: 799,  name: '初级老六', icon: '👑' },
      { min: 800,   max: 999,  name: '中级老六', icon: '👑👑' },
      { min: 1000,  max: 1199, name: '高级老六', icon: '👑👑👑' },
      { min: 1200,  max: Infinity, name: '资深老六', icon: '👑👑👑💎' },
    ],

    // 积分结算规则
    scoreChange: {
      win: +3,
      lose: -3,
      drawRequest: -1,    // 主动发起求和
      drawAgree: +1,      // 同意对方求和
      disconnect: -5,     // 掉线/强退
      naturalDraw: -1,    // 自然和棋（双方各-1）
    },
  },

  // ========== 棋子标识 ==========
  piece: {
    BLACK: 1,   // 黑棋
    WHITE: 2,   // 白棋
    EMPTY: 0,   // 空位
  },
};
