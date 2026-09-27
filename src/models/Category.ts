import Parse from '../lib/parse'
import { PlanObject } from './Plan'
import { actorStampOf } from './actorStamp'
import type { CategoryRecord } from '../types'

export class CategoryObject extends Parse.Object {
  constructor() {
    super('Category')
  }
}

Parse.Object.registerSubclass('Category', CategoryObject)

export function categoryToRecord(obj: Parse.Object): CategoryRecord {
  const plans = (obj.get('plans') as Parse.Object[] | undefined) ?? []
  return {
    id: obj.id!,
    name: obj.get('name') ?? '',
    planIds: plans.map((p) => p.id!),
    ...actorStampOf(obj),
  }
}

export function applyCategoryRecord(
  obj: Parse.Object,
  record: Pick<CategoryRecord, 'name' | 'planIds'>,
): void {
  obj.set('name', record.name)
  obj.set(
    'plans',
    record.planIds.map((id) => PlanObject.createWithoutData(id)),
  )
}
