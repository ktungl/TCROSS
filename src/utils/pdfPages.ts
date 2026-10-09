/** 把 PDF 每一頁畫成 JPEG，給成果報告嵌入掃描的簽到表／流程表用（Word 不能直接嵌 PDF）。
 * 用 legacy build（內含 polyfill，舊手機／Safari 也能跑）；pdf.js 很大，只在真的要轉 PDF 時才動態載入，不拖慢一般頁面。 */
export interface RenderedPage {
  data: ArrayBuffer
  width: number
  height: number
}

/** 約 150 dpi（PDF 單位是 1/72 吋）：印出來看得清楚手寫簽名，檔案又不會太大 */
const RENDER_SCALE = 150 / 72

export async function renderPdfPages(data: ArrayBuffer, maxPages: number): Promise<RenderedPage[]> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data })
  try {
    const pdf = await task.promise
    const pages: RenderedPage[] = []
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport, background: '#ffffff' }).promise
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      page.cleanup()
      if (blob) pages.push({ data: await blob.arrayBuffer(), width: canvas.width, height: canvas.height })
    }
    return pages
  } finally {
    await task.destroy()
  }
}
