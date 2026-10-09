import { reactive } from 'vue'

interface ConfirmState {
  visible: boolean
  message: string
  confirmLabel: string
  danger: boolean
  resolve: ((value: boolean) => void) | null
}

export const confirmState = reactive<ConfirmState>({
  visible: false,
  message: '',
  confirmLabel: '確定',
  danger: false,
  resolve: null,
})

/** danger：無法復原的刪除動作，確認鍵改成紅色，避免跟一般「確定」混在一起順手按下。 */
export function confirm(message: string, confirmLabel = '確定', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.confirmLabel = confirmLabel
    confirmState.danger = danger
    confirmState.visible = true
    confirmState.resolve = resolve
  })
}

export function resolveConfirm(value: boolean): void {
  confirmState.visible = false
  confirmState.resolve?.(value)
  confirmState.resolve = null
}
