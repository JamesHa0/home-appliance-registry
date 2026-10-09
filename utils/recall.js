/**
 * Recall model normalization shared by mini-program pages.
 * Keep this behavior aligned with cloudfunctions/familyService/utils/recall.js.
 */
function normalizeModel(value) {
  const text = String(value || '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
  return text.replace(/[^A-Z0-9\u4e00-\u9fff]/g, '')
}

function hasModelMatch(value) {
  return normalizeModel(value).length >= 2
}

module.exports = {
  normalizeModel,
  hasModelMatch
}
