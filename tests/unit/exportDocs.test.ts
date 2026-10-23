import { afterEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { activity, photo } from './fixtures'

// 匯出模組會 import Parse SDK 與 pdfjs，單元測試用不到，換成假的
vi.mock('../../src/lib/attachments', () => ({ resolveAttachmentUrl: async (url: string) => url }))
vi.mock('../../src/utils/pdfPages', () => ({ renderPdfPages: async () => [] }))
vi.mock('../../src/utils/pdfText', () => ({
  attachmentTextsToPlain: () => '',
  extractPdfText: async () => '',
  readAttachmentTexts: async () => [],
}))

const {
  buildCsv,
  toChineseUpperAmount,
  formatRocChinese,
  buildReceiptXlsx,
  buildSignInSheetDocx,
  buildLedgerXlsx,
  missingImagesMessage,
  SIGN_IN_LAYOUTS,
  takeImageLoadFailures,
} = await import('../../src/utils/exportDocs')
const { computeOutcomeStats } = await import('../../src/utils/outcomeStats')

describe('buildCsv', () => {
  it('TC-01 公式開頭的文字補單引號', () => {
    const csv = buildCsv([['=SUM(A1)', '+1', '-1', '@cmd', 'ok', -5]])
    expect(csv).toBe(`"'=SUM(A1)","'+1","'-1","'@cmd","ok","-5"`)
  })

  it('TC-02 雙引號跳脫、含逗號的欄位用引號包起來', () => {
    expect(buildCsv([['他說"好"', 'a,b']])).toBe(`"他說""好""","a,b"`)
  })
})

describe('toChineseUpperAmount', () => {
  it('TC-03 0 或負數回傳空字串', () => {
    expect(toChineseUpperAmount(0)).toBe('')
    expect(toChineseUpperAmount(-100)).toBe('')
  })

  it('TC-04 萬與伍拾之間補零', () => {
    expect(toChineseUpperAmount(10050)).toBe('壹萬零伍拾')
    expect(toChineseUpperAmount(12500)).toBe('壹萬貳仟伍佰')
    expect(toChineseUpperAmount(1050)).toBe('壹仟零伍拾')
  })

  it('TC-05 小數無條件捨去', () => {
    expect(toChineseUpperAmount(6000.99)).toBe('陸仟')
    expect(toChineseUpperAmount(0.5)).toBe('')
  })
})

describe('formatRocChinese', () => {
  it('TC-06 民國日期；不合法日期回傳空字串', () => {
    expect(formatRocChinese('2025-01-03')).toBe('114年1月3日')
    expect(formatRocChinese('2025/01/03')).toBe('')
    expect(formatRocChinese('')).toBe('')
  })
})

describe('buildReceiptXlsx', () => {
  it('TC-07 金額、國字大寫、日期儲存格正確', async () => {
    const a = activity({ date: '2025-01-03' })
    const blob = await buildReceiptXlsx(a, {
      payer: '社團法人臺灣合作社照顧聯盟',
      item: '講師鐘點費',
      plans: ['共生計畫'],
      entries: [{ time: '09:00', timeEnd: '11:00', amount: 10050, payeeName: '王小明', payeeUnit: '大學' }],
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const sheet = wb.worksheets[0]
    expect(sheet.getCell('G4').value).toBe(10050)
    expect(sheet.getCell('C4').value).toBe('壹萬零伍拾')
    expect(sheet.getCell('G2').value).toBe(114)
    // 2025-01-03 是星期五
    expect(sheet.getCell('A13').value).toBe('日期:114/01/03(五)09:00-11:00')
  })
})

describe('buildSignInSheetDocx', () => {
  it.each(Object.keys(SIGN_IN_LAYOUTS) as (keyof typeof SIGN_IN_LAYOUTS)[])(
    'TC-08 版型 %s 能產出且含活動名稱與日期',
    async (layout) => {
      const blob = await buildSignInSheetDocx(activity(), { titlePlans: ['共生計畫'], layout })
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      const xml = await zip.file('word/document.xml')!.async('string')
      expect(xml).toContain('共生照顧座談 簽到表')
      expect(xml).toContain('114年1月3日(星期五)')
    },
  )
})

describe('大事紀照片挑選', () => {
  afterEach(() => vi.unstubAllGlobals())

  // 照片下載一律失敗，只記錄被挑中的照片網址
  async function pickedUrls(photos: ReturnType<typeof photo>[]): Promise<string[]> {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response(null, { status: 404 })
    })
    const a = activity()
    a.files.photo = photos
    await buildLedgerXlsx([a], (id) => id, { photosPerRow: 3 })
    return fetched
  }

  it('TC-09 有精選只取精選，最多 3 張', async () => {
    const urls = await pickedUrls([
      photo('1.jpg'),
      photo('2.jpg', { featured: true }),
      photo('3.jpg', { featured: true }),
      photo('4.jpg'),
      photo('5.jpg', { featured: true }),
      photo('6.jpg', { featured: true }),
    ])
    expect(urls).toEqual(['gcs:attachments/2.jpg', 'gcs:attachments/3.jpg', 'gcs:attachments/5.jpg'])
  })

  it('TC-09 沒標記精選時照上傳順序取前 3 張', async () => {
    const urls = await pickedUrls([photo('1.jpg'), photo('2.jpg'), photo('3.jpg'), photo('4.jpg')])
    expect(urls).toEqual(['gcs:attachments/1.jpg', 'gcs:attachments/2.jpg', 'gcs:attachments/3.jpg'])
  })

  it('抓不到的照片會列在提示裡，不會默默少一張', async () => {
    takeImageLoadFailures()
    await pickedUrls([photo('1.jpg'), photo('2.jpg')])
    expect(missingImagesMessage()).toBe('有 2 張圖片沒能放進檔案（「1.jpg」、「2.jpg」），請稍後重新下載')
    // 取過一次就清空，下一次產生檔案重新計算
    expect(missingImagesMessage()).toBeNull()
  })
})

describe('computeOutcomeStats', () => {
  it('TC-10 場次、人數與各計畫分組加總正確', () => {
    const list = [
      activity({ id: '1', date: '2025-01-03', plans: ['P1'], headcount: { male: 4, female: 6, total: 10 } }),
      activity({ id: '2', date: '2025-01-20', plans: ['P1', 'P2'], headcount: { male: 1, female: 2, total: 5 } }),
      activity({ id: '3', date: '2025-02-01', plans: [], categories: [], headcount: { male: 0, female: 0, total: 0 } }),
    ]
    const names: Record<string, string> = { P1: '共生計畫', P2: '合作教育計畫' }
    const stats = computeOutcomeStats(list, (id) => names[id])

    expect(stats.overall).toEqual({ label: '合計', sessions: 3, male: 5, female: 8, total: 15 })
    expect(stats.byPlan).toEqual([
      { label: '共生計畫', sessions: 2, male: 5, female: 8, total: 15 },
      { label: '合作教育計畫', sessions: 1, male: 1, female: 2, total: 5 },
      { label: '未對應計畫', sessions: 1, male: 0, female: 0, total: 0 },
    ])
    expect(stats.byMonth.map((r) => [r.label, r.sessions, r.total])).toEqual([
      ['2025-01', 2, 15],
      ['2025-02', 1, 0],
    ])
    expect(stats.byCategory.find((r) => r.label === '未分類')?.sessions).toBe(1)
  })
})
