const cloud = require('wx-server-sdk')

require('./middleware/rateLimit') // Load rate limiter middleware

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ok(data) {
  return { code: 0, data }
}

function fail(msg, code) {
  return { code: code || 1, msg }
}

function addYears(dateStr, years) {
  const d = new Date(String(dateStr).replace(/-/g, '/'))
  d.setFullYear(d.getFullYear() + (Number(years) || 0))
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 生成 6 位邀请码（含校验位）：前 5 位随机 + 第 6 位校验 */
function genInviteCode() {
  const baseChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789' // 40 字符集，无易混淆字符
  
  // 生成 5 个随机字符
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += baseChars.charAt(Math.floor(Math.random() * baseChars.length))
  }
  
  // 计算校验位（mod 37）
  let sum = 0
  for (let i = 0; i < 5; i++) {
    sum += baseChars.indexOf(code[i])
  }
  const checkDigit = baseChars[sum % 37]
  code += checkDigit
  
  console.log('[FamilyService] Generated invite code:', code.slice(0, 2) + '****')
  return code
}

/** 查询调用者所在家庭（members 含 openid） */
async function getFamilyByOpenid(openid) {
  const res = await db.collection('families').where({ members: openid }).limit(1).get()
  return res.data[0] || null
}

/** 校验设备属于该家庭，返回设备文档（否则抛错） */
async function assertDeviceBelongs(deviceId, familyId) {
  const res = await db.collection('devices').doc(deviceId).get().catch(() => null)
  if (!res || !res.data) throw new Error('设备不存在')
  if (res.data.familyId !== familyId) throw new Error('无权访问该设备')
  return res.data
}

/** 自动创建个人家庭（首次建档无家庭时） */
async function ensureFamily(openid) {
  const fam = await getFamilyByOpenid(openid)
  if (fam) return fam
  const inviteCode = genInviteCode()
  const add = await db.collection('families').add({
    data: {
      name: '我的家',
      ownerOpenid: openid,
      members: [openid],
      inviteCode,
      createdAt: db.serverDate()
    }
  })
  return { _id: add._id, name: '我的家', ownerOpenid: openid, members: [openid], inviteCode }
}

