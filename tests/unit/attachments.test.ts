import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/parse', () => ({ default: { User: { current: () => ({ getSessionToken: () => 'r:token' }) } } }))
vi.stubEnv('VITE_MIDDLEWARE_URL', 'https://middleware.example')
const { resolveAttachmentUrl } = await import('../../src/lib/attachments')

const rateLimited = () => new Response(JSON.stringify({ detail: '請求過於頻繁，請稍後再試' }), { status: 429 })

describe('附件臨時網址', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('被限流（429）時等一下自動重試，不會直接失敗', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls++
      if (calls < 3) return rateLimited()
      const { items } = JSON.parse(init.body as string) as { items: { path: string }[] }
      return Response.json({ urls: Object.fromEntries(items.map((i) => [i.path, `https://signed/${i.path}`])) })
    })
    const p = resolveAttachmentUrl('gcs:attachments/a.jpg', 'a.jpg')
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(p).resolves.toBe('https://signed/attachments/a.jpg')
    expect(calls).toBe(3)
  })

  it('重試用完還是 429 才回報錯誤', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return rateLimited()
    })
    const p = resolveAttachmentUrl('gcs:attachments/b.jpg', 'b.jpg')
    const settled = expect(p).rejects.toThrow('請求過於頻繁，請稍後再試')
    await vi.advanceTimersByTimeAsync(120_000)
    await settled
    expect(calls).toBe(5)
  })
})
