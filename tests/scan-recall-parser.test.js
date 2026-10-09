const {
  parseRecallList,
  parseRecallDetail,
  buildRecallDocuments,
  buildRecallBackfillPatch,
  isHomeApplianceRecall
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
    ['冰箱贴', false],
    ['电视柜', false],
    ['空调被', false],
    ['电风扇造型玩具', false],
    ['挂烫机', true],
    ['除湿机', true],
    ['空气炸锅', true]
  ])('classifies %s as appliance=%s', (text, expected) => {
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
  })
})
