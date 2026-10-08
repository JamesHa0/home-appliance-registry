# 知屋家电保修簿(home-appliance-registry)

跨品牌家庭设备中枢微信小程序:扫码建档、保修倒计时、家庭共享、政策与召回提醒。

> 基于微信原生小程序 + 腾讯云开发 CloudBase。

## 功能特性

- **扫码建档** — 扫商品条码或能效标识码自动识别品牌/型号/品类;型号输入框带联想补全(输入型号 → 候选 → 一键回填),未命中时手动录入
- **保修管理** — 按品牌 × 品类保修年限规则自动计算,首页倒计时提醒,到期下发一次性订阅推送
- **家庭共享** — 创建/加入家庭,邀请码机制,家庭成员共享设备数据(服务端 OPENID 校验,防越权)
- **政策与召回** — 国补/以旧换新政策聚合,召回公告按型号匹配并在设备详情标红
- **设备管理** — 详情查看、编辑、删除;归档与恢复(两段式软删除);售后电话与说明书入口
- **隐私保护** — 涉及摄像头(扫码)、头像昵称、剪贴板的操作均需用户明确授权,拒绝后仍可手动完成

## 技术栈

- 微信小程序(原生框架,WXML / WXSS / JS,基础库 3.4.10)
- 腾讯云开发 CloudBase — 云函数、云数据库、定时触发器

## 项目结构

```
home-appliance-registry/
├── app.js / app.json / app.wxss      全局(云开发初始化、tabBar、隐私授权钩子、主题)
├── project.config.json               项目配置(含上传忽略规则)
├── config.local.js                   本地云环境 ID(被 .gitignore 忽略,需本地创建)
├── pages/
│   ├── index/                        首页:设备列表 + 待办提醒条(召回/保修/国补)
│   ├── add-device/                   建档页:扫码 → 条码/能效码识别 → 型号联想补全 → 表单
│   ├── device-detail/                详情:保修状态、召回标红、说明书、售后电话、归档/删除
│   ├── family/                       家庭:创建/邀请码加入/成员管理
│   ├── policy/                       政策:国补/以旧换新/召回公告聚合
│   ├── settings/                     提醒:一次性订阅(保修到期)+ 隐私政策入口
│   ├── archive/                      归档:已归档设备恢复 / 永久删除
│   └── privacy/                      隐私政策(独立静态页)
├── components/
│   └── privacy-popup/                隐私授权弹窗(嵌入全部含隐私接口的页面)
├── utils/
│   ├── warranty.js                   保修规则表(品牌 × 品类 → 年限)
│   ├── format.js                     日期 / 倒计时
│   └── cloud.js                      云函数调用封装
├── db/
│   ├── seed-models.json              型号库种子数据 → 导入 models
│   ├── seed-policies.json            政策种子数据 → 导入 policies
│   └── seed-recalls.json             召回种子数据 → 导入 recalls
└── cloudfunctions/
    ├── familyService/                家庭 + 设备 CRUD 统一入口(成员关系校验,家庭共享核心)
    ├── getBarcodeInfo/               条码反查 + 能效码解析 + 型号联想(searchOfficialModels)
    ├── scanRecall/                   召回公告定时抓取(每日 02:00)
    └── sendWarrantyReminder/         保修到期定时提醒(每日 09:00,一次性订阅下发)
```

## 快速开始

1. 下载并安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html),导入本目录
2. 在开发者工具中开通云开发环境(基础版免费额度即可)
3. 复制 `config.local.js.sample` 为 `config.local.js`,填入云开发环境 ID(该文件已被 `.gitignore` 忽略,不会进入公开仓库)
4. 部署云函数:在 `cloudfunctions/` 下每个函数文件夹右键 → **上传并部署:云端安装依赖**
5. 初始化云数据库:创建下方 **8 个集合**并按下表配置权限,导入种子数据(`db/` 目录,`seed-*.json`)
6. 上传代码并提交审核

## 配置项

