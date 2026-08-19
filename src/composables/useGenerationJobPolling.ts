import { onUnmounted } from 'vue'
import { useDbStore } from '../stores/db'
import type { GenerationJobRecord } from '../types'

const POLL_INTERVAL_MS = 5000

export function useGenerationJobPolling() {
  const db = useDbStore()
  let timer: ReturnType<typeof setTimeout> | undefined

  function stop(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function start(jobId: string, onUpdate: (record: GenerationJobRecord) => void): void {
    stop()
    const tick = async () => {
      try {
        const record = await db.refreshGenerationJob(jobId)
        onUpdate(record)
        if (record.status === 'done' || record.status === 'error') return
      } catch {
        // 暫時性查詢失敗，不跳錯誤訊息，下一輪繼續嘗試
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  onUnmounted(stop)

  return { start, stop }
}
