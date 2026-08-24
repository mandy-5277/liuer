# 六儿 · 后台管理系统

独立于游戏服务端的 Web 管理控制台，复用同一台服务器的 MySQL（同库 `liuer`），监听 `ADMIN_PORT`（默认 8080），由 Nginx 反代 `/admin` 并配置 SSL。

## 功能
1. **用户统计**：总用户数 / 今日新增 / 今日日活；5 分钟粒度实时点；天粒度曲线（默认 7 天，支持至 2 个月）。
2. **用户管理**：按 ID / 昵称 / 注册时间段查询；默认展示最新活跃 100 人；字段含 ID、昵称、注册时间、头像、级别、场次、积分、胜率、看广告次数、分享次数、最后上线、黑名单；操作：赠送精力(+10/20/30)、加黑/解黑、清分。
3. **系统管理**：分权分域（管理员 role: super/admin/operator + domain）、密码强度策略、安全管理（管理员增删改、改密、操作日志）、重启游戏服务端、预警日志查询。
4. **性能监控**：CPU / 内存 / 磁盘 / MySQL 连接 / 带宽采集，超阈值写入 `alerts` 表并去重预警。
5. **安全**：登录 JWT（2h 有效期）、bcrypt 密码哈希、密码强度校验、登录限流、HTTPS 强制跳转、操作审计日志。

## 目录
```
admin/
  server.js            # 主入口（Express）
  package.json
  src/
    db.js              # MySQL 连接池（复用游戏服 .env）
    migrate.js         # 建表/加字段（幂等）
    auth.js            # 登录/JWT/密码强度/分权
    middleware.js      # 鉴权/权限/HTTPS/操作日志
    stats.js           # 用户统计
    users.js           # 用户管理
    system.js          # 系统管理
    monitor.js         # 性能监控
  public/              # 前端 SPA（登录/统计/用户/系统/性能）
```

## 部署
```bash
cd admin
npm install
node src/migrate.js        # 初始化表结构（幂等）
ADMIN_PORT=8080 node server.js
```

### 环境变量（可放 server/.env 或 admin 进程环境）
- `ADMIN_PORT` 监听端口（默认 8080）
- `ADMIN_JWT_SECRET` JWT 密钥（不设则随机，重启失效）
- `ADMIN_SEED_USER` / `ADMIN_SEED_PASSWORD` 首次自动创建的超级管理员（默认 admin / Liuer@2026Admin）
- `ADMIN_ALLOW_RESTART=1` 允许后台重启游戏服务
- `ADMIN_FORCE_HTTPS` 是否强制 http→https 跳转（默认开启）
- `ALERT_CPU` / `ALERT_MEM` / `ALERT_DISK` / `ALERT_MYSQL_CONNS` 预警阈值

### Nginx 反代示例
```nginx
location /admin/ {
  proxy_pass http://127.0.0.1:8080/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Real-IP $remote_addr;
}
```

## 注意
- 后台与游戏服务端操作同一 `users` 表；加黑 / 清分 / 赠送精力均为原子 UPDATE，不影响在线对局。
- 日活以 `lastLoginTime` 当天近似（users 表无独立登录事件表）。
- 分权分域中 `domain` 字段已预留，当前接口按 `role` 控制权限；如需按域隔离数据，可在查询中追加 `domain` 过滤。
