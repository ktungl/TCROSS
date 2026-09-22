import { reactive } from 'vue'

interface ConfirmState {
  visible: boolean
  message: string
  confirmLabel: string
  resolve: ((value: boolean) => void) | null
}

export const confirmState = reactive<ConfirmState>({
  visible: false,
  message: '',
  confirmLabel: '確定',
  resolve: null,
})

export function confirm(message: string, confirmLabel = '確定'): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.confirmLabel = confirmLabel
    confirmState.visible = true
    confirmState.resolve = resolve
  })
}

export function resolveConfirm(value: boolean): void {
  confirmState.visible = false
  confirmState.resolve?.(value)
  confirmState.resolve = null
}
