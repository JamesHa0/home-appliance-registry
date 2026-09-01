const cloud = require('../../utils/cloud')

Page({
  data: {
    family: null,
    members: [],
    membersDetail: [],
    myOpenid: '',
    myNickname: '',
    inviteCodeInput: '',
    creating: false,
    joining: false,
    // 头像昵称编辑弹窗
    showProfileEdit: false,
    editAvatarUrl: '',      // 展示用：新选临时路径 或 已有 fileID
    editAvatarTemp: '',     // 新选头像临时路径（需上传）
    editAvatarFileId: '',   // 已有头像 fileID
    editNickname: '',
    savingProfile: false
  },

  onShow() {
    this.load()
  },

  async load() {
    try {
      // 经 familyService 获取（服务端按 openid 定位家庭，成员可见）
      const res = await cloud.call('familyService', { action: 'getFamily' })
      const f = res.data || null
      // familyService.getFamily 无家庭时返回 { openid }，该对象 truthy；
      // 必须以存在家庭 _id 作为"有家庭"的判定，否则无家庭用户会渲染空家庭页。
      if (!f || !f._id) {
        this.setData({ family: null, members: [], membersDetail: [] })
        return
      }
      const myOpenid = f.openid || getApp().globalData.openid || ''
      const detail = f.membersDetail || []
      const me = detail.find(d => d.openid === myOpenid)
      const myNickname = me ? me.nickname : ''
      const members = detail.map((d, i) => {
        const label = d.nickname || (d.isOwner ? '创建者' : '成员 ' + (i + 1))
        return {
          key: i,
          openid: d.openid,
          isMe: d.openid === myOpenid,
          isOwner: d.isOwner,
          nickname: d.nickname,
          avatarFileId: d.avatarFileId,
          avatarChar: (d.nickname && d.nickname.charAt(0)) || '家',
          label
        }
      })
      this.setData({
        family: f,
        members,
        membersDetail: detail,
        myOpenid,
        myNickname,
        // isOwner 双保险：membersDetail 的 isOwner（服务端按 ownerOpenid 计算）
        // + 直接比对 ownerOpenid（防 membersDetail 缺失/未命中时误判）
        isOwner: !!(me && me.isOwner) || f.ownerOpenid === myOpenid
      })
      // 同步全局状态
      getApp().globalData.familyId = f._id
      getApp().globalData.familyName = f.name
      getApp().globalData.openid = myOpenid
    } catch (e) {
      this.setData({ family: null, members: [], membersDetail: [] })
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
      await this.load()
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
    const code = this.data.inviteCodeInput.trim().toUpperCase()
    
    // Validate format before sending to server
    const invitePattern = /^[A-HJ-NP-Za-km-z0-9]{6}$/
    if (!invitePattern.test(code)) {
      wx.showToast({
        title: '邀请码格式不正确',
        icon: 'none'
      })
      return
    }
    
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
      // await 刷新，确保加入成功后立即按最新成员身份拉取家庭（含邀请码）再渲染
      await this.load()
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

  // ---------- 头像昵称编辑 ----------
  openProfileEdit() {
    const me = this.data.membersDetail.find(d => d.openid === this.data.myOpenid) || {}
    this.setData({
      showProfileEdit: true,
      editNickname: me.nickname || '',
      editAvatarFileId: me.avatarFileId || '',
      editAvatarTemp: '',
      editAvatarUrl: me.avatarFileId || ''
    })
  },

  closeProfileEdit() {
    this.setData({ showProfileEdit: false })
  },

  // 弹窗面板点击不冒泡关闭（用于 catchtap）
  noop() {},

  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl
    this.setData({ editAvatarTemp: temp, editAvatarUrl: temp })
  },

  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value })
  },

  async saveProfile() {
    if (this.data.savingProfile) return
    const nickname = this.data.editNickname.trim()
    let avatarFileId = this.data.editAvatarFileId || ''

    this.setData({ savingProfile: true })
    wx.showLoading({ title: '保存中', mask: true })
    try {
      // 选了新头像 → 先上传到云存储换取永久 fileID
      if (this.data.editAvatarTemp) {
        const openid = this.data.myOpenid || 'user'
        const up = await wx.cloud.uploadFile({
          cloudPath: 'avatars/' + openid + '_' + Date.now() + '.png',
          filePath: this.data.editAvatarTemp
        })
        avatarFileId = up.fileID
      }
      await cloud.call('familyService', { action: 'updateProfile', nickname, avatarFileId })
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showProfileEdit: false, savingProfile: false })
      await this.load()
    } catch (e) {
      wx.hideLoading()
      this.setData({ savingProfile: false })
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },

  onShareAppMessage() {
    const f = this.data.family
    return {
      title: '加入我的家庭，一起管理家电保修',
      path: '/pages/family/family'
    }
  },
  
  async leaveFamily() {
    wx.showModal({
      title: '退出家庭',
      content: '退出后将无法查看该家庭的所有设备，确定吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '退出中' })
          try {
            const result = await cloud.call('familyService', { action: 'leaveFamily' })
            wx.hideLoading()
            if (result.code === 0) {
              wx.showToast({ title: '已退出家庭', icon: 'success' })
              setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 1500)
            } else {
              wx.showToast({ title: result.msg || '退出失败', icon: 'none' })
            }
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: e.message || '退出失败', icon: 'none' })
          }
        }
      }
    })
  },

  async dissolveFamily() {
    wx.showModal({
      title: '解散家庭',
      content: '解散后设备记录将全部删除。是否解散家庭？',
      confirmText: '解散',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '解散中' })
          try {
            const result = await cloud.call('familyService', { action: 'dissolveFamily' })
            wx.hideLoading()
            if (result.code === 0) {
              // 清空全局缓存的家庭状态
              const g = getApp().globalData
              g.familyId = null
              g.familyName = ''
              wx.showToast({ title: '家庭已解散', icon: 'success' })
              setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 1500)
            } else {
              wx.showToast({ title: result.msg || '解散失败', icon: 'none' })
            }
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: e.message || '解散失败', icon: 'none' })
          }
        }
      }
    })
  }
})
