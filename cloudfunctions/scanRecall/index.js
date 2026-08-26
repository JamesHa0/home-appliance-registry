const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 系统错误收集器 - 用于监控爬虫异常情况
const errorCollection = db.collection('system_errors')

// 召回公告源：国家市场监督管理总局缺陷产品召回技术中心
// 消费品召回公告列表页（含家电：电饭煲、燃气灶等真实案例）
const RECALL_LIST_URL = 'https://www.samrdprc.org.cn/xfpzh/xfpgnzh/'

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

/**
 * 从单页召回公告列表提取召回项
 * @param {string} html - 页面 HTML 内容
 * @returns {Array} 解析后的召回列表
 */
function parseRecalls(html) {
  const items = []
  // 提取形如 "【省份】xxx 公司召回部分 xxx 牌 xxx（型号 xxx）" 的标题
  const re = /【[^】]+】([^<]{5,80}?召回[^<]{0,60})/g
  let m
  while ((m = re.exec(html)) !== null) {
    const title = m[1].replace(/\s+/g, '').trim()
    if (title.length < 8) continue
    const modelMatch = title.match(/型号 [为：: ]*([A-Za-z0-9\-]+)/)
    items.push({
      title,
      model: modelMatch ? modelMatch[1] : '',
      brand: title.match(/牌 ([^\s（(]+)/) ? title.match(/牌 ([^\s（(]+)/)[1] : '',
      source: 'samrdprc',
      link: RECALL_LIST_URL,
      createdAt: db.serverDate()
    })
  }
  return items
}

/**
 * 爬取召回公告页面
 * @param {number} pageNum - 页码（当前仅支持单页抓取）
 * @returns {Promise<Array>} 召回列表
 */
async function scrapePages(pageNum = 1) {
  try {
    console.log(`[RecallScrape][Page${pageNum}] Starting to fetch page...`)
    
    const html = await httpsGet(RECALL_LIST_URL)
    const recalls = parseRecalls(html)
    
    console.log(`[RecallScrape][Page${pageNum}] Successfully parsed ${recalls.length} recalls`)
    return recalls
    
  } catch (error) {
    console.error('[RecallScrape][CRITICAL]', {
      operation: 'scrapePages',
      currentPage: pageNum,
      baseUrl: RECALL_LIST_URL,
      errorMessage: error.message,
      stackTrace: error.stack?.substring(0, 200) || 'N/A'
    })
    
    // 记录到 system_errors 集合
    try {
      await errorCollection.add({
        data: {
          type: 'recall-scrape',
          category: 'critical',
          message: error.message,
          context: {
            operation: 'scrapePages',
            currentPage: pageNum,
            timestamp: new Date().toISOString()
          },
          severity: 'high',
          collectedAt: db.serverDate()
        }
      })
      console.log('[RecallScrape] Error recorded to system_errors')
    } catch (logError) {
      console.error('[RecallScrape] Failed to log error:', logError.message)
    }
    
    throw error
  }
}

exports.main = async (event) => {
  const { action } = event || {}
  // 手动触发：action = 'run'；定时触发器自动调用（无参）
  
  // Dry-run 模式：只打印预期行为，不执行实际抓取
  if (action === 'dry') {
    console.log('[RecallScrape][DRY-RUN] Mode enabled')
    console.log('[RecallScrape][DRY-RUN] Target URL:', RECALL_LIST_URL)
    console.log('[RecallScrape][DRY-RUN] Expected pages: 1')
    console.log('[RecallScrape][DRY-RUN] No actual scraping performed')
    
    return { 
      code: 0,
      success: true,
      dryRun: true,
      preview: {
        expectedPages: 1,
        url: RECALL_LIST_URL,
        note: 'Dry run mode - no operations performed'
      }
    }
  }
  
  try {
    console.log('[RecallScrape][START] Recall scan job initiated')
    console.log('[RecallScrape][CONFIG]', { 
      targetUrl: RECALL_LIST_URL,
      startTime: new Date().toISOString() 
    })
    
    // 步骤 1: 爬取页面
    const allRecalls = await scrapePages(1)
    
    // 步骤 2: 去重处理
    const uniqueRecallsMap = new Map()
    allRecalls.forEach(item => {
      if (!uniqueRecallsMap.has(item.title)) {
        uniqueRecallsMap.set(item.title, item)
      }
    })
    const uniqueRecalls = Array.from(uniqueRecallsMap.values())
    
    // 步骤 3: 统计与存储
    let inserted = 0
    let skipped = 0
    const skipDetails = []
    
    for (const item of uniqueRecalls) {
      if (!item.model) {
        skipped++
        skipDetails.push({ title: item.title, reason: 'missing_model' })
        continue
      }
      
      // 检查重复
      const dupCheck = await db.collection('recalls')
        .where({ title: item.title })
        .count()
      
      if (dupCheck.total > 0) {
        skipped++
        skipDetails.push({ title: item.title, reason: 'duplicate' })
        continue
      }
      
      // 插入数据库
      await db.collection('recalls').add({ data: item })
      inserted++
    }
    
    // ✅ 成功路径：记录详细指标
    console.log('[RecallScrape][SUCCESS]', {
      processedPages: 1,
      totalRecallsFound: allRecalls.length,
      uniqueRecallsAfterDedup: uniqueRecalls.length,
      databaseInserted: inserted,
      databaseSkipped: skipped,
      dedupRate: allRecalls.length > 0 
        ? ((1 - uniqueRecalls.length / allRecalls.length) * 100).toFixed(1) + '%' 
        : '0%',
      executionTimestamp: new Date().toISOString()
    })
    
    return { 
      code: 0,
      success: true,
      message: `Successfully processed ${uniqueRecalls.length} unique recalls`,
      stats: {
        totalPages: 1,
        found: allRecalls.length,
        unique: uniqueRecalls.length,
        inserted,
        skipped,
        skipReasons: skipDetails.slice(0, 5) // 仅返回前 5 条详情
      }
    }
    
  } catch (error) {
    // ❌ 失败路径：记录错误日志
    console.error('[RecallScrape][FAILURE]', {
      errorType: error.name,
      errorMessage: error.message,
      fullStack: error.stack || 'No stack trace',
      timestamp: new Date().toISOString()
    })
    
    // 记录失败到 system_errors
    try {
      await errorCollection.add({
        data: {
          type: 'recall-scrape',
          category: 'job-failed',
          message: `Scan job failed: ${error.message}`,
          context: {
            phase: 'main-execution',
            timestamp: new Date().toISOString()
          },
          severity: 'critical',
          collectedAt: db.serverDate()
        }
      })
      console.log('[RecallScrape] Failure recorded to system_errors')
    } catch (logError) {
      console.error('[RecallScrape] Failed to record failure:', logError.message)
    }
    
    return { 
      code: 1,
      success: false,
      msg: `召回抓取失败：${error.message}`,
      error: error.message,
      timestamp: new Date().toISOString()
    }
  }
}
