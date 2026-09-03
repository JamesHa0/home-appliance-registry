const cloud = require('wx-server-sdk')

require('./middleware/rateLimit') // Load rate limiter middleware

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// Import addYears utility for consistent leap year handling across frontend/cloud
const { addYears: calculateAddYears } = require('./utils/warranty.js')  // Fixed NEW-1: Correct relative path for cloud function

function ok(data) {
  return { code: 0, data }
}

function fail(msg, code) {
  return { code: code || 1, msg }
}

/** 生成 6 位邀请码（含校验位）：前 5 位随机 + 第 6 位校验 */
function genInviteCode() {
  // 注意：字符集实际长度必须与校验位取模一致，否则会越界生成 undefined
  const baseChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789' // 34 字符（A-Z 去 I/O + 0-9）
  
  // 生成 5 个随机字符
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += baseChars.charAt(Math.floor(Math.random() * baseChars.length))
  }
  
  // 计算校验位：取模必须用字符集长度，保证结果始终在字符集范围内
  let sum = 0
  for (let i = 0; i < 5; i++) {
    sum += baseChars.indexOf(code[i])
  }
  const checkDigit = baseChars[sum % baseChars.length]
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

/** 聚合成员的昵称与头像（users 集合），供家庭页展示"谁是谁" */
async function getMembersDetail(members, ownerOpenid) {
  const list = members || []
  if (!list.length) return []
  const ur = await db.collection('users')
    .where({ openid: _.in(list) })
    .limit(100)
    .get()
    .catch(() => ({ data: [] }))
  const usersMap = {}
  ;(ur.data || []).forEach(u => { usersMap[u.openid] = u })
  return list.map(openid => ({
    openid,
    nickname: (usersMap[openid] && usersMap[openid].nickname) || '',
    avatarFileId: (usersMap[openid] && usersMap[openid].avatarFileId) || '',
    isOwner: openid === ownerOpenid
  }))
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event || {}

  try {
    switch (action) {
      // ---------- 家庭 ----------
      case 'getFamily': {
        let fam = await getFamilyByOpenid(OPENID)
        // 数据兜底：早期/异常数据可能缺 inviteCode 字段，缺失时补生成，
        // 保证无论创建者还是家庭成员调用 getFamily 都能拿到邀请码
        if (fam && !fam.inviteCode) {
          const code = genInviteCode()
          await db.collection('families').doc(fam._id).update({ data: { inviteCode: code } })
          fam = Object.assign({}, fam, { inviteCode: code })
        }
        if (!fam) return ok({ openid: OPENID })
        const v = familyView(fam)
        // 聚合成员昵称头像，供家庭页展示（members 保持字符串数组不变）
        const membersDetail = await getMembersDetail(fam.members, fam.ownerOpenid)
        return ok(Object.assign({ openid: OPENID }, v, { membersDetail }))
      }

      case 'updateProfile': {
        // 设置当前用户的全局昵称/头像（users 集合，按 openid upsert）
        const nickname = String(event.nickname || '').trim().slice(0, 20)
        const avatarFileId = String(event.avatarFileId || '').trim()
        const now = db.serverDate()
        const existing = await db.collection('users').where({ openid: OPENID }).limit(1).get()
        if (existing.data.length) {
          await db.collection('users').doc(existing.data[0]._id).update({
            data: { nickname, avatarFileId, updatedAt: now }
          })
        } else {
          await db.collection('users').add({
            data: { openid: OPENID, nickname, avatarFileId, createdAt: now, updatedAt: now }
          })
        }
        return ok({ openid: OPENID, nickname, avatarFileId })
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
          // Fixed P0-5: Check if user already belongs to another family
          const existingFamily = await getFamilyByOpenid(OPENID)
          if (existingFamily) {
            return fail('您已加入一个家庭，如需加入其他家庭请先到家庭管理页退出', 400)
          }
          
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
              // 使用单值 push：传数组依赖 SDK 的 $each 展开兼容行为，若底层按 MongoDB
              // 原生 $push 处理会把整个数组作为单个元素追加，形成嵌套数组（members: [A, [B]]），
              // 导致 getFamilyByOpenid 的 where({ members: openid }) 查询不到成员 → 成员看不到家庭与邀请码
              await db.collection('families').doc(fam._id).update({
                data: { members: _.push(OPENID) }
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
        if (!fam) return ok({ familyId: null, devices: [], archivedCount: 0 })
        // 归档过滤：archived=true 查已归档；否则查在库（_.neq(true) 兼容无 archived 字段的历史数据）
        const wantArchived = event.archived === true
        const cond = wantArchived
          ? { familyId: fam._id, archived: true }
          : { familyId: fam._id, archived: _.neq(true) }
        const res = await db.collection('devices')
          .where(cond)
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get()
        // 在库查询时顺带统计已归档数，供首页「已归档」入口角标
        let archivedCount = 0
        if (!wantArchived) {
          const cnt = await db.collection('devices')
            .where({ familyId: fam._id, archived: true })
            .count()
          archivedCount = cnt.total || 0
        }
        return ok({ familyId: fam._id, devices: res.data, archivedCount })
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

        // 设备别称：用户填写则原样使用；未填写时自动生成默认名并对同家庭重名追加序号，
        // 保证多台同品牌同型号设备在列表中可区分（如"美的 空调" / "美的 空调 2"）
        let deviceName = String(d.name || '').trim()
        if (!deviceName) {
          deviceName = (d.brand + ' ' + (d.category || d.model)).trim()
          const dup = await db.collection('devices')
            .where({ familyId: fam._id, name: deviceName })
            .count()
          if (dup.total > 0) deviceName = `${deviceName} ${dup.total + 1}`
        }

        const device = {
          familyId: fam._id,
          brand: d.brand,
          category: d.category || '',
          model: d.model,
          name: deviceName,
          purchaseDate: d.purchaseDate || '',
          warrantyYears: d.warrantyYears || 0,
          warrantyEnd: d.warrantyEnd || '',
          barcode: d.barcode || '',
          archived: false,
          archivedAt: null,
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
            let isSafe = false
            try {
              // P0-4：内容安全检测（msgSecCheck v2 云调用）
              // 参数契约：content 必须是字符串；version/openid/scene 为平级必填项
              // 权限：需在本云函数目录 config.json 的 permissions.openapi 声明 security.msgSecCheck
              const textToCheck = `${ugcBrand} ${ugcModel} ${ugcName}`.slice(0, 2500)
              const securityResult = await cloud.openapi.security.msgSecCheck({
                openid: OPENID,
                scene: 2,        // 2: 评论（用户生成内容）
                version: 2,
                content: textToCheck
              })
              // 返回结构：{ errcode, result: { suggest: 'pass'|'risky'|'review', label } }
              const suggest = securityResult && securityResult.result && securityResult.result.suggest
              isSafe = suggest === 'pass'

              if (!isSafe) {
                console.warn('[FamilyService] UGC content blocked by security:', {
                  openid: OPENID.slice(-8),
                  suggest,
                  text: textToCheck.slice(0, 20) + '...'
                })
              }
            } catch (error) {
              // fail-closed：检测接口异常时拒绝入库，防止违规内容借报错绕过检测
              // （设备本身仍创建成功，仅跳过公开型号库贡献）
              console.error('[FamilyService] Security check failed, skip UGC contribution:', error)
              isSafe = false
            }

            if (isSafe) {
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
          if (event[k] === undefined || event[k] === null) return
          // 防误清空：别称（name）传空串时忽略，避免列表/详情显示空白
          if (k === 'name' && String(event[k]).trim() === '') return
          patch[k] = event[k]
        })
        
        if (!Object.keys(patch).length) return fail('没有可更新字段')
        
        // 如果 purchaseDate 或 warrantyYears 被修改，需要重新计算 warrantyEnd
        // 注意用 !== undefined 判断（不能用 truthy）：单独把保修年限改成 0 也要触发重算
        if (patch.purchaseDate !== undefined || patch.warrantyYears !== undefined) {
          const newPurchaseDate = patch.purchaseDate || device.purchaseDate
          const newWarrantyYears = patch.warrantyYears !== undefined ? patch.warrantyYears : device.warrantyYears  // Fixed P1-2: Use ternary to support 0 value
          patch.warrantyEnd = calculateAddYears(newPurchaseDate, newWarrantyYears)
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

      case 'archiveDevice': {
        // 一级删除 = 归档（软删除，可恢复）：设 archived 标记并清理订阅，设备不在首页/待办/召回中显示
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        await assertDeviceBelongs(event.id, fam._id)
        await db.collection('devices').doc(event.id).update({
          data: { archived: true, archivedAt: db.serverDate() }
        })
        // 归档后不再推送保修提醒，清掉该设备的订阅
        await db.collection('subscriptions')
          .where({ deviceId: event.id })
          .remove()
          .catch(() => {})
        return ok(true)
      }

      case 'restoreDevice': {
        // 从归档恢复：清 archived 标记，回到在库列表（订阅不自动恢复，用户需重新订阅）
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        await assertDeviceBelongs(event.id, fam._id)
        await db.collection('devices').doc(event.id).update({
          data: { archived: false, archivedAt: null }
        })
        return ok(true)
      }
      
      case 'leaveFamily': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('暂无家庭')

        if (fam.ownerOpenid === OPENID) {
          // 创建者不能退出自己创建的家庭；可在家庭页「解散家庭」后重新创建或加入其他家庭
          return fail('作为家庭创建者，请先在家庭页解散家庭，再创建或加入其他家庭', 400)
        }

        // 清理该用户在本家庭设备上的保修提醒订阅，避免退出后仍收到原家庭推送
        const leaveDevices = await db.collection('devices')
          .where({ familyId: fam._id })
          .limit(1000)
          .get()
          .catch(() => ({ data: [] }))
        const leaveDeviceIds = (leaveDevices.data || []).map(d => d._id)
        if (leaveDeviceIds.length) {
          await db.collection('subscriptions')
            .where({ openid: OPENID, deviceId: _.in(leaveDeviceIds) })
            .remove()
            .catch(() => {})
        }

        // Remove member from family
        await db.collection('families').doc(fam._id).update({
          data: { members: _.pull(OPENID) }
        })

        console.log('[FamilyService] User left family:', {
          familyId: fam._id,
          openid: OPENID.slice(-8),
          cleanedSubscriptions: leaveDeviceIds.length
        })

        return ok(true)
      }

      case 'removeMember': {
        // 创建者将成员移出家庭：仅 owner 可调，目标须为家庭成员且非 owner 本人
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('暂无家庭')
        if (fam.ownerOpenid !== OPENID) {
          return fail('只有家庭创建者可以移除成员', 400)
        }
        const target = String(event.memberOpenid || '')
        if (!target) return fail('缺少成员 openid')
        if (target === OPENID) {
          return fail('创建者不能移除自己，如需解散请使用「解散家庭」', 400)
        }
        const members = fam.members || []
        if (!members.includes(target)) return fail('该成员不在当前家庭中')

        // 清理该成员在本家庭设备上的保修提醒订阅，避免被移除后仍收到原家庭推送
        const kickDevices = await db.collection('devices')
          .where({ familyId: fam._id })
          .limit(1000)
          .get()
          .catch(() => ({ data: [] }))
        const kickDeviceIds = (kickDevices.data || []).map(d => d._id)
        if (kickDeviceIds.length) {
          await db.collection('subscriptions')
            .where({ openid: target, deviceId: _.in(kickDeviceIds) })
            .remove()
            .catch(() => {})
        }

        // 从成员列表移除（设备档案属家庭级数据，保留在家庭内）
        await db.collection('families').doc(fam._id).update({
          data: { members: _.pull(target) }
        })

        console.log('[FamilyService] Member removed by owner:', {
          familyId: fam._id,
          owner: OPENID.slice(-8),
          member: target.slice(-8),
          cleanedSubscriptions: kickDeviceIds.length
        })

        return ok(true)
      }

      case 'dissolveFamily': {
        // 解除创建者死锁：joinFamily 拒绝多家庭 + leaveFamily 拒绝 owner 后，
        // owner 需要一个出口 —— 解散家庭（级联删除设备与订阅），之后可重新创建或加入其他家庭
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('暂无家庭')
        if (fam.ownerOpenid !== OPENID) {
          return fail('只有家庭创建者可以解散家庭', 400)
        }

        // 级联清理：本家庭全部设备的订阅记录 → 设备 → 家庭
        const famDevices = await db.collection('devices')
          .where({ familyId: fam._id })
          .limit(1000)
          .get()
          .catch(() => ({ data: [] }))
        const famDeviceIds = (famDevices.data || []).map(d => d._id)
        if (famDeviceIds.length) {
          await db.collection('subscriptions')
            .where({ deviceId: _.in(famDeviceIds) })
            .remove()
            .catch(() => {})
          await db.collection('devices')
            .where({ familyId: fam._id })
            .remove()
            .catch(() => {})
        }
        await db.collection('families').doc(fam._id).remove()

        console.log('[FamilyService] Family dissolved:', {
          familyId: fam._id,
          openid: OPENID.slice(-8),
          deviceCount: famDeviceIds.length
        })

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
