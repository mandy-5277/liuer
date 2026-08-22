/**
 * 微信隐私授权辅助
 * 调用 chooseMedia / 相册等受隐私保护的接口前，应先确认用户已授权隐私协议。
 * 注意：本函数只是代码侧的引导弹窗。若微信后台《隐私保护指引》未声明对应接口，
 * 仍会报 "please go to mp to announce your privacy usage"，此时必须去 mp 后台补充声明。
 */

/**
 * 在需要隐私授权的接口调用前执行 cb。
 * 若基础库不支持隐私接口，直接执行 cb。
 */
function ensurePrivacyAuthorized(cb) {
  if (typeof wx === 'undefined') { cb(); return; }
  if (typeof wx.requirePrivacyAuthorize !== 'function' || typeof wx.getPrivacySetting !== 'function') {
    cb();
    return;
  }
  wx.getPrivacySetting({
    success: (res) => {
      if (res && res.needAuthorization) {
        wx.requirePrivacyAuthorize({
          success: () => cb(),
          fail: () => cb(), // 用户拒绝也继续，避免卡死；真正拦截由后台声明解决
        });
      } else {
        cb();
      }
    },
    fail: () => cb(),
  });
}

module.exports = { ensurePrivacyAuthorized };
