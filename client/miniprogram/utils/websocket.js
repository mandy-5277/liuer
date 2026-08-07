/**
 * 六儿 客户端 — WebSocket 管理器
 *
 * 直连自建服务器（MySQL + Redis 后端）
 * 【使用回调风格 API】避免灰度基础库 SocketTask 为 null 的兼容问题
 *
 * 使用方式：
 *   const { wsManager } = getApp().globalData;
 *   wsManager.send('get_profile');
 *   wsManager.on('profile', (data) => { ... });
 */

const { WS_BASE } = require('../config');

const config = {
  // 自建服务器 WebSocket URL（统一见 config.js）
  wsUrl: WS_BASE + '/',

  reconnectMax: 5,          // 最大重连次数
  reconnectInterval: 3000,  // 重连间隔（毫秒）
  heartbeatInterval: 25000, // 心跳间隔（毫秒）
};

class WsManager {
  constructor() {
    this.openid = '';
    this.isConnected = false;
    this.reconnectCount = 0;
    this.heartbeatTimer = null;
    this.handlers = {};
    this.onceHandlers = {};
    this.pendingQueue = [];
    this.seq = 0;

    // 存储 connect() Promise 的 resolve/reject
    this._connectResolve = null;
    this._connectReject = null;

    // 全局事件只注册一次
    if (!WsManager._globalRegistered) {
      WsManager._globalRegistered = true;
      this._registerGlobalEvents();
    }
  }

  /** 注册 wx.onSocket* 全局事件回调（仅执行一次） */
  _registerGlobalEvents() {
    wx.onSocketOpen(() => {
      console.log('[WS] 连接成功 (直连)');
      this.isConnected = true;
      this.reconnectCount = 0;

      // 发送登录
      const nickName = this._pendingNickName || '';
      const avatarUrl = this._pendingAvatarUrl || '';
      this.send('login', { openid: this.openid, nickName, avatarUrl });

      // 发送积压消息
      this._flushPendingQueue();

      // resolve connect() Promise
      if (this._connectResolve) {
        this._connectResolve();
        this._connectResolve = null;
        this._connectReject = null;
      }
    });

    wx.onSocketMessage((res) => {
      try {
        const msg = JSON.parse(res.data);
        console.log('[WS] 收到:', msg.cmd);

        // 收到 login_success 后启动心跳
        if (msg.cmd === 'login_success' && !this._heartbeatStarted) {
          this._heartbeatStarted = true;
          this._startHeartbeat();
        }

        this._handleMessage(msg);
      } catch (err) {
        console.error('[WS] 消息解析失败:', err);
      }
    });

    wx.onSocketClose((res) => {
      console.log('[WS] 连接关闭, code:', res.code, 'reason:', res.reason);
      this.isConnected = false;
      this._stopHeartbeat();
      this._heartbeatStarted = false;

      // reject connect() Promise（连接失败）
      if (this._connectReject) {
        this._connectReject(new Error(res.reason || '连接关闭'));
        this._connectResolve = null;
        this._connectReject = null;
      }

      this._tryReconnect();
    });

    wx.onSocketError((err) => {
      console.error('[WS] 连接错误:', err.errMsg);

      // reject connect() Promise
      if (this._connectReject) {
        this._connectReject(err);
        this._connectResolve = null;
        this._connectReject = null;
      }
    });
  }

  // ========== 连接管理 ==========

  connect(openid, nickName = '', avatarUrl = '') {
    this.openid = openid;
    this._pendingNickName = nickName;
    this._pendingAvatarUrl = avatarUrl;
    this._heartbeatStarted = false;

    // 如果已连接，直接 resolve
    if (this.isConnected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;

      // 发起连接
      wx.connectSocket({
        url: config.wsUrl,
        success: () => {
          console.log('[WS] connectSocket 调用成功');
        },
        fail: (err) => {
          console.error('[WS] connectSocket 失败:', err);
          this._connectResolve = null;
          this._connectReject = null;
          this.emit('connection_failed', {
            reason: 'connect_failed',
            errMsg: err.errMsg,
          });
          reject(err);
        },
      });
    });
  }

  /** 关闭连接 */
  close() {
    this._stopHeartbeat();
    this._heartbeatStarted = false;
    this.isConnected = false;
    try { wx.closeSocket(); } catch (_) { /* ignore */ }
  }

  // ========== 重连 ==========

  _tryReconnect() {
    if (this.reconnectCount >= config.reconnectMax) {
      console.log('[WS] 重连次数已用完');
      this.emit('connection_failed', { reason: 'max_retries' });
      return;
    }

    this.reconnectCount++;
    console.log(`[WS] 第 ${this.reconnectCount} 次重连...`);

    setTimeout(() => {
      this.connect(this.openid, this._pendingNickName, this._pendingAvatarUrl)
        .catch(() => {});
    }, config.reconnectInterval);
  }

  // ========== 心跳 ==========

  _startHeartbeat() {
    this._stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.send('ping');
      }
    }, config.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ========== 消息发送 ==========

  send(cmd, data = {}) {
    const msg = {
      cmd,
      data,
      seq: ++this.seq,
    };

    if (this.isConnected) {
      wx.sendSocketMessage({
        data: JSON.stringify(msg),
        success: () => { /* sent */ },
        fail: (err) => {
          console.error(`[WS] 发送 ${cmd} 失败:`, err.errMsg);
        },
      });
    } else {
      this.pendingQueue.push(msg);
    }
  }

  _flushPendingQueue() {
    while (this.pendingQueue.length > 0) {
      const msg = this.pendingQueue.shift();
      this.send(msg.cmd, msg.data);
    }
  }

  // ========== 消息处理 ==========

  _handleMessage(msg) {
    const { cmd, data } = msg;

    if (this.handlers[cmd]) {
      this.handlers[cmd].forEach(cb => cb(data, msg));
    }

    if (this.onceHandlers[cmd]) {
      const onceCbs = [...this.onceHandlers[cmd]];
      delete this.onceHandlers[cmd];
      onceCbs.forEach(cb => cb(data, msg));
    }

    if (this.handlers['*']) {
      this.handlers['*'].forEach(cb => cb(cmd, data, msg));
    }
  }

  on(cmd, callback) {
    if (!this.handlers[cmd]) this.handlers[cmd] = [];
    this.handlers[cmd].push(callback);
  }

  once(cmd, callback) {
    if (!this.onceHandlers[cmd]) this.onceHandlers[cmd] = [];
    this.onceHandlers[cmd].push(callback);
  }

  off(cmd, callback) {
    if (!callback) {
      delete this.handlers[cmd];
      delete this.onceHandlers[cmd];
    } else {
      if (this.handlers[cmd]) {
        this.handlers[cmd] = this.handlers[cmd].filter(cb => cb !== callback);
      }
      if (this.onceHandlers[cmd]) {
        this.onceHandlers[cmd] = this.onceHandlers[cmd].filter(cb => cb !== callback);
      }
    }
  }

  // ========== 事件发射 ==========

  emit(cmd, data) {
    this._handleMessage({ cmd, data });
  }
}

module.exports = {
  wsManager: new WsManager(),
  wsConfig: config,
};
