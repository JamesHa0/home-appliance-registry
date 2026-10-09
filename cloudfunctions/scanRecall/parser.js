const DEFAULT_LIST_URL = 'https://www.samrdprc.org.cn/xfpzh/xfpgnzh/'

const HOME_APPLIANCE_KEYWORDS = [
  '空调', '冰箱', '冰柜', '洗衣机', '电视', '热水器', '燃气灶', '油烟机',
  '电饭煲', '电压力锅', '电蒸锅', '熨烫机', '剃须刀', '吹风机', '热水壶',
  '电风扇', '取暖器', '净水器', '洗碗机', '微波炉', '烤箱', '电磁炉',
  '吸尘器', '空气净化器', '加湿器', '挂烫机', '除湿机', '空气炸锅', '家电'
]

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applianceRegexFragment(keyword) {
  if (keyword === '电视') return '电视(?:机)?'
  return escapeRegex(keyword)
}

const TOY_EXCLUDED_APPLIANCE_ALTERNATION = HOME_APPLIANCE_KEYWORDS
  .filter(keyword => keyword !== '家电')
  .sort((a, b) => b.length - a.length)
  .map(applianceRegexFragment)
  .join('|')

const EXCLUDED_PRODUCT_PATTERNS = [
  /冰箱贴|冰箱贴纸|冰箱除味|冰箱清洁剂|冰箱收纳/,
  /电视(?:机)?柜|电视(?:机)?架|电视(?:机)?背景墙|电视(?:机)?盒|电视(?:机)?支架/,
  /空调被|空调毯|空调罩|空调清洁剂/,
  new RegExp(`(?:${TOY_EXCLUDED_APPLIANCE_ALTERNATION})(?:造型|模型|玩具)`),
  new RegExp(`(?:造型|模型|玩具)(?:款|型|版)?(?:${TOY_EXCLUDED_APPLIANCE_ALTERNATION})`)
]

const CATEGORY_KEYWORDS = [
  ['空调', '空调'],
  ['冰箱', '冰箱'],
  ['冰柜', '冰箱'],
  ['洗衣机', '洗衣机'],
  ['电视', '电视'],
  ['热水器', '热水器'],
  ['油烟机', '油烟机'],
  ['电饭煲', '电饭煲'],
  ['电压力锅', '其他'],
  ['电蒸锅', '其他']
]

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[<>]+/g, ' ')
    .replace(/["'“”‘’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveUrl(href, baseUrl = DEFAULT_LIST_URL) {
  try {
    return new URL(href, baseUrl).toString()
  } catch (e) {
    return ''
  }
}

function parseRecallList(html, baseUrl = DEFAULT_LIST_URL) {
  const items = []
  const seen = new Set()
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = anchorRe.exec(String(html || ''))) !== null) {
    const detailUrl = resolveUrl(match[1], baseUrl)
    const title = stripHtml(match[2])
    if (
      !detailUrl ||
      !title ||
      !title.includes('【') ||
      !title.includes('召回') ||
      title.length < 8
    ) continue
    if (seen.has(detailUrl)) continue
    seen.add(detailUrl)
    items.push({ title, detailUrl })
  }
  return items
}

function isHomeApplianceRecall(text) {
  const value = String(text || '').replace(/\s+/g, '')
  if (!value) return false
  if (EXCLUDED_PRODUCT_PATTERNS.some(pattern => pattern.test(value))) return false
  return HOME_APPLIANCE_KEYWORDS.some(keyword => value.includes(keyword))
}

function inferCategory(text) {
  const value = String(text || '')
  const match = CATEGORY_KEYWORDS.find(([keyword]) => value.includes(keyword))
  return match ? match[1] : ''
}

function extractPublishedAt(html) {
  const text = stripHtml(html)
  const match = text.match(/发布时间[：:\s]*(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})/)
  if (!match) return ''
  const month = String(Number(match[2])).padStart(2, '0')
  const day = String(Number(match[3])).padStart(2, '0')
  return `${match[1]}-${month}-${day}`
}

