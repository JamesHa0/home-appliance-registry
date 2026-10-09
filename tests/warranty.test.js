const warranty = require('../utils/warranty')

describe('warranty date calculation', () => {
  test('rolls leap day back to the last day of February', () => {
    expect(warranty.addYears('2024-02-29', 1)).toBe('2025-02-28')
  })

  test('keeps normal month-end dates stable', () => {
    expect(warranty.addYears('2023-01-31', 1)).toBe('2024-01-31')
    expect(warranty.addYears('2025-12-31', 3)).toBe('2028-12-31')
  })

  test('supports zero-year warranty without changing the date', () => {
    expect(warranty.addYears('2026-02-28', 0)).toBe('2026-02-28')
  })

  test('uses brand and category warranty rules', () => {
    expect(warranty.getWarrantyYears('美的', '空调')).toBe(6)
    expect(warranty.getWarrantyYears('未收录品牌', '未知品类')).toBe(1)
  })
})
