const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ok(data) {
  return { code: 0, data }
}

function fail(msg, code) {
  return { code: code || 1, msg }
}

/** 生成 6 位大写邀请码（剔除易混淆字符 0/O/1/I） */
function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)]
  }
  return s
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
        const code = String(event.inviteCode || '').trim().toUpperCase()
        if (!code) return fail('请输入邀请码')
        const res = await db.collection('families').where({ inviteCode: code }).limit(1).get()
        if (!res.data.length) return fail('邀请码无效')
        const fam = res.data[0]
        const members = fam.members || []
        if (members.indexOf(OPENID) === -1) {
          await db.collection('families').doc(fam._id).update({
            data: { members: _.push([OPENID]) }
          })
        }
        return ok({ _id: fam._id, name: fam.name, ownerOpenid: fam.ownerOpenid, inviteCode: fam.inviteCode, members: members.concat(OPENID) })
      }

      // ---------- 设备 ----------
      case 'getDevices': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return ok({ familyId: null, devices: [] })
        const res = await db.collection('devices')
          .where({ familyId: fam._id })
          .orderBy('createdAt', 'desc')
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
          const dup = await db.collection('models')
            .where({ brand: d.brand, model: d.model })
            .count()
          if (dup.total === 0) {
            await db.collection('models').add({
              data: {
                brand: d.brand,
                category: d.category || '',
                model: d.model,
                name: d.name || (d.brand + ' ' + d.model),
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

      case 'updateDevice': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        await assertDeviceBelongs(event.id, fam._id)
        const patch = {}
        const allow = ['name', 'category', 'purchaseDate', 'warrantyYears', 'warrantyEnd']
        allow.forEach(k => {
          if (event[k] !== undefined && event[k] !== null) patch[k] = event[k]
        })
        if (!Object.keys(patch).length) return fail('没有可更新字段')
        await db.collection('devices').doc(event.id).update({ data: patch })
        return ok(true)
      }

      case 'deleteDevice': {
        const fam = await getFamilyByOpenid(OPENID)
        if (!fam) return fail('请先创建或加入家庭')
        if (!event.id) return fail('缺少设备 id')
        await assertDeviceBelongs(event.id, fam._id)
        await db.collection('devices').doc(event.id).remove()
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
