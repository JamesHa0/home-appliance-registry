const cloud = require('wx-server-sdk')
const https = require('https')
const {
  DEFAULT_LIST_URL,
  parseRecallList,
  parseRecallDetail,
  buildRecallDocuments,
  buildRecallBackfillPatch,
  isHomeApplianceRecall
} = require('./parser')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const errorCollection = db.collection('system_errors')
const MAX_DETAILS_PER_RUN = 20

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.setTimeout(8000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function recordError(message, context = {}, category = 'parse') {
  try {
    await errorCollection.add({
      data: {
        type: 'recall-scrape',
        category,
        message: String(message || '').slice(0, 300),
        context,
        severity: category === 'critical' ? 'high' : 'medium',
        collectedAt: db.serverDate()
      }
    })
  } catch (e) {
    console.error('[RecallScrape] Failed to record error:', e.message)
  }
}

async function isDuplicate(doc) {
  if (doc.sourceKey) {
    const bySource = await db.collection('recalls')
      .where({ sourceKey: doc.sourceKey })
      .count()
    if (bySource.total > 0) return true
  }
  const byLegacy = await db.collection('recalls')
    .where({ link: doc.link, model: doc.model })
    .count()
  return byLegacy.total > 0
}

async function backfillMissingRecallModels() {
  const pageSize = 100
  let scanned = 0
  let updated = 0

  for (let offset = 0; offset < 2000; offset += pageSize) {
    const res = await db.collection('recalls')
      .skip(offset)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    const page = res.data || []
    scanned += page.length

    for (const recall of page) {
      const patch = buildRecallBackfillPatch(recall)
      if (!Object.keys(patch).length) continue
      try {
        await db.collection('recalls').doc(recall._id).update({ data: patch })
        updated++
      } catch (e) {
        await recordError(`Recall backfill failed: ${e.message}`, {
          recallId: recall._id,
          model: recall.model || ''
        })
      }
    }
    if (page.length < pageSize) break
  }

  return { scanned, updated }
}

async function scrapePage(url) {
  const html = await httpsGet(url)
  return parseRecallList(html, url)
}

exports.main = async (event) => {
  const { action } = event || {}

  try {
    const listItems = (await scrapePage(DEFAULT_LIST_URL)).slice(0, MAX_DETAILS_PER_RUN)
    if (action === 'dry') {
      return {
        code: 0,
        success: true,
        dryRun: true,
        preview: {
          url: DEFAULT_LIST_URL,
          listItems: listItems.length,
          firstTitles: listItems.slice(0, 5).map(item => item.title)
        }
      }
    }
    if (!listItems.length) {
      await recordError('No recall list items were parsed', {
        url: DEFAULT_LIST_URL,
        action: action || 'scheduled'
      }, 'critical')
      return {
        code: 0,
        success: true,
        stats: { listItems: 0, detailFetched: 0, applianceMatched: 0, modelParsed: 0, inserted: 0, skipped: 0 }
      }
    }

    const backfill = await backfillMissingRecallModels()
    let detailFetched = 0
    let applianceMatched = 0
    let modelParsed = 0
    let inserted = 0
    let skipped = 0
    const failures = []

    for (const listItem of listItems) {
      try {
        const detailHtml = await httpsGet(listItem.detailUrl)
        detailFetched++
        const detail = parseRecallDetail(detailHtml, listItem.detailUrl, listItem.title)

        // Product classification should use the official title. Scanning the full
        // detail body caused accessories and standards text to trigger false positives.
        if (!isHomeApplianceRecall(listItem.title)) {
          skipped++
          continue
        }
        applianceMatched++

        if (!detail.models.length) {
          skipped++
          failures.push({ title: listItem.title, reason: 'missing_model', url: listItem.detailUrl })
          await recordError('Recall detail did not contain a parseable model', {
            title: listItem.title,
            url: listItem.detailUrl
          })
          continue
        }
        modelParsed += detail.models.length

        const docs = buildRecallDocuments(listItem, detail)
        for (const doc of docs) {
          if (await isDuplicate(doc)) {
            skipped++
            continue
          }
          await db.collection('recalls').add({
            data: Object.assign({}, doc, { createdAt: db.serverDate() })
          })
          inserted++
        }
      } catch (e) {
        failures.push({ title: listItem.title, reason: e.message, url: listItem.detailUrl })
        await recordError(`Recall detail failed: ${e.message}`, {
          title: listItem.title,
          url: listItem.detailUrl
        })
      }
    }

    const stats = {
      listItems: listItems.length,
      detailFetched,
      applianceMatched,
      modelParsed,
      inserted,
      skipped,
      backfilled: backfill.updated,
      legacyScanned: backfill.scanned,
      failed: failures.length,
      failures: failures.slice(0, 10)
    }

    console.log('[RecallScrape][SUCCESS]', stats)
    return {
      code: 0,
      success: true,
      message: `Inserted ${inserted} recall records`,
      stats
    }
  } catch (error) {
    console.error('[RecallScrape][FAILURE]', error)
    await recordError(error.message, {
      operation: 'scanRecall',
      url: DEFAULT_LIST_URL,
      stack: String(error.stack || '').slice(0, 300)
    }, 'critical')
    return {
      code: 1,
      success: false,
      msg: `召回抓取失败：${error.message}`
    }
  }
}
