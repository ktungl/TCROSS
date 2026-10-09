import { onUnmounted } from 'vue'
import { useDbStore } from '../stores/db'
import type { GenerationJobRecord } from '../types'

const POLL_INTERVAL_MS = 5000

export function useGenerationJobPolling() {
  const db = useDbStore()
  let timer: ReturnType<typeof setTimeout> | undefined
  // 每次 start()/stop() 都換一個世代；查詢回來時世代已經變了，代表期間被停止或換了工作，
  // 結果直接丟掉、也不再排下一輪，避免已停止的輪詢復活或兩條輪詢同時跑。
  let generation = 0

  function stop(): void {
    generation++
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function start(jobId: string, onUpdate: (record: GenerationJobRecord) => void): void {
    stop()
    const myGeneration = generation
    const tick = async () => {
      try {
        const record = await db.refreshGenerationJob(jobId)
        if (myGeneration !== generation) return
        onUpdate(record)
        if (record.status === 'done' || record.status === 'error') return
      } catch {
        // 暫時性查詢失敗，不跳錯誤訊息，下一輪繼續嘗試
      }
      if (myGeneration !== generation) return
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  onUnmounted(stop)

  return { start, stop }
}
