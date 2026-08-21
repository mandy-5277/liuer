// 临时验证脚本：模拟真人匹配，等待机器人介入（最多 20s）
const WebSocket = require('/opt/liuer/server/node_modules/ws');
const openid = 'test_human_' + Date.now();
const ws = new WebSocket('ws://127.0.0.1:3000');
let matched = false;
ws.on('open', () => {
  ws.send(JSON.stringify({ cmd: 'login', data: { openid, nickName: '测试真人', avatarUrl: '' } }));
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.cmd === 'login_success') {
    console.log('[login ok] 发起 match_start');
    ws.send(JSON.stringify({ cmd: 'match_start', data: {} }));
  } else if (msg.cmd === 'match_status') {
    console.log('[match_status]', JSON.stringify(msg.data));
  } else if (msg.cmd === 'game_start') {
    matched = true;
    const bp = msg.data.blackPlayer, wp = msg.data.whitePlayer;
    console.log('[game_start] black isBot=', bp.isBot, 'white isBot=', wp.isBot);
    console.log('  black=', bp.nickName, ' white=', wp.nickName);
    ws.close();
    process.exit(0);
  } else if (msg.cmd === 'error') {
    console.log('[error]', JSON.stringify(msg.data));
  }
});
ws.on('error', (e) => { console.log('ws error:', e.message); process.exit(1); });
setTimeout(() => {
  if (!matched) { console.log('[timeout] 20s 内未匹配到机器人'); process.exit(1); }
}, 20000);
