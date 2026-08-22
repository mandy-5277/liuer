#!/usr/bin/env bash
# ============================================================
#  六儿服务端 一键部署脚本（自建服务器）
#  功能：把本地 server/ 同步到服务器 + 安装依赖 + 重启服务
#  用法：
#    bash scripts/deploy.sh                # 默认部署并重启
#    bash scripts/deploy.sh --no-restart   # 只同步代码，不重启（你自己手动起）
#    DEPLOY_HOST=user@1.2.3.4 bash scripts/deploy.sh
#  前置：
#    - 能 ssh 到服务器（脚本会走 ssh，需要你本机已配置好密钥或能交互输密码）
#    - 服务器上已存在 .env（首次需手动 scp 一次，脚本不会删除它）
# ============================================================
set -e

# ---------- 部署目标配置（可用环境变量覆盖） ----------
DEPLOY_HOST="${DEPLOY_HOST:-root@47.93.96.20}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/liuer/server}"
DEPLOY_KEY="${DEPLOY_KEY:-}"   # 可选：ssh 私钥路径，如 ~/.ssh/id_rsa
RESTART="${RESTART:-1}"        # 传 --no-restart 时置 0

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART=0 ;;
    --help|-h) echo "用法: bash scripts/deploy.sh [--no-restart]"; exit 0 ;;
  esac
done

# ---------- 本地路径（scripts/ 上级为项目根） ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$PROJECT_ROOT/server"

echo "============================================"
echo "  六儿服务端部署"
echo "  目标: $DEPLOY_HOST:$DEPLOY_PORT"
echo "  路径: $DEPLOY_PATH"
echo "  重启: $([ "$RESTART" = "1" ] && echo '是' || echo '否')"
echo "============================================"

# ---------- 组装 ssh / scp 选项 ----------
SSH_OPTS="-p $DEPLOY_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=10"
SCP_OPTS="-P $DEPLOY_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=20"
if [[ -n "$DEPLOY_KEY" ]]; then
  SSH_OPTS="$SSH_OPTS -i $DEPLOY_KEY"
  SCP_OPTS="$SCP_OPTS -i $DEPLOY_KEY"
fi

# ---------- 0. 连通性检查 ----------
echo "[0/4] 检查服务器连通性..."
if ! ssh $SSH_OPTS "$DEPLOY_HOST" "echo OK" >/dev/null 2>&1; then
  echo "[错误] 无法 SSH 到 $DEPLOY_HOST，请检查网络/密钥/密码。"
  exit 1
fi

# ---------- 1. 同步代码（保留 .env / node_modules / logs） ----------
echo "[1/4] 同步代码到服务器..."
STAGE_DIR="$(mktemp -d)"
# 打包并排除不需要上传的目录/文件，避免覆盖服务器上的 .env 与已装依赖
tar --exclude='node_modules' --exclude='.env' --exclude='logs' \
    --exclude='*.log' --exclude='.git' \
    -C "$SERVER_DIR" -cf "$STAGE_DIR/liuer.tar" .
# 上传到临时位置，再解压覆盖到目标目录（不清空整个目录，保护 .env）
ssh $SSH_OPTS "$DEPLOY_HOST" "mkdir -p $DEPLOY_PATH/.deploy_stage"
scp $SCP_OPTS "$STAGE_DIR/liuer.tar" "$DEPLOY_HOST:$DEPLOY_PATH/.deploy_stage/liuer.tar"
ssh $SSH_OPTS "$DEPLOY_HOST" <<EOF
  set -e
  cd $DEPLOY_PATH
  tar -xf .deploy_stage/liuer.tar
  rm -rf .deploy_stage
  echo "[OK] 代码已覆盖"
EOF
rm -rf "$STAGE_DIR"

# ---------- 2. 安装依赖 ----------
echo "[2/4] 安装生产依赖..."
ssh $SSH_OPTS "$DEPLOY_HOST" <<EOF
  set -e
  cd $DEPLOY_PATH
  if [ ! -f .env ]; then
    echo "[警告] 服务器上缺少 .env，服务可能无法启动。请先 scp 一份 .env 到 $DEPLOY_PATH/"
  fi
  npm install --production --no-audit --no-fund
EOF

# ---------- 3. 重启服务 ----------
if [[ "$RESTART" = "1" ]]; then
  echo "[3/4] 重启服务..."
  ssh $SSH_OPTS "$DEPLOY_HOST" <<'EOF'
    set -e
    cd /opt/liuer/server
    # 先杀掉所有遗留的旧 node 进程，避免重复进程占用端口
    pkill -f "node src/index.js" || true
    sleep 1
    if command -v pm2 >/dev/null 2>&1; then
      pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js
      pm2 save
      echo "[OK] pm2 已重启"
    else
      echo "[提示] 未检测到 pm2，使用 nohup 单实例启动"
      nohup node src/index.js > logs/out.log 2>&1 &
      echo "[OK] node 已启动 (nohup)"
    fi
EOF
else
  echo "[3/4] 跳过重启（--no-restart）"
fi

# ---------- 4. 健康检查 ----------
echo "[4/4] 健康检查..."
sleep 2
ssh $SSH_OPTS "$DEPLOY_HOST" "curl -s http://127.0.0.1:3000/health || echo '[警告] 健康检查失败，请登录服务器查看 logs/out.log'"

echo "============================================"
echo "  部署完成！"
echo "============================================"
