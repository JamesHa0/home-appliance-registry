const warrantyUtil = require('../../utils/warranty')
const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

const CATEGORIES = ['空调', '冰箱', '洗衣机', '电视', '热水器', '油烟机', '电饭煲', '其他']

Page({
  data: {
    categories: CATEGORIES,
    categoryIndex: -1,
    form: {
      brand: '',
      category: '',
      model: '',
      name: '',
      purchaseDate: format.today()
    },
    warrantyYears: 0,
    warrantyEnd: '',
    scanned: null,
    recognizing: false,
    saving: false,
    contribute: true
  },

  /** 扫码识别：机身条码 → 云函数（本地型号库 → 条码 API）→ 回填表单 */
  async scan() {
    this.setData({ recognizing: true })
    try {
      const res = await new Promise((resolve, reject) => {
        wx.scanCode({
          scanType: ['barCode', 'qrCode', 'datamatrix'],
          onlyFromCamera: true,
          success: resolve,
          fail: reject
        })
      })
      const result = await wx.cloud.callFunction({ name: 'getBarcodeInfo', data: { code: res.result } })
      const r = result.result
      if (r.found) {
        const idx = CATEGORIES.indexOf(r.category)
        this.setData({
          scanned: r,
          'form.brand': r.brand,
          'form.category': r.category,
          'form.model': r.model || '',
          'form.name': r.name || '',
          categoryIndex: idx >= 0 ? idx : -1
        })
        this.recalcWarranty()
        wx.showToast({ title: '识别成功', icon: 'success' })
      } else {
        this.setData({ scanned: { raw: res.result, found: false } })
        wx.showToast({ title: r.msg || '未识别，请手动补全', icon: 'none' })
      }
    } catch (e) {
      if (e.errMsg && e.errMsg.indexOf('cancel') > -1) return
      wx.showToast({ title: '扫码失败', icon: 'none' })
    } finally {
      this.setData({ recognizing: false })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
    if (field === 'brand') this.recalcWarranty()
  },

  onCategory(e) {
    const i = Number(e.detail.value)
    this.setData({ categoryIndex: i, 'form.category': CATEGORIES[i] })
    this.recalcWarranty()
  },

  onDate(e) {
    this.setData({ 'form.purchaseDate': e.detail.value })
    this.recalcWarranty()
  },

  onContributeChange(e) {
    this.setData({ contribute: e.detail.value })
  },

  /** 按品牌×品类规则自动计算保修年限与到期日 */
  recalcWarranty() {
    const { brand, category, purchaseDate } = this.data.form
    if (brand && category && purchaseDate) {
      const years = warrantyUtil.getWarrantyYears(brand, category)
      this.setData({
        warrantyYears: years,
        warrantyEnd: warrantyUtil.calcWarrantyEnd(purchaseDate, brand, category, years)
      })
    }
  },

  async save() {
    const { form } = this.data
    if (!form.brand || !form.category || !form.model) {
      wx.showToast({ title: '请补全品牌/品类/型号', icon: 'none' })
      return
    }
    if (!form.purchaseDate) {
      wx.showToast({ title: '请选择购机日期', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      // 建档统一经 familyService：服务端自动取/建家庭，并处理 UGC 型号贡献
      const years = this.data.warrantyYears || warrantyUtil.getWarrantyYears(form.brand, form.category)
      const res = await cloud.call('familyService', {
        action: 'createDevice',
        device: {
          brand: form.brand,
          category: form.category,
          model: form.model,
          name: form.name,
          purchaseDate: form.purchaseDate,
          warrantyYears: years,
          warrantyEnd: warrantyUtil.calcWarrantyEnd(form.purchaseDate, form.brand, form.category, years),
          barcode: (this.data.scanned && this.data.scanned.raw) || ''
        },
        contribute: this.data.contribute
      })

      if (res.data && res.data.familyId) {
        getApp().globalData.familyId = res.data.familyId
      }
      wx.showToast({ title: '建档成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (e) {
      wx.showToast({ title: '保存失败：' + (e.message || ''), icon: 'none' })
      console.warn(e)
    } finally {
      this.setData({ saving: false })
    }
  }
})
