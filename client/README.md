# 六耳 - 双人对战棋类游戏

基于微信小程序 + CloudBase（腾讯云开发）的随机匹配/邀请双人对战棋类游戏。

## 技术架构

- **前端**：微信小程序原生开发
- **后端**：CloudBase 云函数 (Node.js)
- **存储**：CloudBase 云开发 (wx.cloud)

## CloudBase 环境

- **环境 ID**: `lieur-d1g5b7sa6eb6ce30e`
- **环境别名**: `lieur`

## 已部署资源

### 云函数

| 函数名 | 运行时 | 状态 | 说明 |
|--------|--------|------|------|
| quickstartFunctions | Nodejs18.15 | Active | 基础云函数（getOpenId, 数据库CRUD等） |

## 项目结构

```
client/
├── cloudfunctions/          # 云函数目录
│   └── quickstartFunctions/ # 基础云函数
├── miniprogram/             # 小程序前端
│   ├── pages/               # 页面
│   ├── images/              # 静态资源
│   ├── app.js               # 小程序入口
│   └── app.json             # 小程序配置
└── project.config.json      # 项目配置
server/                      # 服务端（预留）
```

## 部署说明

### 云函数部署
已通过 CloudBase CLI 部署到环境 `lieur-d1g5b7sa6eb6ce30e`。

### 小程序发布
1. 使用微信开发者工具打开 `client/` 目录
2. 在工具中右键云函数目录上传部署
3. 点击工具栏「上传」发布小程序

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
- [CloudBase 文档](https://docs.cloudbase.net/)

