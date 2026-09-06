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

/** 生产者全称 → 品牌短名（匹配到已知品牌关键词即返回，否则截前 8 字兜底） */
function mapProducerToBrand(producer) {
  if (!producer) return ''
  const keywords = ['美的', '海尔', '格力', '海信', 'TCL', '小米', '奥克斯', '容声', '长虹', '创维', '华凌', '统帅']
  for (const k of keywords) {
    if (producer.indexOf(k) > -1) return k
  }
  return String(producer).slice(0, 8)
}

/** 型号前缀 + 国家标准 → 品类（与前端 CATEGORIES 枚举对齐） */
function inferCategory(model, gb) {
  const m = String(model || '').toUpperCase()
  const g = String(gb || '')
  if (m.indexOf('KFR') === 0 || m.indexOf('KF-') === 0 || g.indexOf('21455') > -1 || g.indexOf('12021.3') > -1) return '空调'
  if (m.indexOf('BCD') === 0 || m.indexOf('BD') === 0 || m.indexOf('BC') === 0 || g.indexOf('12021.2') > -1) return '冰箱'
  if (m.indexOf('XQG') === 0 || m.indexOf('XQB') === 0 || m.indexOf('EB') === 0 || m.indexOf('MD') === 0 || g.indexOf('12021.4') > -1) return '洗衣机'
  if (m.indexOf('CXW') === 0 || g.indexOf('29539') > -1) return '油烟机'
  if (g.indexOf('21519') > -1 || g.indexOf('20665') > -1) return '热水器'
  if (g.indexOf('24850') > -1) return '电视'
  return '' // 推断失败返回空，由用户选择
}

/** 判断扫码内容是否为能效标识二维码（官方备案 URL 或第三方能效短链） */
function isEnergyLabelQr(raw) {
  return /energylabel\.com\.cn/i.test(raw) || /bbqk\.com\//i.test(raw)
}

/** JSON POST（5s 超时快速失败，与 httpsGet 对齐） */
function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://www.energylabel.com.cn',
        'Referer': 'https://www.energylabel.com.cn/signDetails'
      }
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('bad json: ' + data.slice(0, 60))) }
      })
    })
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** 官方备案 productType（中文）→ 品类（与前端 CATEGORIES 枚举对齐），失配时回退型号前缀推断 */
function mapProductTypeToCategory(productType, model, gb) {
  const t = String(productType || '')
  if (t.indexOf('冰箱') > -1 || t.indexOf('冷柜') > -1) return '冰箱'
  if (t.indexOf('空调') > -1) return '空调'
  if (t.indexOf('洗衣机') > -1) return '洗衣机'
  if (t.indexOf('热水器') > -1 || t.indexOf('燃气灶') > -1 || t.indexOf('燃气具') > -1) return '热水器'
  if (t.indexOf('油烟机') > -1 || t.indexOf('吸油烟机') > -1) return '油烟机'
  if (t.indexOf('电视') > -1) return '电视'
  if (t.indexOf('电饭') > -1) return '电饭煲'
  return inferCategory(model, gb)
}

/**
 * 能效码解析结果自动缓存入 models（source=energylabel）
 * 同 brand+model 未入库时才写；失败吞错不影响扫码主流程。
 * 数据来源为官方备案公告/bbqk 结构化数据（机器来源，非用户手填），与 barcode-api 缓存同级信任
 */
async function cacheEnergyModel({ brand, category, model, level, energyUid }) {
  try {
    const dup = await db.collection('models')
      .where({ brand, model })
      .count()
    if (dup.total === 0) {
      await db.collection('models').add({
        data: {
          brand,
          category,
          model: String(model).slice(0, 50),
          name: `${brand} ${model}`.slice(0, 30),
          manualUrl: '',
          level: level || '',
          source: 'energylabel',
          energyUid,
          createdAt: db.serverDate()
        }
      })
    }
  } catch (e) {
    console.warn('energylabel cache write fail', e.message)
  }
}

/**
 * 解析能效标识二维码 → 统一返回结构
 * 官方 URL 分支：调用中国能效标识网公开备案详情接口（signDetails 页面同源，无鉴权）
 * 自动取回品牌/型号/能效等级用于建档回填；接口失败降级为引导手动填写（fail-open）。
 * 合规边界：不声称官方授权/合作，数据仅用于用户主动扫码建档时的表单回填，
 * 不提供独立"备案查询"功能入口（CNIS 2025-09 公告风险已知悉，见 docs/research 竞品调研）
 */
