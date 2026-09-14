import { reactive } from 'vue'

export type ToastType = 'success' | 'error'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

let nextId = 1
export const toasts = reactive<Toast[]>([])

export function pushToast(message: string, type: ToastType = 'success'): void {
  const id = nextId++
  toasts.push({ id, message, type })
  // 錯誤訊息通常比較長、也比較需要使用者讀完再處理，停留時間拉長一點。
  const duration = type === 'error' ? 6000 : 2500
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i !== -1) toasts.splice(i, 1)
  }, duration)
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '發生未預期的錯誤'
}
