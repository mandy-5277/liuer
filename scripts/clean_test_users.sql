-- 清理历史测试用户，从现在开始累计真实用户
-- 删除规则：
--   E2E_%       E2E 自动化测试用户
--   test_%      测试真人 / 测试加入者 / 测试创建者
--   oBV1M3%     早期匿名测试账号（空昵称、无战绩）
-- 保留：机器人(bot_%)、真实用户(o0oDP5% 等微信 openid)

SET FOREIGN_KEY_CHECKS = 0;

-- 先删除这些用户的对局记录
DELETE FROM games
 WHERE blackOpenid LIKE 'E2E_%' OR whiteOpenid LIKE 'E2E_%'
    OR blackOpenid LIKE 'test_%' OR whiteOpenid LIKE 'test_%'
    OR blackOpenid LIKE 'oBV1M3%' OR whiteOpenid LIKE 'oBV1M3%';

-- 再删除用户本身
DELETE FROM users
 WHERE openid LIKE 'E2E_%'
    OR openid LIKE 'test_%'
    OR openid LIKE 'oBV1M3%';

SET FOREIGN_KEY_CHECKS = 1;

-- 确认清理结果
SELECT '剩余用户数' AS k, COUNT(*) AS v FROM users;
