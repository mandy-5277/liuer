/* 六儿后台管理 — 前端逻辑 */
const $ = (s) => document.querySelector(s);
let TOKEN = localStorage.getItem('liuer_admin_token') || '';
let ADMIN = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { logout(); throw new Error('登录已过期'); }
  const data = await res.json().catch(() => ({}));
  return data;
}

function show(view) {
  $('#login-view').classList.toggle('hidden', view !== 'login');
  $('#main-view').classList.toggle('hidden', view !== 'main');
}

function logout() {
  TOKEN = ''; ADMIN = null;
  localStorage.removeItem('liuer_admin_token');
  show('login');
}

// ============ 登录 ============
$('#login-btn').onclick = async () => {
  $('#login-err').textContent = '';
  const username = $('#login-user').value.trim();
  const password = $('#login-pwd').value;
  if (!username || !password) { $('#login-err').textContent = '请输入账号和密码'; return; }
  const r = await api('/api/admin/login', { method: 'POST', body: { username, password } });
  if (!r.ok) { $('#login-err').textContent = r.errMsg || '登录失败'; return; }
  TOKEN = r.token; ADMIN = r.admin;
  localStorage.setItem('liuer_admin_token', TOKEN);
  enterMain();
};

// ============ 主界面 ============
async function enterMain() {
  show('main');
  $('#cur-admin').textContent = `${ADMIN.username}（${roleName(ADMIN.role)}）`;
  // 按权限隐藏系统管理 tab
  if (!hasPerm('system:all')) {
    document.querySelector('[data-tab="system"]').style.display = 'none';
  }
  loadStats();
  loadMonitor();
  if (hasPerm('system:all')) loadSystem();
}

function roleName(r) { return { super: '超级管理员', admin: '管理员', operator: '操作员' }[r] || r; }
// 简化权限判断（与服务端一致）
function hasPerm(p) {
  const map = {
    super: ['stats:view', 'user:view', 'user:edit', 'system:all', 'monitor:view'],
    admin: ['stats:view', 'user:view', 'user:edit', 'monitor:view'],
    operator: ['stats:view', 'user:view', 'monitor:view'],
  };
  const perms = map[ADMIN.role] || [];
  return perms.includes(p) || perms.includes('system:all');
}

$('#logout-btn').onclick = logout;

// tab 切换
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const tab = t.dataset.tab;
    ['stats', 'users', 'system', 'monitor'].forEach((k) =>
      $('#tab-' + k).classList.toggle('hidden', k !== tab));
    if (tab === 'stats') loadStats();
    if (tab === 'users') loadUsers();
    if (tab === 'monitor') loadMonitor();
  };
});

// ============ 统计 ============
async function loadStats() {
  const ov = await api('/api/stats/overview');
  if (ov.ok) {
    $('#st-total').textContent = ov.totalUsers;
    $('#st-new').textContent = ov.newUsersToday;
    $('#st-dau').textContent = ov.dauToday;
  }
  const days = parseInt($('#st-days').value, 10);
  const daily = await api('/api/stats/daily?days=' + days);
  drawChart(daily.series || []);
}
$('#st-days').onchange = loadStats;

