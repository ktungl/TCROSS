import Parse from '../lib/parse'
import { PlanObject } from './Plan'
import { FOLDERS } from '../types'
import type { ActivityRecord, ActivityFiles, FileMeta } from '../types'

export class ActivityObject extends Parse.Object {
  constructor() {
    super('Activity')
  }
}

Parse.Object.registerSubclass('Activity', ActivityObject)

function emptyFiles(): ActivityFiles {
  return { photo: [], audio: [], video: [], doc: [] }
}

export function activityToRecord(obj: Parse.Object): ActivityRecord {
  const files = emptyFiles()
  for (const [key] of FOLDERS) {
    files[key] = (obj.get(`${key}Files`) as FileMeta[] | undefined) ?? []
  }
  const plans = (obj.get('plans') as Parse.Object[] | undefined) ?? []
  return {
    id: obj.id!,
    name: obj.get('name') ?? '',
    date: obj.get('date') ?? '',
    place: obj.get('place') ?? '',
    owner: obj.get('owner') ?? '',
    headcount: obj.get('headcount') ?? 0,
    plans: plans.map((p) => p.id!),
    summary: obj.get('summary') ?? '',
    kpis: obj.get('kpis') ?? [],
    files,
  }
}

export function applyActivityRecord(
  obj: Parse.Object,
  record: Omit<ActivityRecord, 'id' | 'files'>,
): void {
  obj.set('name', record.name)
  obj.set('date', record.date)
  obj.set('place', record.place)
  obj.set('owner', record.owner)
  obj.set('headcount', record.headcount)
  obj.set('summary', record.summary)
  obj.set('kpis', record.kpis)
  obj.set(
    'plans',
    record.plans.map((id) => PlanObject.createWithoutData(id)),
  )
}
