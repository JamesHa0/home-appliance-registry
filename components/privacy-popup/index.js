// 隐私授权弹窗组件（官方 demo2 模式）
//
// 用法：页面 json 声明 usingComponents，页面 wxml 末尾放 <privacy-popup />
// 工作机制：
//   1. 页面显示时（pageLifetimes.show）向 app 注册 privacyHandler，接管全局隐私事件
//   2. 用户触发隐私接口（扫码/头像/剪贴板）且未同意过 → 微信回调 app 的
//      onNeedPrivacyAuthorization → 分发到本组件 → 弹窗展示
//   3. 用户点击 <button open-type="agreePrivacyAuthorization"> 同意按钮 →
//      resolve({ event: 'agree', buttonId: 'agree-btn' })（buttonId 必须对应真实按钮）
//   4. 拒绝则 resolve({ event: 'disagree' })，原隐私接口调用收到失败回调
const app = getApp()

Component({
  data: {
    show: false,
    contractName: ''   // 后台配置的《用户隐私保护指引》名称（仅展示用）
  },

  lifetimes: {
    attached() {
      this._resolve = null
    },
    detached() {
      if (app.privacyHandler === this._boundHandler) {
        app.privacyHandler = null
      }
      this._resolve = null
    }
  },

  pageLifetimes: {
    show() {
      // 页面可见时接管全局隐私事件分发
      this._boundHandler = (resolve) => this.showPopup(resolve)
      app.privacyHandler = this._boundHandler
      // 接管前若已有挂起的授权请求（如冷启动首屏即触发隐私接口），补弹窗
      if (app.pendingPrivacyResolve) {
        const resolve = app.pendingPrivacyResolve
        app.pendingPrivacyResolve = null
        this.showPopup(resolve)
      }
    },
    hide() {
      // 页面隐藏时让出分发权；未完成的授权请求转存，交给下一个可见页面处理
      if (app.privacyHandler === this._boundHandler) {
        app.privacyHandler = null
      }
      if (this._resolve && !app.pendingPrivacyResolve) {
        app.pendingPrivacyResolve = this._resolve
      }
      this._resolve = null
      this.setData({ show: false })
    }
  },

  methods: {
    showPopup(resolve) {
      this._resolve = resolve
      this.setData({ show: true })
      // 拉取后台配置的隐私协议名称（失败不影响授权流程）
      if (!this.data.contractName && wx.getPrivacySetting) {
        wx.getPrivacySetting({
          success: (res) => {
            if (res && res.privacyContractName) {
              this.setData({ contractName: res.privacyContractName })
            }
          },
          fail: () => {}
        })
      }
    },

    // 必须由真实 <button open-type="agreePrivacyAuthorization"> 触发（wxml 中 id="agree-btn"）
    handleAgree() {
      if (this._resolve) {
        this._resolve({ event: 'agree', buttonId: 'agree-btn' })
        this._resolve = null
      }
      this.setData({ show: false })
    },

    handleDisagree() {
      if (this._resolve) {
        this._resolve({ event: 'disagree' })
        this._resolve = null
      }
      this.setData({ show: false })
    },

    openContract() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({
          fail: () => wx.showToast({ title: '暂时无法打开隐私协议', icon: 'none' })
        })
      }
    }
  }
})
