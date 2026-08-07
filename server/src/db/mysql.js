/**
 * MySQL 连接池（基于 mysql2/promise）
 * 仅负责连接管理与初始化建表，业务 SQL 在 services/data.js 中执行
 */
const mysql = require('mysql2/promise');
const { mysql: mysqlConfig } = require('../config');

// 创建连接池
const pool = mysql.createPool({
  host: mysqlConfig.host,
  port: mysqlConfig.port,
  user: mysqlConfig.user,
  password: mysqlConfig.password,
  database: mysqlConfig.database,
  connectionLimit: mysqlConfig.connectionLimit,
  charset: 'utf8mb4',
  timezone: '+08:00',
  waitForConnections: true,
  queueLimit: 0,
});

/**
 * 自动建表（幂等，生产环境建议用迁移脚本管理，这里仅作兜底）
 */
async function initSchema() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        openid         VARCHAR(64)   NOT NULL,
        unionid        VARCHAR(64)   DEFAULT NULL,
        nickName       VARCHAR(128)  DEFAULT '',
        avatarUrl      VARCHAR(512)  DEFAULT '',
        rankScore      INT           NOT NULL DEFAULT 1000,
        rankName       VARCHAR(32)   DEFAULT '初级小六',
        energy         INT           NOT NULL DEFAULT 30,
        copper         INT           NOT NULL DEFAULT 0,
        dailyCopper    INT           NOT NULL DEFAULT 0,
        lastCheckin    DATE          DEFAULT NULL,
        lastDailyReset DATE          DEFAULT NULL,
        winCount       INT           NOT NULL DEFAULT 0,
        loseCount      INT           NOT NULL DEFAULT 0,
        drawCount      INT           NOT NULL DEFAULT 0,
        settings       JSON          DEFAULT NULL,
        createTime     DATETIME      DEFAULT CURRENT_TIMESTAMP,
        updateTime     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (openid),
        KEY idx_rankScore (rankScore)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS games (
        gameId         VARCHAR(64)   NOT NULL,
        blackOpenid    VARCHAR(64)   NOT NULL,
        whiteOpenid    VARCHAR(64)   NOT NULL,
        mode           VARCHAR(16)   DEFAULT 'random',
        result         VARCHAR(16)   DEFAULT NULL,
        endReason      VARCHAR(32)   DEFAULT NULL,
        endStage       TINYINT       DEFAULT NULL,
        blackMoves     INT           NOT NULL DEFAULT 0,
        whiteMoves     INT           NOT NULL DEFAULT 0,
        blackCaptures  INT           NOT NULL DEFAULT 0,
        whiteCaptures  INT           NOT NULL DEFAULT 0,
        blackRating    INT           NOT NULL DEFAULT 0,
        whiteRating    INT           NOT NULL DEFAULT 0,
        durationMs     BIGINT        NOT NULL DEFAULT 0,
        createTime     DATETIME      DEFAULT CURRENT_TIMESTAMP,
        endTime        DATETIME      DEFAULT NULL,
        PRIMARY KEY (gameId),
        KEY idx_black (blackOpenid),
        KEY idx_white (whiteOpenid),
        KEY idx_createTime (createTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id             BIGINT         NOT NULL AUTO_INCREMENT,
        openid         VARCHAR(64)   NOT NULL,
        type           VARCHAR(16)   NOT NULL,
        amount         INT           NOT NULL,
        balanceAfter   INT           NOT NULL DEFAULT 0,
        remark         VARCHAR(255)  DEFAULT '',
        createTime     DATETIME      DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_openid (openid),
        KEY idx_createTime (createTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        roomId         VARCHAR(16)   NOT NULL,
        creatorOpenid  VARCHAR(64)   NOT NULL,
        joinerOpenid   VARCHAR(64)   DEFAULT NULL,
        status         VARCHAR(16)   NOT NULL DEFAULT 'waiting',
        createTime     DATETIME      DEFAULT CURRENT_TIMESTAMP,
        expireTime     DATETIME      DEFAULT NULL,
        PRIMARY KEY (roomId),
        KEY idx_status (status),
        KEY idx_creator (creatorOpenid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[MySQL] 数据表初始化完成');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initSchema };