function extractBrand(title, detailText) {
  const value = `${title || ''} ${detailText || ''}`
  const prefixed = value.match(/(?:召回部分|部分|召回|涉及)([\u4e00-\u9fa5A-Za-z0-9]{2,20})牌/)
  if (prefixed) return prefixed[1]
  const fallback = value.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20})牌/)
  return fallback ? fallback[1] : ''
}

function normalizeModel(value) {
  const text = String(value || '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
  return text.replace(/[^A-Z0-9\u4e00-\u9fff]/g, '')
}

function isLikelyModel(value) {
  const raw = String(value || '').trim()
  if (raw.length < 2 || raw.length > 60) return false
  if (/[<>"']/.test(raw) || /\.{2,}/.test(raw)) return false
  const unbalancedBracket = [
    ['(', ')'],
    ['（', '）'],
    ['[', ']'],
    ['【', '】']
  ].some(([open, close]) => raw.split(open).length !== raw.split(close).length)
  if (unbalancedBracket) return false
  if (/^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?(?:cm|mm|kg|ml|kw|hz|g|l|L|V|W|A)(?![A-Za-z])/.test(raw)) {
    return false
  }
  if (/[年月日件台个只数量涉及生产制造期间]/.test(raw)) return false
  if (!/[A-Za-z0-9]/.test(raw)) return false
  if (/^GB\d/i.test(raw)) return false
  return /[A-Za-z]/.test(raw) || /^\d{4,}$/.test(raw)
}

function extractModels(html) {
  const text = stripHtml(html)
  const captured = []
  const patterns = [
    /型号\s*\/\s*规格\s*[：:]\s*([^。；;）)】\]]+)/g,
    /型号\s*\/\s*规格\s+([A-Za-z0-9][A-Za-z0-9._/\-()（）]{1,49})/g,
    /规格型号\s*[：:]\s*([^。；;）)】\]]+)/g,
    /型号\s*[为是]?\s*[：:]\s*([^。；;）)】\]]+)/g
  ]

  for (const re of patterns) {
    let match
    while ((match = re.exec(text)) !== null) {
      captured.push(match[1])
    }
    if (captured.length) break
  }

  const models = []
  const seen = new Set()
  for (const chunk of captured) {
    const candidates = chunk
      .split(/[、,，；;]/)
      .flatMap(part => part.split(/\s+/))
      .map(part => part.replace(/^[（(【\[]+|[）)】\]]+$/g, '').trim())
      .filter(isLikelyModel)

    for (const model of candidates) {
      const normalized = normalizeModel(model)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      models.push({ model, normalized })
    }
  }
  return models
}

function parseRecallDetail(html, baseUrl = DEFAULT_LIST_URL, title = '') {
  const detailText = stripHtml(html)
  return {
    detailText,
    models: extractModels(html),
    brand: extractBrand(title, detailText),
    category: inferCategory(detailText),
    publishedAt: extractPublishedAt(html),
    detailUrl: baseUrl
  }
}

function buildRecallDocuments(listItem, detail) {
  const docs = []
  for (const item of detail.models || []) {
    docs.push({
      title: listItem.title,
      brand: detail.brand || '',
      category: detail.category || '',
      model: item.model,
      modelNormalized: item.normalized,
      source: 'samrdprc',
      link: listItem.detailUrl,
      sourceKey: `${listItem.detailUrl}#${item.normalized}`,
      publishedAt: detail.publishedAt || ''
    })
  }
  return docs
}

function buildRecallBackfillPatch(recall) {
  const source = recall || {}
  const model = String(source.model || '').trim()
  const normalized = normalizeModel(model)
  const patch = {}
  if (model && (source.modelNormalized || '') !== normalized) {
    patch.modelNormalized = normalized
  }
  if (!source.sourceKey && source.link && normalized) {
    patch.sourceKey = `${source.link}#${normalized}`
  }
  return patch
}

module.exports = {
  DEFAULT_LIST_URL,
  HOME_APPLIANCE_KEYWORDS,
  EXCLUDED_PRODUCT_PATTERNS,
  normalizeModel,
  stripHtml,
  parseRecallList,
  parseRecallDetail,
  buildRecallDocuments,
  buildRecallBackfillPatch,
  isHomeApplianceRecall,
  inferCategory,
  extractBrand,
  extractPublishedAt,
  extractModels
}
