/**
 * 后台管理系统 — 主入口
 * 独立 Express 服务，监听 ADMIN_PORT（默认 8080）。
 * 由前端 Nginx（liuer.xin）反代 /admin 路径并配置 SSL。
 *
 * 路由：
 *  POST /api/admin/login            管理员登录
 *  GET  /api/admin/me               当前管理员信息
 *  POST /api/admin/change-pwd       修改密码
 *  GET  /api/stats/overview         总/新增/日活
 *  GET  /api/stats/realtime         5分钟粒度实时点
 *  GET  /api/stats/daily?days=7     天粒度曲线
 *  GET  /api/users                  用户查询
 *  GET  /api/users/:openid          单用户
 *  POST /api/users/grant            赠送精力
 *  POST /api/users/blacklist        加黑/解黑
 *  POST /api/users/clear-score      清分
 *  GET  /api/system/admins          管理员列表
 *  POST /api/system/admins          新增管理员
 *  PUT  /api/system/admins/:id      改管理员
 *  POST /api/system/restart         重启游戏服务
 *  GET  /api/system/op-log          操作日志
 *  GET  /api/system/alerts          预警日志
 *  GET  /api/monitor                性能监控快照
 */
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { query, ping } = require('./src/db');
const auth = require('./src/auth');
const { requireAuth, requirePerm, enforceHttps, opLog } = require('./src/middleware');
const stats = require('./src/stats');
const users = require('./src/users');
const system = require('./src/system');
const monitor = require('./src/monitor');
const { migrate } = require('./src/migrate');

const PORT = parseInt(process.env.ADMIN_PORT, 10) || 8080;
const app = express();
// 信任 Nginx 反代转发的 X-Forwarded-* 头（express-rate-limit 需要）
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// 登录接口限流（防爆破）
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, errMsg: '登录尝试过于频繁，请稍后再试' },
});

// 静态前端
const PUBLIC = path.join(__dirname, 'public');
app.use(enforceHttps);
app.use(express.static(PUBLIC, { maxAge: '10m' }));

// 健康检查
app.get('/api/health', async (req, res) => {
  try { await ping(); res.json({ ok: true, uptime: process.uptime() }); }
  catch (e) { res.status(500).json({ ok: false, errMsg: e.message }); }
});

// ============ 认证 ============
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, errMsg: '账号和密码必填' });
  const admin = await auth.findAdmin(username);
  if (!admin || !(await auth.verifyPassword(password, admin.passwordHash))) {
    return res.status(401).json({ ok: false, errMsg: '账号或密码错误' });
  }
  if (admin.status === 0) return res.status(403).json({ ok: false, errMsg: '账号已被禁用' });
  await query('UPDATE admin_users SET lastLoginTime = NOW() WHERE id = ?', [admin.id]);
  const token = auth.signToken(admin);
  res.json({ ok: true, token, admin: { username: admin.username, role: admin.role, domain: admin.domain } });
});

app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({ ok: true, admin: { username: req.admin.username, role: req.admin.role, domain: req.admin.domain } });
});

app.post('/api/admin/change-pwd', requireAuth, async (req, res) => {
  const { oldPwd, newPwd } = req.body || {};
  const r = await system.changePassword({ username: req.admin.username, oldPwd, newPwd, operator: req.admin.username });
  if (!r.ok) return res.status(400).json(r);
  res.json({ ok: true });
});

// ============ 统计 ============
app.get('/api/stats/overview', requireAuth, requirePerm('stats:view'), async (req, res) => {
  const ov = await stats.getOverview();
  res.json({ ok: true, ...ov });
});

app.get('/api/stats/realtime', requireAuth, requirePerm('stats:view'), (req, res) => {
  res.json({ ok: true, points: stats.getRealtime5min() });
});

app.get('/api/stats/daily', requireAuth, requirePerm('stats:view'), async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 7, 60); // 最多 2 个月
  const series = await stats.getDailySeries(days);
  res.json({ ok: true, days, series });
});

// ============ 用户管理 ============
app.get('/api/users', requireAuth, requirePerm('user:view'), async (req, res) => {
  const { keyword, startTime, endTime, blacklist, limit, offset } = req.query;
  const r = await users.listUsers({
    keyword, startTime, endTime,
    blacklistOnly: blacklist === '1',
    limit: parseInt(limit, 10) || 100,
    offset: parseInt(offset, 10) || 0,
  });
  res.json({ ok: true, ...r });
});

