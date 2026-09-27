// 建立角色（member／developer）與帳號，並（加 --clp 時）把資料表權限改成「只有這兩個
// 角色能存取」。
//
// 帳號清單放在 scripts/users.local.json（含密碼，已列入 .gitignore，不會進 git），
// 格式見 scripts/users.example.json。既有帳號只會更新 username／displayName 與角色，
// 一律不送出 password，所以不會改到既有帳號的密碼。
//
//   node scripts/setup-users.mjs                 只列出現況與會做的變更（唯讀）
//   node scripts/setup-users.mjs --apply         建立角色、建立/更新帳號、加入角色
//   node scripts/setup-users.mjs --apply --clp   上面全部＋套用角色 CLP
//
// ⚠️ --clp 套用後，不屬於任何角色的帳號會立刻讀不到任何資料，所以腳本會先檢查
// 「是否每個帳號都已加入角色」，有漏的就拒絕套用。
//
// 需要 .env 裡的 VITE_PARSE_APP_ID／VITE_PARSE_SERVER_URL／PARSE_MASTER_KEY。
import { existsSync, readFileSync } from 'fs'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].trim()
}

const APP_ID = env.VITE_PARSE_APP_ID
const MASTER_KEY = env.PARSE_MASTER_KEY
const SERVER_URL = (env.VITE_PARSE_SERVER_URL || 'https://parseapi.back4app.com').replace(/\/$/, '')

if (!APP_ID || !MASTER_KEY) {
  console.error('.env 缺少 VITE_PARSE_APP_ID 或 PARSE_MASTER_KEY')
  process.exit(1)
}

const configUrl = new URL('./users.local.json', import.meta.url)
if (!existsSync(configUrl)) {
  console.error('找不到 scripts/users.local.json，請複製 scripts/users.example.json 並填入密碼。')
  process.exit(1)
}
/** @type {{ users: { username: string, displayName?: string, password?: string, objectId?: string, roles: string[] }[] }} */
const config = JSON.parse(readFileSync(configUrl, 'utf8'))

const ROLE_NAMES = ['member', 'developer']
const DATA_CLASSES = ['Plan', 'Category', 'Activity', 'GenerationJob']

const apply = process.argv.includes('--apply')
const applyClp = process.argv.includes('--clp')

const headers = {
  'X-Parse-Application-Id': APP_ID,
  'X-Parse-Master-Key': MASTER_KEY,
  'Content-Type': 'application/json',
}

