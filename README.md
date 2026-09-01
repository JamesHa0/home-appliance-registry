# 知屋家电保修簿(home-appliance-registry)

跨品牌家庭设备中枢微信小程序:扫码建档、保修倒计时、家庭共享、政策与召回提醒。

## 功能特性

- **扫码建档** — 扫描商品条码,本地型号库反查,支持手动录入与型号贡献(UGC)
- **保修管理** — 按品牌 × 品类保修年限规则自动计算,首页倒计时提醒,到期下发一次性订阅推送
- **家庭共享** — 创建/加入家庭,邀请码机制,家庭成员共享设备数据
- **政策与召回** — 国补/以旧换新政策聚合,召回公告按型号匹配并在设备详情标红
- **设备管理** — 详情查看、编辑、删除,售后电话与说明书入口

## 技术栈

- 微信小程序(原生框架,WXML / WXSS / JS)
- 腾讯云开发 CloudBase — 云函数、云数据库、定时触发器

## 项目结构

```
home-appliance-registry/
├── app.js / app.json / app.wxss      全局(云开发初始化、tabBar、主题)
├── project.config.json               项目配置
├── pages/
│   ├── index/                        首页:设备列表 + 待办提醒条
│   ├── add-device/                   建档页:扫码 → 条码反查 → 表单(含型号库 UGC 开关)
│   ├── device-detail/                详情:保修状态、说明书入口、售后电话、删除
│   ├── family/                       家庭:创建/邀请码加入/成员
│   ├── policy/                       政策:国补/以旧换新/召回公告聚合
│   └── settings/                     提醒:一次性订阅(保修到期)
├── utils/
│   ├── warranty.js                   保修规则表(品牌×品类→年限)
│   ├── format.js                     日期/倒计时
│   └── cloud.js                      云函数调用封装
└── cloudfunctions/
    ├── familyService/                家庭+设备 CRUD 统一入口(成员关系校验,家庭共享核心)
    ├── getBarcodeInfo/               条码反查(本地型号库 → 条码 API → 模糊匹配)
    ├── scanRecall/                   召回公告定时抓取
    └── sendWarrantyReminder/         保修到期定时提醒(一次性订阅下发)
```

## 快速开始

1. 下载并安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html),导入本目录
2. 在开发者工具中开通云开发环境(基础版免费额度即可)
3. 复制 `config.local.js.sample` 为 `config.local.js`,填入云开发环境 ID(该文件已被 `.gitignore` 忽略,不会提交)
4. 部署云函数:在 `cloudfunctions/` 下每个函数文件夹右键 → 上传并部署:云端安装依赖
5. 初始化云数据库:创建下方 6 个集合并配置索引,导入种子数据(本地 `db/` 目录,见各 JSON 文件)

## 配置项

| 配置 | 位置 | 说明 |
|------|------|------|
| AppID | `project.config.json` | 小程序 AppID |
| 云开发环境 ID | `config.local.js`(模板:`config.local.js.sample`) | `app.js` 以占位 `free-xxxxxxxx` 读取,真实值不进公开仓库 |
| 订阅消息模板 ID | `pages/settings/settings.js`、`cloudfunctions/sendWarrantyReminder/index.js` | 公众平台申请后替换 2 处 `YOUR_WARRANTY_TEMPLATE_ID` |
| 条码查询 API Key | `cloudfunctions/getBarcodeInfo/index.js` | 可选,留空仅走本地型号库 |

## 云函数

| 函数 | 说明 |
|------|------|
| `familyService` | 家庭与设备 CRUD 统一入口,所有读写经此函数并基于 OPENID 校验成员关系 |
| `getBarcodeInfo` | 条码反查:本地型号库 → 条码 API → 模糊匹配 |
| `scanRecall` | 召回公告定时抓取(每天 02:00) |
| `sendWarrantyReminder` | 保修到期提醒(每天 09:00 扫描 7 天内到期,下发一次性订阅) |

> 前端统一经 `utils/cloud.js` 的 `call('familyService', {...})` 调用,返回值 `{ code, data | msg }`。

## 数据模型与权限

| 集合 | 权限 | 说明 |
|------|------|------|
| `devices` | 仅云函数可访问 | 设备档案,客户端一律经 `familyService` |
| `families` | 仅云函数可访问 | 家庭与成员关系 |
| `models` | 所有用户可读 | 品牌型号库(含 UGC 贡献) |
| `policies` | 所有用户可读 | 国补/以旧换新政策 |
| `recalls` | 所有用户可读 | 官方召回公告 |
| `subscriptions` | 仅创建者可读写 | 订阅消息记录 |

## 已知限制

- 个人主体小程序仅支持一次性订阅消息:保修到期可推送,政策/召回以站内页提醒
- 订阅模板需在公众平台申请后替换模板 ID
- 家庭共享涉及用户数据,已通过 `familyService` 的 OPENID 校验限制越权访问
