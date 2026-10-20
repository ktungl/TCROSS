// 搬家後的行為檢查：以一般成員身分登入，驗證讀取、CLP、Cloud Code 驗證與稽核紀錄都和 Back4App 一致。
// rehearse-local.mjs（本機／測試資料庫）與 smoke-test.mjs（Cloud Run 上的伺服器）共用。
// 會新增再刪除一筆「搬家演練活動」，並留下登入／新增／刪除三筆稽核紀錄。
import { readFileSync } from 'fs'
import { join } from 'path'

/** 回傳不符的項目數；每個請求的耗時印在最後，用來看速度。 */
export async function runChecks({ base, appId, jsKey, dir }) {
  const backup = (c) => JSON.parse(readFileSync(join(dir, 'classes', `${c}.json`), 'utf8'))
  const roles = JSON.parse(readFileSync(join(dir, 'roles.json'), 'utf8'))
  const { tempPasswords } = JSON.parse(readFileSync(join(dir, 'import-result.json'), 'utf8'))
  let failed = 0
  const timings = []

  async function call(method, path, body, session) {
    const headers = { 'X-Parse-Application-Id': appId, 'X-Parse-JavaScript-Key': jsKey, 'Content-Type': 'application/json' }
    if (session) headers['X-Parse-Session-Token'] = session
    const t0 = performance.now()
    const res = await fetch(`${base}${path}`, { method, headers, body: body && JSON.stringify(body) })
    const json = await res.json()
    timings.push({ label: `${method} ${path.split('?')[0]}`, ms: Math.round(performance.now() - t0) })
    return { status: res.status, json }
  }
  function check(ok, label, detail = '') {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`)
    if (!ok) failed++
  }

  console.log('\n══ 以一般成員身分驗證 ══')
  const member = roles.member[0].username
  const login = await call('POST', '/login', { username: member, password: tempPasswords[member] })
  check(login.status === 200, `成員 ${member} 登入`)
  const session = login.json.sessionToken

  const me = await call('GET', '/users/me', undefined, session)
  check(me.json.username === member, 'GET /users/me（Cloud Run 中介層驗身分用）')

  for (const c of ['Activity', 'Plan', 'Category', 'GenerationJob']) {
    const r = await call('GET', `/classes/${c}?count=1&limit=0`, undefined, session)
    check(r.json.count === backup(c).length, `讀取 ${c}`, `${r.json.count}／${backup(c).length} 筆`)
  }
  // 剛才的登入本身會被 Cloud Code 記一筆，所以最新一筆應該是這次登入
  const audit = await call('GET', '/classes/AuditLog?count=1&limit=1&order=-createdAt', undefined, session)
  const latest = audit.json.results[0]
  check(
    audit.json.count > backup('AuditLog').length && latest.action === 'login' && latest.actorId === me.json.objectId,
    '讀取 AuditLog，且登入有被記錄',
    `${audit.json.count} 筆，最新一筆 ${latest.action}／${latest.actorName}`,
  )
  const anon = await call('GET', '/classes/Activity?limit=1')
  check(anon.status !== 200 || anon.json.results.length === 0, '未登入讀不到活動（CLP）', `HTTP ${anon.status}`)

  const bad = await call('POST', '/classes/Activity', { name: '' }, session)
  check(bad.json.code === 142, 'Cloud Code 擋下空白活動名稱', bad.json.error)

  const created = await call('POST', '/classes/Activity', { name: '搬家演練活動' }, session)
  check(created.status === 201, '新增活動', created.json.error || created.json.objectId)
  const id = created.json.objectId
  const fetched = await call('GET', `/classes/Activity/${id}`, undefined, session)
  check(fetched.json.createdByName === me.json.displayName, 'Cloud Code 寫入建立者', fetched.json.createdByName)

  const del = await call('DELETE', `/classes/Activity/${id}`, undefined, session)
  check(del.status === 200, '刪除活動')
  const logs = await call('GET', `/classes/AuditLog?where=${encodeURIComponent(JSON.stringify({ targetId: id }))}`, undefined, session)
  const actions = logs.json.results.map((l) => l.action).sort().join(',')
  check(actions === 'create,delete', 'afterSave／afterDelete 寫入稽核紀錄', actions)

  const forged = await call('POST', '/classes/AuditLog', { action: 'create', summary: '偽造' }, session)
  check(forged.status !== 201, '成員不能自己寫稽核紀錄', `HTTP ${forged.status}`)

  // 前端開活動列表時實際會做的查詢：抓全部活動（含附件陣列）
  const list = await call('GET', '/classes/Activity?limit=1000&order=-date', undefined, session)
  check(list.json.results?.length === backup('Activity').length, '活動列表（完整資料）', `${list.json.results?.length} 筆`)

  console.log('\n══ 每個請求耗時 ══')
  for (const t of timings) console.log(`  ${String(t.ms).padStart(5)} ms  ${t.label}`)
  const sorted = timings.map((t) => t.ms).sort((a, b) => a - b)
  console.log(`  中位數 ${sorted[Math.floor(sorted.length / 2)]} ms，最慢 ${sorted[sorted.length - 1]} ms`)

  console.log(failed ? `\n✗ 有 ${failed} 項不符` : '\n✓ 全部通過')
  return failed
}
