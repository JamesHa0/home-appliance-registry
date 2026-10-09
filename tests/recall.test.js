const { normalizeModel } = require('../utils/recall')
const { normalizeModel: normalizeCloudModel } = require('../cloudfunctions/familyService/utils/recall')

describe('recall model normalization', () => {
  test('normalizes casing, spaces, punctuation and full-width text', () => {
    expect(normalizeModel(' KFR－35GW/N8KS1-1 ')).toBe('KFR35GWN8KS11')
    expect(normalizeModel('ｘｑｇ１００．ａ')).toBe('XQG100A')
  })

  test('keeps Chinese model characters', () => {
    expect(normalizeModel('型号-甲/01')).toBe('型号甲01')
  })

  test('keeps frontend and cloud normalization aligned', () => {
    expect(normalizeCloudModel(' KFR－35GW/N8KS1-1 ')).toBe(normalizeModel('KFR-35GW/N8KS1-1'))
  })
})
