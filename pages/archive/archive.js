const cloud = require('../../utils/cloud')

Page({
  data: {
    devices: [],
    loading: true
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await cloud.call('familyService', { action: 'getDevices', archived: true })
      const devices = (res.data.devices || []).map(d => Object.assign({}, d, {
        archivedLabel: d.archivedAt ? this.formatDate(d.archivedAt) : ''
      }))
      this.setData({ devices, loading: false })
    } catch (e) {
      console.warn(e)
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  formatDate(v) {
    // archivedAt 为云函数 serverDate（时间戳）或 Date 对象，统一格式化为 YYYY-MM-DD
    try {
      const d = new Date(v)
      if (isNaN(d.getTime())) return ''
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${d.getFullYear()}-${m}-${day}`
    } catch (e) {
      return ''
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/device-detail/device-detail?id=' + e.currentTarget.dataset.id })
  },

  /** 恢复：归档 → 在库 */
  restoreDevice(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '恢复设备',
      content: '将该设备恢复到设备列表？',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await cloud.call('familyService', { action: 'restoreDevice', id })
          wx.showToast({ title: '已恢复', icon: 'success' })
          this.load()
        } catch (err) {
          wx.showToast({ title: err.message || '恢复失败', icon: 'none' })
        }
      }
    })
  },

  /** 永久删除：真正的硬删除，不可恢复 */
  permanentDelete(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '永久删除',
      content: '删除后该设备档案将不可恢复，确定永久删除？',
      confirmText: '删除',
      confirmColor: '#A32D2D',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await cloud.call('familyService', { action: 'deleteDevice', id })
          wx.showToast({ title: '已永久删除', icon: 'success' })
          this.load()
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      }
    })
  }
})
