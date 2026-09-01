/**
 * 设备管理页面 - 支持新建和编辑双模式
 * @author Qoder
 */
const warrantyUtil = require('../../utils/warranty')
const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

const CATEGORIES = ['空调', '冰箱', '洗衣机', '电视', '热水器', '油烟机', '电饭煲', '其他']

Page({
  data: {
    isEditMode: false, // 是否处于编辑模式
    editDeviceId: null, // 正在编辑的设备 ID
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
    contribute: true,
    todayMax: format.today()  // Fixed P1-1: Store today as max date for picker
  },

  /**
   * 页面加载 - 检测是否在编辑模式下
   * @param {Object} options - 路由参数
   */
  onLoad(options) {
    if (options.action === 'edit') {
      this.setData({ 
        isEditMode: true,
        editDeviceId: options.deviceId 
      })
      this.loadDeviceData() // 加载现有设备数据
    } else {
      this.initForm() // 初始化新设备表单
    }
  },

  /** 初始化表单数据（新建模式） */
  initForm() {
    this.setData({
      isEditMode: false,
      editDeviceId: null,
      form: {
        brand: '',
        category: '',
        model: '',
        name: '',
        purchaseDate: format.today()
      },
      warrantyYears: 0,
      warrantyEnd: '',
      scanned: null
    })
  },

  /**
   * 加载设备数据用于编辑模式
   * 从 familyService 获取完整设备信息并填充表单
   */
  loadDeviceData() {
    const { editDeviceId } = this.data
    wx.showLoading({ title: '加载中...' })
    
    cloud.call('familyService', {
      action: 'getDevice',
      id: editDeviceId  // Fixed P0-1: Changed from deviceId to id for consistency
    })
    .then(res => {
      const device = res.data
      const catIndex = CATEGORIES.indexOf(device.category)
      
      // 填充表单
      this.setData({
        'form.brand': device.brand,
        'form.category': device.category || '',
        'form.model': device.model,
        'form.name': device.name || `${device.brand}${device.category ? ' ' + device.category : ''}`,
        'form.purchaseDate': device.purchaseDate,
        categoryIndex: catIndex >= 0 ? catIndex : -1,
        warrantyYears: device.warrantyYears || 0,
        warrantyEnd: device.warrantyEnd || ''
      })
      
      wx.hideLoading()
    })
    .catch(err => {
      console.error('加载设备数据失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: err.message || '加载设备信息失败',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 2000)
    })
  },

  /** 扫码识别：机身码 → 云函数（本地型号库 → 条码 API）→ 回填表单 */
  async scan() {
    // 编辑模式下禁止重新扫码
    if (this.data.isEditMode) {
      wx.showToast({
        title: '编辑模式下无法重新扫描',
        icon: 'none'
      })
      return
    }
    
    this.setData({ recognizing: true })
    try {
      // P0-3：隐私授权由全局 privacy-popup 组件处理 ——
      // wx.scanCode 触发隐私检查时，微信回调 onNeedPrivacyAuthorization 分发到弹窗，
      // 用户点击同意按钮后本次 scanCode 自动继续执行，无需在此手动预检
      const scanPromise = new Promise((resolve, reject) => {
        wx.scanCode({
          scanType: ['barCode', 'qrCode', 'datamatrix'],
          onlyFromCamera: true,
          success: resolve,
          fail: reject
        })
      })
      const res = await scanPromise
      const result = await wx.cloud.callFunction({ name: 'getBarcodeInfo', data: { code: res.result } })
      const r = result.result
      if (r.found) {
        const idx = CATEGORIES.indexOf(r.category)
        this.setData({
          scanned: r,
          'form.brand': r.brand,
          'form.category': r.category,
          'form.model': r.model || '', // 本地库命中回填真实型号；在线 GS1 反查无型号（后端返回空），留空由用户确认
          'form.name': r.name || '',
          categoryIndex: idx >= 0 ? idx : -1
        })
        this.recalcWarranty()
        wx.showToast({ title: '识别成功，请确认型号', icon: 'none' })
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

  /** 扫能效标识二维码：wx.scanCode(qrCode) → getBarcodeInfo.parseEnergyLabel → 回填表单 */
  async scanEnergyLabel() {
    // 编辑模式下禁止重新扫码
    if (this.data.isEditMode) {
      wx.showToast({
        title: '编辑模式下无法重新扫描',
        icon: 'none'
      })
      return
    }

    this.setData({ recognizing: true })
    try {
      const res = await new Promise((resolve, reject) => {
        wx.scanCode({
          scanType: ['qrCode'],
          onlyFromCamera: true,
          success: resolve,
          fail: reject
        })
      })
      const result = await wx.cloud.callFunction({
        name: 'getBarcodeInfo',
        data: { action: 'parseEnergyLabel', qrContent: res.result }
      })
      const r = result.result
      if (!r || r.code !== 0) {
        wx.showToast({ title: (r && r.msg) || '识别失败', icon: 'none' })
        return
      }
      const d = r.data || {}
      // 官方能效备案 URL：无法自动取品牌型号，弹窗引导用户手动填写
      if (d.needManual) {
        wx.showModal({
          title: '请手动填写',
          content: (d.hint || '请查看扫码页面') + '（备案号：' + (d.productId || '') + '）',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      const { brand, model, category } = d
      const idx = CATEGORIES.indexOf(category)
      this.setData({
        scanned: { found: true, brand, model, category, name: brand + ' ' + category },
        'form.brand': brand,
        'form.category': category,
        'form.model': model,
        'form.name': brand + ' ' + category,
        categoryIndex: idx >= 0 ? idx : -1
      })
      this.recalcWarranty()
      wx.showToast({ title: '识别成功，请确认型号', icon: 'none' })
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

  /**
   * 保存设备信息 - 支持新建和编辑两种模式
   * @returns {Promise<void>}
   */
  async save() {
    const { form, isEditMode } = this.data
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
      const years = this.data.warrantyYears || warrantyUtil.getWarrantyYears(form.brand, form.category)
      const warrantyEnd = warrantyUtil.calcWarrantyEnd(form.purchaseDate, form.brand, form.category, years)
      
      const params = {
        action: 'createDevice',
        device: {
          brand: form.brand,
          category: form.category,
          model: form.model,
          name: form.name,
          purchaseDate: form.purchaseDate,
          warrantyYears: years,
          warrantyEnd,
          barcode: (this.data.scanned && this.data.scanned.raw) || ''
        },
        contribute: this.data.contribute
      }
      
      if (isEditMode) {
        // 更新模式：只允许更新的字段
        params.action = 'updateDevice'
        params.id = this.data.editDeviceId
        params.brand = form.brand
        params.category = form.category
        params.model = form.model
        params.name = form.name
        params.purchaseDate = form.purchaseDate
        params.warrantyYears = years
        params.warrantyEnd = warrantyEnd
        delete params.contribute // 更新模式不需要 UGC 贡献
      }
      
      const res = await cloud.call('familyService', params)
      
      if (res.data && res.data.familyId) {
        getApp().globalData.familyId = res.data.familyId
      }
      
      wx.showToast({
        title: isEditMode ? '修改成功' : '建档成功',
        icon: 'success',
        duration: 1500
      })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (e) {
      wx.showToast({
        title: '保存失败：' + (e.message || ''),
        icon: 'none'
      })
      console.warn(e)
    } finally {
      this.setData({ saving: false })
    }
  }
})