function familyView(f) {
  if (!f) return null
  return {
    _id: f._id,
    name: f.name,
    ownerOpenid: f.ownerOpenid,
    inviteCode: f.inviteCode,
    members: f.members || []
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event || {}

  try {
    switch (action) {
      // ---------- 家庭 ----------
      case 'getFamily': {
        const fam = await getFamilyByOpenid(OPENID)
        const v = familyView(fam)
        return ok(v ? Object.assign({ openid: OPENID }, v) : { openid: OPENID })
      }

      case 'createFamily': {
        const existing = await getFamilyByOpenid(OPENID)
        if (existing) return ok(familyView(existing))
        const inviteCode = genInviteCode()
        const name = (event.name || '我的家').slice(0, 20)
        const add = await db.collection('families').add({
          data: {
            name,
            ownerOpenid: OPENID,
            members: [OPENID],
            inviteCode,
            createdAt: db.serverDate()
          }
        })
        return ok({ _id: add._id, name, ownerOpenid: OPENID, inviteCode, members: [OPENID] })
      }

      case 'joinFamily': {
        try {
          // Rate limiter for join family (5 attempts per hour, 5 min block)
          const joinRateLimiter = require('./middleware/rateLimit').createRateLimiter({
            windowMs: 3600000,       // 1 hour window
            maxRequests: 5,          // max 5 attempts
            blockDuration: 300000    // 5 minute block
          })
          
          const code = String(event.inviteCode || '').trim().toUpperCase()
          
          // Apply rate limiting
          const result = await joinRateLimiter(
            { openid: OPENID, clientIP: event.clientIP },
            async () => {
              // Find family by invite code
              const res = await db.collection('families')
                .where({ inviteCode: code })
                .limit(1)
                .get()
              
              if (!res.data.length) {
                throw new Error('邀请码不存在或已过期')
              }
              
              const fam = res.data[0]
              const members = fam.members || []
              
              // Check if already member
              if (members.includes(OPENID)) {
                throw new Error('您已经加入该家庭')
              }
              
              // Add member to family
              await db.collection('families').doc(fam._id).update({
                data: { members: _.push([OPENID]) }
              })
              
              console.log('[FamilyService] Member joined successfully:', {
                familyId: fam._id,
                openid: OPENID.slice(-8),
                inviteCode: code
              })
              
              return {
                _id: fam._id,
                name: fam.name,
                ownerOpenid: fam.ownerOpenid,
                inviteCode: fam.inviteCode,
                members: members.concat(OPENID)
              }
            },
            async () => {
              // Callback when blocked
              console.warn('[FamilyService] Join attempt blocked due to rate limit:', {
                openid: OPENID.slice(-8),
                clientIP: event.clientIP || 'unknown'
              })
            }
          )
          return ok(result)

        } catch (error) {
          // Distinguish between rate limit errors and business logic errors
          if (error.message.includes('操作过于频繁')) {
            return fail(error.message)
          }
          
          // For other errors, return detailed message
          return fail(error.message || '加入家庭失败')
        }
      }

      // ---------- 设备 ----------
      case 'getDevices': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return ok({ familyId: null, devices: [] })
        const res = await db.collection('devices')
          .where({ familyId: fam._id })
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get()
        return ok({ familyId: fam._id, devices: res.data })
      }

      case 'getDevice': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        const device = await assertDeviceBelongs(event.id, fam._id)
        return ok(device)
      }

      case 'createDevice': {
        const fam = await ensureFamily(OPENID)
        const d = event.device || {}
        if (!d.brand || !d.model) return fail('品牌与型号必填')
        const device = {
          familyId: fam._id,
          brand: d.brand,
          category: d.category || '',
          model: d.model,
          name: d.name || (d.brand + ' ' + d.model),
          purchaseDate: d.purchaseDate || '',
          warrantyYears: d.warrantyYears || 0,
          warrantyEnd: d.warrantyEnd || '',
          barcode: d.barcode || '',
          createdAt: db.serverDate()
        }
        const addRes = await db.collection('devices').add({ data: device })

        // UGC：用户勾选贡献且型号库无此 brand+model 时写入（source=ugc）
        if (event.contribute && d.brand && d.model) {
          const ugcBrand = String(d.brand).trim().slice(0, 20)
          const ugcModel = String(d.model).trim().slice(0, 50)
          const ugcName = String(d.name || '').trim().slice(0, 30)
          const dup = await db.collection('models')
            .where({ brand: ugcBrand, model: ugcModel })
            .count()
          if (dup.total === 0) {
            await db.collection('models').add({
              data: {
                brand: ugcBrand,
                category: String(d.category || '').trim().slice(0, 20),
                model: ugcModel,
                name: ugcName || (ugcBrand + ' ' + ugcModel),
                barcode: String(d.barcode || '').trim().slice(0, 20),
                manualUrl: '',
                source: 'ugc',
                contributedBy: OPENID,
                createdAt: db.serverDate()
              }
            })
          }
        }
        return ok({ id: addRes._id, familyId: fam._id })
      }

      /**
       * 更新设备信息 - 编辑模式核心逻辑
       * 验证权限、只更新允许的字段、自动重新计算保修到期日
       */
      case 'updateDevice': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        
        const device = await assertDeviceBelongs(event.id, fam._id)
        
        // 允许更新的字段列表
        const patch = {}
        const allow = ['name', 'category', 'model', 'brand', 'purchaseDate', 'warrantyYears', 'warrantyEnd']
        
        allow.forEach(k => {
          if (event[k] !== undefined && event[k] !== null) {
            patch[k] = event[k]
          }
        })
        
        if (!Object.keys(patch).length) return fail('没有可更新字段')
        
        // 如果 purchaseDate 或 warrantyYears 被修改，需要重新计算 warrantyEnd
        if (patch.purchaseDate || patch.warrantyYears) {
          const newPurchaseDate = patch.purchaseDate || device.purchaseDate
          const newWarrantyYears = patch.warrantyYears || device.warrantyYears
          patch.warrantyEnd = addYears(newPurchaseDate, newWarrantyYears)
        }
        
        await db.collection('devices').doc(event.id).update({ data: patch })
        
        console.log('[FamilyService] Device updated:', {
          deviceId: event.id,
          updates: patch
        })
        
        return ok(true)
      }

      case 'deleteDevice': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        await assertDeviceBelongs(event.id, fam._id)
        await db.collection('devices').doc(event.id).remove()
        // 级联清理该设备的订阅记录，避免残留 used:false 记录触发无效发送
        await db.collection('subscriptions')
          .where({ deviceId: event.id })
          .remove()
          .catch(() => {})
        return ok(true)
      }

      default:
        return fail('未知操作: ' + action)
    }
  } catch (e) {
    console.error('familyService error', action, e)
    return fail(e.message || '服务异常')
  }
}
