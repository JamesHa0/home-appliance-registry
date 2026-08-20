const format = require('../../utils/format')

Page({
  data: {
    policies: [],
    recalls: [],
    loading: true
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const today = format.today()
      const policyRes = await db.collection('policies').orderBy('createdAt', 'desc').limit(20).get()
      const recallRes = await db.collection('recalls').orderBy('createdAt', 'desc').limit(20).get()

      const policies = policyRes.data.map(p => Object.assign({}, p, {
        active: !p.endDate || p.endDate >= today
      }))

      this.setData({ policies, recalls: recallRes.data, loading: false })
    } catch (e) {
      console.warn(e)
      this.setData({ loading: false })
    }
  },

  copyLink(e) {
    const link = e.currentTarget.dataset.link
    if (!link) return
    wx.setClipboardData({
      data: link,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    })
  }
})
