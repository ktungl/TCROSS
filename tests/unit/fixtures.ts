import type { ActivityFiles, ActivityRecord, FileMeta } from '../../src/types'

const emptyFiles = (): ActivityFiles => ({
  registration: [],
  content: [],
  photo: [],
  signIn: [],
  record: [],
  agenda: [],
  document: [],
  receipt: [],
  social: [],
  media: [],
})

export function photo(name: string, extra: Partial<FileMeta> = {}): FileMeta {
  return { name, size: 1000, url: `gcs:attachments/${name}`, caption: `${name} 圖說`, ...extra }
}

/** 資料齊全（缺漏檢核 100 分）的活動，各測試再覆寫需要的欄位 */
export function activity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  const files = emptyFiles()
  files.photo = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]
  files.signIn = [{ name: 'sign.pdf', size: 1000, url: 'gcs:attachments/sign.pdf' }]
  return {
    id: 'A1',
    name: '共生照顧座談',
    categories: ['居場所'],
    date: '2025-01-03',
    time: '09:00',
    timeEnd: '12:00',
    placeMode: 'physical',
    place: '臺南市東區大學路1號',
    venue: '共生之家',
    meetingUrl: '',
    owner: '雅婷',
    attendees: '',
    participantDesc: '',
    headcount: { male: 4, female: 6, total: 10 },
    plans: ['P1'],
    summary: '活動順利完成',
    remark: '',
    kpis: [],
    files,
    trash: emptyFiles(),
    archivedAt: '',
    archivedByName: '',
    createdByName: '',
    updatedByName: '',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}
