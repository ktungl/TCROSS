// Back4App Cloud Code：伺服器端資料驗證。
//
// 前端的 ActivityFormModal.vue／PlansView.vue 已經有欄位檢查，但那只擋得住「正常
// 使用畫面的人」。CLP 開放給所有登入使用者讀寫後，任何拿到有效帳號的人都能繞過前端
// 直接打 REST API 寫入任意內容，這裡補的是資料庫最後一道防線。

const FOLDER_FIELDS = ['photoFiles', 'audioFiles', 'videoFiles', 'docFiles'];
const GENERATION_JOB_KINDS = ['成果報告', '其他'];
const GENERATION_JOB_STATUSES = ['pending', 'processing', 'done', 'error'];

function fail(message) {
  throw new Parse.Error(Parse.Error.VALIDATION_ERROR, message);
}

Parse.Cloud.beforeSave('Plan', (request) => {
  const object = request.object;
  const name = object.get('name');
  if (typeof name !== 'string' || !name.trim()) {
    fail('計畫名稱不能為空');
  }
  if (name.length > 100) {
    fail('計畫名稱過長（上限 100 字）');
  }
  object.set('name', name.trim());
});

Parse.Cloud.beforeSave('Activity', (request) => {
  const object = request.object;

  const name = object.get('name');
  if (typeof name !== 'string' || !name.trim()) {
    fail('活動名稱不能為空');
  }
  if (name.length > 200) {
    fail('活動名稱過長（上限 200 字）');
  }
  object.set('name', name.trim());

  const headcount = object.get('headcount');
  if (headcount !== undefined && headcount !== null) {
    if (typeof headcount !== 'number' || !Number.isFinite(headcount) || headcount < 0) {
      fail('參與人數必須是不小於 0 的數字');
    }
  }

  const date = object.get('date');
  if (typeof date === 'string' && date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    fail('日期格式必須是 YYYY-MM-DD');
  }

  const plans = object.get('plans');
  if (plans !== undefined && !Array.isArray(plans)) {
    fail('plans 必須是陣列');
  }

  const kpis = object.get('kpis');
  if (kpis !== undefined) {
    if (!Array.isArray(kpis)) {
      fail('kpis 必須是陣列');
    }
    for (const kpi of kpis) {
      if (
        typeof kpi !== 'object' ||
        kpi === null ||
        typeof kpi.k !== 'string' ||
        typeof kpi.v !== 'string' ||
        typeof kpi.u !== 'string'
      ) {
        fail('kpis 陣列項目格式不正確（需要 { k, v, u } 皆為字串）');
      }
    }
  }

  for (const field of FOLDER_FIELDS) {
    const files = object.get(field);
    if (files === undefined) continue;
    if (!Array.isArray(files)) {
      fail(`${field} 必須是陣列`);
    }
    for (const file of files) {
      if (
        typeof file !== 'object' ||
        file === null ||
        typeof file.name !== 'string' ||
        typeof file.size !== 'number' ||
        typeof file.url !== 'string'
      ) {
        fail(`${field} 陣列項目格式不正確（需要 { name, size, url }）`);
      }
    }
  }
});

Parse.Cloud.beforeSave('GenerationJob', (request) => {
  const object = request.object;

  const activity = object.get('activity');
  if (!activity || typeof activity.id !== 'string') {
    fail('activity 不能為空');
  }

  const kind = object.get('kind');
  if (kind !== undefined && !GENERATION_JOB_KINDS.includes(kind)) {
    fail(`kind 必須是 ${GENERATION_JOB_KINDS.join('/')} 其中之一`);
  }

  const status = object.get('status');
  if (status !== undefined && !GENERATION_JOB_STATUSES.includes(status)) {
    fail(`status 必須是 ${GENERATION_JOB_STATUSES.join('/')} 其中之一`);
  }

  const sourceFiles = object.get('sourceFiles');
  if (sourceFiles !== undefined) {
    if (!Array.isArray(sourceFiles) || sourceFiles.some((f) => typeof f !== 'string')) {
      fail('sourceFiles 必須是字串陣列');
    }
  }

  const resultFile = object.get('resultFile');
  if (resultFile !== undefined && typeof resultFile !== 'string') {
    fail('resultFile 必須是字串');
  }

  const errorMessage = object.get('errorMessage');
  if (errorMessage !== undefined && typeof errorMessage !== 'string') {
    fail('errorMessage 必須是字串');
  }
});
