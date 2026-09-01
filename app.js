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
    
    // P0-3：隐私授权（官方 demo2 模式）
    // 触发时机：用户调用未同意过的隐私接口（扫码 / 选择头像 / 剪贴板）
    // 处理方式：把 resolve 分发给当前可见页面的 <privacy-popup /> 组件弹窗，
    // 由真实 <button open-type="agreePrivacyAuthorization"> 的回调去 resolve —— 
    // 官方要求 resolve({ event: 'agree', buttonId })，buttonId 必须来自真实点击的同意按钮
    this.privacyHandler = null          // 当前生效的弹窗组件回调（页面显示时由组件注册）
    this.pendingPrivacyResolve = null   // 组件尚未挂载时暂存的 resolve
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        if (this.privacyHandler) {
          this.privacyHandler(resolve)
        } else {
          this.pendingPrivacyResolve = resolve
        }
      })
    }
    
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
