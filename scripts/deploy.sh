#!/usr/bin/env bash
# ============================================================
#  六儿服务端 一键部署脚本（自建服务器）
#  功能：rsync 代码到服务器 + 安装依赖 + pm2 重启
#  用法：bash scripts/deploy.sh
#  前置：配置下方 DEPLOY_* 变量（或用环境变量覆盖）
# ============================================================
set -e

# ---------- 部署目标配置（按需修改） ----------
DEPLOY_HOST="${DEPLOY_HOST:-root@47.93.96.20}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/liuer/server}"
DEPLOY_KEY="${DEPLOY_KEY:-}"   # 可选：ssh 私钥路径，如 ~/.ssh/id_rsa

# ---------- 本地路径（脚本位于 scripts/，上级为项目根） ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$PROJECT_ROOT/server"

echo "============================================"
echo "  六儿服务端部署"
echo "  目标: $DEPLOY_HOST:$DEPLOY_PORT"
echo "  路径: $DEPLOY_PATH"
echo "============================================"

# 检查是否配置
if [[ "$DEPLOY_HOST" == root@your-server-ip ]]; then
  echo "[错误] 请先编辑 scripts/deploy.sh 配置 DEPLOY_HOST"
  echo "        或在部署时传入环境变量：DEPLOY_HOST=user@1.2.3.4 bash scripts/deploy.sh"
  exit 1
fi

# 组装 ssh / scp 选项
# 注意：ssh 用 -p（小写），scp 用 -P（大写），两者不同！
SSH_OPTS="-p $DEPLOY_PORT"
SCP_OPTS="-P $DEPLOY_PORT"
RSYNC_OPTS="--exclude node_modules --exclude logs --exclude .env --exclude '*.log' -avz --delete"
if [[ -n "$DEPLOY_KEY" ]]; then
  SSH_OPTS="$SSH_OPTS -i $DEPLOY_KEY"
  RSYNC_OPTS="$RSYNC_OPTS -e \"ssh -p $DEPLOY_PORT -i $DEPLOY_KEY\""
else
  RSYNC_OPTS="$RSYNC_OPTS -e \"ssh -p $DEPLOY_PORT\""
fi

# ---------- 1. 同步代码（排除 node_modules / .env / logs） ----------
echo "[1/4] 同步代码到服务器..."
# 兼容无 rsync 环境（Git Bash 精简版），优先 rsync，缺失则回退 scp
if command -v rsync >/dev/null 2>&1; then
  rsync $RSYNC_OPTS "$SERVER_DIR/" "$DEPLOY_HOST:$DEPLOY_PATH/"
else
  echo "  [提示] 未检测到 rsync，使用 scp 同步（会整体复制，已排除 node_modules/.env）"
  # scp 不支持 --exclude，先本地打包排除项，再解压到服务器
  STAGE_DIR="$(mktemp -d)"
  tar --exclude='node_modules' --exclude='.env' --exclude='logs' --exclude='*.log' \
      -C "$SERVER_DIR" -cf "$STAGE_DIR/liuer.tar" .
  ssh $SSH_OPTS "$DEPLOY_HOST" "mkdir -p $DEPLOY_PATH && rm -rf $DEPLOY_PATH/*"
  scp $SCP_OPTS "$STAGE_DIR/liuer.tar" "$DEPLOY_HOST:$DEPLOY_PATH/liuer.tar"
  ssh $SSH_OPTS "$DEPLOY_HOST" "cd $DEPLOY_PATH && tar -xf liuer.tar && rm -f liuer.tar"
  rm -rf "$STAGE_DIR"
fi

# ---------- 2. 服务器：安装依赖 ----------
echo "[2/4] 安装依赖..."
ssh $SSH_OPTS "$DEPLOY_HOST" <<EOF
  set -e
  cd $DEPLOY_PATH
  # 若没有 .env 则复制示例（首次部署需要你手动填值）
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "[提示] 已生成 .env，请编辑填入 MYSQL_PASSWORD / WX_APPSECRET 后重新部署"
  fi
  npm install --production
EOF

# ---------- 3. 服务器：pm2 重启 ----------
echo "[3/4] pm2 重启服务..."
ssh $SSH_OPTS "$DEPLOY_HOST" <<EOF
  set -e
  cd $DEPLOY_PATH
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js
    pm2 save
    echo "[OK] pm2 已重启"
  else
    echo "[警告] 未检测到 pm2，请先安装：npm install -g pm2"
    echo "        手动启动：cd $DEPLOY_PATH && node src/index.js"
  fi
EOF

# ---------- 4. 健康检查 ----------
echo "[4/4] 健康检查..."
sleep 2
ssh $SSH_OPTS "$DEPLOY_HOST" "curl -s http://127.0.0.1:3000/health || echo '[警告] 健康检查失败，请登录服务器查看日志'"

echo "============================================"
echo "  部署完成！"
echo "  客户端 SERVER_URL 改为: http://你的域名或IP:3000"
echo "============================================"
