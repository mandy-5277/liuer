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
    drawNoCatchRounds: 0,  // 无有效揪回合数和棋（0=关闭自动和棋，仅保留双方主动求和）
    drawRequestCooldown: 15000, // 求和冷却 15秒
    roomExpire: 60000,     // 房间过期 60秒
    reconnectWindow: 30000, // 断线重连窗口30秒，超时判掉线方负
    energyPerGame: 5,      // 每局消耗精力
    energyMax: 30,         // 精力上限
    energyRecoverMinutes: 5, // 每 5 分钟自然恢复 1 点精力（离线也按时间戳累计）
    maxAdPerDay: 3,        // 每日广告次数上限（看广告恢复精力）
    adReward: 10,          // 看广告恢复精力点数
    shareReward: 5,        // 分享恢复精力点数
    shareRewardLimit: 5,   // 每日分享次数上限
    signInReward: 5,       // 每日签到恢复精力点数

    // 段位体系（积分区间 -> 段位名称）
    // 新手小步进（10/20分一档）给快速正反馈；小六起50分一档；老六起100分一档。
    // 负分(<0)显示「还未入门」；≥680 固定「资深老六+」并以星星/月亮/太阳/皇冠展示（按胜场累计）。
    ranks: [
      { min: 0,     max: 9,      name: '初级小方' },
      { min: 10,    max: 19,     name: '中级小方' },
      { min: 20,    max: 39,     name: '高级小方' },
      { min: 40,    max: 59,     name: '初级老方' },
      { min: 60,    max: 79,     name: '中级老方' },
      { min: 80,    max: 99,     name: '高级老方' },
      { min: 100,   max: 129,    name: '资深老方' },
      { min: 130,   max: 179,    name: '初级小六' },
      { min: 180,   max: 229,    name: '中级小六' },
      { min: 230,   max: 279,    name: '高级小六' },
      { min: 280,   max: 379,    name: '初级老六' },
      { min: 380,   max: 479,    name: '中级老六' },
      { min: 480,   max: 579,    name: '高级老六' },
      { min: 580,   max: 679,    name: '资深老六' },
    ],
    // 1400+ 的星星展示配置（按胜场 stars 字段换算，四进制：4星=1月，4月=1日/太阳，4太阳=1皇冠）
    starTiers: { star: '⭐', moon: '🌙', sun: '☀️', crown: '👑' },
    // 匹配分级扩圈（毫秒 -> 允许的最大积分差；超过 robotDelay 后机器人介入）
    matchTiers: [
      { afterMs: 0,    maxDiff: 200 },   // 0-5s：±200
      { afterMs: 5000,  maxDiff: 500 },   // 5-10s：±500
      { afterMs: 10000, maxDiff: 1000 },  // 10-15s：±1000
      { afterMs: 15000, maxDiff: Infinity }, // 15-20s：无分段
    ],
    robotDelay: 20000, // 20s 后机器人介入兜底

    // 积分结算规则
    scoreChange: {
      win: +3,
      lose: -3,
      drawRequest: -1,    // 主动发起求和
      drawAgree: +1,      // 同意对方求和
      disconnect: -5,     // 掉线/强退
      naturalDraw: -1,    // 自然和棋（双方各-1）
    },

    // 机器人（AI 陪练）配置
    robot: {
      enabled: true,        // 是否启用机器人介入
      prefix: 'bot_',       // 机器人 openid 前缀
      matchDelay: 15000,    // 真人随机匹配等待多少毫秒后机器人介入
      maxIdle: 50,          // 机器人在线池上限（空闲+对局中）
      thinkMin: 1000,       // 机器人思考最小延迟(ms)：1s
      thinkMax: 5000,       // 机器人思考最大延迟(ms)：5s
      // 机器人随机昵称/头像素材
      nickNames: [
        '小六同学', '六六', '老六', '棋痴', '落子无悔', '方方', '六子棋迷',
        '摸鱼小六', '隔壁老王', '棋坛新星', '六神', '稳如老狗', '一子定乾坤',
        '六耳猕猴', '棋盘浪人', '半目胜负', '无名小卒', '棋逢对手', '落花六子',
      ],
      avatarUrls: [
        'emoji:🤖',
        'emoji:👾',
        'emoji:🦾',
        'emoji:🎲',
        'emoji:🧩',
      ],
    },
  },

  // ========== 棋子标识 ==========
  piece: {
    BLACK: 1,   // 黑棋
    WHITE: 2,   // 白棋
    EMPTY: 0,   // 空位
  },
};
