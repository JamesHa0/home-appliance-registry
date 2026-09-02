Page({
  data: {
    updateDate: '2026-09-02'
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/settings/settings' })
    }
  }
})
