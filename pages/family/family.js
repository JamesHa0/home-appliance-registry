const cloud = require('../../utils/cloud')

Page({
  data: {
    family: null,
    members: [],
    inviteCodeInput: '',
    creating: false,
    joining: false
  },

  onShow() {
    this.load()
  },

  async load() {
    try {
      // 经 familyService 获取（服务端按 openid 定位家庭，成员可见）
      const res = await cloud.call('familyService', { action: 'getFamily' })
      const f = res.data || null
      if (!f) {
        this.setData({ family: null, members: [] })
        return
      }
      this.setData({
        family: f,
        members: (f.members || []).map((openid, i) => ({
          key: i,
          label: openid === f.ownerOpenid ? '创建者' : '成员 ' + (i + 1),
          short: openid.slice(-6)
        }))
      })
      // 同步全局状态
      getApp().globalData.familyId = f._id
      getApp().globalData.familyName = f.name
    } catch (e) {
      this.setData({ family: null, members: [] })
    }
  },

  async createFamily() {
    this.setData({ creating: true })
    try {
      const res = await cloud.call('familyService', { action: 'createFamily', name: '我的家' })
      const f = res.data
      getApp().globalData.familyId = f._id
      getApp().globalData.familyName = f.name
      wx.showToast({ title: '家庭已创建', icon: 'success' })
      this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' })
    } finally {
      this.setData({ creating: false })
    }
  },

  onInviteInput(e) {
    this.setData({ inviteCodeInput: e.detail.value.trim().toUpperCase() })
  },

  async joinFamily() {
    const code = this.data.inviteCodeInput
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }
    this.setData({ joining: true })
    try {
      const res = await cloud.call('familyService', { action: 'joinFamily', inviteCode: code })
      const f = res.data
      getApp().globalData.familyId = f._id
      getApp().globalData.familyName = f.name
      wx.showToast({ title: '已加入家庭', icon: 'success' })
      this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '加入失败', icon: 'none' })
    } finally {
      this.setData({ joining: false })
    }
  },

  copyInvite() {
    if (!this.data.family) return
    wx.setClipboardData({
      data: this.data.family.inviteCode,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' })
    })
  },

  onShareAppMessage() {
    const f = this.data.family
    return {
      title: '加入我的家庭，一起管理家电保修',
      path: '/pages/family/family'
    }
  }
})
