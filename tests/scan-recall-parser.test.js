const {
  parseRecallList,
  parseRecallDetail,
  buildRecallDocuments,
  buildRecallBackfillPatch,
  isHomeApplianceRecall,
  extractModels,
  HOME_APPLIANCE_KEYWORDS
} = require('../cloudfunctions/scanRecall/parser')

const LIST_HTML = `
  <ul>
    <li>
      <a href="./202609/t20260928_116125.html">
        【河南】郑州洛蒂娅环保科技有限公司召回部分洛蒂娅牌吸附式熨烫机
      </a>
    </li>
    <li>
      <a href="./202609/t20260921_116098.html">
        【上海】上海启漫科技有限公司召回部分启漫牌理发剪
      </a>
    </li>
  </ul>
`

const DETAIL_HTML = `
  <html>
    <body>
      <h1>【河南】郑州洛蒂娅环保科技有限公司召回部分洛蒂娅牌吸附式熨烫机</h1>
      <div>发布时间：2026-09-24</div>
      <p>
        日前，郑州洛蒂娅环保科技有限公司召回部分洛蒂娅牌吸附式熨烫机
        （型号/规格：LDY-YT-07），涉及数量为 47 台。
      </p>
    </body>
  </html>
`

describe('scanRecall parser', () => {
  test('parses anchor titles and resolves detail links', () => {
    const items = parseRecallList(LIST_HTML)
    expect(items).toHaveLength(2)
    expect(items[0].title).toContain('熨烫机')
    expect(items[0].detailUrl).toBe(
      'https://www.samrdprc.org.cn/xfpzh/xfpgnzh/202609/t20260928_116125.html'
    )
  })

  test('ignores navigation anchors without a province tag', () => {
    const items = parseRecallList(
      '<a href="/"><span>国内消费品召回新闻</span></a>' + LIST_HTML
    )
    expect(items).toHaveLength(2)
    expect(items.every(item => item.title.includes('【'))).toBe(true)
  })

  test('parses detail model, brand, category and publish date', () => {
    const detail = parseRecallDetail(
      DETAIL_HTML,
      'https://www.samrdprc.org.cn/xfpzh/xfpgnzh/202609/t20260928_116125.html'
    )
    expect(detail.models).toEqual([{ model: 'LDY-YT-07', normalized: 'LDYYT07' }])
    expect(detail.brand).toBe('洛蒂娅')
    expect(detail.category).toBe('')
    expect(detail.publishedAt).toBe('2026-09-24')
  })

  test('rejects unrelated consumer recalls', () => {
    expect(isHomeApplianceRecall('【上海】某公司召回部分品牌理发剪')).toBe(false)
    expect(isHomeApplianceRecall('【河南】某公司召回部分品牌吸附式熨烫机')).toBe(true)
  })

  test.each([
    ['【广东】某公司召回部分品牌冰箱贴', false],
    ['【广东】某公司召回部分品牌电视柜', false],
    ['【广东】某公司召回部分品牌电视机柜', false],
    ['【广东】某公司召回部分品牌空调被', false],
    ['【广东】某公司召回部分品牌电风扇造型玩具', false],
    ['【广东】某公司召回部分品牌玩具电风扇', false],
    ['【浙江】某公司召回部分品牌挂烫机', true],
    ['【浙江】某公司召回部分品牌除湿机', true],
    ['【浙江】某公司召回部分品牌空气炸锅', true]
  ])('classifies %s as appliance=%s', (text, expected) => {
    expect(isHomeApplianceRecall(text)).toBe(expected)
  })

  const derivedToyTerms = HOME_APPLIANCE_KEYWORDS.filter(keyword => keyword !== '家电')
  const derivedToyCases = derivedToyTerms.flatMap(keyword => [
    [`【测试】某公司召回部分品牌${keyword}造型玩具`, false],
    [`【测试】某公司召回部分品牌玩具${keyword}`, false]
  ])
  test.each(derivedToyCases)('derived exclusion handles %s', (text, expected) => {
    expect(isHomeApplianceRecall(text)).toBe(expected)
  })

  test('expands multiple models into independent records', () => {
    const detail = parseRecallDetail(
      `${DETAIL_HTML.replace('LDY-YT-07', 'ABC-1、ABC-2')}`,
      'https://example.com/detail'
    )
    const docs = buildRecallDocuments(
      { title: '某公司召回部分品牌熨烫机', detailUrl: 'https://example.com/detail' },
      detail
    )
    expect(docs.map(doc => doc.model)).toEqual(['ABC-1', 'ABC-2'])
    expect(docs.map(doc => doc.sourceKey)).toEqual([
      'https://example.com/detail#ABC1',
      'https://example.com/detail#ABC2'
    ])
  })

  test('parses model text without a colon', () => {
    const detail = parseRecallDetail(`
      <div>发布时间：2026-09-23</div>
      <div>型号/规格 LR-SS117 生产起止日期 2024年12月1日至2024年12月30日</div>
    `)
    expect(detail.models).toEqual([{ model: 'LR-SS117', normalized: 'LRSS117' }])
  })

  test('builds an idempotent legacy recall backfill patch', () => {
    expect(buildRecallBackfillPatch({
      model: 'm 1',
      link: 'https://example.com/recall'
    })).toEqual({
      modelNormalized: 'M1',
      sourceKey: 'https://example.com/recall#M1'
    })
    expect(buildRecallBackfillPatch({
      model: 'M-1',
      modelNormalized: 'M1',
      sourceKey: 'https://example.com/recall#M1'
    })).toEqual({})
    expect(buildRecallBackfillPatch(null)).toEqual({})
    expect(buildRecallBackfillPatch(undefined)).toEqual({})
    expect(buildRecallBackfillPatch({})).toEqual({})
  })

  test('rejects malformed HTML fragments as model values', () => {
    expect(extractModels('<div>型号/规格：22-24cm..."></div>')).toEqual([])
    expect(extractModels('<div>型号/规格：5kg/..."></div>')).toEqual([])
    expect(extractModels('<div>型号/规格：5kg/桶</div>')).toEqual([])
    expect(extractModels('<div>型号/规格：ZTNW40（cm</div>')).toEqual([])
  })

  test.each([
    ['5kg'],
    ['60L'],
    ['220V'],
    ['300W'],
    ['1.5kg']
  ])('rejects unit-like value %s', value => {
    expect(extractModels(`<div>型号/规格：${value}</div>`)).toEqual([])
  })

  test.each([
    'KFR-35GW/N8KS1-1',
    'KFR-72LW/N1A1',
    'MD100V70DG',
    'XQG100MJ106',
    'BCD-516WFGPZM',
    'BCD-501WGPM',
    'ES60H-C6',
    'F60-21BA6',
    '65R5',
    'EA55',
    'L70M5-4A',
    'CXW-260-JCD7',
    'JZT-968BX',
    'MB-FB40Simple111',
    'LDY-YT-07',
    'LR-SS117',
    '5G-M1',
    '300WX',
    'AB.12',
    'RX-16L8',
    'M-1'
  ])('preserves valid model %s', model => {
    expect(extractModels(`<div>型号/规格：${model}</div>`)).toEqual([
      expect.objectContaining({ model })
    ])
  })
})
