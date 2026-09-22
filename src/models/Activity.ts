import Parse from '../lib/parse'
import { PlanObject } from './Plan'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityCategory, ActivityRecord, ActivityFiles, FileMeta, Kpi } from '../types'

/** Cloud Code 要求 kpis 陣列的 k/v/u 都必須是字串；舊資料或曾經用 REST API 寫入的紀錄
 * 可能帶著數字型別的 v/u。讀取時就轉成字串，讓本地狀態（之後任何一次存檔，不管是編輯
 * 基本資料還是儲存成果，都會把整包 kpis 原封不動送回去）永遠是乾淨資料，不會被
 * 「kpis 陣列項目格式不正確」擋下。 */
function normalizeKpis(raw: unknown): Kpi[] {
  if (!Array.isArray(raw)) return []
  return raw.map((k) => ({
    k: String((k as Partial<Kpi> | undefined)?.k ?? ''),
    v: String((k as Partial<Kpi> | undefined)?.v ?? ''),
    u: String((k as Partial<Kpi> | undefined)?.u ?? ''),
  }))
}

export class ActivityObject extends Parse.Object {
  constructor() {
    super('Activity')
  }
}

Parse.Object.registerSubclass('Activity', ActivityObject)

function emptyFiles(): ActivityFiles {
  const files = {} as ActivityFiles
  for (const [key] of ATTACHMENT_TYPES) files[key] = []
  return files
}

export function activityToRecord(obj: Parse.Object): ActivityRecord {
  const files = emptyFiles()
  for (const [key] of ATTACHMENT_TYPES) {
    files[key] = (obj.get(`${key}Files`) as FileMeta[] | undefined) ?? []
  }
  const plans = (obj.get('plans') as Parse.Object[] | undefined) ?? []
  const male = Number(obj.get('maleCount')) || 0
  const female = Number(obj.get('femaleCount')) || 0
  const total = obj.get('totalCount')
  // categories 是新版可複選欄位；舊資料只有單一字串的 category，讀取時往下相容。
  const categories = obj.get('categories') as ActivityCategory[] | undefined
  const legacyCategory = obj.get('category') as ActivityCategory | undefined
  return {
    id: obj.id!,
    name: obj.get('name') ?? '',
    categories: categories?.length ? categories : legacyCategory ? [legacyCategory] : [],
    date: obj.get('date') ?? '',
    time: obj.get('time') ?? '',
    timeEnd: obj.get('timeEnd') ?? '',
    place: obj.get('place') ?? '',
    owner: obj.get('owner') ?? '',
    attendees: obj.get('attendees') ?? '',
    participantDesc: obj.get('participantDesc') ?? '',
    headcount: {
      male,
      female,
      total: typeof total === 'number' ? total : male + female,
    },
    plans: plans.map((p) => p.id!),
    summary: obj.get('summary') ?? '',
    remark: obj.get('remark') ?? '',
    kpis: normalizeKpis(obj.get('kpis')),
    files,
  }
}

export function applyActivityRecord(
  obj: Parse.Object,
  record: Omit<ActivityRecord, 'id' | 'files'>,
): void {
  obj.set('name', record.name)
  obj.set('categories', record.categories)
  // 舊版 category 欄位繼續寫入（取第一個分類），維持與舊報表/查詢的相容性。
  obj.set('category', record.categories[0] ?? '')
  obj.set('date', record.date)
  obj.set('time', record.time)
  obj.set('timeEnd', record.timeEnd)
  obj.set('place', record.place)
  obj.set('owner', record.owner)
  obj.set('attendees', record.attendees)
  obj.set('participantDesc', record.participantDesc)
  obj.set('maleCount', record.headcount.male)
  obj.set('femaleCount', record.headcount.female)
  obj.set('totalCount', record.headcount.total)
  obj.set('summary', record.summary)
  obj.set('remark', record.remark)
  obj.set('kpis', record.kpis)
  obj.set(
    'plans',
    record.plans.map((id) => PlanObject.createWithoutData(id)),
  )
}
