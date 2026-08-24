/**
 * 后台管理 — 用户统计
 * 指标：
 *  - 总用户数 totalUsers
 *  - 新增用户数 newUsers（按时间区间）
 *  - 日活用户数 dau（lastLoginTime 当天去重）
 *  - 5 分钟粒度实时刷新（内存缓存最近若干点，定时落库 stats_snapshot）
 *  - 天粒度曲线：默认 7 天，支持 2 个月（读 stats_snapshot）
 *
 * 说明：users 表没有"登录事件表"，日活以 lastLoginTime 当天近似；
 * 若未来接入登录流水可改为精确统计。
 */
const { query } = require('./db');

function todayStr(d = new Date()) {
  const z = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// 内存中保存最近 5 分钟粒度的实时点（用于仪表盘即时刷新）
const realtime5min = [];
const MAX_POINTS = 288; // 24h / 5min

function pushRealtimePoint() {
  return getOverview().then((ov) => {
    realtime5min.push({ t: Date.now(), ...ov });
    if (realtime5min.length > MAX_POINTS) realtime5min.shift();
    return ov;
  });
}

async function getOverview() {
  const [total] = await query("SELECT COUNT(*) AS c FROM users WHERE openid NOT LIKE 'bot_%'");
  const t = todayStr();
  const [newToday] = await query(
    "SELECT COUNT(*) AS c FROM users WHERE DATE(createTime) = ? AND openid NOT LIKE 'bot_%'",
    [t]
  );
  const [dau] = await query(
    "SELECT COUNT(*) AS c FROM users WHERE DATE(lastLoginTime) = ? AND openid NOT LIKE 'bot_%'",
    [t]
  );
  return {
    totalUsers: total.c,
    newUsersToday: newToday.c,
    dauToday: dau.c,
  };
}

// 按小时/天返回新增用户曲线（基于 createTime）
async function getNewUserSeries(days) {
  const rows = await query(
    `SELECT DATE(createTime) AS day, COUNT(*) AS c
     FROM users
     WHERE createTime >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND openid NOT LIKE 'bot_%'
     GROUP BY DATE(createTime) ORDER BY day`,
    [days]
  );
  return rows;
}

// 天粒度曲线：优先读 stats_snapshot 历史；不足部分用实时计算补齐
async function getDailySeries(days) {
  const snap = await query(
    `SELECT DATE(snapTime) AS day, MAX(totalUsers) AS totalUsers, MAX(dau) AS dau, MAX(newUsers) AS newUsers
     FROM stats_snapshot
     WHERE snapTime >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(snapTime) ORDER BY day`,
    [days]
  );
  return snap;
}

// 落库快照（由定时器每 5 分钟调用）
async function snapshot() {
  const ov = await getOverview();
  const [newInWindow] = await query(
    `SELECT COUNT(*) AS c FROM users
     WHERE lastLoginTime >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND openid NOT LIKE 'bot_%'`
  );
  await query(
    'INSERT INTO stats_snapshot (snapTime, totalUsers, newUsers, dau) VALUES (NOW(), ?, ?, ?)',
    [ov.totalUsers, newInWindow.c, ov.dauToday]
  );
  return ov;
}

module.exports = {
  todayStr, getOverview, getNewUserSeries, getDailySeries,
  pushRealtimePoint, getRealtime5min: () => realtime5min, snapshot,
};
