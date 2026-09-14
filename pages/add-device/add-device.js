/**
 * 设备管理页面 - 支持新建和编辑双模式
 * @author Qoder
 */
const warrantyUtil = require('../../utils/warranty')
const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

const CATEGORIES = ['空调', '冰箱', '洗衣机', '电视', '热水器', '油烟机', '电饭煲', '其他']

// 官方「绿色低碳码」小程序 appid（CNIS 出品，能效/水效备案官方查询渠道）。
// 官方未公开披露 appid：获取方法 = PC 版微信打开该小程序一次，
// 然后查看 文档\WeChat Files\Applet\ 下新生成的 wx 开头文件夹名。
// 留空则「已识别官方能效码」弹窗不显示跳转按钮，仅引导手动填写
const OFFICIAL_ENERGY_APPID = ''

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
    todayMax: format.today(),  // Fixed P1-1: Store today as max date for picker
    // 型号搜索自动补全（官方备案列表接口模糊搜索，仅新建模式启用）
    officialCandidates: [],   // 官方备案候选列表（最多展示 4 条）
    modelSearchHint: '',      // 搜索不到时的一行灰字提示；空串表示不显示
    modelSearching: false     // 联想请求进行中（输入框内小 loading 态）
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

  /** 页面卸载：清理防抖/失焦定时器，避免离页后 setData */
  onUnload() {
    clearTimeout(this._modelSearchTimer)
    clearTimeout(this._modelBlurTimer)
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
      scanned: null,
      officialCandidates: [],
      modelSearchHint: '',
      modelSearching: false
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

  /**
   * 统一扫码识别：一个入口，按扫码内容自动路由
   * 商品条码 → getBarcodeInfo 条码链路；能效标识二维码 → 能效解析链路
   * 路由在云函数侧按内容判断（energylabel.com.cn / bbqk.com 短链 → 能效，其余 → 条码）
   */
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
      const res = await new Promise((resolve, reject) => {
        wx.scanCode({
          scanType: ['barCode', 'qrCode', 'datamatrix'],
          onlyFromCamera: true,
          success: resolve,
          fail: reject
        })
      })
      const result = await wx.cloud.callFunction({
        name: 'getBarcodeInfo',
        data: { code: res.result }
      })
      const r = result.result
      if (!r || r.code !== 0) {
        wx.showToast({ title: (r && r.msg) || '识别失败，请手动补全', icon: 'none' })
        return
      }

      // ---------- 能效标识二维码 ----------
      if (r.kind === 'energylabel') {
        // 官方备案 URL：能效备案信息不自动抓取（官方未授权第三方查询/展示），引导手动填写
        // 可选跳转官方「绿色低碳码」小程序查验真伪 —— appid 官方未公开披露，
        // 获取方法见 README「配置项」；留空时弹窗仅提示手动填写
        if (r.needManual) {
          const canJump = !!OFFICIAL_ENERGY_APPID
          this.setData({ scanned: { raw: '能效码' + (r.productId ? ' ' + r.productId : ''), found: false } })
          wx.showModal({
            title: '已识别官方能效码',
            content: (r.hint || '备案数据未授权第三方自动展示，请对照标识下方印制的品牌与型号填写') +
              (r.productId ? '（备案号：' + r.productId + '）' : ''),
            showCancel: canJump,
            confirmText: canJump ? '去官方查验' : '知道了',
            cancelText: '手动填写',
            success: (m) => {
              if (!canJump || !m.confirm) return
              wx.navigateToMiniProgram({
                appId: OFFICIAL_ENERGY_APPID,
                // 官方未公开页面参数契约，extraData 仅预留，落到首页由用户自行扫码查询
                extraData: { productId: r.productId || '' },
                fail: () => {
                  wx.showToast({ title: '跳转失败，可在微信搜索「绿色低碳码」', icon: 'none' })
                }
              })
            }
          })
          return
        }
        if (!r.found) {
          this.setData({ scanned: { raw: '能效码', found: false } })
          wx.showToast({ title: r.msg || '未识别，请手动补全', icon: 'none' })
          return
        }
        const { brand, model, category } = r
        const idx = CATEGORIES.indexOf(category)
        this.setData({
          scanned: { found: true, brand, model, category, name: brand + ' ' + category },
          'form.brand': brand,
          'form.category': category,
          'form.model': model,
          // 别称栏保持空白，不主动预填 —— 用户不填时由云函数生成默认名（含同家庭重名自动序号）
          categoryIndex: idx >= 0 ? idx : -1
        })
        this.recalcWarranty()
        wx.showToast({ title: '识别成功，请确认型号', icon: 'none' })
        return
      }

      // ---------- 商品条码 ----------
      if (r.found) {
        const idx = CATEGORIES.indexOf(r.category)
        this.setData({
          scanned: r,
          'form.brand': r.brand,
          'form.category': r.category,
          'form.model': r.model || '', // 本地库命中回填真实型号；在线 GS1 反查无型号（后端返回空），留空由用户确认
          // 别称栏保持空白，不主动预填 —— 用户不填时由云函数生成默认名（含同家庭重名自动序号）
          categoryIndex: idx >= 0 ? idx : -1
        })
        this.recalcWarranty()
        wx.showToast({ title: '识别成功，请确认型号', icon: 'none' })
      } else {
        this.setData({ scanned: { raw: r.raw || res.result, found: false } })
        wx.showToast({ title: r.msg || '未识别，请手动补全', icon: 'none' })
      }
    } catch (e) {
      if (e.errMsg && e.errMsg.indexOf('cancel') > -1) return
      // 扫码失败（对焦/反光/角度等）给出明确的重试与手动录入引导，而非一句 toast
      wx.showModal({
        title: '二维码识别失败',
        content: '请对准能效标识上的二维码重试；也可手动录入标识下方印制的品牌与型号。',
        confirmText: '重新扫码',
        cancelText: '手动填写',
        success: (r2) => {
          if (r2.confirm) this.scan()
        }
      })
    } finally {
      this.setData({ recognizing: false })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
    if (field === 'brand') this.recalcWarranty()
    if (field === 'model') this.onModelInput(e.detail.value)
  },

  /**
   * 型号输入 → 官方备案模糊搜索联想（纯数字能效码场景升级：输入型号一键补全）
   * 触发规则：≥2 字符、500ms 防抖；编辑模式禁用（编辑是修正场景，自动回填反而干扰）
   */
  onModelInput(value) {
    clearTimeout(this._modelSearchTimer)
    const kw = String(value || '').trim()
    if (this.data.isEditMode || kw.length < 2) {
      this.hideModelCandidates()
      return
    }
    this._modelSearchTimer = setTimeout(() => this.searchOfficial(kw), 500)
  },

  /**
   * 调云函数 searchOfficialModels 搜索官方备案候选
   * 竞态守卫：seq 自增，慢返回的旧请求直接丢弃，避免 "HR-2" 的结果盖住 "HR-282" 的结果
   * fail-open：任何失败静默收起浮层，不打扰手填路径
   */
  async searchOfficial(keyword) {
    const seq = (this._modelSearchSeq = (this._modelSearchSeq || 0) + 1)
    this.setData({ modelSearching: true, modelSearchHint: '' })
    try {
      const res = await cloud.call('getBarcodeInfo', {
        action: 'searchOfficialModels',
        keyword
      })
      if (seq !== this._modelSearchSeq) return // 已有更新的输入，丢弃本次结果
      const list = (res && res.list) || []
      if (!list.length) {
        // 接口正常但确实搜不到：一行灰字提示，不弹窗不阻塞
        this.setData({ officialCandidates: [], modelSearchHint: '未在官方备案中找到，可直接手动填写' })
      } else {
        this.setData({ officialCandidates: list.slice(0, 4), modelSearchHint: '' })
      }
    } catch (e) {
      if (seq !== this._modelSearchSeq) return
      this.setData({ officialCandidates: [], modelSearchHint: '' }) // 静默退回纯手填
      console.warn('searchOfficial fail', e)
    } finally {
      if (seq === this._modelSearchSeq) this.setData({ modelSearching: false })
    }
  },

  /** 选中候选：回填品牌/品类/型号，收起浮层，刷新保修预览 */
  onPickCandidate(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const c = this.data.officialCandidates[idx]
    if (!c) return
    const catIdx = CATEGORIES.indexOf(c.category)
    this.setData({
      'form.brand': c.brand,
      'form.model': c.model,
      'form.category': c.category,
      categoryIndex: catIdx >= 0 ? catIdx : -1,
      officialCandidates: [],
      modelSearchHint: ''
    })
    this.recalcWarranty()
    // 品类是 productType 映射推断的（可能失配），回填 ≠ 免确认，提示用户核对
    wx.showToast({ title: '已回填，请核对品类', icon: 'none' })
  },

  /** 失焦延迟 200ms 收起：给候选的 tap 事件留出执行窗口（blur 先于 tap 是下拉联想最常见的坑） */
  onModelBlur() {
    clearTimeout(this._modelBlurTimer)
    this._modelBlurTimer = setTimeout(() => this.hideModelCandidates(), 200)
  },

  hideModelCandidates() {
    clearTimeout(this._modelSearchTimer)
    this.setData({ officialCandidates: [], modelSearchHint: '' })
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
          barcode: (this.data.scanned && this.data.scanned.raw) || '',
          // 扫码命中型号库时保存的说明书页，详情页「说明书」入口优先使用
          manualUrl: (this.data.scanned && this.data.scanned.manualUrl) || ''
        }
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
