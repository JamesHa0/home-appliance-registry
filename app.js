App({
  globalData: {
    openid: null,
    familyId: null,
    familyName: ''
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'free-d4ghcn6kmf592a75f',
      traceUser: true
    })
    // 启动时拉取当前用户的 openid 与家庭信息
    this.bootstrap()
  },

  async bootstrap() {
    try {
      const db = wx.cloud.database()
      const res = await wx.cloud.callFunction({ name: 'getBarcodeInfo', data: { ping: true } }).catch(() => null)
      // openid 通过云函数返回（云函数内用 cloud.getWXContext() 获取）
      const openidRes = await wx.cloud.callFunction({
        name: 'getBarcodeInfo',
        data: { action: 'openid' }
      })
      if (openidRes.result && openidRes.result.openid) {
        this.globalData.openid = openidRes.result.openid
      }
      // 查询该用户所属家庭
      const famRes = await db.collection('families').where({
        members: this.globalData.openid
      }).limit(1).get()
      if (famRes.data.length) {
        this.globalData.familyId = famRes.data[0]._id
        this.globalData.familyName = famRes.data[0].name
      }
    } catch (e) {
      console.warn('bootstrap 失败（首次使用或未配置云环境）', e)
    }
  }
})
