/**
 * 内容安全服务
 * 接入微信公众平台内容安全 API：
 * - msgSecCheck：文本（昵称、签名等）
 * - imgSecCheck：图片（头像等）
 *
 * 生产环境必须配置 WX_APPID + WX_APPSECRET；
 * 未配置时（开发调试）会打印警告并放行，避免阻塞本地测试。
 */

const https = require('https');
const crypto = require('crypto');
const { wechat } = require('../config');

// access_token 缓存
let tokenCache = {
  token: null,
  expiresAt: 0,
};

const TOKEN_BUFFER_MS = 60 * 1000; // 提前 60 秒过期，避免边界失效

// ========== 结果缓存（减少重复 API 调用，避免配额被打爆） ==========
// 同一昵称/文本重复检测频率很高（每次登录都查历史昵称），缓存命中可省掉绝大多数调用。
const resultCache = new Map(); // key -> { ok, risky, ts }
const RESULT_TTL_MS = 10 * 60 * 1000; // 10 分钟内复用结果

function resultKey(content) {
  // 文本用内容哈希；图片用 buffer 哈希
  const h = crypto.createHash('md5').update(String(content)).digest('hex');
  return h;
}

function getCachedResult(key) {
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.ts < RESULT_TTL_MS) {
    return { ok: hit.ok, risky: hit.risky, errcode: hit.errcode, errmsg: hit.errmsg, cached: true };
  }
  if (hit) resultCache.delete(key);
  return null;
}

function setCachedResult(key, res) {
  const { ok, risky, errcode, errmsg } = res;
  resultCache.set(key, { ok, risky, errcode, errmsg, ts: Date.now() });
  // 简单容量保护：超过 5000 条时清理过期项
  if (resultCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of resultCache) {
      if (now - v.ts > RESULT_TTL_MS) resultCache.delete(k);
    }
  }
}

// ========== 配额熔断（命中 45009 后进入冷却，期间降级放行，不再调用 API） ==========
let quotaCooldownUntil = 0;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000; // 配额耗尽后冷却 10 分钟

function inQuotaCooldown() {
  return Date.now() < quotaCooldownUntil;
}
function triggerQuotaCooldown() {
  quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
  console.error('[Security] 命中配额上限(45009)，进入冷却窗口，期间降级放行 10 分钟');
}

// ========== 简单令牌桶限流（避免瞬时请求打爆配额） ==========
const RATE_LIMIT = { tokens: 20, max: 20, refillPerMs: 20 / (1000) }; // 约 20 次/秒上限
let bucket = RATE_LIMIT.max;
let lastRefill = Date.now();
function takeToken() {
  const now = Date.now();
  const elapsed = now - lastRefill;
  bucket = Math.min(RATE_LIMIT.max, bucket + elapsed * RATE_LIMIT.refillPerMs);
  lastRefill = now;
  if (bucket >= 1) {
    bucket -= 1;
    return true;
  }
  return false;
}

