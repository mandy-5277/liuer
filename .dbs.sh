#!/usr/bin/env bash
cd /opt/liuer
source .env 2>/dev/null
DB=${DB_NAME:-liuer}
USER=${DB_USER:-root}
PASS=${DB_PASS:-}
echo "DB=$DB USER=$USER"
mysql -u"$USER" -p"$PASS" "$DB" -e "DESCRIBE users;" 2>&1 | head -40
echo "=== 相关字段抽样 ==="
mysql -u"$USER" -p"$PASS" "$DB" -e "SELECT openid, energy, rankScore, rankName, lastLoginTime, createTime, isBlacklist, totalAdCount, totalShareCount, games, winRate FROM users LIMIT 3;" 2>&1 | head -10