async function resolveEnergyLabel(raw) {
  // 1. 官方能效标识网 URL：提取备案参数调公开接口自动取数
  if (/energylabel\.com\.cn/i.test(raw)) {
    const q = (k) => {
      const m = raw.match(new RegExp('[?&]' + k + '=([^&]+)'))
      return m ? decodeURIComponent(m[1]) : ''
    }
    const productId = q('productId')
    if (!productId) {
      return { code: 0, kind: 'energylabel', found: false, needManual: true, raw,
        hint: '未获取到备案号，请手动输入' }
    }
    try {
      const resp = await httpsPostJson(
        'https://www.energylabel.com.cn/admin-api/gateway/productRegistration/productDetailById',
        {
          productId,
          productTypeCode: q('productTypeCode'),
          mark: q('tenantId'),
          isSign: 'true',
          isOld: q('isOld') || 1,
          originalExtendId: 0
        }
      )
      const d = resp && resp.code === 200 && resp.data
      if (d && d.productModel) {
        const brand = mapProducerToBrand(d.producerName)
        const model = String(d.productModel).slice(0, 50)
        const category = mapProductTypeToCategory(d.productType, model, d.standard)
        const level = String(d.nxLever || '')
        await cacheEnergyModel({ brand, category, model, level, energyUid: 'EL' + productId })
        return {
          code: 0,
          kind: 'energylabel',
          found: true,
          brand,
          model,
          category,
          level,
          producer: d.producerName || '',
          raw
        }
      }
    } catch (e) {
      console.warn('energylabel official api fail', e.message)
    }
    // 降级：接口失败/未取到数据 → 保持引导手填
    return { code: 0, kind: 'energylabel', found: false, needManual: true, productId, raw,
      hint: '已识别官方能效备案号，自动获取信息失败。请对照能效标识下方印制的「生产者名称」与「规格型号」填写品牌与型号' }
  }

  // 2. bbqk 第三方短链：请求公开数据接口拿品牌/型号/品类
  const bbqkMatch = raw.match(/bbqk\.com\/([a-zA-Z0-9]+)/)
  if (!bbqkMatch) {
    return { code: 0, kind: 'energylabel', found: false, raw,
      msg: '暂不支持该二维码格式，请手动输入型号' }
  }
  const uid = bbqkMatch[1]
  const infoUrl = `https://bbqk.pzjdimg.com/uid/${uid}/helinfo.json`
  try {
    const data = await httpsGet(infoUrl)
    const json = JSON.parse(data)
    if (!json.model) {
      return { code: 0, kind: 'energylabel', found: false, raw,
        msg: '未获取到型号信息，请手动输入' }
    }
    const brand = mapProducerToBrand(json.producer)
    const category = inferCategory(json.model, json.gb)

    // 自动缓存：与官方分支共用 cacheEnergyModel（同 brand+model 去重，失败不影响主流程）
    await cacheEnergyModel({ brand, category, model: json.model, level: json.level, energyUid: uid })

    return {
      code: 0,
      kind: 'energylabel',
      found: true,
      brand,
      model: json.model,
      category,
      level: json.level,
      producer: json.producer,
      raw
    }
  } catch (e) {
    console.warn('resolveEnergyLabel error', e)
    return { code: 0, kind: 'energylabel', found: false, raw,
      msg: '能效信息获取失败，请手动输入' }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

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

  // 统一扫码入口：兼容 code（商品条码）与 qrContent（能效二维码），按内容自动路由
  const code = String(event.qrContent || event.code || '').trim()
  if (!code) return { code: 1, msg: '缺少条码参数' }

  // 能效标识二维码 → 能效解析；其余（纯数字条码 / 其他码制）→ 商品条码查询
  if (action === 'parseEnergyLabel' || isEnergyLabelQr(code)) {
    return resolveEnergyLabel(code)
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
      kind: 'barcode',
      found: true,
      source: 'model-db',
      brand: m.brand,
      category: m.category,
      model: m.model,
      name: m.name,
      manualUrl: m.manualUrl || '',
      scanned: { raw: code, matchedFrom: 'local' }  // Fixed P0-2: Return scanned code for cache writeback
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
          kind: 'barcode',
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
  // 纯数字码（6-20 位）在条码链路未命中后，标记为疑似能效备案号：
  // 能效标识二维码部分内容为纯数字备案号，与商品条码（8/12/13 位）区分靠
  // "先走完条码链路再标记"的顺序保证，避免 EAN-13 条码被误判
  const suspectEnergyId = /^\d{6,20}$/.test(code) ? code : ''
  return {
    code: 0,
    kind: 'barcode',
    found: false,
    raw: code,
    suspectEnergyId,
    msg: suspectEnergyId
      ? '疑似能效备案号，可在官方「绿色低碳码」小程序查验'
      : '未在型号库命中，请手动确认型号或拍照识别铭牌'
  }
}
