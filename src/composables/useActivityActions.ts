import { useDbStore } from '../stores/db'
import type { ActivityRecord } from '../types'
import { confirm } from './useConfirm'
import { errorMessage, pushToast } from './useToast'

/** 活動列表、計畫詳情、活動詳情共用的「複製活動」「封存／解除封存」，確認文字與提示統一在這裡。 */
export function useActivityActions() {
  const db = useDbStore()

  /** 回傳新建的活動；失敗時已跳錯誤提示，回傳 undefined。 */
  async function duplicate(id: string): Promise<ActivityRecord | undefined> {
    try {
      const created = await db.duplicateActivity(id)
      pushToast('已複製活動，請填寫新日期')
      return created
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }

  async function toggleArchive(a: ActivityRecord): Promise<void> {
    const next = !a.archivedAt
    const message = next
      ? `確定要封存「${a.name}」嗎？封存後內容仍可檢視，但不能編輯、上傳或刪除，需要時可再解除封存。`
      : `確定要解除封存「${a.name}」嗎？解除後就可以再編輯。`
    if (!(await confirm(message, next ? '封存' : '解除封存'))) return
    try {
      await db.setActivityArchived(a.id, next)
      pushToast(next ? '已封存活動' : '已解除封存，可以編輯了')
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    }
  }

  return { duplicate, toggleArchive }
}
