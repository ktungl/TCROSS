import Parse from '../lib/parse'
import { PlanObject } from './Plan'
import { ATTACHMENT_TYPES } from '../types'
import type { ActivityCategory, ActivityRecord, ActivityFiles, FileMeta } from '../types'

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
  return {
    id: obj.id!,
    name: obj.get('name') ?? '',
    category: (obj.get('category') as ActivityCategory | undefined) ?? '',
    date: obj.get('date') ?? '',
    dateEnd: obj.get('dateEnd') ?? '',
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
    kpis: obj.get('kpis') ?? [],
    files,
  }
}

export function applyActivityRecord(
  obj: Parse.Object,
  record: Omit<ActivityRecord, 'id' | 'files'>,
): void {
  obj.set('name', record.name)
  obj.set('category', record.category)
  obj.set('date', record.date)
  obj.set('dateEnd', record.dateEnd)
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
