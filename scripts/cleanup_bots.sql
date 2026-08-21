-- ============================================================
-- 清理机器人陪练账号（openid 以 bot_ 开头）
-- 仅删除现有机器人数据，保留陪练功能：
--   删除后，真人匹配等待超过 robot.matchDelay(默认15s) 无对手时，
--   服务端会自动重新创建机器人（spawnRobot → createBotUser）。
--
-- 执行方式（在服务器 MySQL 中执行）：
--   mysql -u liuer -p liuer < scripts/cleanup_bots.sql
-- 或进入 mysql 客户端后逐条执行。
-- ============================================================

-- 1) 删除机器人参与的对局记录（games.blackOpenid / whiteOpenid 以 bot_ 开头）
DELETE g FROM games g
WHERE g.blackOpenid LIKE 'bot\_%' OR g.whiteOpenid LIKE 'bot\_%';

-- 2) 删除机器人的交易记录（transactions.openid 以 bot_ 开头，若有）
DELETE t FROM transactions t
WHERE t.openid LIKE 'bot\_%';

-- 3) 删除机器人账号本身（users.openid 以 bot_ 开头）
DELETE FROM users WHERE openid LIKE 'bot\_%';

-- 4) 可选：确认删除数量
SELECT ROW_COUNT() AS deleted_bots;