app.get('/api/users/:openid', requireAuth, requirePerm('user:view'), async (req, res) => {
  const u = await users.getUser(req.params.openid);
  if (!u) return res.status(404).json({ ok: false, errMsg: '用户不存在' });
  res.json({ ok: true, user: u });
});

app.post('/api/users/grant', requireAuth, requirePerm('user:edit'), async (req, res) => {
  const { openid, amount } = req.body || {};
  const r = await users.grantEnergy(openid, amount);
  if (!r.ok) return res.status(400).json(r);
  await opLog(req.admin.username, 'user_grant', openid, `+${(amount)} 精力 -> ${r.energy}`);
  res.json({ ok: true, energy: r.energy });
});

app.post('/api/users/blacklist', requireAuth, requirePerm('user:edit'), async (req, res) => {
  const { openid, on } = req.body || {};
  const r = await users.setBlacklist(openid, !!on);
  await opLog(req.admin.username, 'user_blacklist', openid, on ? '加黑' : '解黑');
  res.json(r);
});

app.post('/api/users/clear-score', requireAuth, requirePerm('user:edit'), async (req, res) => {
  const { openid } = req.body || {};
  const r = await users.clearScore(openid);
  await opLog(req.admin.username, 'user_clearscore', openid, '清分');
  res.json(r);
});

// ============ 系统管理 ============
app.get('/api/system/admins', requireAuth, requirePerm('system:all'), async (req, res) => {
  res.json({ ok: true, list: await system.listAdmins() });
});

app.post('/api/system/admins', requireAuth, requirePerm('system:all'), async (req, res) => {
  const r = await system.addAdmin({ ...req.body, operator: req.admin.username });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

app.put('/api/system/admins/:id', requireAuth, requirePerm('system:all'), async (req, res) => {
  const r = await system.updateAdmin({ id: req.params.id, ...req.body, operator: req.admin.username });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/system/restart', requireAuth, requirePerm('system:all'), async (req, res) => {
  const r = await system.restartGameServer();
  await opLog(req.admin.username, 'system_restart', 'liuer-server', r.msg || 'ok');
  res.json(r);
});

app.get('/api/system/op-log', requireAuth, requirePerm('system:all'), async (req, res) => {
  res.json({ ok: true, list: await system.getOpLog(parseInt(req.query.limit, 10) || 100) });
});

app.get('/api/system/alerts', requireAuth, requirePerm('stats:view'), async (req, res) => {
  res.json({ ok: true, list: await system.getAlerts(parseInt(req.query.limit, 10) || 100, req.query.unresolved === '1') });
});

// ============ 性能监控 ============
app.get('/api/monitor', requireAuth, requirePerm('monitor:view'), async (req, res) => {
  const m = await monitor.collect();
  res.json({ ok: true, ...m });
});

// 性能历史曲线（默认 24h，?hours= 可指定 1~720）
app.get('/api/monitor/history', requireAuth, requirePerm('monitor:view'), async (req, res) => {
  const r = await monitor.getHistory(req.query.hours);
  res.json({ ok: true, ...r });
});

// SPA 兜底（前端路由刷新）
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, errMsg: '接口不存在' });
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

// ============ 定时任务 ============
let snapshotTimer = null;
async function startTimers() {
  // 每 5 分钟落库统计快照 + 实时点
  const tick = async () => {
    try { await stats.snapshot(); await stats.pushRealtimePoint(); }
    catch (e) { console.error('[Timer] 统计采集失败:', e.message); }
    try { await monitor.recordHistory(); }
    catch (e) { console.error('[Timer] 性能采集失败:', e.message); }
  };
  await tick();
  snapshotTimer = setInterval(tick, 5 * 60 * 1000);
}

async function start() {
  try { await ping(); console.log('[Admin] MySQL 连接正常'); }
  catch (e) { console.error('[Admin] MySQL 连接失败:', e.message); process.exit(1); }

  await migrate().catch((e) => console.error('[Admin] 迁移失败:', e.message));
  await auth.ensureSeedAdmin().catch((e) => console.error('[Admin] 种子管理员初始化失败:', e.message));
  await startTimers();

  app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('  六儿 后台管理系统 v1.0');
    console.log(`  监听: http://0.0.0.0:${PORT}`);
    console.log(`  HTTPS: 由 Nginx 反代 (liuer.xin) 提供`);
    console.log('='.repeat(50));
  });
}

start();

module.exports = app;