// 简易折线图（Canvas 手绘，不依赖第三方库）
function drawChart(series) {
  const cv = $('#chart');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (!series.length) { ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.fillText('暂无数据', W/2-30, H/2); return; }
  const padL = 50, padB = 40, padT = 20, padR = 20;
  const maxV = Math.max(1, ...series.map((s) => s.totalUsers));
  const xStep = (W - padL - padR) / Math.max(1, series.length - 1);
  const yOf = (v) => H - padB - (v / maxV) * (H - padT - padB);
  // 坐标轴
  ctx.strokeStyle = '#ddd'; ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
  // 折线
  ctx.strokeStyle = '#8b6914'; ctx.lineWidth = 2; ctx.beginPath();
  series.forEach((s, i) => {
    const x = padL + i * xStep, y = yOf(s.totalUsers);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  // 点 + 标签
  ctx.fillStyle = '#8b6914'; ctx.font = '11px sans-serif';
  series.forEach((s, i) => {
    const x = padL + i * xStep, y = yOf(s.totalUsers);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#666';
    ctx.fillText(String(s.totalUsers), x - 10, y - 8);
    ctx.fillStyle = '#8b6914';
  });
  // X 轴日期
  ctx.fillStyle = '#999';
  series.forEach((s, i) => {
    if (i % Math.ceil(series.length / 7) === 0) {
      const x = padL + i * xStep;
      ctx.fillText(String(s.day).slice(5), x - 14, H - padB + 16);
    }
  });
  // 标题
  ctx.fillStyle = '#6b5847'; ctx.font = '13px sans-serif';
  ctx.fillText('总用户数（天粒度）', padL, padT - 5);
}

// ============ 用户管理 ============
async function loadUsers() {
  const kw = $('#u-keyword').value.trim();
  const start = $('#u-start').value;
  const end = $('#u-end').value;
  const black = $('#u-black').checked ? '1' : '';
  const q = new URLSearchParams({ keyword: kw, startTime: start, endTime: end, blacklist: black });
  const r = await api('/api/users?' + q.toString());
  if (!r.ok) return;
  const tbody = $('#u-table tbody');
  tbody.innerHTML = '';
  r.list.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${u.openid}">${shortId(u.openid)}</td>
      <td>${escapeHtml(u.nickName || '')}</td>
      <td>${fmtTime(u.createTime)}</td>
      <td>${u.rankName || '-'}</td>
      <td>${u.games}</td>
      <td>${u.rankScore}</td>
      <td>${u.winRate}%</td>
      <td>${u.totalAdCount}</td>
      <td>${u.totalShareCount}</td>
      <td>${fmtTime(u.lastLoginTime)}</td>
      <td>${u.isBlacklist ? '<span class="black-tag">是</span>' : '否'}</td>
      <td>
        <button class="mini-btn" data-act="grant" data-id="${u.openid}">赠送</button>
        <button class="mini-btn black" data-act="black" data-id="${u.openid}" data-on="${u.isBlacklist ? 0 : 1}">${u.isBlacklist ? '解黑' : '加黑'}</button>
        <button class="mini-btn clear" data-act="clear" data-id="${u.openid}">清分</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('#u-total').textContent = `共 ${r.total} 人`;
}

$('#u-search').onclick = loadUsers;
$('#u-table').onclick = async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'grant') {
    openGrant(id);
  } else if (act === 'black') {
    const on = btn.dataset.on === '1';
    const r = await api('/api/users/blacklist', { method: 'POST', body: { openid: id, on } });
    toast(r.ok ? (on ? '已加黑' : '已解黑') : (r.errMsg || '失败'));
    loadUsers();
  } else if (act === 'clear') {
    if (!confirm('确认清空该用户积分/段位/场次？')) return;
    const r = await api('/api/users/clear-score', { method: 'POST', body: { openid: id } });
    toast(r.ok ? '已清分' : (r.errMsg || '失败'));
    loadUsers();
  }
};

function openGrant(openid) {
  showModal(`
    <h3>赠送精力 — ${shortId(openid)}</h3>
    <button class="primary" data-amt="10">+10</button>
    <button class="primary" data-amt="20">+20</button>
    <button class="primary" data-amt="30">+30</button>
  `);
  $('#modal-body').querySelectorAll('button[data-amt]').forEach((b) => {
    b.onclick = async () => {
      const r = await api('/api/users/grant', { method: 'POST', body: { openid, amount: parseInt(b.dataset.amt, 10) } });
      toast(r.ok ? `赠送成功，当前精力 ${r.energy}` : (r.errMsg || '失败'));
      hideModal(); loadUsers();
    };
  });
}

