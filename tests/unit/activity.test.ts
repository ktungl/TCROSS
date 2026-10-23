import { describe, expect, it, vi } from 'vitest'
import { activity } from './fixtures'
import { checkBasicInfo, dateMentionMismatches, gaps, score } from '../../src/utils/activity'
import type { BasicInfoInput } from '../../src/utils/activity'

vi.mock('../../src/lib/attachments', () => ({ resolveAttachmentUrl: async (url: string) => url }))
const { readParticipants } = await import('../../src/utils/registration')
const { parseCsv } = await import('../../src/utils/sheet')

describe('gaps / score', () => {
  it('TC-11 資料齊全時沒有缺漏、100 分', () => {
    const a = activity()
    expect(gaps(a)).toEqual([])
    expect(score(a)).toBe(100)
  })

  it('TC-12 每缺一項回報一條、扣 20 分', () => {
    const cases: [string, (a: ReturnType<typeof activity>) => void][] = [
      ['尚未對應計畫', (a) => (a.plans = [])],
      ['照片未達 3 張', (a) => a.files.photo.pop()],
      ['有照片未填圖說', (a) => (a.files.photo[0].caption = ' ')],
      ['沒有簽到表或成果紀錄', (a) => (a.files.signIn = [])],
      ['成果摘要空白', (a) => (a.summary = '  ')],
    ]
    for (const [message, mutate] of cases) {
      const a = activity()
      mutate(a)
      expect(gaps(a), message).toEqual([message])
      expect(score(a), message).toBe(80)
    }
    const empty = activity({ plans: [], summary: '' })
    empty.files.photo = []
    empty.files.signIn = []
    expect(gaps(empty)).toHaveLength(4)
    expect(score(empty)).toBe(20)
  })
})

describe('dateMentionMismatches', () => {
  // 2026-10-18 是星期日
  it('TC-14 寫「10/18(六)」但實際是週日，回報不符', () => {
    const issues = dateMentionMismatches('活動於10/18(六)舉行', '2026-10-18', '摘要')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toBe('摘要寫「(六)」，但活動日期是 2026-10-18（週日）')
  })

  it('TC-14 「（一）」條列編號不誤報', () => {
    expect(dateMentionMismatches('（一）開場致詞\n（二）分組討論\n（六）綜合座談', '2026-10-18', '摘要')).toEqual([])
    expect(dateMentionMismatches('10/18(日) 舉行', '2026-10-18', '摘要')).toEqual([])
  })
})

describe('checkBasicInfo', () => {
  const input = (overrides: Partial<BasicInfoInput> = {}): BasicInfoInput => ({
    name: '座談',
    date: '2025-01-03',
    time: '09:00',
    timeEnd: '12:00',
    placeMode: 'physical',
    place: '臺南市',
    meetingUrl: '',
    participantDesc: '',
    remark: '',
    headcount: { male: 0, female: 0, total: 0 },
    ...overrides,
  })

  it('TC-15 傳入固定 today，日期相關提醒穩定', () => {
    // 活動在 today 之後一週：沒有日期提醒
    expect(checkBasicInfo(input(), new Date(2024, 11, 27))).toEqual([])
    // 活動已過且人數為 0：提醒人數
    expect(checkBasicInfo(input(), new Date(2025, 0, 10))).toEqual(['活動日期已過，但合計人數還是 0'])
    // 距今超過一年
    expect(checkBasicInfo(input({ headcount: { male: 0, female: 0, total: 5 } }), new Date(2026, 5, 1))).toEqual([
      '活動日期 2025-01-03 距今超過一年，請確認年份是否正確',
    ])
  })
})

describe('報名表解析', () => {
  it('TC-16 parseCsv 處理引號內逗號、換行與 ""', () => {
    const text = 'a,"b,c","d\ne","他說""好"""\r\nx,y,z,w'
    expect(parseCsv(text)).toEqual([
      ['a', 'b,c', 'd\ne', '他說"好"'],
      ['x', 'y', 'z', 'w'],
    ])
  })

  it('TC-17 表頭別名辨識成姓名、職稱、單位', async () => {
    const csv = '﻿名字,職務,服務處\n王小明,理事,合作社\n,,\n李大華,社工,協會'
    vi.stubGlobal('fetch', async () => new Response(csv))
    const people = await readParticipants({ name: '報名.csv', size: 1, url: 'gcs:attachments/報名.csv' })
    vi.unstubAllGlobals()
    expect(people).toEqual([
      { name: '王小明', title: '理事', unit: '合作社' },
      { name: '李大華', title: '社工', unit: '協會' },
    ])
  })
})
