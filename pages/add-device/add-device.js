const warrantyUtil = require('../../utils/warranty')
const format = require('../../utils/format')

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
    saving: false
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
      const app = getApp()
      const db = wx.cloud.database()
      let familyId = app.globalData.familyId

      // 首次建档且无家庭：自动创建个人家庭
      if (!familyId) {
        const openid = app.globalData.openid || 'pending'
        const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
        const fam = await db.collection('families').add({
          data: {
            name: '我的家',
            ownerOpenid: openid,
            members: [openid],
            inviteCode,
            createdAt: db.serverDate()
          }
        })
        familyId = fam._id
        app.globalData.familyId = familyId
      }

      const years = this.data.warrantyYears || warrantyUtil.getWarrantyYears(form.brand, form.category)
      await db.collection('devices').add({
        data: {
          familyId,
          brand: form.brand,
          category: form.category,
          model: form.model,
          name: form.name || (form.brand + ' ' + form.model),
          purchaseDate: form.purchaseDate,
          warrantyYears: years,
          warrantyEnd: warrantyUtil.calcWarrantyEnd(form.purchaseDate, form.brand, form.category, years),
          barcode: (this.data.scanned && this.data.scanned.raw) || '',
          createdAt: db.serverDate()
        }
      })

      wx.showToast({ title: '建档成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
      console.warn(e)
    } finally {
      this.setData({ saving: false })
    }
  }
})
