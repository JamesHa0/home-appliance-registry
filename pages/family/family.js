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
    const app = getApp()
    const familyId = app.globalData.familyId
    if (!familyId) {
      this.setData({ family: null, members: [] })
      return
    }
    try {
      const res = await wx.cloud.database().collection('families').doc(familyId).get()
      const f = res.data
      this.setData({
        family: f,
        members: (f.members || []).map((openid, i) => ({
          key: i,
          label: openid === f.ownerOpenid ? '创建者' : '成员 ' + (i + 1),
          short: openid.slice(-6)
        }))
      })
    } catch (e) {
      this.setData({ family: null })
    }
  },

  async createFamily() {
    this.setData({ creating: true })
    try {
      const app = getApp()
      const db = wx.cloud.database()
      let openid = app.globalData.openid
      if (!openid) {
        const r = await cloud.call('getBarcodeInfo', { action: 'openid' })
        openid = r.openid
        app.globalData.openid = openid
      }
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
      app.globalData.familyId = fam._id
      wx.showToast({ title: '家庭已创建', icon: 'success' })
      this.load()
    } catch (e) {
      wx.showToast({ title: '创建失败', icon: 'none' })
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
      const app = getApp()
      const db = wx.cloud.database()
      let openid = app.globalData.openid
      if (!openid) {
        const r = await cloud.call('getBarcodeInfo', { action: 'openid' })
        openid = r.openid
        app.globalData.openid = openid
      }
      const res = await db.collection('families').where({ inviteCode: code }).limit(1).get()
      if (!res.data.length) {
        wx.showToast({ title: '邀请码无效', icon: 'none' })
        return
      }
      const fam = res.data[0]
      if ((fam.members || []).indexOf(openid) > -1) {
        app.globalData.familyId = fam._id
        wx.showToast({ title: '已在家庭中', icon: 'none' })
      } else {
        await db.collection('families').doc(fam._id).update({
          data: { members: wx.cloud.database().command.push([openid]) }
        })
        app.globalData.familyId = fam._id
        wx.showToast({ title: '已加入家庭', icon: 'success' })
      }
      this.load()
    } catch (e) {
      wx.showToast({ title: '加入失败', icon: 'none' })
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
