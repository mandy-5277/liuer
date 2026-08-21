DELETE FROM users WHERE openid LIKE 'E2E_A_T%';
DELETE FROM games WHERE blackOpenid LIKE 'E2E_A_T%' OR whiteOpenid LIKE 'E2E_A_T%';
