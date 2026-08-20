# 家电户籍 — 微信小程序

跨品牌家庭设备中枢：扫码建档 → 保修倒计时 → 家庭共享 → 政策/召回提醒。

## 项目结构

```
home-appliance-registry/
├── app.js / app.json / app.wxss      全局（云开发初始化、tabBar、主题）
├── project.config.json               项目配置
├── pages/
│   ├── index/                        首页：设备列表 + 待办提醒条
│   ├── add-device/                   建档页：扫码 → 条码反查 → 表单（含型号库 UGC 开关）
│   ├── device-detail/                详情：保修状态、说明书入口、售后电话、删除
│   ├── family/                       家庭：创建/邀请码加入/成员
│   ├── policy/                       政策：国补/以旧换新/召回公告聚合
│   └── settings/                     提醒：一次性订阅（保修到期）
├── utils/
│   ├── warranty.js                   保修规则表（品牌×品类→年限）
│   ├── format.js                     日期/倒计时
│   └── cloud.js                      云函数调用封装
└── cloudfunctions/
    ├── familyService/                家庭+设备 CRUD 统一入口（成员关系校验，家庭共享核心）
    ├── getBarcodeInfo/               条码反查（本地型号库 → 条码 API → matchModel 模糊匹配）
    ├── scanRecall/                   召回公告定时抓取
    └── sendWarrantyReminder/         保修到期定时提醒（一次性订阅下发）
```

## 一、环境准备

1. **安装微信开发者工具**（官网下载，选稳定版 Windows 64）：
   https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 用已注册的个人主体小程序账号扫码登录，导入本目录。
3. 开发者工具右上角「云开发」→ 开通环境（基础版免费额度即可）。

## 二、配置点

| 位置 | 内容 | 状态 |
|------|------|------|
| `project.config.json` | appid | ✅ 已填 |
| `app.js` | 云开发环境 ID | ✅ 已填（free-d4ghcn6kmf592a75f） |
| `pages/settings/settings.js` + `cloudfunctions/sendWarrantyReminder/index.js` | 订阅模板 ID（公众平台 → 功能 → 订阅消息，选用"保修到期"类模板） | ⏳ 待申请后替换 2 处 `YOUR_WARRANTY_TEMPLATE_ID` |
| `cloudfunctions/getBarcodeInfo/index.js` | 条码查询 API Key | ⏳ 可选（留空仅走本地型号库） |

## 三、云端已配置（2026-08-20）

通过 CloudBase 连接器自动完成：环境确认 → 6 集合创建 → 种子数据导入（models 18 / policies 3 / recalls 2）→ 公开集合只读、家庭数据仅云函数可访问 → 索引（families: members+_openid；devices: familyId+createdAt）。

**当前权限矩阵**（已生效）：

| 集合 | 权限 | 说明 |
|------|------|------|
| `devices` | ADMINONLY | 仅云函数可访问（客户端一律走 familyService） |
| `families` | ADMINONLY | 仅云函数可访问（同上） |
| `models` / `policies` / `recalls` | READONLY | 所有用户可读（型号库/政策/召回） |
| `subscriptions` | PRIVATE | 用户管理自己的订阅记录 |

## 四、云函数部署（共 4 个）

1. `cloudfunctions` 下每个函数文件夹**右键 → 上传并部署：云端安装依赖**（已部署：getBarcodeInfo / scanRecall / sendWarrantyReminder / familyService）。
2. 定时触发器（云开发控制台 → 云函数 → 配置触发器）：
   - `scanRecall`：`0 0 2 * * * *`（每天 02:00 抓取召回公告）
   - `sendWarrantyReminder`：`0 0 9 * * * *`（每天 09:00 扫保修 7 天内到期并推送）
3. 手动测试：云函数 → 云端测试（`scanRecall` 传 `{"action":"run"}`）。

## 五、家庭共享架构（familyService）

家庭/设备数据的**所有读写都经 `familyService` 云函数**，服务端通过 `getWXContext().OPENID` 识别调用者并校验成员关系：

| Action | 说明 |
|--------|------|
| `getFamily` | 返回调用者家庭（含 openid） |
| `createFamily` / `joinFamily` | 创建（幂等）/ 按邀请码加入（members 去重 push） |
| `getDevices` / `getDevice` | 家庭设备列表 / 详情（非成员访问被拒） |
| `createDevice` | 建档（无家庭自动创建）；`contribute:true` 且型号不在库 → 写入 models（UGC，source=ugc） |
| `updateDevice` / `deleteDevice` | 仅家庭内成员可操作 |

> 前端约定：所有调用走 `utils/cloud.js` 的 `call('familyService', {...})`，返回值统一 `{ code, data | msg }`。

## 六、预置数据

项目已带种子数据文件（`db/` 目录），云开发控制台 → 数据库 → 对应集合 → 导入：

| 文件 | 集合 | 内容 |
|------|------|------|
| `db/seed-models.json` | `models` | 美的/海尔/小米 18 个高频型号 |
| `db/seed-policies.json` | `policies` | 2026 国补 6 类家电、数码智能 4 类、地方自主品类（含官方链接） |
| `db/seed-recalls.json` | `recalls` | 官方真实召回案例（荣事达电饭煲、三益燃气灶） |

## 七、已知限制

- 个人主体**仅一次性订阅消息**：保修到期可推送；国补/召回走站内"政策"页提醒（召回按型号匹配并在首页/详情标红）。
- 订阅模板未申请前，提醒页显示配置提示，不影响其他流程。
- 升级企业主体 + 服务号后可解锁真正的召回/政策推送与以旧换新 CPS 变现。

## 八、下一步

1. **双人真机验证家庭共享**（需两台微信）：A 创建家庭复制邀请码 → B 输入邀请码加入 → 互相可见对方设备、均可建档/删除。
2. 家人群 10 人建档测试：扫码命中率、是否愿意填购机日、家庭共享使用率。
3. 订阅模板申请 → 替换 2 处模板 ID → 配定时触发器。
4. 体验增强：OCR 铭牌识别兜底、条码 API Key 接入。
