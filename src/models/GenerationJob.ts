import Parse from '../lib/parse'
import { ActivityObject } from './Activity'
import type { GenerationJobKind, GenerationJobRecord, GenerationJobStatus } from '../types'

export class GenerationJobObject extends Parse.Object {
  constructor() {
    super('GenerationJob')
  }
}

Parse.Object.registerSubclass('GenerationJob', GenerationJobObject)

export function generationJobToRecord(obj: Parse.Object): GenerationJobRecord {
  const activity = obj.get('activity') as Parse.Object | undefined
  return {
    id: obj.id!,
    activityId: activity?.id ?? '',
    kind: (obj.get('kind') as GenerationJobKind | undefined) ?? '成果報告',
    status: (obj.get('status') as GenerationJobStatus | undefined) ?? 'pending',
    sourceFiles: (obj.get('sourceFiles') as string[] | undefined) ?? [],
    resultFile: obj.get('resultFile') ?? '',
    errorMessage: obj.get('errorMessage') ?? '',
    createdAt: obj.createdAt?.toISOString() ?? '',
  }
}

export function applyGenerationJobRecord(
  obj: Parse.Object,
  record: Omit<GenerationJobRecord, 'id' | 'createdAt'>,
): void {
  obj.set('activity', ActivityObject.createWithoutData(record.activityId))
  obj.set('kind', record.kind)
  obj.set('status', record.status)
  obj.set('sourceFiles', record.sourceFiles)
  obj.set('resultFile', record.resultFile)
  obj.set('errorMessage', record.errorMessage)
}
