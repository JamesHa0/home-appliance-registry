/**
 * Recall model normalization for familyService.
 * Keep this behavior aligned with utils/recall.js in the mini program.
 */
function normalizeModel(value) {
  const text = String(value || '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
  return text.replace(/[^A-Z0-9\u4e00-\u9fff]/g, '')
}

module.exports = {
  normalizeModel
}
