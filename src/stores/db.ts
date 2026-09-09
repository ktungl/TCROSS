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
  category: ActivityCategory | ''
  date: string
  dateEnd: string
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
          category: existing.category,
          date: existing.date,
          dateEnd: existing.dateEnd,
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

  async function uploadFiles(id: string, folder: AttachmentKey, files: File[]): Promise<void> {
    const existing = activities.value.find((a) => a.id === id)
    if (!existing || !files.length) return
    for (const file of files) {
      const reason = fileUploadRejectionReason(file)
      if (reason) throw new Error(reason)
    }
    const uploaded: FileMeta[] = []
    for (const file of files) {
      const parseFile = new Parse.File(file.name, file)
      await parseFile.save()
      uploaded.push({ name: file.name, size: file.size, url: parseFile.url() ?? '' })
    }
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
    deletePlan,
    createActivity,
    updateActivity,
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
