#!/usr/bin/env bash
cd /opt/liuer/admin
curl -s -X POST http://127.0.0.1:8080/api/admin/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"Liuer@2026Admin"}' -o /tmp/login.json
node -e "const r=require('/tmp/login.json');require('fs').writeFileSync('/tmp/token.txt', r.token||'')"
T=$(cat /tmp/token.txt)
H="Authorization: Bearer $T"
echo "=== 手动触发一次性能落库(通过 monitor 接口) ==="
curl -s http://127.0.0.1:8080/api/monitor -H "$H" > /dev/null
echo "=== monitor/history?hours=24 ==="
curl -s "http://127.0.0.1:8080/api/monitor/history?hours=24" -H "$H"
echo
echo "=== 选一个普通用户测清分(仅清 rankScore) ==="
U=$(node -e "const {query}=require('/opt/liuer/admin/src/db');query(\"SELECT openid,rankScore,winCount,loseCount,rankName FROM users WHERE openid NOT LIKE 'bot_%' LIMIT 1\").then(r=>{console.log(r[0].openid)})")
echo "user=$U"
echo "--- 清分前 ---"
node -e "const {query}=require('/opt/liuer/admin/src/db');query(\"SELECT rankScore,winCount,loseCount,rankName FROM users WHERE openid='$U'\").then(r=>console.log(JSON.stringify(r[0])))"
curl -s -X POST http://127.0.0.1:8080/api/users/clear-score -H "$H" -H 'Content-Type: application/json' -d "{\"openid\":\"$U\"}"
echo
echo "--- 清分后 ---"
node -e "const {query}=require('/opt/liuer/admin/src/db');query(\"SELECT rankScore,winCount,loseCount,rankName FROM users WHERE openid='$U'\").then(r=>console.log(JSON.stringify(r[0])))"
