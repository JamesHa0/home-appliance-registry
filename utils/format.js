/**
 * 日期与倒计时格式化工具
 */

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/** Date -> 'YYYY-MM-DD' */
function formatDate(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d.replace(/-/g, '/')) : d
  if (isNaN(date.getTime())) return ''
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** 今天 'YYYY-MM-DD' */
function today() {
  return formatDate(new Date())
}

/** 距离目标日期的天数（目标 - 今天，可为负） */
function daysTo(targetDate) {
  const t = new Date(targetDate.replace(/-/g, '/')).getTime()
  const now = new Date(today().replace(/-/g, '/')).getTime()
  return Math.round((t - now) / 86400000)
}

/**
 * 保修倒计时文案
 * @returns {{status: 'in-warranty'|'expiring'|'expired'|'unknown', text: string}}
 */
function warrantyStatus(warrantyEnd) {
  if (!warrantyEnd) return { status: 'unknown', text: '未设置保修' }
  const d = daysTo(warrantyEnd)
  if (d < 0) return { status: 'expired', text: `已过保 ${-d} 天` }
  if (d === 0) return { status: 'expiring', text: '今天到期' }
  if (d <= 7) return { status: 'expiring', text: `保修剩 ${d} 天` }
  if (d <= 30) return { status: 'expiring', text: `保修剩 ${d} 天` }
  return { status: 'in-warranty', text: `保修剩 ${d} 天` }
}

module.exports = {
  formatDate,
  today,
  daysTo,
  warrantyStatus
}
