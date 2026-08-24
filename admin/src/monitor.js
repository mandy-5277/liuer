/**
 * 后台管理 — 性能监控
 * 采集：CPU 使用率 / 内存 / 磁盘 / 数据库(MySQL 连接数&慢查询) / 带宽(网络 IO)
 * 阈值预警：超过阈值写入 alerts 表（去重：同一指标 5 分钟内不重复告警）
 */
const os = require('os');
const { exec } = require('child_process');
const { query, ping } = require('./db');
const { opLog } = require('./middleware');
const crypto = require('crypto');

// 阈值配置（可在 .env 覆盖）
const TH = {
  cpu: parseFloat(process.env.ALERT_CPU || '85'),        // %
  mem: parseFloat(process.env.ALERT_MEM || '90'),        // %
  disk: parseFloat(process.env.ALERT_DISK || '90'),      // %
  mysqlConns: parseInt(process.env.ALERT_MYSQL_CONNS || '80', 10),
};

let lastCpu = { idle: 0, total: 0 };
let lastNet = null;
const alertCache = {}; // metric -> lastAlertTs

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}

function cpuPercent() {
  const cur = cpuTimes();
  const idleDiff = cur.idle - lastCpu.idle;
  const totalDiff = cur.total - lastCpu.total;
  lastCpu = cur;
  if (totalDiff === 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;
}

function memInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalMB: Math.round(total / 1024 / 1024),
    freeMB: Math.round(free / 1024 / 1024),
    usedMB: Math.round((total - free) / 1024 / 1024),
    percent: Math.round((1 - free / total) * 1000) / 10,
  };
}

function diskInfo() {
  return new Promise((resolve) => {
    exec("df -k / | awk 'NR==2{print $2,$3,$4,$5}'", (err, out) => {
      if (err) return resolve({ error: err.message });
      const [total, used, free, pct] = out.trim().split(/\s+/);
      resolve({
        totalGB: Math.round(total * 1024 / 1024 / 1024),
        usedGB: Math.round(used * 1024 / 1024 / 1024),
        freeGB: Math.round(free * 1024 / 1024 / 1024),
        percent: parseInt(pct) || 0,
      });
    });
  });
}

function netInfo() {
  const ifaces = os.networkInterfaces();
  let rx = 0, tx = 0;
  for (const name in ifaces) {
    for (const ni of ifaces[name]) {
      if (ni.family === 'IPv4' && !ni.internal) {
        // 粗略：仅统计存在流量计数（Linux /proc 更准，这里用 os 无法取，留接口）
      }
    }
  }
  // 用 /proc/net/dev 读取更可靠（Linux 服务器）
  return new Promise((resolve) => {
    exec("cat /proc/net/dev | awk 'NR>2{gsub(/:/,\":\")} NR>2{split($0,a,\":\"); rx+=a[2]; tx+=a[10]} END{print rx, tx}'",
      (err, out) => {
        if (err) return resolve({ error: err.message });
        const [rxBytes, txBytes] = out.trim().split(/\s+/).map(Number);
        let rate = { rxKBps: 0, txKBps: 0 };
        if (lastNet) {
          const dt = (Date.now() - lastNet.ts) / 1000;
          if (dt > 0) {
            rate = {
              rxKBps: Math.round((rxBytes - lastNet.rx) / 1024 / dt),
              txKBps: Math.round((txBytes - lastNet.tx) / 1024 / dt),
            };
          }
        }
        lastNet = { ts: Date.now(), rx: rxBytes || 0, tx: txBytes || 0 };
        resolve({ rxBytes: rxBytes || 0, txBytes: txBytes || 0, ...rate });
      });
  });
}

async function mysqlInfo() {
  try {
    await ping();
    const [vars] = await query("SHOW STATUS LIKE 'Threads_connected'");
    const [maxConn] = await query("SHOW VARIABLES LIKE 'max_connections'");
    return {
      ok: true,
      connections: vars ? parseInt(vars.Value) : 0,
      maxConnections: maxConn ? parseInt(maxConn.Value) : 0,
    };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

async function raiseAlert(metric, level, value, message) {
  const now = Date.now();
  if (alertCache[metric] && now - alertCache[metric] < 5 * 60 * 1000) return; // 5 分钟去重
  alertCache[metric] = now;
  try {
    await query(
      'INSERT INTO alerts (metric, level, value, message) VALUES (?, ?, ?, ?)',
      [metric, level, String(value), message]
    );
  } catch (e) { /* ignore */ }
}

async function collect() {
  const cpu = cpuPercent();
  const mem = memInfo();
  const disk = await diskInfo();
  const net = await netInfo();
  const mysql = await mysqlInfo();

  // 预警判断
  if (cpu > TH.cpu) await raiseAlert('cpu', 'warn', cpu, `CPU 使用率 ${cpu}% 超过阈值 ${TH.cpu}%`);
  if (mem.percent > TH.mem) await raiseAlert('mem', 'warn', mem.percent, `内存使用率 ${mem.percent}% 超过阈值 ${TH.mem}%`);
  if (disk.percent > TH.disk) await raiseAlert('disk', 'critical', disk.percent, `磁盘使用率 ${disk.percent}% 超过阈值 ${TH.disk}%`);
  if (mysql.ok && mysql.connections > TH.mysqlConns) {
    await raiseAlert('mysql', 'warn', mysql.connections, `MySQL 连接数 ${mysql.connections} 超过阈值 ${TH.mysqlConns}`);
  }

  return {
    ts: Date.now(),
    cpu: { percent: cpu, cores: os.cpus().length },
    mem,
    disk,
    net,
    mysql,
    loadavg: os.loadavg(),
    uptime: os.uptime(),
    thresholds: TH,
  };
}

module.exports = { collect, TH };
