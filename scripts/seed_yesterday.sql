UPDATE users SET dailyAdCount=3, dailyShareCount=5, lastDailyReset=DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE openid='o0oDP5Dq1BREaH3CeUtfQfGVz3ts';
SELECT 'seeded_yesterday_used' AS k, dailyAdCount, dailyShareCount, lastDailyReset FROM users WHERE openid='o0oDP5Dq1BREaH3CeUtfQfGVz3ts';
