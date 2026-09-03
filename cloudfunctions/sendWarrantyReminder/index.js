const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 订阅模板「保修到期提醒」：物品名称(thing8) / 到期时间(time7) / 剩余天数(number12) / 温馨提示(thing5)
const TEMPLATE_ID = '0URiO7JaaTCkQFaIaEfsfX4ZbxifBUuAthJt0VpWcrA'

function pad(n) { return n < 10 ? '0' + n : '' + n }
function fmt(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
function addDays(base, n) {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return fmt(d)
}
/** 距离到期日还有多少天（到期日当天=0，已过期取 0 并可由提示语区分） */
function daysUntil(dateStr) {
  const p = dateStr.split('-').map(Number)
  const target = new Date(p[0], p[1] - 1, p[2])
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((target - today) / 86400000))
}

/**
 * 每日定时（建议 09:00）执行：
 * 1. 找出保修在 (今天, 今天+7] 内到期的设备
 * 2. 对每台设备上已订阅且未使用的用户下发一次性订阅消息
 * 3. 下发后标记 used = true（一次性订阅授权只能发一条）
 */
exports.main = async () => {
  if (TEMPLATE_ID.indexOf('YOUR_') === 0) {
    return { code: 0, skipped: true, msg: '未配置订阅模板，已跳过' }
  }

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
    // 过滤已标记 invalid 的记录（连续 3 次发送失败），避免永久失败记录每日反复重试
    const subs = await db.collection('subscriptions')
      .where({ deviceId: dev._id, used: false, invalid: _.neq(true) })
      .get()

    for (const s of subs.data) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: s.openid,
          templateId: TEMPLATE_ID,
          page: 'pages/device-detail/device-detail?id=' + dev._id,
          data: {
            thing8: { value: (dev.name || dev.model || '家电').slice(0, 20) },
            time7: { value: dev.warrantyEnd },
            number12: { value: daysUntil(dev.warrantyEnd) },
            thing5: { value: daysUntil(dev.warrantyEnd) === 0 ? '保修已到期，请尽快联系售后' : '保修即将到期，请及时联系售后' }
          }
        })
        await db.collection('subscriptions').doc(s._id).update({
          data: { used: true, sentAt: db.serverDate() }
        })
        sent++
      } catch (e) {
        failed++
        console.error('send fail', s._id, e)
        // 失败重试上限：连续 3 次失败标记 invalid，避免永久失败记录反复触发
        const failCount = (s.failCount || 0) + 1
        await db.collection('subscriptions').doc(s._id).update({
          data: { failCount, ...(failCount >= 3 ? { invalid: true } : {}) }
        }).catch(() => {})
      }
    }
  }

  return { code: 0, scannedDevices: devices.data.length, sent, failed }
}
