const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

// 品牌售后入口（官方客服电话，来自品牌公开服务信息；可扩展为云数据库表）
const AFTER_SALES = {
  '美的': { phone: '4008899315', link: 'https://www.midea.com/support' },
  '海尔': { phone: '4006999999', link: 'https://www.haier.com/support/' },
  '小米': { phone: '4001005678', link: 'https://www.mi.com/service/' },
  '格力': { phone: '4008365315', link: 'https://www.gree.com.cn/service/' },
  '海信': { phone: '4006111111', link: 'https://www.hisense.com/service' }
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
    const { device } = this.data
    if (!device || !device.brand) return
    // 说明书跳转品牌官方服务支持页（不本地存储 PDF，规避版权）
    const link = (this.data.afterSale && this.data.afterSale.link) || 'https://www.baidu.com'
    wx.setClipboardData({
      data: link,
      success: () => wx.showToast({ title: '官网链接已复制，请在浏览器打开', icon: 'none' })
    })
  },

  /** 跳转到编辑页面 */
  goEditDevice() {
    const { _id } = this.data.device
    wx.navigateTo({
      url: `/pages/add-device/add-device?action=edit&deviceId=${_id}`
    })
  },

  deleteDevice() {
    wx.showModal({
      title: '删除设备',
      content: '确认删除该设备档案？',
      confirmColor: '#A32D2D',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await cloud.call('familyService', { action: 'deleteDevice', id: this.data.id })
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