// ============ 系统管理 ============
async function loadSystem() {
  const admins = await api('/api/system/admins');
  const box = $('#sys-admins');
  if (admins.ok) {
    box.innerHTML = '<table><thead><tr><th>账号</th><th>角色</th><th>域</th><th>状态</th><th>操作</th></tr></thead><tbody>'
      + admins.list.map((a) => `<tr>
        <td>${a.username}</td><td>${roleName(a.role)}</td><td>${a.domain}</td>
        <td>${a.status ? '启用' : '禁用'}</td>
        <td><button class="mini-btn" data-toggle="${a.id}" data-st="${a.status ? 0 : 1}">${a.status ? '禁用' : '启用'}</button></td>
      </tr>`).join('') + '</tbody></table>';
    box.querySelectorAll('button[data-toggle]').forEach((b) => {
      b.onclick = async () => {
        await api('/api/system/admins/' + b.dataset.toggle, { method: 'PUT', body: { status: parseInt(b.dataset.st, 10) } });
        loadSystem();
      };
    });
  }
  $('#sys-add-admin').onclick = () => {
    showModal(`
      <h3>新增管理员</h3>
      <input id="na-user" placeholder="账号(3-32位)" />
      <input id="na-pwd" type="password" placeholder="密码(强密码)" />
      <select id="na-role"><option value="operator">操作员</option><option value="admin">管理员</option><option value="super">超级管理员</option></select>
      <input id="na-domain" placeholder="分域(默认 *)" value="*" />
      <button class="primary" id="na-submit">创建</button>
    `);
    $('#na-submit').onclick = async () => {
      const r = await api('/api/system/admins', { method: 'POST', body: {
        username: $('#na-user').value, password: $('#na-pwd').value,
        role: $('#na-role').value, domain: $('#na-domain').value } });
      toast(r.ok ? '创建成功' : (r.errMsg || '失败'));
      if (r.ok) { hideModal(); loadSystem(); }
    };
  };
  $('#sys-restart').onclick = async () => {
    if (!confirm('确认重启游戏服务端？将中断当前对局。')) return;
    const r = await api('/api/system/restart', { method: 'POST' });
    toast(r.ok ? '已发送重启指令' : (r.errMsg || '失败'));
  };
  const log = await api('/api/system/op-log?limit=50');
  $('#sys-oplog').innerHTML = (log.list || []).map((l) =>
    `<div>[${fmtTime(l.createTime)}] ${l.adminUser} ${l.action} ${l.target} ${l.detail || ''}</div>`).join('');
  const alerts = await api('/api/system/alerts?limit=50');
  $('#sys-alerts').innerHTML = (alerts.list || []).map((a) =>
    `<div>[${fmtTime(a.createTime)}] <b>${a.level}</b> ${a.metric}: ${a.message}</div>`).join('');
}

// ============ 性能监控 ============
async function loadMonitor() {
  const m = await api('/api/monitor');
  if (!m.ok) return;
  const cards = [
    ['CPU', m.cpu.percent + '%', m.cpu.percent > m.thresholds.cpu],
    ['内存', m.mem.percent + '%', m.mem.percent > m.thresholds.mem],
    ['磁盘', m.disk.percent + '%', m.disk.percent > m.thresholds.disk],
    ['MySQL连接', (m.mysql.connections || 0) + '/' + (m.mysql.maxConnections || 0), false],
    ['带宽↓', (m.net.rxKBps || 0) + ' KB/s', false],
    ['带宽↑', (m.net.txKBps || 0) + ' KB/s', false],
  ];
  $('#mon-cards').innerHTML = cards.map(([l, v, warn]) =>
    `<div class="card" style="${warn ? 'border:2px solid #c0392b' : ''}"><div class="num" style="${warn ? 'color:#c0392b' : ''}">${v}</div><div class="lbl">${l}</div></div>`).join('');
  const alerts = await api('/api/system/alerts?limit=30&unresolved=1');
  $('#mon-alerts').innerHTML = (alerts.list || []).length
    ? alerts.list.map((a) => `<div>[${fmtTime(a.createTime)}] <b>${a.level}</b> ${a.metric}: ${a.message}</div>`).join('')
    : '<div>无未处理预警</div>';
}

// 每 30s 刷新统计与监控
setInterval(() => {
  if ($('#main-view').classList.contains('hidden')) return;
  if (!$('#tab-stats').classList.contains('hidden')) loadStats();
  if (!$('#tab-monitor').classList.contains('hidden')) loadMonitor();
}, 30000);

// ============ 工具 ============
function showModal(html) { $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); }
function hideModal() { $('#modal').classList.add('hidden'); }
$('#modal-close').onclick = hideModal;
let toastTimer;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 18px;border-radius:8px;z-index:99;font-size:14px;';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.display = 'none'), 2000);
  el.style.display = 'block';
}
function shortId(s) { return s ? s.slice(0, 10) + (s.length > 10 ? '…' : '') : '-'; }
function fmtTime(t) { if (!t) return '-'; const d = new Date(t); return d.toLocaleString('zh-CN', { hour12: false }); }
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 启动
if (TOKEN) {
  api('/api/admin/me').then((r) => {
    if (r.ok) { ADMIN = r.admin; enterMain(); } else { show('login'); }
  }).catch(() => show('login'));
} else {
  show('login');
}
