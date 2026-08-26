const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 第三方条码查询 API（中国物品编码中心官方注册库直连封装，见研究报告 5.2 节）
// APIZero「商品条码查询PRO」：鉴权为 query 参数 key=，见 https://apizero.cn/aidocs/barcode-gs1
// 部署时在云函数「配置 → 环境变量」设置 BARCODE_API_KEY（如 sk_xxx），留空则跳过在线查询，仅用本地型号库
const BARCODE_API_URL = 'https://v1.apizero.cn/api/barcode-gs1'
const BARCODE_API_KEY = process.env.BARCODE_API_KEY || ''

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    })
    // 5s 超时：API 挂起时快速失败走兜底，不拖到云函数默认超时
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
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

  // 2. 在线条码反查（GS1 官方注册库：品牌 + 品类 + 商品名，不保证含型号）
  if (BARCODE_API_KEY) {
    try {
      const raw = await httpsGet(`${BARCODE_API_URL}?code=${encodeURIComponent(code)}&key=${BARCODE_API_KEY}`)
      const json = JSON.parse(raw)
      const d = json.data || {}
      // found=false（未注册/进口条码）时业务字段为 null，直接走兜底
      if (d.found !== false) {
        const brand = d.brand || d.manufacturer || ''
        const category = d.category || d.general_name || ''
        const name = d.name || d.general_name || ''
        // 回写 models 缓存：同码二次扫描直接本地命中，省 API 额度（GS1 无型号，model 留空）
        const cached = await db.collection('models')
          .where({ barcode: code })
          .limit(1)
          .get()
          .catch(() => ({ data: [] }))
        if (!cached.data.length) {
          await db.collection('models').add({
            data: {
              brand: String(brand).slice(0, 20),
              category: String(category).slice(0, 20),
              model: '',
              name: String(name).slice(0, 30),
              barcode: String(code).slice(0, 20),
              manualUrl: '',
              source: 'barcode-api',
              createdAt: db.serverDate()
            }
          }).catch(e => console.warn('barcode cache write fail', e.message))
        }
        return {
          code: 0,
          found: true,
          source: 'barcode-api',
          brand,
          category,
          model: '',
          name
        }
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
