// Back4App Cloud Code：伺服器端資料驗證。
//
// 前端的 ActivityFormModal.vue／PlansView.vue 已經有欄位檢查，但那只擋得住「正常
// 使用畫面的人」。CLP 開放給所有登入使用者讀寫後，任何拿到有效帳號的人都能繞過前端
// 直接打 REST API 寫入任意內容，這裡補的是資料庫最後一道防線。

// audioFiles/videoFiles/docFiles 是舊版 4 分類附件，前端已改用下面 8 分類，但
// 舊資料可能還留著，繼續驗證＋清孤兒檔，不主動刪除欄位。
const FOLDER_FIELDS = [
  'photoFiles',
  'audioFiles',
  'videoFiles',
  'docFiles',
  'signInFiles',
  'recordFiles',
  'agendaFiles',
  'documentFiles',
  'receiptFiles',
  'socialFiles',
  'mediaFiles',
];
const ACTIVITY_CATEGORIES = ['居場所', '會務', '合作教育', '社區關懷', '其他'];
const GENERATION_JOB_KINDS = ['成果報告', '其他'];
const GENERATION_JOB_STATUSES = ['pending', 'processing', 'done', 'error'];

function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function checkOptionalString(object, field, maxLength) {
  const value = object.get(field);
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    fail(`${field} 必須是字串`);
  }
  if (value.length > maxLength) {
    fail(`${field} 過長（上限 ${maxLength} 字）`);
  }
}

function checkOptionalDate(object, field) {
  const value = object.get(field);
  if (typeof value === 'string' && value.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    fail(`${field} 格式必須是 YYYY-MM-DD`);
  }
}

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

  // headcount 是舊版單一數字欄位，前端已改用 maleCount/femaleCount/totalCount，
  // 但舊資料可能還留著，繼續驗證，不主動刪除欄位。
  const headcount = object.get('headcount');
  if (headcount !== undefined && headcount !== null) {
    if (typeof headcount !== 'number' || !Number.isFinite(headcount) || headcount < 0) {
      fail('參與人數必須是不小於 0 的數字');
    }
  }

  for (const field of ['maleCount', 'femaleCount', 'totalCount']) {
    const value = object.get(field);
    if (value !== undefined && value !== null && !isNonNegativeNumber(value)) {
      fail(`${field} 必須是不小於 0 的數字`);
    }
  }

  const date = object.get('date');
  if (typeof date === 'string' && date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    fail('日期格式必須是 YYYY-MM-DD');
  }
  checkOptionalDate(object, 'dateEnd');

  const category = object.get('category');
  if (typeof category === 'string' && category.trim() && !ACTIVITY_CATEGORIES.includes(category)) {
    fail(`category 必須是 ${ACTIVITY_CATEGORIES.join('/')} 其中之一`);
  }

  checkOptionalString(object, 'attendees', 200);
  checkOptionalString(object, 'participantDesc', 200);
  checkOptionalString(object, 'remark', 500);

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
      if (file.caption !== undefined && typeof file.caption !== 'string') {
        fail(`${field} 的 caption 必須是字串`);
      }
      if (file.featured !== undefined && typeof file.featured !== 'boolean') {
        fail(`${field} 的 featured 必須是布林值`);
      }
    }
  }
});

// 前端刪檔（removeFile()）只把項目從陣列拿掉再存回去，實際的 Parse.File blob
// 從來沒被刪過，會在 Back4App 檔案儲存裡一直堆孤兒檔案。這裡改成不管陣列是怎麼變小的
// （手動刪除、或任何其他寫入路徑），存檔後統一比對前後差異，把消失的檔案一併刪掉。
// Parse.File.destroy() 需要 Master Key，前端沒有也不該有，所以放在這裡而不是 db.ts。
Parse.Cloud.afterSave('Activity', async (request) => {
  if (!request.original) return; // 新建的活動沒有舊檔案可比對

  for (const field of FOLDER_FIELDS) {
    const before = request.original.get(field) || [];
    const after = request.object.get(field) || [];
    const afterUrls = new Set(after.map((f) => f && f.url));
    const removed = before.filter((f) => f && f.url && !afterUrls.has(f.url));

    for (const f of removed) {
      const filename = decodeURIComponent(f.url.split('/').pop() || '');
      if (!filename) continue;
      try {
        await new Parse.File(filename).destroy({ useMasterKey: true });
      } catch (err) {
        console.error(`刪除檔案失敗：${filename}`, err);
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
