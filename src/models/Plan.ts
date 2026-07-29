import Parse from '../lib/parse'
import type { PlanRecord } from '../types'

export class PlanObject extends Parse.Object {
  constructor() {
    super('Plan')
  }
}

Parse.Object.registerSubclass('Plan', PlanObject)

export function planToRecord(obj: Parse.Object): PlanRecord {
  return {
    id: obj.id!,
    name: obj.get('name') ?? '',
  }
}

export function applyPlanRecord(obj: Parse.Object, record: Pick<PlanRecord, 'name'>): void {
  obj.set('name', record.name)
}
