import { ref } from 'vue'
import { requestDownloadUrl } from '../lib/middleware'
import type { GenerationJobRecord } from '../types'
import { errorMessage, pushToast } from './useToast'

/** 下載 AI 產出的報告（AI 生成視窗、歷史檔案頁共用）。
 * downloading 存「工作 id:格式」，Word／PDF 兩顆按鈕各自顯示取得中。 */
export function useReportDownload() {
  const downloading = ref<string | null>(null)

  async function download(job: GenerationJobRecord, pdf = false): Promise<void> {
    if (!job.resultFile) return
    downloading.value = `${job.id}:${pdf ? 'pdf' : 'docx'}`
    try {
      const url = await requestDownloadUrl(job.resultFile, pdf)
      window.open(url, '_blank')
    } catch (e) {
      pushToast(errorMessage(e), 'error')
    } finally {
      downloading.value = null
    }
  }

  return { downloading, download }
}
