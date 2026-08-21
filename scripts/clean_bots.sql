-- 清除机器人（虚拟用户）缓存信息
DELETE FROM users WHERE openid LIKE 'bot_%';

-- 清空对局记录（排行榜数据来源）
DELETE FROM games;

-- 重置所有真人用户战绩统计与积分，让排行榜从零开始
UPDATE users SET winCount = 0, loseCount = 0, drawCount = 0, rankScore = 0, rankName = '初级小六';

-- 统计清理结果
SELECT 'remaining_users' AS k, COUNT(*) AS v FROM users;
SELECT 'remaining_games' AS k, COUNT(*) AS v FROM games;
SELECT 'bot_users' AS k, COUNT(*) AS v FROM users WHERE openid LIKE 'bot_%';
