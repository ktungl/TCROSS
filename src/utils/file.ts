/** 檔名相關的小工具：用副檔名判斷檔案類型（縮圖、AI 讀檔、匯出嵌入共用）。 */

/** 瀏覽器能直接顯示、也能畫進 canvas 的圖片格式。HEIC 只有 Safari 認得，當一般檔案處理；
 * SVG 本來就禁止上傳（types.ts BLOCKED_EXTENSIONS）。 */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']

export function fileExt(name: string): string {
  return name.trim().toLowerCase().split('.').pop() ?? ''
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExt(name))
}

export function isPdfFile(name: string): boolean {
  return fileExt(name) === 'pdf'
}
