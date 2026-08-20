const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// TODO: 在微信公众平台「功能 → 订阅消息」申请"保修到期提醒"类模板后替换
const TEMPLATE_ID = 'YOUR_WARRANTY_TEMPLATE_ID'

function pad(n) { return n < 10 ? '0' + n : '' + n }
function fmt(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
function addDays(base, n) {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return fmt(d)
}

/**
 * 每日定时（建议 09:00）执行：
 * 1. 找出保修在 (今天, 今天+7] 内到期的设备
 * 2. 对每台设备上已订阅且未使用的用户下发一次性订阅消息
 * 3. 下发后标记 used = true（一次性订阅授权只能发一条）
 */
exports.main = async () => {
  const today = fmt(new Date())
  const end = addDays(today, 7)

  const devices = await db.collection('devices')
    .where({
      warrantyEnd: _.gt(today).and(_.lte(end))
    })
    .limit(100)
    .get()

  let sent = 0
  let failed = 0

  for (const dev of devices.data) {
    const subs = await db.collection('subscriptions')
      .where({ deviceId: dev._id, used: false })
      .get()

    for (const s of subs.data) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: s.openid,
          templateId: TEMPLATE_ID,
          page: 'pages/device-detail/device-detail?id=' + dev._id,
          data: {
            thing1: { value: (dev.name || dev.model || '家电').slice(0, 20) },
            time2: { value: dev.warrantyEnd },
            thing3: { value: '保修即将到期，请在到期前联系售后检查' }
          }
        })
        await db.collection('subscriptions').doc(s._id).update({
          data: { used: true, sentAt: db.serverDate() }
        })
        sent++
      } catch (e) {
        failed++
        console.error('send fail', s._id, e)
      }
    }
  }

  return { code: 0, scannedDevices: devices.data.length, sent, failed }
}
