import { defineStore } from 'pinia'
import { ref } from 'vue'
import Parse from '../lib/parse'
import { deleteObjects } from '../lib/middleware'
import { uploadParseFile } from '../lib/uploadFile'
import { PlanObject, planToRecord } from '../models/Plan'
import { CategoryObject, applyCategoryRecord, categoryToRecord } from '../models/Category'
import { ActivityObject, activityToRecord, applyActivityRecord } from '../models/Activity'
import {
  GenerationJobObject,
  applyGenerationJobRecord,
  generationJobToRecord,
} from '../models/GenerationJob'
import { DEFAULT_CATEGORY_NAMES, fileUploadRejectionReason } from '../types'
import type {
  ActivityCategory,
  ActivityRecord,
  AttachmentKey,
  CategoryRecord,
  FileMeta,
  GenerationJobKind,
  GenerationJobRecord,
  HeadcountStat,
  Kpi,
  PlanRecord,
} from '../types'

export interface ActivityFormInput {
  name: string
  categories: ActivityCategory[]
  date: string
  time: string
  place: string
  owner: string
  attendees: string
  participantDesc: string
  headcount: HeadcountStat
  plans: string[]
  remark: string
}

export const useDbStore = defineStore('db', () => {
  const plans = ref<PlanRecord[]>([])
  const categories = ref<CategoryRecord[]>([])
  const activities = ref<ActivityRecord[]>([])
  const generationJobs = ref<GenerationJobRecord[]>([])
  const loading = ref(false)
  const error = ref('')

  /** Category 集合第一次使用是空的（尚未有人建立過任何分類），這裡用舊版寫死的
   * 分類清單當起始種子，讓既有使用習慣（下拉選單有 5 個預設分類）不會斷。 */
  async function seedDefaultCategoriesIfEmpty(): Promise<CategoryRecord[]> {
    const objs = await Promise.all(
      DEFAULT_CATEGORY_NAMES.map((name) => {
        const obj = new CategoryObject()
        obj.set('name', name)
        return obj.save()
      }),
    )
    return objs.map(categoryToRecord)
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const [planObjs, categoryObjs, activityObjs] = await Promise.all([
        new Parse.Query(PlanObject).find(),
        new Parse.Query(CategoryObject).find(),
        new Parse.Query(ActivityObject).find(),
      ])
      plans.value = planObjs.map(planToRecord)
      categories.value = categoryObjs.length
        ? categoryObjs.map(categoryToRecord)
        : await seedDefaultCategoriesIfEmpty()
      activities.value = activityObjs.map(activityToRecord)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '無法連線到 Parse 伺服器'
      plans.value = []
      categories.value = []
      activities.value = []
    } finally {
      loading.value = false
    }
  }

  async function createCategory(name: string, planIds: string[] = []): Promise<void> {
    const obj = new CategoryObject()
    applyCategoryRecord(obj, { name, planIds })
    await obj.save()
    categories.value.push(categoryToRecord(obj))
  }

  async function renameCategory(id: string, name: string): Promise<void> {
    const existing = categories.value.find((c) => c.id === id)
    const obj = CategoryObject.createWithoutData(id)
    applyCategoryRecord(obj, { name, planIds: existing?.planIds ?? [] })
    await obj.save()
    if (existing) existing.name = name
  }

  async function setCategoryPlans(id: string, planIds: string[]): Promise<void> {
    const existing = categories.value.find((c) => c.id === id)
    if (!existing) return
    const obj = CategoryObject.createWithoutData(id)
    applyCategoryRecord(obj, { name: existing.name, planIds })
    await obj.save()
    existing.planIds = planIds
  }

  /** 只刪分類管理清單裡的項目，不會動到已存活動的 categories 欄位——那裡存的是
   * 分類名稱文字本身（不是參照 id），刪除或改名分類都不影響既有紀錄。 */
  async function deleteCategory(id: string): Promise<void> {
    await CategoryObject.createWithoutData(id).destroy()
    categories.value = categories.value.filter((c) => c.id !== id)
  }

  async function createPlan(name: string): Promise<void> {
    const obj = new PlanObject()
    obj.set('name', name)
    await obj.save()
    plans.value.push(planToRecord(obj))
  }

  async function renamePlan(id: string, name: string): Promise<void> {
    const obj = PlanObject.createWithoutData(id)
    obj.set('name', name)
    await obj.save()
    const existing = plans.value.find((p) => p.id === id)
    if (existing) existing.name = name
  }

  async function deletePlan(id: string): Promise<void> {
    await PlanObject.createWithoutData(id).destroy()
    const affectedActivities = activities.value.filter((a) => a.plans.includes(id))
    const affectedCategories = categories.value.filter((c) => c.planIds.includes(id))
    await Promise.all([
      ...affectedActivities.map((a) => setActivityPlans(a.id, a.plans.filter((p) => p !== id))),
      ...affectedCategories.map((c) => setCategoryPlans(c.id, c.planIds.filter((p) => p !== id))),
    ])
    plans.value = plans.value.filter((p) => p.id !== id)
  }

  async function createActivity(input: ActivityFormInput): Promise<ActivityRecord> {
    const obj = new ActivityObject()
    applyActivityRecord(obj, { ...input, summary: '', kpis: [] })
    await obj.save()
    const record = activityToRecord(obj)
    activities.value.push(record)
    return record
  }

  async function duplicateActivity(id: string): Promise<ActivityRecord> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing) throw new Error('找不到活動')
    return createActivity({
      name: `${existing.name}（複製）`,
      categories: [...existing.categories],
      date: '',
      time: '',
      place: existing.place,
      owner: existing.owner,
      attendees: existing.attendees,
      participantDesc: existing.participantDesc,
      headcount: { ...existing.headcount },
      plans: [...existing.plans],
      remark: existing.remark,
    })
  }

  async function deleteActivity(id: string): Promise<void> {
    await ActivityObject.createWithoutData(id).destroy()
    activities.value = activities.value.filter((a) => a.id !== id)
  }

  /** 共用的「找本地紀錄 → 建指標 → set 欄位 → save → 同步本地」流程，找不到就靜默略過。 */
  async function patchActivity(
    id: string,
    apply: (obj: ActivityObject, existing: ActivityRecord) => void,
    mutateLocal: (existing: ActivityRecord) => void,
  ): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing) return
    const obj = ActivityObject.createWithoutData(id) as ActivityObject
    apply(obj, existing)
    await obj.save()
    mutateLocal(existing)
  }

  async function updateActivity(id: string, input: ActivityFormInput): Promise<void> {
    await patchActivity(
      id,
      (obj, existing) =>
        applyActivityRecord(obj, { ...input, summary: existing.summary, kpis: existing.kpis }),
      (existing) => Object.assign(existing, input),
    )
  }

  async function setActivityPlans(id: string, planIds: string[]): Promise<void> {
    await patchActivity(
      id,
      (obj, existing) =>
        applyActivityRecord(obj, {
          name: existing.name,
          categories: existing.categories,
          date: existing.date,
          time: existing.time,
          place: existing.place,
          owner: existing.owner,
          attendees: existing.attendees,
          participantDesc: existing.participantDesc,
          headcount: existing.headcount,
          summary: existing.summary,
          remark: existing.remark,
          kpis: existing.kpis,
          plans: planIds,
        }),
      (existing) => {
        existing.plans = planIds
      },
    )
  }

  async function saveActivityResults(id: string, summary: string, kpis: Kpi[]): Promise<void> {
    await patchActivity(
      id,
      (obj) => {
        obj.set('summary', summary)
        obj.set('kpis', kpis)
      },
      (existing) => {
        existing.summary = summary
        existing.kpis = kpis
      },
    )
  }

  /** 同時上傳的檔案數量上限，避免一次太多連線把伺服器或使用者頻寬打滿。 */
  const UPLOAD_CONCURRENCY = 4

  /** Parse Server 的檔案名稱只接受 ASCII 且必須以英數字開頭（正規表示式
   * `^[a-zA-Z0-9][a-zA-Z0-9@. ~_-]*`），中文/日文等非 ASCII 字元會被拒絕並回傳
   * 400「Filename contains invalid characters」。Windows 螢幕截圖預設就是中文檔名，
   * 清成安全字元後常常整段中文被換成單一底線，導致檔名變成「_xxx.png」這種不合法
   * 的開頭，所以額外加上數字時間戳記當前綴，保證一定以數字開頭。展示用的原始檔名
   * （FileMeta.name）維持不變。 */
  function safeUploadFilename(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9 @.~_-]+/g, '_') || 'file'
    return `${Date.now()}_${cleaned}`
  }

  async function uploadFiles(
    id: string,
    folder: AttachmentKey,
    files: File[],
    onProgress?: (file: File, fraction: number) => void,
  ): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !files.length) return
    for (const file of files) {
      const reason = fileUploadRejectionReason(file)
      if (reason) throw new Error(reason)
    }
    const uploaded: FileMeta[] = new Array(files.length)
    let cursor = 0
    async function worker() {
      while (cursor < files.length) {
        const i = cursor++
        const file = files[i]
        const result = await uploadParseFile(safeUploadFilename(file.name), file, (fraction) =>
          onProgress?.(file, fraction),
        )
        uploaded[i] = { name: file.name, size: file.size, url: result.url }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker),
    )
    // Parse 的 `${folder}Files` 欄位一次寫入整個陣列，會連垃圾桶裡的項目一起蓋掉，
    // 所以每次寫入都要把 files（現存）＋ trash（垃圾桶）兩邊都併回去。
    const nextFull = [...existing.files[folder], ...existing.trash[folder], ...uploaded]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.files[folder] = [...existing.files[folder], ...uploaded]
      },
    )
  }

  /** 軟刪除：把檔案標上 deletedAt 移進垃圾桶，不會真的從 Back4App 刪掉。
   * index 是在「目前顯示中」的 files[folder] 陣列裡的位置。 */
  async function trashFile(id: string, folder: AttachmentKey, index: number): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !existing.files[folder][index]) return
    const target = { ...existing.files[folder][index], deletedAt: new Date().toISOString() }
    const remainingActive = existing.files[folder].filter((_, i) => i !== index)
    const nextFull = [...remainingActive, ...existing.trash[folder], target]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.files[folder] = remainingActive
        existing.trash[folder] = [...existing.trash[folder], target]
      },
    )
  }

  /** 從垃圾桶復原。index 是在 trash[folder] 陣列裡的位置。 */
  async function restoreFile(id: string, folder: AttachmentKey, index: number): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !existing.trash[folder][index]) return
    const restored = { ...existing.trash[folder][index] }
    delete restored.deletedAt
    const remainingTrash = existing.trash[folder].filter((_, i) => i !== index)
    const nextFull = [...existing.files[folder], restored, ...remainingTrash]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.files[folder] = [...existing.files[folder], restored]
        existing.trash[folder] = remainingTrash
      },
    )
  }

  /** 永久刪除：只能對垃圾桶裡的項目做，做了就真的從 Back4App 的陣列裡拿掉，無法復原。
   * index 是在 trash[folder] 陣列裡的位置。 */
  async function hardDeleteFile(id: string, folder: AttachmentKey, index: number): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !existing.trash[folder][index]) return
    const remainingTrash = existing.trash[folder].filter((_, i) => i !== index)
    const nextFull = [...existing.files[folder], ...remainingTrash]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.trash[folder] = remainingTrash
      },
    )
  }

  async function updateFileMeta(
    id: string,
    folder: AttachmentKey,
    index: number,
    patch: Partial<Pick<FileMeta, 'caption' | 'featured'>>,
  ): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !existing.files[folder][index]) return
    const nextActive = existing.files[folder].map((f, i) => (i === index ? { ...f, ...patch } : f))
    const nextFull = [...nextActive, ...existing.trash[folder]]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.files[folder] = nextActive
      },
    )
  }

  async function fetchGenerationJobs(activityId: string): Promise<void> {
    const objs = await new Parse.Query(GenerationJobObject)
      .equalTo('activity', ActivityObject.createWithoutData(activityId))
      .descending('createdAt')
      .find()
    const records = objs.map(generationJobToRecord)
    generationJobs.value = [
      ...generationJobs.value.filter((j) => j.activityId !== activityId),
      ...records,
    ]
  }

  /** 「歷史檔案」頁用：撈全部活動的生成工作，不像 fetchGenerationJobs 只查單一活動。 */
  async function fetchAllGenerationJobs(): Promise<void> {
    const objs = await new Parse.Query(GenerationJobObject).descending('createdAt').find()
    generationJobs.value = objs.map(generationJobToRecord)
  }

  async function createGenerationJob(
    activityId: string,
    kind: GenerationJobKind,
    sourceFiles: string[],
  ): Promise<GenerationJobRecord> {
    const obj = new GenerationJobObject()
    applyGenerationJobRecord(obj, {
      activityId,
      kind,
      status: 'pending',
      sourceFiles,
      resultFile: '',
      errorMessage: '',
    })
    await obj.save()
    const record = generationJobToRecord(obj)
    generationJobs.value.push(record)
    return record
  }

  async function refreshGenerationJob(id: string): Promise<GenerationJobRecord> {
    const obj = await new Parse.Query(GenerationJobObject).get(id)
    const record = generationJobToRecord(obj)
    const i = generationJobs.value.findIndex((j) => j.id === id)
    if (i !== -1) generationJobs.value[i] = record
    else generationJobs.value.push(record)
    return record
  }

  /** 軟刪除：標上 deletedAt 移進垃圾桶，素材與產出檔案都還留著。 */
  async function trashGenerationJob(id: string): Promise<void> {
    const existing = generationJobs.value.find((j) => j.id === id)
    if (!existing) return
    const obj = GenerationJobObject.createWithoutData(id)
    const now = new Date()
    obj.set('deletedAt', now)
    await obj.save()
    existing.deletedAt = now.toISOString()
  }

  /** 從垃圾桶復原。 */
  async function restoreGenerationJob(id: string): Promise<void> {
    const existing = generationJobs.value.find((j) => j.id === id)
    if (!existing) return
    const obj = GenerationJobObject.createWithoutData(id)
    obj.unset('deletedAt')
    await obj.save()
    existing.deletedAt = undefined
  }

  /** 永久刪除：只能對垃圾桶裡的工作做，會把已上傳的素材與產出檔案一併從 GCS 清掉，無法復原。 */
  async function hardDeleteGenerationJob(id: string): Promise<void> {
    const existing = generationJobs.value.find((j) => j.id === id)
    if (!existing) return
    const objectPaths = [...existing.sourceFiles, ...(existing.resultFile ? [existing.resultFile] : [])]
    await deleteObjects(objectPaths)
    await GenerationJobObject.createWithoutData(id).destroy()
    generationJobs.value = generationJobs.value.filter((j) => j.id !== id)
  }

  return {
    plans,
    categories,
    activities,
    generationJobs,
    loading,
    error,
    fetchAll,
    createPlan,
    renamePlan,
    deletePlan,
    createCategory,
    renameCategory,
    setCategoryPlans,
    deleteCategory,
    createActivity,
    updateActivity,
    duplicateActivity,
    deleteActivity,
    setActivityPlans,
    saveActivityResults,
    uploadFiles,
    trashFile,
    restoreFile,
    hardDeleteFile,
    updateFileMeta,
    fetchGenerationJobs,
    fetchAllGenerationJobs,
    createGenerationJob,
    refreshGenerationJob,
    trashGenerationJob,
    restoreGenerationJob,
    hardDeleteGenerationJob,
  }
})
