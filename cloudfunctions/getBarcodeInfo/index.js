const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 第三方条码查询 API（中国物品编码中心官方注册库直连封装，见研究报告 5.2 节）
// TODO: 在华为云市场 / APIZero 等购买后填入 Key；留空则跳过在线查询，仅用本地型号库
const BARCODE_API_URL = 'https://v1.apizero.cn/api/barcode-gs1'
const BARCODE_API_KEY = ''

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, code } = event

  // 供前端获取 openid
  if (action === 'openid') {
    return { code: 0, openid: OPENID }
  }
  if (action === 'ping') {
    return { code: 0, pong: true }
  }

  // 按品牌 + 型号文本模糊匹配型号库（OCR 识别 / 手动输入兜底，冷启动核心路径）
  if (action === 'matchModel') {
    const { brand, model } = event
    if (!model) return { code: 1, msg: '缺少型号' }
    const cond = {}
    if (brand) cond.brand = brand
    cond.model = db.RegExp({
      regexp: model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      options: 'i'
    })
    const list = await db.collection('models')
      .where(cond)
      .limit(10)
      .get()
      .catch(() => ({ data: [] }))
    return {
      code: 0,
      list: list.data.map(m => ({
        brand: m.brand,
        category: m.category,
        model: m.model,
        name: m.name,
        manualUrl: m.manualUrl || ''
      }))
    }
  }

  if (!code) {
    return { code: 1, msg: '缺少条码参数' }
  }

  // 1. 优先命中本地型号库（冷启动预置 + UGC 补充）
  const local = await db.collection('models')
    .where({ barcode: code })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))

  if (local.data.length) {
    const m = local.data[0]
    return {
      code: 0,
      found: true,
      source: 'model-db',
      brand: m.brand,
      category: m.category,
      model: m.model,
      name: m.name,
      manualUrl: m.manualUrl || ''
    }
  }

  // 2. 在线条码反查（品牌 + 品类 + 商品名，不保证含型号）
  if (BARCODE_API_KEY) {
    try {
      const raw = await httpsGet(`${BARCODE_API_URL}?code=${encodeURIComponent(code)}`)
      const json = JSON.parse(raw)
      const d = json.data || {}
      return {
        code: 0,
        found: true,
        source: 'barcode-api',
        brand: d.brand || d.厂商 || '',
        category: d.category || d.分类 || '',
        model: d.model || '',
        name: d.productName || d.产品名称 || ''
      }
    } catch (e) {
      console.warn('barcode api error', e.message)
    }
  }

  // 3. 兜底：引导前端 OCR / 手动录入
  return {
    code: 0,
    found: false,
    raw: code,
    msg: '未在型号库命中，请手动确认型号或拍照识别铭牌'
  }
}
