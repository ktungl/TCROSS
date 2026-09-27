import Parse from '../lib/parse'
import type { AuditAction, AuditChange, AuditLogRecord } from '../types'

export class AuditLogObject extends Parse.Object {
  constructor() {
    super('AuditLog')
  }
}

Parse.Object.registerSubclass('AuditLog', AuditLogObject)

export function auditLogToRecord(obj: Parse.Object): AuditLogRecord {
  return {
    id: obj.id!,
    action: (obj.get('action') as AuditAction | undefined) ?? 'update',
    targetClass: obj.get('targetClass') ?? '',
    targetId: obj.get('targetId') ?? '',
    targetName: obj.get('targetName') ?? '',
    activityId: obj.get('activityId') ?? '',
    actorId: obj.get('actorId') ?? '',
    actorName: obj.get('actorName') ?? '',
    changes: (obj.get('changes') as AuditChange[] | undefined) ?? [],
    summary: obj.get('summary') ?? '',
    createdAt: obj.createdAt?.toISOString() ?? '',
  }
}
