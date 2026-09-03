const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

// 品牌售后入口（官方客服电话与官网服务页，来自品牌公开服务信息；可扩展为云数据库表）
// 电话仅收录可确认的官方号码，不确定的只给 link，前端兜底提示拨打 114
const AFTER_SALES = {
  '美的': { phone: '4008899315', link: 'https://www.midea.com/support' },
  '海尔': { phone: '4006999999', link: 'https://www.haier.com/support/' },
  '统帅': { phone: '4006999999', link: 'https://www.haier.com/support/' },
  '小米': { phone: '4001005678', link: 'https://www.mi.com/service/' },
  '米家': { phone: '4001005678', link: 'https://www.mi.com/service/' },
  '格力': { phone: '4008365315', link: 'https://www.gree.com.cn/service/' },
  '海信': { phone: '4006111111', link: 'https://www.hisense.com/service' },
  '奥克斯': { link: 'https://www.aux.com.cn/' },
  'TCL': { link: 'https://www.tcl.com/cn/zh' },
  '创维': { link: 'https://www.skyworth.com/' },
  '长虹': { link: 'https://www.changhong.com/' },
  '康佳': { link: 'https://www.konka.com/' },
  '松下': { link: 'https://www.panasonic.cn/' },
  '博世': { link: 'https://www.bosch-home.cn/' },
  '西门子': { link: 'https://www.siemens-home.cn/' },
  '方太': { link: 'https://www.fotile.com/' },
  '老板': { link: 'https://www.robam.com/' },
  '华帝': { link: 'https://www.vatti.com.cn/' },
  '万和': { link: 'https://www.vanward.com/' },
  '九阳': { link: 'https://www.joyoung.com/' },
  '苏泊尔': { link: 'https://www.supor.com.cn/' }
}

Page({
  data: {
    id: '',
    device: null,
    ws: null,
    recalled: false,
    afterSale: null,
    loading: true
  },

  onLoad(options) {
    this.setData({ id: options.id })
  },

  onShow() {
    this.load()
  },

  async load() {
    if (!this.data.id) return
    this.setData({ loading: true })
    try {
      // 经 familyService 获取（服务端校验：仅家庭成员可读该设备）
      const res = await cloud.call('familyService', { action: 'getDevice', id: this.data.id })
      const d = res.data
      const ws = format.warrantyStatus(d.warrantyEnd)

      // 召回匹配（recalls 为公开只读集合）
      let recalled = false
      try {
        const recallRes = await wx.cloud.database().collection('recalls')
          .where({ model: d.model }).limit(5).get()
        recalled = recallRes.data.length > 0
      } catch (e) { /* 忽略 */ }

      const afterSale = AFTER_SALES[d.brand] || null

      this.setData({ device: d, ws, recalled, afterSale, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '设备不存在', icon: 'none' })
    }
  },

  callPhone(e) {
    wx.makePhoneCall({ phoneNumber: e.currentTarget.dataset.phone })
  },

  openManual() {
    try {
      const device = this.data.device || {}
      const brand = device.brand || ''
      // 链接优先级：扫码命中型号库时保存的说明书页 > 品牌官方服务页 > 搜索"品牌 官方售后"
      const link = device.manualUrl
        || (this.data.afterSale && this.data.afterSale.link)
        || 'https://www.baidu.com/s?wd=' + encodeURIComponent(brand + ' 家电 售后 官网')

      wx.setClipboardData({
        data: link,
        success: () => {
          // 用 modal 而非 toast：展示复制到的实际链接，给用户明确的可视证据
          wx.showModal({
            title: '链接已复制',
            content: '已复制到剪贴板：\n' + link + '\n\n请打开手机浏览器，长按地址栏粘贴访问',
            showCancel: false,
            confirmText: '知道了'
          })
        },
        fail: (err) => {
          console.error('[device-detail] setClipboardData fail:', err)
          wx.showToast({
            title: '复制失败：' + ((err && err.errMsg) || '未知原因'),
            icon: 'none',
            duration: 3000
          })
        }
      })
    } catch (e) {
      console.error('[device-detail] openManual error:', e)
      wx.showToast({ title: '操作异常：' + (e.message || '未知错误'), icon: 'none', duration: 3000 })
    }
  },

  /** 跳转到编辑页面 */
  goEditDevice() {
    const { _id } = this.data.device
    wx.navigateTo({
      url: `/pages/add-device/add-device?action=edit&deviceId=${_id}`
    })
  },

  /** 归档（一级删除，可恢复） */
  archiveDevice() {
    wx.showModal({
      title: '归档该设备',
      content: '归档后该设备将移入「已归档」列表，可随时恢复。确定归档？',
      confirmText: '归档',
      confirmColor: '#BA7517',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await cloud.call('familyService', { action: 'archiveDevice', id: this.data.id })
          wx.showToast({ title: '已归档', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (e) {
          wx.showToast({ title: e.message || '归档失败', icon: 'none' })
        }
      }
    })
  },

  /** 从归档恢复 */
  restoreDevice() {
    wx.showModal({
      title: '恢复设备',
      content: '将该设备恢复到设备列表？',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await cloud.call('familyService', { action: 'restoreDevice', id: this.data.id })
          wx.showToast({ title: '已恢复', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (e) {
          wx.showToast({ title: e.message || '恢复失败', icon: 'none' })
        }
      }
    })
  },

  /** 永久删除（真删除，不可恢复） */
  deleteDevice() {
    wx.showModal({
      title: '永久删除',
      content: '删除后该设备档案将不可恢复，确定永久删除？',
      confirmText: '删除',
      confirmColor: '#A32D2D',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await cloud.call('familyService', { action: 'deleteDevice', id: this.data.id })
          wx.showToast({ title: '已永久删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
