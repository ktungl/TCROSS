export interface Kpi {
  k: string
  v: string
  u: string
}

export interface FileMeta {
  name: string
  size: number
  url: string
}

export type FolderKey = 'photo' | 'audio' | 'video' | 'doc'

export const FOLDERS: [FolderKey, string][] = [
  ['photo', '照片'],
  ['audio', '錄音'],
  ['video', '影片'],
  ['doc', '文件'],
]

export interface PlanRecord {
  id: string
  name: string
}

export interface ActivityFiles {
  photo: FileMeta[]
  audio: FileMeta[]
  video: FileMeta[]
  doc: FileMeta[]
}

export interface ActivityRecord {
  id: string
  name: string
  date: string
  place: string
  owner: string
  headcount: number
  plans: string[]
  summary: string
  kpis: Kpi[]
  files: ActivityFiles
}

export type GenerationJobKind = '成果報告' | '其他'
export type GenerationJobStatus = 'pending' | 'processing' | 'done' | 'error'

export interface GenerationJobRecord {
  id: string
  activityId: string
  kind: GenerationJobKind
  status: GenerationJobStatus
  sourceFiles: string[]
  resultFile: string
  errorMessage: string
  createdAt: string
}