/** 请求微信 access_token（client_credential） */
function fetchAccessToken() {
  return new Promise((resolve, reject) => {
    if (!wechat.appid || !wechat.secret) {
      return reject(new Error('未配置 WX_APPID/WX_APPSECRET'));
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(wechat.appid)}&secret=${encodeURIComponent(wechat.secret)}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.access_token && result.expires_in) {
            resolve({ token: result.access_token, expiresIn: result.expires_in });
          } else {
            reject(new Error(`微信 token 接口返回错误: ${JSON.stringify(result)}`));
          }
        } catch (err) {
          reject(new Error(`解析微信 token 返回失败: ${err.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`请求微信 token 接口失败: ${err.message}`));
    });
  });
}

/** 获取有效 access_token（带缓存） */
async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt - now > TOKEN_BUFFER_MS) {
    return tokenCache.token;
  }
  const { token, expiresIn } = await fetchAccessToken();
  tokenCache = {
    token,
    expiresAt: now + expiresIn * 1000,
  };
  return token;
}

/** 通用 POST JSON */
function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`解析微信返回失败: ${body}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

/**
 * 文本内容安全检测（msgSecCheck）
 * @param {string} content 待检测文本
 * @returns {Promise<{ok: boolean, risky?: boolean, errcode: number, errmsg: string}>}
 */
async function msgSecCheck(content) {
  if (!content || typeof content !== 'string') {
    return { ok: true, risky: false, errcode: 0, errmsg: 'empty' };
  }

  // 未配置密钥：开发环境降级放行
  if (!wechat.appid || !wechat.secret) {
    console.warn('[Security] 未配置 WX_APPSECRET，跳过 msgSecCheck（生产环境请务必配置）');
    return { ok: true, risky: false, errcode: 0, errmsg: 'dev-bypass' };
  }

  const key = resultKey(content);

  // 1) 配额熔断：冷却期内直接放行，避免反复打爆 API
  if (inQuotaCooldown()) {
    return { ok: true, risky: false, errcode: 0, errmsg: 'quota-cooldown-bypass' };
  }

  // 2) 结果缓存命中：直接复用，省掉 API 调用
  const cached = getCachedResult(key);
  if (cached) {
    return cached;
  }

  // 3) 限流：瞬时请求过多则降级放行（不阻断业务）
  if (!takeToken()) {
    console.error('[Security] msgSecCheck 触发限流，降级放行');
    return { ok: true, risky: false, errcode: 0, errmsg: 'rate-limit-bypass' };
  }

  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`;
  const result = await postJson(url, { content });

  // errcode 0：通过；87014：含有违法违规内容；45009：配额上限
  const risky = result.errcode === 87014;
  const ok = result.errcode === 0;

  if (result.errcode === 45009) {
    // 配额耗尽：熔断 + 降级放行（不缓存，避免后续一直放行违规内容）
    triggerQuotaCooldown();
    return { ok: true, risky: false, errcode: 45009, errmsg: result.errmsg || 'quota exceeded' };
  }
  if (!ok && !risky) {
    console.error('[Security] msgSecCheck 接口异常:', result);
    return { ok: false, risky: false, errcode: result.errcode, errmsg: result.errmsg || '' };
  }

  // 通过/违规都缓存结果（10 分钟内复用）
  const res = { ok, risky, errcode: result.errcode, errmsg: result.errmsg || '' };
  setCachedResult(key, res);
  return res;
}

/**
 * 图片内容安全检测（imgSecCheck）
 * @param {Buffer} buffer 图片二进制
 * @param {string} filename 文件名（仅影响 filename 字段）
 * @returns {Promise<{ok: boolean, risky?: boolean, errcode: number, errmsg: string}>}
 */
async function imgSecCheck(buffer, filename = 'image.png') {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { ok: true, risky: false, errcode: 0, errmsg: 'empty' };
  }

  // 未配置密钥：开发环境降级放行
  if (!wechat.appid || !wechat.secret) {
    console.warn('[Security] 未配置 WX_APPSECRET，跳过 imgSecCheck（生产环境请务必配置）');
    return { ok: true, risky: false, errcode: 0, errmsg: 'dev-bypass' };
  }

  const key = resultKey(buffer);

  // 1) 配额熔断：冷却期内直接放行
  if (inQuotaCooldown()) {
    return { ok: true, risky: false, errcode: 0, errmsg: 'quota-cooldown-bypass' };
  }

  // 2) 结果缓存命中：直接复用（同一头像重复上传很常见）
  const cached = getCachedResult(key);
  if (cached) {
    return cached;
  }

  // 3) 限流：瞬时请求过多则降级放行
  if (!takeToken()) {
    console.error('[Security] imgSecCheck 触发限流，降级放行');
    return { ok: true, risky: false, errcode: 0, errmsg: 'rate-limit-bypass' };
  }

  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${token}`;

  const boundary = '----LiuerFormBoundary' + Math.random().toString(36).slice(2);
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
    'utf-8'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const body = Buffer.concat([prefix, buffer, suffix]);

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let response = '';
      res.on('data', (chunk) => { response += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(response);
          const risky = result.errcode === 87014;
          const ok = result.errcode === 0;

          if (result.errcode === 45009) {
            triggerQuotaCooldown();
            return resolve({ ok: true, risky: false, errcode: 45009, errmsg: result.errmsg || 'quota exceeded' });
          }
          if (!ok && !risky) {
            console.error('[Security] imgSecCheck 接口异常:', result);
            return resolve({ ok: false, risky: false, errcode: result.errcode, errmsg: result.errmsg || '' });
          }
          const resObj = { ok, risky, errcode: result.errcode, errmsg: result.errmsg || '' };
          setCachedResult(key, resObj);
          resolve(resObj);
        } catch (err) {
          reject(new Error(`解析微信 imgSecCheck 返回失败: ${response}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

module.exports = {
  msgSecCheck,
  imgSecCheck,
  getAccessToken,
};
