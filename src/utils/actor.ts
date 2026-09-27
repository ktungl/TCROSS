/** 操作者紀錄（建立者／最後修改者／上傳者／刪除者）的顯示格式。 */

export const UNRECORDED = '（未記錄）'

/** ISO 字串 → 「2026-09-27 14:03」（本地時間）；空值回傳空字串。 */
export function formatDateTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 「陳若庭・2026-09-27 14:03」；功能上線前的舊資料沒有操作者，顯示「（未記錄）」。 */
export function actorLine(name?: string, iso?: string): string {
  if (!name) return UNRECORDED
  const time = formatDateTime(iso)
  return time ? `${name}・${time}` : name
}

/** 登入歡迎畫面用的稱呼：三個字的中文姓名取後兩字（陳若庭 → 若庭），其他照原樣。 */
export function greetingNameOf(displayName: string): string {
  const name = displayName.trim()
  return /^[一-鿿]{3}$/.test(name) ? name.slice(1) : name
}
