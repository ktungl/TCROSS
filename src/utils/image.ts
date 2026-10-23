/** 用瀏覽器內建的圖片解碼讀 blob；格式不支援（例如非 Safari 的 HEIC）或檔案損毀時 reject。 */
export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取這張圖片（格式不支援或檔案損毀）'))
    }
    img.src = url
  })
}

/** blob → 「data:<type>;base64,…」 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('讀取檔案失敗'))
    reader.readAsDataURL(blob)
  })
}
