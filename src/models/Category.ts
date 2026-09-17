import Parse from '../lib/parse'
import type { CategoryRecord } from '../types'

export class CategoryObject extends Parse.Object {
  constructor() {
    super('Category')
  }
}

Parse.Object.registerSubclass('Category', CategoryObject)

export function categoryToRecord(obj: Parse.Object): CategoryRecord {
  return {
    id: obj.id!,
    name: obj.get('name') ?? '',
  }
}

export function applyCategoryRecord(obj: Parse.Object, record: Pick<CategoryRecord, 'name'>): void {
  obj.set('name', record.name)
}
