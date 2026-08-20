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
    // 云开发环境 ID：公开仓库用占位，真实值取自被忽略的 config.local.js（见 config.local.js.sample）
    let cloudEnv = 'free-xxxxxxxx'
    try { cloudEnv = require('./config.local.js').cloudEnv } catch (e) {}
    wx.cloud.init({
      env: cloudEnv,
      traceUser: true
    })
    // 启动时拉取当前用户的 openid 与家庭信息
    this.bootstrap()
  },

  async bootstrap() {
    try {
      // 统一经 familyService 获取 openid 与家庭信息（云函数内校验成员关系）
      const res = await wx.cloud.callFunction({
        name: 'familyService',
        data: { action: 'getFamily' }
      })
      const r = res.result || {}
      if (r.code === 0 && r.data) {
        if (r.data.openid) this.globalData.openid = r.data.openid
        if (r.data._id) {
          this.globalData.familyId = r.data._id
          this.globalData.familyName = r.data.name
        }
      }
    } catch (e) {
      console.warn('bootstrap 失败（首次使用或未配置云环境）', e)
    }
  }
})