| 配置 | 位置 | 说明 |
|------|------|------|
| AppID | `project.config.json` | 小程序 AppID |
| 云开发环境 ID | `config.local.js`(模板:`config.local.js.sample`) | **已配置**。`app.js` 启动时 `require('./config.local.js')` 读取真实 env;文件缺失时回落占位 `free-xxxxxxxx`,致云调用失败(见下方提示) |
| 订阅消息模板 ID | `pages/settings/settings.js`、`cloudfunctions/sendWarrantyReminder/index.js` | **已配置并前后端对齐**,无需再改。模板「保修到期提醒」(thing8 / time7 / number12 / thing5);两处常量必须保持一致 |
| 条码查询 API Key | 云函数 `getBarcodeInfo` 环境变量 `BARCODE_API_KEY` | 可选,留空则跳过在线反查,仅走本地型号库 |
| 官方绿色低碳码 appid | `pages/add-device/add-device.js` 的 `OFFICIAL_ENERGY_APPID` | 可选,当前为空。填入后「已识别官方能效码」弹窗出现「去官方查验」跳转按钮;获取方法:PC 版微信打开该小程序一次,查看 `文档\WeChat Files\Applet\` 下 wx 开头的新文件夹名 |

> **注意**:`config.local.js` 需随上传包一并提交(它有意不在 `packOptions.ignore` 中),否则线上 `cloudEnv` 会回落占位 `free-xxxxxxxx`,导致云函数 / 云数据库调用失败。

## 云函数

| 函数 | 定时 | 说明 |
|------|------|------|
| `familyService` | — | 家庭与设备 CRUD 统一入口,所有读写经此函数并基于 OPENID 校验成员关系 |
| `getBarcodeInfo` | — | 条码反查:本地型号库 → 条码 API → 模糊匹配;能效码(官方备案接口/bbqk)自动取数并缓存(`source=energylabel`),接口失败降级手填;`searchOfficialModels` 按型号模糊搜索备案列表供建档页型号联想补全(默认 `mark=854` 能效,取回后前端只展示 4 条) |
| `scanRecall` | 每日 02:00 | 召回公告定时抓取,失败写入 `system_errors` |
| `sendWarrantyReminder` | 每日 09:00 | 扫描 7 天内到期设备,下发一次性订阅消息 |

> 前端统一经 `utils/cloud.js` 的 `call('familyService', {...})` 调用,返回值 `{ code, data | msg }`;`code !== 0` 时 reject。公开只读集合(`models` / `policies` / `recalls`)由前端直读,省去云函数往返。

## 数据模型与权限

| 集合 | 权限 | 说明 |
|------|------|------|
| `devices` | 仅云函数可访问 | 设备档案,客户端一律经 `familyService` |
| `families` | 仅云函数可访问 | 家庭与成员关系 |
| `users` | 仅云函数可访问 | 用户昵称 / 头像缓存 |
| `system_errors` | 仅云函数可访问 | 定时任务失败日志(堆栈截断,不含 PII) |
| `models` | 所有用户可读,仅管理端可写 | 品牌型号库(种子数据 + 能效码缓存) |
| `policies` | 所有用户可读,仅管理端可写 | 国补 / 以旧换新政策 |
| `recalls` | 所有用户可读,仅管理端可写 | 官方召回公告 |
| `subscriptions` | 仅创建者可读写 | 订阅消息记录(`openid` / `deviceId` / `used`) |

> ⚠️ `models` / `policies` / `recalls` 必须设为「所有用户可读、**仅管理端可写**」。若误设为「所有用户可读写」,任何人可灌入虚假召回或国补信息(诈骗风险)。

## 隐私

- 仅在用户授权后调用相关能力:扫码(摄像头)、家庭昵称头像、复制说明书链接(剪贴板);授权弹窗覆盖全部相关页面,拒绝授权不影响手动录入等主流程
- 设备档案与家庭成员关系仅家庭成员可见,由服务端按 OPENID 校验
- 完整隐私政策见小程序内「提醒 → 隐私政策」页(`pages/privacy`)

## 已知限制

- 个人主体小程序仅支持**一次性订阅消息**:保修到期可推送,政策/召回以站内页提醒
- 保修规则为前端硬编码(`utils/warranty.js`),暂不支持云端动态配置
- 型号联想补全依赖能效标识网公开列表接口(无鉴权、无 SLA):接口失败或无命中时静默退回纯手填,不影响建档;该接口返回的候选仅用于表单回填,应用不提供独立查询入口
- 条码在线反查依赖 `BARCODE_API_KEY`,未配置时仅走本地型号库
