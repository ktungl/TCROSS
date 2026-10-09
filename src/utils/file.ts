/** 檔名相關的小工具（歷史檔案頁、從歷史檔案選取彈窗共用）。 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg']

export function fileExt(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExt(name))
}
