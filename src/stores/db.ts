import { defineStore } from 'pinia'
import { ref } from 'vue'
import Parse from '../lib/parse'
import { deleteObjects } from '../lib/middleware'
import { deleteUnreferencedAttachments, putAttachment, requestAttachmentUploadUrls } from '../lib/attachments'
import { PlanObject, planToRecord } from '../models/Plan'
import { CategoryObject, applyCategoryRecord, categoryToRecord } from '../models/Category'
import {
  ActivityObject,
  activityToRecord,
  applyActivityRecord,
  splitAttachments,
} from '../models/Activity'
import { AuditLogObject, auditLogToRecord } from '../models/AuditLog'
import { mergeUpdateStamp } from '../models/actorStamp'
import {
  GenerationJobObject,
  applyGenerationJobRecord,
  generationJobToRecord,
} from '../models/GenerationJob'
import { ATTACHMENT_TYPES, DEFAULT_CATEGORY_NAMES, fileUploadRejectionReason } from '../types'
import type {
  ActivityCategory,
  ActivityRecord,
  AttachmentKey,
  AuditLogRecord,
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
  timeEnd: string
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
    if (existing) {
      existing.name = name
      mergeUpdateStamp(existing, obj)
    }
  }

  async function setCategoryPlans(id: string, planIds: string[]): Promise<void> {
    const existing = categories.value.find((c) => c.id === id)
    if (!existing) return
    const obj = CategoryObject.createWithoutData(id)
    applyCategoryRecord(obj, { name: existing.name, planIds })
    await obj.save()
    existing.planIds = planIds
    mergeUpdateStamp(existing, obj)
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
    if (existing) {
      existing.name = name
      mergeUpdateStamp(existing, obj)
    }
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
      timeEnd: '',
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
    const existing = activities.value.find((a) => a.id === id)
    await ActivityObject.createWithoutData(id).destroy()
    activities.value = activities.value.filter((a) => a.id !== id)
    // 活動刪掉後，它的 GCS 附件如果沒有別的活動在用（歷史檔案可以跨活動引用）就一併清掉。
    // 清不掉只是留下孤兒檔案，不影響刪除結果，所以不往外丟錯。
    if (existing) {
      const urls = [existing.files, existing.trash].flatMap((g) => Object.values(g).flat().map((f) => f.url))
      deleteUnreferencedAttachments(urls).catch(() => {})
    }
  }

  /** 共用的「找本地紀錄 → 建指標 → set 欄位 → save → 同步本地」流程，找不到就靜默略過。
   * 存檔後再用伺服器回傳的值補上最後修改者，以及附件陣列裡 Cloud Code 蓋上的
   * 上傳者／刪除者（這些只有伺服器知道，mutateLocal 算不出來）。 */
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
    mergeUpdateStamp(existing, obj)
    for (const [key] of ATTACHMENT_TYPES) {
      if (!obj.has(`${key}Files`)) continue
      const split = splitAttachments(obj, key)
      existing.files[key] = split.files
      existing.trash[key] = split.trash
    }
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
          timeEnd: existing.timeEnd,
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
    // 附件直接傳到 GCS：先跟 Cloud Run 換一批上傳網址，再由瀏覽器直接 PUT。
    // GCS 上的物件名稱由 Cloud Run 清成安全字元，原始檔名（可含中文）留在 FileMeta.name。
    const targets = await requestAttachmentUploadUrls(id, folder, files)
    const uploaded: FileMeta[] = new Array(files.length)
    let cursor = 0
    async function worker() {
      while (cursor < files.length) {
        const i = cursor++
        const file = files[i]
        await putAttachment(targets[i].uploadUrl, file, (fraction) => onProgress?.(file, fraction))
        uploaded[i] = { name: file.name, size: file.size, url: targets[i].url }
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

  /** 把「歷史檔案」挑選頁選到的既有檔案掛到這個活動的這個分類——重用同一個已上傳
   * 好的檔案（GCS 或舊的 Back4App 網址），不用重新上傳一次。只留 name/size/url，caption／featured
   * 是每個活動自己的，不沿用來源活動的值。 */
  async function attachExistingFiles(
    id: string,
    folder: AttachmentKey,
    files: Pick<FileMeta, 'name' | 'size' | 'url'>[],
  ): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !files.length) return
    const clean: FileMeta[] = files.map((f) => ({ name: f.name, size: f.size, url: f.url }))
    const nextFull = [...existing.files[folder], ...existing.trash[folder], ...clean]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.files[folder] = [...existing.files[folder], ...clean]
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
   * index 是在 trash[folder] 陣列裡的位置。GCS 附件在沒有其他活動引用時才會刪掉實體檔
   * （舊的 Back4App 附件由 Cloud Code afterSave 處理）。 */
  async function hardDeleteFile(id: string, folder: AttachmentKey, index: number): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    const target = existing?.trash[folder][index]
    if (!existing || !target) return
    const remainingTrash = existing.trash[folder].filter((_, i) => i !== index)
    const nextFull = [...existing.files[folder], ...remainingTrash]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextFull),
      (existing) => {
        existing.trash[folder] = remainingTrash
      },
    )
    // 紀錄已經拿掉了，實體檔清不掉只是留下孤兒檔案，不讓整個操作顯示失敗
    await deleteUnreferencedAttachments([target.url]).catch(() => {})
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
    mergeUpdateStamp(existing, obj)
  }

  /** 從垃圾桶復原。 */
  async function restoreGenerationJob(id: string): Promise<void> {
    const existing = generationJobs.value.find((j) => j.id === id)
    if (!existing) return
    const obj = GenerationJobObject.createWithoutData(id)
    obj.unset('deletedAt')
    await obj.save()
    existing.deletedAt = undefined
    mergeUpdateStamp(existing, obj)
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

  /** 稽核紀錄，由新到舊。傳 activityId 只查這個活動（含它的 AI 生成任務）。 */
  async function fetchAuditLogs(
    options: { activityId?: string; limit?: number } = {},
  ): Promise<AuditLogRecord[]> {
    const query = new Parse.Query(AuditLogObject).descending('createdAt').limit(options.limit ?? 500)
    if (options.activityId) query.equalTo('activityId', options.activityId)
    return (await query.find()).map(auditLogToRecord)
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
    attachExistingFiles,
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
    fetchAuditLogs,
  }
})
