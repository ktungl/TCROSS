import Parse from '../lib/parse'
import type { ActorStamp } from '../types'

// 只在型別位置用到 Parse 時 noUnusedLocals 會誤判成沒用到，改從實例型別取。
type ParseObject = InstanceType<typeof Parse.Object>

/** 讀出 cloud/main.js stampActor() 寫入的建立者／最後修改者。 */
export function actorStampOf(obj: ParseObject): ActorStamp {
  return {
    createdByName: obj.get('createdByName') ?? '',
    updatedByName: obj.get('updatedByName') ?? '',
    createdAt: obj.createdAt?.toISOString() ?? '',
    updatedAt: obj.updatedAt?.toISOString() ?? '',
  }
}

/** 修改（createWithoutData + save）後，伺服器回傳的最後修改者／時間寫回本地紀錄。
 * 只覆蓋有回傳的欄位，建立者不會因為這次存檔沒帶回來就被清掉。 */
export function mergeUpdateStamp(
  target: Pick<ActorStamp, 'updatedByName' | 'updatedAt'>,
  obj: ParseObject,
): void {
  const updatedByName = obj.get('updatedByName') as string | undefined
  if (updatedByName) target.updatedByName = updatedByName
  if (obj.updatedAt) target.updatedAt = obj.updatedAt.toISOString()
}
