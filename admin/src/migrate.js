/**
 * 后台管理 — 数据库迁移（幂等，可重复执行）
 * 1) users 表补充后台所需字段：lastLoginTime / isBlacklist / totalAdCount / totalShareCount
 * 2) 新建后台专属表：admin_users / stats_snapshot / admin_op_log / alerts
 */
const { pool } = require('./db');

async function addColumnIfNotExists(conn, table, col, def) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  if (rows.length === 0) {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`[Migrate] ${table}.${col} 已添加`);
  }
}

async function createTableIfNotExists(conn, name, ddl) {
  await conn.query(`CREATE TABLE IF NOT EXISTS ${name} (${ddl})`);
  console.log(`[Migrate] 表 ${name} 就绪`);
}

async function migrate() {
  const conn = await pool.getConnection();
  try {
    // ---- 1. users 补充字段 ----
    await addColumnIfNotExists(conn, 'users', 'lastLoginTime', 'DATETIME DEFAULT NULL');
    await addColumnIfNotExists(conn, 'users', 'isBlacklist', 'TINYINT NOT NULL DEFAULT 0');
    await addColumnIfNotExists(conn, 'users', 'totalAdCount', 'INT NOT NULL DEFAULT 0');
    await addColumnIfNotExists(conn, 'users', 'totalShareCount', 'INT NOT NULL DEFAULT 0');

    // 回填 lastLoginTime：没有对局记录的新用户用 createTime 近似
    await conn.query(
      `UPDATE users SET lastLoginTime = createTime WHERE lastLoginTime IS NULL`
    );

    // ---- 2. 后台表 ----
    await createTableIfNotExists(conn, 'admin_users', `
      id            INT            NOT NULL AUTO_INCREMENT,
      username      VARCHAR(32)   NOT NULL,
      passwordHash  VARCHAR(100)  NOT NULL,
      role          VARCHAR(16)   NOT NULL DEFAULT 'operator',  -- super | admin | operator
      domain        VARCHAR(64)   NOT NULL DEFAULT '*',          -- 分域：* 表示全部
      remark        VARCHAR(128)  DEFAULT '',
      createTime    DATETIME      DEFAULT CURRENT_TIMESTAMP,
      lastLoginTime DATETIME      DEFAULT NULL,
      status        TINYINT       NOT NULL DEFAULT 1,            -- 1 启用 0 禁用
      PRIMARY KEY (id),
      UNIQUE KEY uk_username (username)
    `);

    await createTableIfNotExists(conn, 'stats_snapshot', `
      id         BIGINT        NOT NULL AUTO_INCREMENT,
      snapTime   DATETIME      NOT NULL,
      totalUsers INT           NOT NULL DEFAULT 0,
      newUsers   INT           NOT NULL DEFAULT 0,
      dau        INT           NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_snapTime (snapTime)
    `);

    await createTableIfNotExists(conn, 'admin_op_log', `
      id         BIGINT        NOT NULL AUTO_INCREMENT,
      adminUser  VARCHAR(32)   NOT NULL,
      action     VARCHAR(32)   NOT NULL,
      target     VARCHAR(64)   DEFAULT '',
      detail     VARCHAR(512)  DEFAULT '',
      createTime DATETIME      DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_createTime (createTime)
    `);

    await createTableIfNotExists(conn, 'alerts', `
      id         BIGINT        NOT NULL AUTO_INCREMENT,
      metric     VARCHAR(32)   NOT NULL,
      level      VARCHAR(16)   NOT NULL DEFAULT 'warn',  -- warn | critical
      value      VARCHAR(64)   DEFAULT '',
      message    VARCHAR(256)  DEFAULT '',
      createTime DATETIME      DEFAULT CURRENT_TIMESTAMP,
      resolved   TINYINT       NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_createTime (createTime)
    `);

    // 性能历史（用于历史曲线，定时落库）
    await createTableIfNotExists(conn, 'monitor_history', `
      id         BIGINT        NOT NULL AUTO_INCREMENT,
      snapTime   DATETIME      NOT NULL,
      cpu        FLOAT         NOT NULL DEFAULT 0,
      mem        FLOAT         NOT NULL DEFAULT 0,
      disk       FLOAT         NOT NULL DEFAULT 0,
      mysqlConns INT           NOT NULL DEFAULT 0,
      rxKBps     FLOAT         NOT NULL DEFAULT 0,
      txKBps     FLOAT         NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_snapTime (snapTime)
    `);

    console.log('[Migrate] 迁移完成');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { migrate };
