const format = require('../../utils/format')

Page({
  data: {
    devices: [],
    todos: [],
    loading: true,
    hasFamily: true
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const app = getApp()
      const familyId = app.globalData.familyId
      if (!familyId) {
        this.setData({ loading: false, hasFamily: false })
        return
      }
      const db = wx.cloud.database()
      const devRes = await db.collection('devices').where({ familyId }).orderBy('createdAt', 'desc').get()
      const recallRes = await db.collection('recalls').limit(20).get()
      const policyRes = await db.collection('policies').where({ type: 'subsidy' }).limit(5).get()

      const activePolicy = policyRes.data.find(p => !p.endDate || p.endDate >= format.today())
      const devices = devRes.data.map(d => {
        const ws = format.warrantyStatus(d.warrantyEnd)
        const recalled = recallRes.data.some(r => r.model && d.model && r.model === d.model)
        return Object.assign({}, d, { ws, recalled })
      })

      const todos = []
      devices.forEach(d => {
        if (d.recalled) {
          todos.push({ type: 'recall', text: `${d.name} 在召回范围，请立即查看`, deviceId: d._id })
        } else if (d.ws.status === 'expiring') {
          todos.push({ type: 'warranty', text: `${d.name} ${d.ws.text}`, deviceId: d._id })
        }
      })
      if (activePolicy && devices.length) {
        todos.push({ type: 'policy', text: '2026 国补进行中：1 级能效家电换新最高补 1500 元', link: '/pages/policy/policy' })
      }

      this.setData({ devices, todos, loading: false, hasFamily: true })
    } catch (e) {
      console.warn(e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add-device/add-device' })
  },
  goDetail(e) {
    wx.navigateTo({ url: '/pages/device-detail/device-detail?id=' + e.currentTarget.dataset.id })
  },
  goFamily() {
    wx.switchTab({ url: '/pages/family/family' })
  },
  goPolicy() {
    wx.switchTab({ url: '/pages/policy/policy' })
  }
})
