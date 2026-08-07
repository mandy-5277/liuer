# 六儿 服务端

实时双人对战棋类游戏后端服务，基于 Node.js (Express + WebSocket)，数据持久化使用 **MySQL + Redis**（自建服务器部署，不依赖 CloudBase）。

## 客户端接入方式

**不依赖 `wx.cloud` SDK** —— 客户端通过以下两个接口即可完成认证和通信：

| 接口 | 类型 | 地址 | 说明 |
|------|------|------|------|
| 微信登录 | HTTP POST | `https://你的域名或IP:3000/api/auth/wx-login` | `{ code }` → `{ openid }` |
| 游戏通信 | WebSocket | `wss://你的域名或IP:3000` | 双工实时消息 |

**登录流程**：`wx.login()` → 发 code 到 `/api/auth/wx-login` → 拿到 openid → WebSocket 登录

## 环境要求

- Node.js 16+
- MySQL 5.7+ / 8.0
- Redis 5+
- 已备案域名（微信小程序要求 HTTPS + WSS）

## 快速开始（本地开发）

```bash
cd server
npm install
cp .env.example .env   # 编辑 .env 填入 MySQL 密码、WX_APPSECRET
npm run dev            # 开发模式（--watch 自动重启）
# 或
npm start              # 生产模式
```

服务启动时会自动建表（users / games / transactions / rooms），无需手动导入 SQL。

## 目录结构

```
server/
├── package.json
├── .env.example           # 环境变量示例
├── .env                   # 环境配置（不提交）
├── ecosystem.config.js    # pm2 配置
├── src/
│   ├── index.js           # 主入口（Express + WebSocket + 数据库初始化）
│   ├── config/index.js    # 全局配置（端口 / MySQL / Redis / 微信）
│   ├── db/
│   │   ├── mysql.js       # MySQL 连接池 + 建表
│   │   └── redis.js       # Redis 客户端
│   ├── game/
│   │   ├── constants.js   # 游戏常量（阶段、颜色、结果）
│   │   ├── board.js       # 五大核心棋盘算法
│   │   └── engine.js      # 四阶段游戏引擎（状态机）
│   ├── services/
│   │   ├── data.js        # 数据服务（MySQL + Redis 实现）
│   │   └── session.js     # 会话管理（匹配/房间/对局）
│   └── ws/
│       └── handler.js     # WebSocket 消息路由
└── ../scripts/deploy.sh   # 一键部署脚本
```

## 数据存储说明

| 存储 | 用途 |
|------|------|
| **MySQL** | 持久化：用户资料、对局记录、铜板/能量交易、房间元数据 |
| **Redis** | 内存态：匹配队列、房间状态、对局状态、掉线缓存（带 TTL 自动过期） |

> 注意：对局进行中的实时状态存于 Redis，仅在结算时落 MySQL。运维 Redis 时请注意不要误清关键 key（前缀 `liuer:`）。

## 核心模块

### 游戏引擎 (`src/game/engine.js`)

四阶段状态机，管理单局游戏完整生命周期：

```
PLACING(1) → CAPTURING(2) → MOVING(3) → SETTLED(4)
```

- **阶段1 下子**：白棋先手，交替下子，填满36个交叉点
- **阶段2 揪子**：下子反向先手，消耗揪子次数移除对方非成型棋子
- **阶段3 走子**：四向移动，走子后动态检测构型 → 联动揪子
- **阶段4 结算**：胜负判定，积分变动，铜板奖励

### 棋盘算法 (`src/game/board.js`)

1. `calcCatchNum` — 全局扫描方块(2×2)和六连，计算揪子次数
2. `getAllFormed` — 返回所有成型棋子坐标集
3. `checkNewForm` — 对比移动前后，计算新增构型
4. `hasAvailableMove` — 判断是否有可移动棋子
5. `getStoneCount` — 统计棋子数量

### WebSocket 协议

详见 ../PRD.md 第四节，所有消息格式：

```json
{
  "cmd": "指令名",
  "data": {},
  "seq": 序列号
}
```

## 部署到自建服务器

### 方式一：一键部署脚本（推荐）

```bash
# 配置服务器信息（可编辑 scripts/deploy.sh 或传环境变量）
export DEPLOY_HOST="user@你的服务器IP"
export DEPLOY_PORT="22"
export DEPLOY_KEY="~/.ssh/id_rsa"   # 可选

# 执行部署（自动 rsync 代码 + npm install + pm2 重启）
bash scripts/deploy.sh
```

首次部署会在服务器生成 `.env`，需登录服务器填入 `MYSQL_PASSWORD` 和 `WX_APPSECRET`，再次运行脚本即可。

### 方式二：手动部署 + PM2

```bash
# 在服务器上
cd /opt/liuer/server
npm install --production
cp .env.example .env && vim .env   # 填入配置
npm install -g pm2

# 启动 / 重启
pm2 start ecosystem.config.js
pm2 save
pm2 logs liuer-server
```

### 方式三：Nginx 反向代理（可选，推荐）

若想用标准 443 端口 + 域名证书：

```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

配置后客户端 `SERVER_URL` 改为 `https://your.domain.com`，WebSocket 用 `wss://your.domain.com`。

## 客户端对接

客户端通过 WebSocket 连接服务端，参见 `../client/miniprogram/utils/websocket.js`。

`websocket.js` 中的 `SERVER_URL`（已适配自建服务器）：
- 生产环境：`https://你的域名或IP:3000`（或 nginx 反代后的域名）
- 开发环境：`ws://localhost:3000`

## 微信登录配置

生产环境需要配置微信小程序的 AppSecret：

1. 访问 [微信公众平台](https://mp.weixin.qq.com) → 开发管理 → 开发设置
2. 生成/查看 AppSecret（需管理员扫码）
3. 将值填入 `.env` 文件的 `WX_APPSECRET=`
4. 重新部署（`bash scripts/deploy.sh`）
