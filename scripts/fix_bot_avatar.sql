-- 修复机器人头像：将已有 bot_% 用户的旧 URL 头像统一更新为 emoji 头像
-- 用 CRC32(openid) 取模 5 在 5 个 emoji 间均匀分布（与 config robot.avatarUrls 一致）
UPDATE users
   SET avatarUrl = CASE MOD(CRC32(openid), 5)
       WHEN 0 THEN 'emoji:🤖'
       WHEN 1 THEN 'emoji:👾'
       WHEN 2 THEN 'emoji:🦾'
       WHEN 3 THEN 'emoji:🎲'
       ELSE 'emoji:🧩'
   END
 WHERE openid LIKE 'bot_%';

-- 确认
SELECT openid, nickName, avatarUrl FROM users WHERE openid LIKE 'bot_%';
