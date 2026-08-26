/**
 * 保修规则表（品牌 × 品类 → 保修年限）
 * 数据依据各品牌官网公开保修政策整理，以官方最新政策为准，可在云数据库 warranty_rules 集合覆盖。
 * 未收录品牌/品类回退 default。
 */
const WARRANTY_RULES = Object.freeze({
  '美的': { '空调': 6, '洗衣机': 3, '冰箱': 3, '电视': 3, '热水器': 8, '油烟机': 5, 'default': 3 },
  '海尔': { '空调': 6, '洗衣机': 3, '冰箱': 3, '电视': 3, '热水器': 8, '油烟机': 5, 'default': 3 },
  '小米': { '空调': 6, '电视': 1, 'default': 1 },
  '格力': { '空调': 6, 'default': 3 },
  '海信': { '电视': 1, '空调': 6, 'default': 1 },
  'TCL': { '电视': 1, '空调': 6, 'default': 1 },
  'default': { 'default': 1 }
})

/**
 * 获取某品牌某品类的保修年限（年）
 */
function getWarrantyYears(brand, category) {
  const brandRules = WARRANTY_RULES[brand] || WARRANTY_RULES['default']
  return brandRules[category] || brandRules['default'] || 1
}

/**
 * 计算保修到期日：购机日 + 保修年限
 * @param {string} purchaseDate 'YYYY-MM-DD'
 * @param {string} brand
 * @param {string} category
 * @param {number} customYears 手动覆盖的年限（可选）
 * @returns {string} 'YYYY-MM-DD'
 */
function calcWarrantyEnd(purchaseDate, brand, category, customYears) {
  const years = (customYears !== undefined && customYears !== null) ? customYears : getWarrantyYears(brand, category)
  const d = new Date(String(purchaseDate).replace(/-/g, '/'))
  if (isNaN(d.getTime())) throw new Error('无效的购机日期')
  const originalDay = d.getDate()
  d.setFullYear(d.getFullYear() + years)
  // 闰年 2/29 溢出到 3/1 时，回退到目标月最后一天
  if (d.getDate() !== originalDay) {
    d.setDate(0)
  }
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

module.exports = {
  WARRANTY_RULES,
  getWarrantyYears,
  calcWarrantyEnd
}
