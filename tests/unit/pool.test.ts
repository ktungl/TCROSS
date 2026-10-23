import { describe, expect, it } from 'vitest'
import { runPool } from '../../src/utils/pool'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runPool', () => {
  it('同時執行數不超過上限，全部項目都跑到', async () => {
    let running = 0
    let peak = 0
    const seen: number[] = []
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++
      peak = Math.max(peak, running)
      await tick(5)
      seen.push(n)
      running--
    })
    expect(peak).toBe(3)
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('失敗後不再開始新項目，但等已開始的結束才拋出第一個錯誤', async () => {
    const finished: number[] = []
    const started: number[] = []
    const run = runPool([0, 1, 2, 3, 4], 2, async (n) => {
      started.push(n)
      if (n === 0) throw new Error('boom')
      await tick(20)
      finished.push(n)
    })
    await expect(run).rejects.toThrow('boom')
    // 1 在 0 失敗前就開始了，要等它完成才 reject
    expect(finished).toEqual([1])
    expect(started).toEqual([0, 1])
  })
})
