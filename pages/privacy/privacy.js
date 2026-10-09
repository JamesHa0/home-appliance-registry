Page({
  data: {
    updateDate: '2026-10-08'
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/settings/settings' })
    }
  },

  onContactError() {
    wx.showToast({ title: '微信客服暂不可用，请稍后重试', icon: 'none' })
  }
})
