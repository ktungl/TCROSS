/** 最多 limit 個同時執行 fn，避免一次太多連線把伺服器或使用者頻寬打滿。
 * 任一個失敗後就不再開始新的項目，但會等已經開始的都結束才 reject 第一個錯誤——
 * 呼叫端在 catch 裡清理（例如刪掉已上傳的孤兒檔）時，才不會漏掉稍後才完成的項目。 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0
  let failed = false
  async function worker() {
    while (!failed && cursor < items.length) {
      const i = cursor++
      try {
        await fn(items[i], i)
      } catch (e) {
        failed = true
        throw e
      }
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (rejected) throw rejected.reason
}
