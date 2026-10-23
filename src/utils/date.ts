/** 日期字串都用本地時間：toISOString() 是 UTC，台灣早上 8 點前會變成前一天。 */

/** 民國紀年 = 西元 − 1911 */
export const ROC_EPOCH = 1911

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 本地日期「2026-09-27」 */
export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 本地時間「2026-09-27 14:03」 */
export function localDateTimeString(d: Date): string {
  return `${localDateString(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
