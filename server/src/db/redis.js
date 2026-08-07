/**
 * Redis 客户端（基于 ioredis）
 * 用于存储内存态数据：匹配队列、房间、对局、掉线缓存
 * 与 CloudBase 时期的内存 Map 用法一一对应
 */
const Redis = require('ioredis');
const { redis: redisConfig } = require('../config');

const options = {
  host: redisConfig.host,
  port: redisConfig.port,
  db: redisConfig.db,
  retryStrategy: (times) => Math.min(times * 200, 2000),
};

if (redisConfig.password) {
  options.password = redisConfig.password;
}

const redis = new Redis(options);

redis.on('error', (err) => {
  console.error('[Redis] 连接错误:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] 已连接');
});

module.exports = redis;
