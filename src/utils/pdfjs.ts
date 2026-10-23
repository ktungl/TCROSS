/** pdf.js 約 1MB，只在真的要讀 PDF 時才動態載入，不放進主程式包。
 * 用 legacy build（內含 polyfill，舊手機／Safari 也能跑）。 */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

/** 開啟 PDF。中文 PDF 常用的 CJK 字型編碼需要 cMap 才解得出字（擷取文字、畫成圖片都要）；
 * cMap 版本取自實際載入的 pdfjs，升級套件不用跟著改。用完要呼叫回傳 task 的 destroy() 釋放 worker 端的文件。 */
export async function openPdf(data: ArrayBuffer) {
  const pdfjs = await loadPdfjs()
  return pdfjs.getDocument({
    data,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
  })
}
