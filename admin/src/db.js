/**
 * 后台管理 — 数据库连接层
 * 复用与游戏服务端同一套 MySQL 配置（读取 .env 中的 MYSQL_*）。
 * 后台作为独立进程，使用自己的连接池，但操作同一个 liuer 库。
 * 通过 MYSQL_DATABASE 指向同一数据库，确保能读到 users / games 等表。
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'server', '.env') });
require('dotenv').config();

const cfg = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  user: process.env.MYSQL_USER || 'liuer',
  password: process.env.MYSQL_PASSWORD || 'liuer123456',
  database: process.env.MYSQL_DATABASE || 'liuer',
  connectionLimit: parseInt(process.env.ADMIN_MYSQL_POOL || '5', 10),
  charset: 'utf8mb4',
  timezone: '+08:00',
  waitForConnections: true,
  queueLimit: 0,
};

const pool = mysql.createPool(cfg);

async function query(sql, params) {
  const [rows] = await pool.query(sql, params || []);
  return rows;
}

async function ping() {
  await pool.query('SELECT 1');
}

module.exports = { pool, query, ping, cfg };
