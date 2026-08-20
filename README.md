# 家电户籍 — 微信小程序（云开发 MVP 骨架）

跨品牌家庭设备中枢：扫码建档 → 保修倒计时 → 家庭共享 → 政策/召回提醒。

## 项目结构

```
home-appliance-registry/
├── app.js / app.json / app.wxss      全局（云开发初始化、tabBar、主题）
├── project.config.json               项目配置（AppID 占位）
├── pages/
│   ├── index/                        首页：设备列表 + 待办提醒条
│   ├── add-device/                   建档页：扫码 → 条码反查 → 表单
│   ├── device-detail/                详情：保修状态、说明书入口、售后电话
│   ├── family/                       家庭：创建/邀请码加入/成员
│   ├── policy/                       政策：国补/以旧换新/召回公告聚合
│   └── settings/                     提醒：一次性订阅（保修到期）
├── utils/
│   ├── warranty.js                   保修规则表（品牌×品类→年限）
│   ├── format.js                     日期/倒计时
│   └── cloud.js                      云函数调用封装
└── cloudfunctions/
    ├── getBarcodeInfo/               条码反查（本地型号库 → 条码 API）
    ├── scanRecall/                   召回公告定时抓取
    └── sendWarrantyReminder/         保修到期定时提醒（一次性订阅下发）
```

## 一、环境准备

1. **安装微信开发者工具**（官网下载，选稳定版 Windows 64）：
   https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 用你已注册的个人主体小程序账号扫码登录，导入本目录。
3. 开发者工具右上角「云开发」→ 开通环境（基础版免费额度即可），记下 **环境 ID**。

## 二、必须替换的配置点（4 处）

| 位置 | 替换内容 | 状态 |
|------|---------|------|
| `project.config.json` | `appid` → 你的小程序 AppID | ✅ 已填（wxbff1749c09556c18） |
| `app.js` | `env` → 你的云开发环境 ID | ✅ 已填（free-d4ghcn6kmf592a75f） |
| `pages/settings/settings.js` + `cloudfunctions/sendWarrantyReminder/index.js` | `YOUR_WARRANTY_TEMPLATE_ID` → 订阅模板 ID（公众平台 → 功能 → 订阅消息，选用"保修到期"类模板） | ⏳ 待申请后替换 |
| `cloudfunctions/getBarcodeInfo/index.js` | `BARCODE_API_KEY` → 条码查询 API Key（可留空，仅走本地型号库） | ⏳ 可选 |

## 二点五、云端已自动配置（2026-08-20）

通过 CloudBase 连接器已完成：环境确认（`free-d4ghcn6kmf592a75f`，即微信开发者工具中的云开发环境）→ 创建 6 个集合（devices/families/models/recalls/policies/subscriptions）→ 导入种子数据（models 18 条、policies 3 条、recalls 2 条）→ models/policies/recalls 权限设为"所有用户可读"。

> devices/families/subscriptions 保持"仅创建者可读写"（安全默认）。家庭共享的成员互读能力需要后续用**云函数封装 CRUD**（校验 familyId 成员关系）实现，当前 MVP 先以建档者本人视角跑通。

## 三、云函数部署

1. 开发者工具资源管理器 → `cloudfunctions` 目录下每个函数**右键 → 上传并部署：云端安装依赖**。
2. 定时触发器（云开发控制台 → 云函数 → 配置触发器）：
   - `scanRecall`：`0 0 2 * * * *`（每天 02:00 抓取召回公告）
   - `sendWarrantyReminder`：`0 0 9 * * * *`（每天 09:00 扫保修到期并推送）
3. 部署后先手动测试一次：云开发控制台 → 云函数 → 云端测试（`scanRecall` 传 `{"action":"run"}`）。

## 四、数据库集合与权限（云开发控制台创建）

| 集合 | 用途 | 权限建议 |
|------|------|---------|
| `devices` | 设备档案 | 仅创建者可读写（家庭共享走云函数/后续调整） |
| `families` | 家庭组 | 仅创建者可读写 |
| `models` | 型号库（条码→型号→说明书） | 所有用户可读，仅管理端可写 |
| `recalls` | 召回公告 | 所有用户可读 |
| `policies` | 政策（国补/以旧换新） | 所有用户可读 |
| `subscriptions` | 订阅授权记录 | 仅创建者可读写 |

> 家庭共享的完整权限模型（成员共同读写同一家庭设备）建议用**云函数封装 CRUD**（查询时校验 familyId 成员关系），当前骨架为简化实现，上线前务必收紧。

## 五、预置数据（跑通体验的最低配置）

项目已带种子数据文件（`db/` 目录），在**云开发控制台 → 数据库 → 对应集合 → 导入**即可：

| 文件 | 集合 | 内容 |
|------|------|------|
| `db/seed-models.json` | `models` | 美的/海尔/小米 18 个高频型号（品牌/品类/型号/名称/官网说明书入口），冷启动建档用 |
| `db/seed-policies.json` | `policies` | 2026 国补 6 类家电 15% 补贴、数码智能 4 类、地方自主品类（含官方政策链接） |
| `db/seed-recalls.json` | `recalls` | 官方真实召回案例（荣事达电饭煲、三益燃气灶），用于验证"型号命中召回提醒" |

> models 种子数据为公开渠道可查的高频型号示例，型号与说明书链接以品牌官网为准；后续靠条码 API 兜底 + 用户建档 UGC 持续扩充。`getBarcodeInfo` 云函数支持 `action: "matchModel"` 按品牌+型号文本模糊匹配，供 OCR/手输型号兜底。

## 六、已知限制（架构已按此设计）

- 个人主体**仅一次性订阅消息**：保修到期可推送；国补/召回走站内"政策"页提醒（`scanRecall` 抓取的召回会匹配设备型号并在首页/详情标红）。
- 升级企业主体 + 服务号后可解锁真正的召回/政策推送与以旧换新 CPS 变现，代码无需大改。

## 七、下一步

1. 真机预览，家人群 10 人建档测试：扫码命中率、是否愿意填购机日、家庭共享是否被用。
2. 按测试结果优化建档漏斗（补 OCR 兜底路径）。
3. 型号库 UGC 贡献机制（建档即贡献 + 激励）。
