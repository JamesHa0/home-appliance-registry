const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 召回公告源：国家市场监督管理总局缺陷产品召回技术中心
// 消费品召回公告列表页（含家电：电饭煲、燃气灶等真实案例）
const RECALL_LIST_URL = 'https://www.samrdprc.org.cn/xfpzh/xfpgnzh/'

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

/**
 * 解析召回公告 HTML。
 * 注意：官网 DOM 可能调整，此为正则兜底方案；
 * 更稳的做法是人工运营录入 + 本函数做增量抓取，两者共用 recalls 集合。
 */
function parseRecalls(html) {
  const items = []
  // 提取形如 "【省份】xxx公司召回部分xxx牌xxx（型号 xxx）" 的标题
  const re = /【[^】]+】([^<]{5,80}?召回[^<]{0,60})/g
  let m
  while ((m = re.exec(html)) !== null) {
    const title = m[1].replace(/\s+/g, '').trim()
    if (title.length < 8) continue
    const modelMatch = title.match(/型号[为：: ]*([A-Za-z0-9\-]+)/)
    items.push({
      title,
      model: modelMatch ? modelMatch[1] : '',
      brand: title.match(/牌([^\s（(]+)/) ? title.match(/牌([^\s（(]+)/)[1] : '',
      source: 'samrdprc',
      link: RECALL_LIST_URL,
      createdAt: db.serverDate()
    })
  }
  return items
}

exports.main = async (event) => {
  const { action } = event || {}
  // 手动触发：action = 'run'；定时触发器自动调用（无参）
  if (action === 'dry') {
    return { code: 0, msg: 'dry run ok' }
  }
  try {
    const html = await httpsGet(RECALL_LIST_URL)
    const items = parseRecalls(html)
    let inserted = 0
    for (const item of items) {
      if (!item.model) continue // 无型号的召回不自动入库，避免误报
      const dup = await db.collection('recalls')
        .where({ title: item.title })
        .count()
      if (dup.total > 0) continue
      await db.collection('recalls').add({ data: item })
      inserted++
    }
    return { code: 0, parsed: items.length, inserted }
  } catch (e) {
    return { code: 1, msg: '召回抓取失败：' + e.message }
  }
}
