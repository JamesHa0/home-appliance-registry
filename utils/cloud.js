/**
 * 云函数调用薄封装（Promise + 可选 loading）
 */
function call(name, data, options = {}) {
  const { loading, loadingText } = options
  if (loading) {
    wx.showLoading({ title: loadingText || '加载中', mask: true })
  }
  return wx.cloud.callFunction({ name, data }).then(res => {
    if (loading) wx.hideLoading()
    if (res.result && res.result.code !== undefined && res.result.code !== 0) {
      return Promise.reject(new Error(res.result.msg || '业务错误'))
    }
    return res.result
  }).catch(err => {
    if (loading) wx.hideLoading()
    throw err
  })
}

module.exports = { call }
