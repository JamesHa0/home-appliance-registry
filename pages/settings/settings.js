const format = require('../../utils/format')
const cloud = require('../../utils/cloud')

// 与云函数 sendWarrantyReminder 中的 TEMPLATE_ID 保持一致
// 模板「保修到期提醒」：物品名称(thing8) / 到期时间(time7) / 剩余天数(number12) / 温馨提示(thing5)
const TEMPLATE_ID = '0URiO7JaaTCkQFaIaEfsfX4ZbxifBUuAthJt0VpWcrA'

Page({
  data: {
    devices: [],
    subscribedMap: {},
    loading: true,
    ready: TEMPLATE_ID.indexOf('YOUR_') === -1
  },

  onShow() {
    this.load()
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  async load() {
    this.setData({ loading: true })
    try {
      // 设备列表经 familyService 获取（家庭成员设备都可订阅）
      const devRes = await cloud.call('familyService', { action: 'getDevices' })
      const devices = (devRes.data.devices || []).map(d => Object.assign({}, d, {
        ws: format.warrantyStatus(d.warrantyEnd)
      }))

      const app = getApp()
      let subscribedMap = {}
      if (app.globalData.openid) {
        const subRes = await wx.cloud.database().collection('subscriptions')
          .where({ openid: app.globalData.openid, used: false })
          .limit(100)
          .get()
        subRes.data.forEach(s => { subscribedMap[s.deviceId] = true })
      }

      this.setData({ devices, subscribedMap, loading: false })
    } catch (e) {
      console.warn(e)
      this.setData({ loading: false })
    }
  },

  /** 为用户在某台设备上订阅"保修到期提醒"（一次性订阅：授权一次可下发一条） */
  async subscribe(e) {
    if (!this.data.ready) {
      wx.showToast({ title: '请先在公众平台配置订阅模板', icon: 'none' })
      return
    }
    const deviceId = e.currentTarget.dataset.id
    // 防重：已订阅状态直接拦截（按钮 disabled 之外的兜底）
    if (this.data.subscribedMap[deviceId]) {
      wx.showToast({ title: '已订阅该设备提醒', icon: 'none' })
      return
    }
    try {
      const res = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: [TEMPLATE_ID],
          success: resolve,
          fail: (err) => reject(Object.assign(new Error(err.errMsg || '订阅调用失败'), { raw: err }))
        })
      })
      // 结果态：accept 接受 / reject 拒绝 / ban 模板封禁 / filter 被过滤
      const state = res[TEMPLATE_ID]
      if (state !== 'accept') {
        const stateMsg = {
          reject: '你之前选择了拒绝订阅。请在弹窗时选择「允许」，或到小程序右上角「…」→ 设置 → 订阅消息中重新开启',
          ban: '该订阅模板已被平台封禁，请联系开发者处理',
          filter: '订阅请求被过滤：同类型订阅已达上限，稍后再试'
        }
        wx.showToast({
          title: stateMsg[state] || '订阅未成功：' + (state || '未知状态'),
          icon: 'none',
          duration: 3500
        })
        return
      }
      const app = getApp()
      let openid = app.globalData.openid
      if (!openid) {
        const r = await cloud.call('familyService', { action: 'getFamily' })
        openid = r.data.openid
        app.globalData.openid = openid
      }
      await wx.cloud.database().collection('subscriptions').add({
        data: {
          openid,
          deviceId,
          templateId: TEMPLATE_ID,
          used: false,
          createdAt: wx.cloud.database().serverDate()
        }
      })
      this.setData({ [`subscribedMap.${deviceId}`]: true })
      wx.showToast({ title: '订阅成功', icon: 'success' })
    } catch (e) {
      // 用户主动点弹窗取消：静默返回
      if (e.errMsg && e.errMsg.indexOf('cancel') > -1) return
      // 其余失败展示真实原因（如 20001 模板不存在 / -604101 等），便于定位模板配置问题
      wx.showToast({
        title: '订阅失败：' + (e.errMsg || e.message || '未知错误'),
        icon: 'none',
        duration: 3500
      })
    }
  }
})