async function api(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} 失敗 (${res.status})：${text}`)
  return text ? JSON.parse(text) : {}
}

const userPointer = (id) => ({ __type: 'Pointer', className: '_User', objectId: id })

async function fetchUsers() {
  return (await api('GET', '/users?limit=1000&keys=username,displayName')).results
}

async function fetchRoles() {
  const roles = {}
  for (const role of (await api('GET', '/roles?limit=100')).results) {
    const where = encodeURIComponent(
      JSON.stringify({
        $relatedTo: { object: { __type: 'Pointer', className: '_Role', objectId: role.objectId }, key: 'users' },
      }),
    )
    const members = (await api('GET', `/users?where=${where}&limit=1000&keys=username`)).results
    roles[role.name] = { id: role.objectId, memberIds: new Set(members.map((u) => u.objectId)) }
  }
  return roles
}

function printUsers(users, roles) {
  console.log('目前的帳號：')
  for (const u of users) {
    const inRoles = Object.entries(roles)
      .filter(([, r]) => r.memberIds.has(u.objectId))
      .map(([name]) => name)
    console.log(
      `  ${u.objectId}  ${u.username.padEnd(20)} ${(u.displayName || '（無顯示名稱）').padEnd(8)}  角色：${inRoles.join(', ') || '（無）'}`,
    )
  }
  console.log()
}

// ───────────────────────── 1. 現況 ─────────────────────────
let users = await fetchUsers()
let roles = await fetchRoles()
printUsers(users, roles)

// ───────────────────────── 2. 角色 ─────────────────────────
for (const name of ROLE_NAMES) {
  if (roles[name]) continue
  console.log(`建立角色 ${name}`)
  if (apply) {
    // ACL：所有人可讀（Parse 解析角色權限時需要），只有 Master Key 能寫。
    const created = await api('POST', '/roles', { name, ACL: { '*': { read: true } } })
    roles[name] = { id: created.objectId, memberIds: new Set() }
  }
}

// ───────────────────────── 3. 帳號 ─────────────────────────
const unknownRoles = config.users.flatMap((u) => u.roles).filter((r) => !ROLE_NAMES.includes(r))
if (unknownRoles.length) {
  console.error(`users.local.json 有未知的角色：${[...new Set(unknownRoles)].join(', ')}`)
  process.exit(1)
}

for (const entry of config.users) {
  const existing = entry.objectId
    ? users.find((u) => u.objectId === entry.objectId)
    : users.find((u) => u.username === entry.username)

  if (entry.objectId && !existing) {
    console.error(`找不到 objectId ${entry.objectId}（${entry.username}）`)
    process.exit(1)
  }

  let userId
  if (existing) {
    userId = existing.objectId
    // 既有帳號：只更新 username／displayName，刻意不送 password。
    const patch = {}
    if (existing.username !== entry.username) patch.username = entry.username
    if (entry.displayName && existing.displayName !== entry.displayName) patch.displayName = entry.displayName
    if (Object.keys(patch).length) {
      console.log(`更新帳號 ${existing.username}：${JSON.stringify(patch)}`)
      if (apply) await api('PUT', `/users/${userId}`, patch)
    }
  } else {
    if (!entry.password) {
      console.error(`新帳號 ${entry.username} 需要在 users.local.json 填 password`)
      process.exit(1)
    }
    console.log(`建立帳號 ${entry.username}（${entry.displayName || '無顯示名稱'}）`)
    if (apply) {
      const created = await api('POST', '/users', {
        username: entry.username,
        password: entry.password,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
      })
      userId = created.objectId
    }
  }

  for (const roleName of entry.roles) {
    const role = roles[roleName]
    if (role && userId && role.memberIds.has(userId)) continue
    console.log(`  將 ${entry.username} 加入角色 ${roleName}`)
    if (apply) {
      await api('PUT', `/roles/${role.id}`, {
        users: { __op: 'AddRelation', objects: [userPointer(userId)] },
      })
      role.memberIds.add(userId)
    }
  }
}

if (apply) {
  users = await fetchUsers()
  roles = await fetchRoles()
  console.log()
  printUsers(users, roles)
}

// ───────────────────────── 4. CLP ─────────────────────────
const roleAccess = Object.fromEntries(ROLE_NAMES.map((r) => [`role:${r}`, true]))
const CLP_BY_CLASS = {
  ...Object.fromEntries(
    DATA_CLASSES.map((c) => [
      c,
      {
        find: roleAccess,
        count: roleAccess,
        get: roleAccess,
        create: roleAccess,
        update: roleAccess,
        delete: roleAccess,
        addField: {},
        protectedFields: {},
      },
    ]),
  ),
  // 稽核紀錄：兩個角色都能看，任何人都不能新增/修改/刪除（只有 Cloud Code 用 Master Key 寫）
  AuditLog: {
    find: roleAccess,
    count: roleAccess,
    get: roleAccess,
    create: {},
    update: {},
    delete: {},
    addField: {},
    protectedFields: {},
  },
  // 原本 _Role 完全公開：任何人（連登入都不用）都能建角色或把自己加進 developer。
  _Role: {
    find: { requiresAuthentication: true },
    count: { requiresAuthentication: true },
    get: { requiresAuthentication: true },
    create: {},
    update: {},
    delete: {},
    addField: {},
    protectedFields: {},
  },
  // 關閉公開註冊與前端自動加欄位；登入、讀自己、改自己（受物件 ACL 保護）不受影響。
  _User: {
    find: { requiresAuthentication: true },
    count: { requiresAuthentication: true },
    get: { requiresAuthentication: true },
    create: {},
    update: { '*': true },
    delete: { '*': true },
    addField: {},
    protectedFields: { '*': ['email'] },
  },
}

const usersWithoutRole = users.filter(
  (u) => !Object.values(roles).some((r) => r.memberIds.has(u.objectId)),
)

console.log()
if (!applyClp) {
  console.log('（未加 --clp，不變更資料表權限。）')
} else if (!apply) {
  console.log('--clp 需要搭配 --apply 才會實際套用。會套用的權限：')
  for (const [className, clp] of Object.entries(CLP_BY_CLASS)) console.log(`  ${className}: ${JSON.stringify(clp)}`)
} else if (usersWithoutRole.length) {
  console.error(
    `以下帳號還不屬於任何角色，套用 CLP 後會讀不到任何資料，已停止：${usersWithoutRole.map((u) => u.username).join(', ')}`,
  )
  process.exit(1)
} else {
  for (const [className, clp] of Object.entries(CLP_BY_CLASS)) {
    await api('PUT', `/schemas/${className}`, { className, classLevelPermissions: clp })
    console.log(`已套用 ${className} 的 CLP`)
  }
}

if (!apply) {
  console.log('\n唯讀模式，未變更任何東西。要實際執行請加上 --apply（資料表權限再加 --clp）。')
}
