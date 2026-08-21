// 临时验证脚本：测试登录返回 dailyAdCount / dailyShareCount 及默认积分
const WebSocket = require('/opt/liuer/server/node_modules/ws');
const openid = process.argv[2] || 'o0oDP5Dq1BREaH3CeUtfQfGVz3ts';
const ws = new WebSocket('ws://127.0.0.1:3000');
ws.on('open', () => {
  ws.send(JSON.stringify({ cmd: 'login', data: { openid, nickName: '测试', avatarUrl: '' } }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.cmd === 'login_success') {
    console.log('login_success keys:', Object.keys(msg.data).join(','));
    console.log('rankScore:', msg.data.rankScore);
    console.log('dailyAdCount:', msg.data.dailyAdCount);
    console.log('dailyShareCount:', msg.data.dailyShareCount);
    console.log('energy:', msg.data.energy);
    ws.close();
    process.exit(0);
  } else if (msg.cmd === 'error') {
    console.log('error:', JSON.stringify(msg.data));
    ws.close();
    process.exit(1);
  }
});
ws.on('error', (e) => { console.log('ws error:', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(1); }, 8000);
