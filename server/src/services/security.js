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
const { wechat } = require('../config');

// access_token 缓存
let tokenCache = {
  token: null,
  expiresAt: 0,
};

const TOKEN_BUFFER_MS = 60 * 1000; // 提前 60 秒过期，避免边界失效

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

  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`;
  const result = await postJson(url, { content });

  // errcode 0：通过；87014：含有违法违规内容
  const risky = result.errcode === 87014;
  const ok = result.errcode === 0;
  if (!ok && !risky) {
    console.error('[Security] msgSecCheck 接口异常:', result);
  }
  return {
    ok,
    risky,
    errcode: result.errcode,
    errmsg: result.errmsg || '',
  };
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
          if (!ok && !risky) {
            console.error('[Security] imgSecCheck 接口异常:', result);
          }
          resolve({ ok, risky, errcode: result.errcode, errmsg: result.errmsg || '' });
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
