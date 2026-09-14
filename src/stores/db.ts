import { defineStore } from 'pinia'
import { ref } from 'vue'
import Parse from '../lib/parse'
import { deleteObjects } from '../lib/middleware'
import { PlanObject, planToRecord } from '../models/Plan'
import { ActivityObject, activityToRecord, applyActivityRecord } from '../models/Activity'
import {
  GenerationJobObject,
  applyGenerationJobRecord,
  generationJobToRecord,
} from '../models/GenerationJob'
import { fileUploadRejectionReason } from '../types'
import type {
  ActivityCategory,
  ActivityRecord,
  AttachmentKey,
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
  const activities = ref<ActivityRecord[]>([])
  const generationJobs = ref<GenerationJobRecord[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const [planObjs, activityObjs] = await Promise.all([
        new Parse.Query(PlanObject).find(),
        new Parse.Query(ActivityObject).find(),
      ])
      plans.value = planObjs.map(planToRecord)
      activities.value = activityObjs.map(activityToRecord)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '無法連線到 Parse 伺服器'
      plans.value = []
      activities.value = []
    } finally {
      loading.value = false
    }
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
    const affected = activities.value.filter((a) => a.plans.includes(id))
    await Promise.all(
      affected.map((a) => setActivityPlans(a.id, a.plans.filter((p) => p !== id))),
    )
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

  /** Parse Server 的檔案名稱只接受 ASCII，中文/日文等非 ASCII 字元會被拒絕並回傳
   * 400「Filename contains invalid characters」。Windows 螢幕截圖預設就是中文檔名，
   * 所以上傳用的檔名要清成安全字元，展示用的原始檔名（FileMeta.name）維持不變。 */
  function safeUploadFilename(name: string): string {
    return name.replace(/[^A-Za-z0-9 _.-]+/g, '_') || 'file'
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
        const parseFile = new Parse.File(safeUploadFilename(file.name), file)
        await parseFile.save({
          progress: (fraction?: number | null) => {
            if (fraction !== null && fraction !== undefined) onProgress?.(file, fraction)
          },
        })
        uploaded[i] = { name: file.name, size: file.size, url: parseFile.url() ?? '' }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker),
    )
    const nextList = [...existing.files[folder], ...uploaded]
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextList),
      (existing) => {
        existing.files[folder] = nextList
      },
    )
  }

  async function removeFile(id: string, folder: AttachmentKey, index: number): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing) return
    const nextList = existing.files[folder].filter((_, i) => i !== index)
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextList),
      (existing) => {
        existing.files[folder] = nextList
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
    const nextList = existing.files[folder].map((f, i) => (i === index ? { ...f, ...patch } : f))
    await patchActivity(
      id,
      (obj) => obj.set(`${folder}Files`, nextList),
      (existing) => {
        existing.files[folder] = nextList
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

  async function deleteGenerationJob(id: string): Promise<void> {
    const existing = generationJobs.value.find((j) => j.id === id)
    if (!existing) return
    const objectPaths = [...existing.sourceFiles, ...(existing.resultFile ? [existing.resultFile] : [])]
    await deleteObjects(objectPaths)
    await GenerationJobObject.createWithoutData(id).destroy()
    generationJobs.value = generationJobs.value.filter((j) => j.id !== id)
  }

  return {
    plans,
    activities,
    generationJobs,
    loading,
    error,
    fetchAll,
    createPlan,
    renamePlan,
    deletePlan,
    createActivity,
    updateActivity,
    duplicateActivity,
    deleteActivity,
    setActivityPlans,
    saveActivityResults,
    uploadFiles,
    removeFile,
    updateFileMeta,
    fetchGenerationJobs,
    createGenerationJob,
    refreshGenerationJob,
    deleteGenerationJob,
  }
})
