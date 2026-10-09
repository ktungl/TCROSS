import { onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue'
import { confirmState } from './useConfirm'

/** 按 Esc 關閉對話框，行為跟點背景關閉一致。
 * 確認框開著時只讓確認框自己處理 Esc，避免連底下的對話框一起關掉。
 * active：對話框用 v-if 掛在頁面上而不是獨立元件時，用它判斷目前是否開著。 */
export function useEscape(handler: () => void, options: { active?: MaybeRefOrGetter<boolean>; isConfirm?: boolean } = {}) {
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (options.active !== undefined && !toValue(options.active)) return
    if (confirmState.visible && !options.isConfirm) return
    e.preventDefault()
    handler()
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
