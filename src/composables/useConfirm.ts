import { reactive } from 'vue'

interface ConfirmState {
  visible: boolean
  message: string
  resolve: ((value: boolean) => void) | null
}

export const confirmState = reactive<ConfirmState>({
  visible: false,
  message: '',
  resolve: null,
})

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.visible = true
    confirmState.resolve = resolve
  })
}

export function resolveConfirm(value: boolean): void {
  confirmState.visible = false
  confirmState.resolve?.(value)
  confirmState.resolve = null
}
