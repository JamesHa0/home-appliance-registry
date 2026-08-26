const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

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
      // 设备列表经 familyService 获取（服务端校验家庭成员，家人可见彼此设备）
      const res = await cloud.call('familyService', { action: 'getDevices' })
      const familyId = res.data.familyId
      const devices = (res.data.devices || []).map(d => {
        const ws = format.warrantyStatus(d.warrantyEnd)
        return Object.assign({}, d, { ws, recalled: false })
      })

      // 召回匹配（recalls 为公开只读集合，可直接查询）
      let recalls = []
      try {
        const r = await wx.cloud.database().collection('recalls').limit(20).get()
        recalls = r.data
      } catch (e) { /* 忽略 */ }
      devices.forEach(d => {
        if (d.model) {
          d.recalled = recalls.some(x => x.model && x.model === d.model)
        }
      })

      // 国补待办（policies 为公开只读集合）
      let activePolicy = null
      try {
        const p = await wx.cloud.database().collection('policies')
          .where({ type: 'subsidy' }).limit(5).get()
        activePolicy = p.data.find(x => !x.endDate || x.endDate >= format.today())
      } catch (e) { /* 忽略 */ }

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

      this.setData({ devices, todos, loading: false, hasFamily: !!familyId })
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
  },
  onTodoTap(e) {
    const { type, id } = e.currentTarget.dataset
    if (type === 'policy') return this.goPolicy()
    if (id) return this.goDetail(e)
  }
})
