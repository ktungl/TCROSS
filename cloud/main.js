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
  'registrationFiles',
];
// 分類已改成使用者可在「分類管理」頁面自訂（見 Category class），不再是寫死的
// 5 個選項，這裡只驗證格式（非空字串、長度上限），不再檢查是否落在某個固定清單。
const ACTIVITY_CATEGORY_MAX_LENGTH = 50;

// 上傳檔案安全限制（ISO 27001 A.8.7 惡意軟體防護／A.8.28 安全程式設計）。
// 前端 src/types.ts 的 fileUploadRejectionReason() 有同樣規則做即時提示，但那邊能被繞過
// （直打 REST API），這裡才是真正擋得住的最後防線。
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'dll', 'ps1', 'psm1',
  'vbs', 'vbe', 'js', 'jse', 'jar', 'apk', 'sh', 'app', 'cpl', 'gadget',
  'pif', 'wsf', 'wsh', 'hta', 'lnk', 'reg',
];
const GENERATION_JOB_KINDS = ['成果報告', '其他'];
const GENERATION_JOB_STATUSES = ['pending', 'processing', 'done', 'error'];

function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function checkOptionalString(object, field, maxLength) {
  const value = object.get(field);
  if (value === undefined || value === null) return;
  const label = FIELD_LABELS[field] || field;
  if (typeof value !== 'string') {
    fail(`${label}必須是文字`);
  }
  if (value.length > maxLength) {
    fail(`${label}過長（上限 ${maxLength} 字）`);
  }
}

function fail(message) {
  throw new Parse.Error(Parse.Error.VALIDATION_ERROR, message);
}

// ───────────────────────── 操作者紀錄＋稽核紀錄 ─────────────────────────
//
// 「誰建立／誰最後修改／誰上傳／誰刪除」一律在這裡由伺服器寫入：前端送來的同名欄位
// 會被覆蓋，拿到帳號的人也無法直打 REST API 冒名。每次寫入後再把差異寫一筆到
// AuditLog（只有 Master Key 能寫，CLP 也不開放任何人新增/修改/刪除）。

const ROLE_NAMES = ['member', 'developer'];
const ACTOR_FIELDS = ['createdById', 'createdByName', 'updatedById', 'updatedByName'];
const FILE_STAMP_FIELDS = ['uploadedById', 'uploadedByName', 'uploadedAt', 'deletedById', 'deletedByName'];

const CLASS_LABELS = {
  Plan: '計畫',
  Category: '分類',
  Activity: '活動',
  GenerationJob: 'AI 生成工作',
};

const FOLDER_LABELS = {
  photoFiles: '活動照片',
  signInFiles: '簽到表',
  recordFiles: '成果紀錄',
  agendaFiles: '活動流程',
  documentFiles: '公文',
  receiptFiles: '領據',
  socialFiles: '社群貼文',
  mediaFiles: '影音檔',
  registrationFiles: '參與者名單（報名表）',
  audioFiles: '錄音（舊版）',
  videoFiles: '影片（舊版）',
  docFiles: '文件（舊版）',
};

const FIELD_LABELS = {
  name: '名稱',
  categories: '分類',
  category: '分類（舊版欄位）',
  date: '日期',
  dateEnd: '結束日期（舊版欄位）',
  time: '開始時間',
  timeEnd: '結束時間',
  placeMode: '實體／線上',
  place: '地點',
  meetingUrl: '會議連結',
  owner: '負責人',
  attendees: '與會單位或成員',
  participantDesc: '參加對象說明',
  headcount: '人數（舊版欄位）',
  maleCount: '男性人數',
  femaleCount: '女性人數',
  totalCount: '合計人數',
  plans: '對應計畫',
  summary: '成果摘要',
  kpis: 'KPI',
  remark: '備註',
  activity: '所屬活動',
  kind: '種類',
  status: '狀態',
  sourceFiles: '素材檔案',
  resultFile: '產出檔案',
  errorMessage: '錯誤訊息',
  deletedAt: '移到垃圾桶',
};

// 同一個欄位在不同資料類型的畫面上叫法不同：活動是「對應計畫」，分類是「所屬計畫」。
const FIELD_LABELS_BY_CLASS = {
  Category: { plans: '所屬計畫' },
};

function fieldLabel(className, field) {
  return (FIELD_LABELS_BY_CLASS[className] || {})[field] || FIELD_LABELS[field] || field;
}

// 這些欄位不列進 AuditLog 的逐欄差異：系統欄位、操作者欄位本身，以及附件陣列
// （附件改用 attachmentSummaries() 寫成「新增 N 個檔案到『照片』」這類摘要）。
const AUDIT_SKIP_FIELDS = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL', ...ACTOR_FIELDS, ...FOLDER_FIELDS]);

/** 目前這個請求是誰做的。Master Key 請求沒有使用者：Cloud Run 更新 AI 生成狀態、
 * 或有人從 Back4App Dashboard 直接改資料。 */
function actorOf(request, className) {
  const user = request.user;
  if (user) {
    return { id: user.id, name: user.get('displayName') || user.get('username') || user.id };
  }
  if (request.master) {
    return { id: '', name: className === 'GenerationJob' ? '系統（AI 生成）' : '系統（後台）' };
  }
  return null;
}

function copyOrUnset(object, source, field) {
  const value = source ? source.get(field) : undefined;
  if (value === undefined) object.unset(field);
  else object.set(field, value);
}

/** 在 beforeSave 最後呼叫：新建時寫入建立者，每次存檔都寫入最後修改者。 */
function stampActor(request, className) {
  const actor = actorOf(request, className);
  if (!actor) fail('需要登入才能修改資料');
  const { object, original } = request;
  if (original) {
    copyOrUnset(object, original, 'createdById');
    copyOrUnset(object, original, 'createdByName');
  } else {
    object.set('createdById', actor.id);
    object.set('createdByName', actor.name);
  }
  object.set('updatedById', actor.id);
  object.set('updatedByName', actor.name);
  return actor;
}

/** 以 url 對照存檔前後的附件陣列：新出現的檔案蓋上上傳者，既有檔案沿用原本的
 * 上傳者（前端送什麼都不採用），這次才被移進垃圾桶的檔案蓋上刪除者。 */
function stampAttachments(request, actor) {
  const { object, original } = request;
  const dirty = new Set(object.dirtyKeys());
  const now = new Date().toISOString();
  for (const field of FOLDER_FIELDS) {
    if (!dirty.has(field)) continue;
    const files = object.get(field);
    if (!Array.isArray(files)) continue;
    const before = new Map(
      ((original && original.get(field)) || []).filter((f) => f && f.url).map((f) => [f.url, f]),
    );
    object.set(
      field,
      files.map((f) => {
        if (typeof f !== 'object' || f === null) return f; // 格式錯誤交給後面的驗證擋下
        const prev = before.get(f.url);
        const next = { ...f };
        for (const k of FILE_STAMP_FIELDS) delete next[k];
        if (prev) {
          for (const k of ['uploadedById', 'uploadedByName', 'uploadedAt']) {
            if (prev[k] !== undefined) next[k] = prev[k];
          }
        } else {
          next.uploadedById = actor.id;
          next.uploadedByName = actor.name;
          next.uploadedAt = now;
        }
        if (next.deletedAt) {
          if (prev && prev.deletedAt) {
            next.deletedAt = prev.deletedAt;
            if (prev.deletedById !== undefined) next.deletedById = prev.deletedById;
            if (prev.deletedByName !== undefined) next.deletedByName = prev.deletedByName;
          } else {
            next.deletedById = actor.id;
            next.deletedByName = actor.name;
          }
        }
        return next;
      }),
    );
  }
}

/** 把 Parse 值轉成可存進 AuditLog 的純 JSON：Pointer → objectId、Date → ISO 字串。 */
function plain(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    if (typeof value.toPointer === 'function') return value.id;
    if (value.__type === 'Pointer') return value.objectId;
    if (value.__type === 'Date') return value.iso;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

function fieldChanges(className, object, original) {
  const keys = new Set([
    ...Object.keys(object.attributes),
    ...(original ? Object.keys(original.attributes) : []),
  ]);
  const changes = [];
  for (const field of keys) {
    if (AUDIT_SKIP_FIELDS.has(field)) continue;
    const before = original ? plain(original.get(field)) : null;
    const after = plain(object.get(field));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (!original && (after === null || after === '' || (Array.isArray(after) && !after.length))) continue;
    changes.push({ field, label: fieldLabel(className, field), before, after });
  }
  return changes;
}

function fileNames(files) {
  const names = files.map((f) => f.name);
  return names.length > 5 ? `${names.slice(0, 5).join('、')} 等` : names.join('、');
}

function attachmentSummaries(object, original) {
  const lines = [];
  for (const field of FOLDER_FIELDS) {
    const before = ((original && original.get(field)) || []).filter((f) => f && f.url);
    const after = (object.get(field) || []).filter((f) => f && f.url);
    if (!before.length && !after.length) continue;
    const beforeMap = new Map(before.map((f) => [f.url, f]));
    const afterUrls = new Set(after.map((f) => f.url));
    const label = FOLDER_LABELS[field] || field;

    const added = after.filter((f) => !beforeMap.has(f.url));
    const removed = before.filter((f) => !afterUrls.has(f.url));
    const trashed = after.filter((f) => f.deletedAt && beforeMap.has(f.url) && !beforeMap.get(f.url).deletedAt);
    const restored = after.filter((f) => !f.deletedAt && beforeMap.has(f.url) && beforeMap.get(f.url).deletedAt);
    const edited = after.filter((f) => {
      const prev = beforeMap.get(f.url);
      return prev && ((prev.caption || '') !== (f.caption || '') || !!prev.featured !== !!f.featured);
    });

    if (added.length) lines.push(`新增 ${added.length} 個檔案到「${label}」：${fileNames(added)}`);
    if (trashed.length) lines.push(`將「${label}」的 ${trashed.length} 個檔案移到垃圾桶：${fileNames(trashed)}`);
    if (restored.length) lines.push(`從垃圾桶復原「${label}」的 ${restored.length} 個檔案：${fileNames(restored)}`);
    if (removed.length) lines.push(`永久刪除「${label}」的 ${removed.length} 個檔案：${fileNames(removed)}`);
    if (edited.length) lines.push(`修改「${label}」的 ${edited.length} 個檔案圖說／精選：${fileNames(edited)}`);
  }
  return lines;
}

async function auditTarget(className, object) {
  if (className === 'Activity') return { targetName: object.get('name') || '', activityId: object.id };
  if (className === 'GenerationJob') {
    const activity = object.get('activity');
    let activityName = '';
    if (activity && activity.id) {
      try {
        const fetched = await new Parse.Query('Activity').get(activity.id, { useMasterKey: true });
        activityName = fetched.get('name') || '';
      } catch (err) {
        // 活動已被刪除時查不到，名稱留空即可
      }
    }
    const kind = object.get('kind') || '成果報告';
    return {
      targetName: activityName ? `${activityName}／${kind}` : kind,
      activityId: activity && activity.id ? activity.id : '',
    };
  }
  return { targetName: object.get('name') || '', activityId: '' };
}

/** 寫一筆 AuditLog。失敗只記在 Cloud Code log，不讓原本的操作跟著失敗。 */
async function writeAudit(entry) {
  try {
    const log = new Parse.Object('AuditLog');
    const acl = new Parse.ACL();
    for (const role of ROLE_NAMES) acl.setRoleReadAccess(role, true);
    log.setACL(acl);
    await log.save(entry, { useMasterKey: true });
  } catch (err) {
    console.error('寫入 AuditLog 失敗', err);
  }
}

async function auditSave(className, request) {
  const { object, original } = request;
  const actor = actorOf(request, className) || { id: '', name: '（不明）' };
  const changes = fieldChanges(className, object, original);
  const fileLines = className === 'Activity' ? attachmentSummaries(object, original) : [];
  if (original && !changes.length && !fileLines.length) return; // 內容沒有實際變動，不記

  const { targetName, activityId } = await auditTarget(className, object);
  const label = CLASS_LABELS[className];
  let headline;
  if (!original) headline = `建立${label}「${targetName}」`;
  else if (changes.length) headline = `修改${label}「${targetName}」：${changes.map((c) => c.label).join('、')}`;
  else headline = `更新${label}「${targetName}」的附件`;

  await writeAudit({
    action: original ? 'update' : 'create',
    targetClass: className,
    targetId: object.id,
    targetName,
    activityId,
    actorId: actor.id,
    actorName: actor.name,
    changes,
    summary: [headline, ...fileLines].join('\n'),
  });
}

async function auditDelete(className, request) {
  const { object } = request;
  const actor = actorOf(request, className) || { id: '', name: '（不明）' };
  const { targetName, activityId } = await auditTarget(className, object);
  await writeAudit({
    action: 'delete',
    targetClass: className,
    targetId: object.id,
    targetName,
    activityId,
    actorId: actor.id,
    actorName: actor.name,
    changes: [],
    summary: `刪除${CLASS_LABELS[className]}「${targetName}」`,
  });
}

// AuditLog 只能由上面的 writeAudit() 用 Master Key 寫入；CLP 已擋，這裡再擋一次。
Parse.Cloud.beforeSave('AuditLog', (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, '稽核紀錄不可新增或修改');
  }
});

Parse.Cloud.beforeDelete('AuditLog', (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, '稽核紀錄不可刪除');
  }
});

// displayName 會被蓋進每一筆操作紀錄，使用者如果能自己改名就能冒用別人的名字，
// 所以 username／displayName 只能由 Master Key（scripts/setup-users.mjs）修改。
Parse.Cloud.beforeSave(Parse.User, (request) => {
  if (request.master || !request.original) return;
  const dirty = request.object.dirtyKeys();
  if (dirty.includes('displayName') || dirty.includes('username')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, '帳號名稱與顯示名稱只能由管理者修改');
  }
});

Parse.Cloud.afterLogin(async (request) => {
  const user = request.object;
  const name = user.get('displayName') || user.get('username');
  await writeAudit({
    action: 'login',
    targetClass: '_User',
    targetId: user.id,
    targetName: name,
    activityId: '',
    actorId: user.id,
    actorName: name,
    changes: [],
    summary: `${name} 登入系統`,
  });
});

Parse.Cloud.afterLogout(async (request) => {
  const userPtr = request.object.get('user');
  if (!userPtr) return;
  let name = userPtr.id;
  try {
    const user = await new Parse.Query(Parse.User).get(userPtr.id, { useMasterKey: true });
    name = user.get('displayName') || user.get('username');
  } catch (err) {
    // 查不到就用 id
  }
  await writeAudit({
    action: 'logout',
    targetClass: '_User',
    targetId: userPtr.id,
    targetName: name,
    activityId: '',
    actorId: userPtr.id,
    actorName: name,
    changes: [],
    summary: `${name} 登出系統`,
  });
});

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
  stampActor(request, 'Plan');
});

Parse.Cloud.afterSave('Plan', (request) => auditSave('Plan', request));
Parse.Cloud.afterDelete('Plan', (request) => auditDelete('Plan', request));

Parse.Cloud.beforeSave('Category', (request) => {
  const object = request.object;
  const name = object.get('name');
  if (typeof name !== 'string' || !name.trim()) {
    fail('分類名稱不能為空');
  }
  if (name.length > ACTIVITY_CATEGORY_MAX_LENGTH) {
    fail(`分類名稱過長（上限 ${ACTIVITY_CATEGORY_MAX_LENGTH} 字）`);
  }
  object.set('name', name.trim());

  // plans：這個分類所屬的計畫（可複選，可留空＝不限計畫）。
  const plans = object.get('plans');
  if (plans !== undefined && !Array.isArray(plans)) {
    fail('plans 必須是陣列');
  }
  stampActor(request, 'Category');
});

Parse.Cloud.afterSave('Category', (request) => auditSave('Category', request));
Parse.Cloud.afterDelete('Category', (request) => auditDelete('Category', request));

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
      fail(`${FIELD_LABELS[field]}必須是不小於 0 的數字`);
    }
  }

  const date = object.get('date');
  if (typeof date === 'string' && date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    fail('日期格式必須是 YYYY-MM-DD');
  }

  const time = object.get('time');
  if (typeof time === 'string' && time.trim() && !/^\d{2}:\d{2}$/.test(time.trim())) {
    fail('時間格式必須是 HH:MM');
  }

  const timeEnd = object.get('timeEnd');
  if (typeof timeEnd === 'string' && timeEnd.trim() && !/^\d{2}:\d{2}$/.test(timeEnd.trim())) {
    fail('結束時間格式必須是 HH:MM');
  }

  // category 是舊版單一字串欄位，前端已改用 categories 陣列，但為相容性仍會同步寫入
  // 第一個分類，繼續驗證，不主動刪除欄位。
  const category = object.get('category');
  if (typeof category === 'string' && category.length > ACTIVITY_CATEGORY_MAX_LENGTH) {
    fail(`category 過長（上限 ${ACTIVITY_CATEGORY_MAX_LENGTH} 字）`);
  }

  const categories = object.get('categories');
  if (categories !== undefined && categories !== null) {
    if (
      !Array.isArray(categories) ||
      categories.some((c) => typeof c !== 'string' || !c.trim() || c.length > ACTIVITY_CATEGORY_MAX_LENGTH)
    ) {
      fail(`categories 必須是陣列，且每個項目都是不超過 ${ACTIVITY_CATEGORY_MAX_LENGTH} 字的非空字串`);
    }
  }

  const placeMode = object.get('placeMode');
  if (placeMode !== undefined && placeMode !== null && placeMode !== 'physical' && placeMode !== 'online') {
    fail('placeMode 必須是 physical 或 online');
  }
  checkOptionalString(object, 'place', 200);
  // meetingUrl 會直接當成連結渲染（活動詳情頁），只接受 http(s)，擋掉 javascript: 之類
  checkOptionalString(object, 'meetingUrl', 500);
  const meetingUrl = object.get('meetingUrl');
  if (typeof meetingUrl === 'string' && meetingUrl && !/^https?:\/\//i.test(meetingUrl)) {
    fail('會議連結必須是 http(s) 網址');
  }

  checkOptionalString(object, 'owner', 100);
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
      // url 會直接當成連結渲染（歷史檔案頁的「開啟」），只接受 http(s)，擋掉 javascript: 之類；
      // gcs:attachments/… 是存在 GCS 的附件，畫面上一律先換成 Cloud Run 簽的臨時網址
      if (!/^https?:\/\//i.test(file.url) && !file.url.startsWith('gcs:attachments/')) {
        fail(`${field} 的 url 必須是 http(s) 網址或 gcs:attachments/ 路徑`);
      }
      if (file.caption !== undefined && typeof file.caption !== 'string') {
        fail(`${field} 的 caption 必須是字串`);
      }
      if (file.featured !== undefined && typeof file.featured !== 'boolean') {
        fail(`${field} 的 featured 必須是布林值`);
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        fail(`「${file.name}」超過上傳大小上限（${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB）`);
      }
      // 先去掉結尾的點與空白：Windows 存檔時會自動拿掉，「evil.exe.」下載後就是 evil.exe
      const ext = (file.name.replace(/[.\s]+$/, '').split('.').pop() || '').toLowerCase();
      if (BLOCKED_EXTENSIONS.includes(ext)) {
        fail(`「${file.name}」的檔案類型不允許上傳`);
      }
      if (file.deletedAt !== undefined && typeof file.deletedAt !== 'string') {
        fail(`${field} 的 deletedAt 必須是字串`);
      }
    }
  }

  // 附件從 Back4App 搬到 GCS（scripts/migrate-attachments-to-gcs.mjs）只是換網址，
  // 不是誰新增了檔案：保留腳本帶過來的原上傳者／刪除者與最後修改者，不重新蓋章。
  if (isAttachmentMigration(request)) return;
  const actor = stampActor(request, 'Activity');
  stampAttachments(request, actor);
});

/** 只有 Master Key 才能帶這個 context，前端（JS Key＋session）帶了也不算數。 */
function isAttachmentMigration(request) {
  return !!(request.master && request.context && request.context.attachmentMigration);
}

/** 這個物件所有附件欄位裡還引用到的檔案網址。 */
function referencedUrls(object) {
  const urls = new Set();
  for (const field of FOLDER_FIELDS) {
    for (const f of object.get(field) || []) {
      if (f && typeof f.url === 'string') urls.add(f.url);
    }
  }
  return urls;
}

// 前端刪檔（removeFile()）只把項目從陣列拿掉再存回去，實際的 Parse.File blob
// 從來沒被刪過，會在 Back4App 檔案儲存裡一直堆孤兒檔案。這裡改成不管陣列是怎麼變小的
// （手動刪除、或任何其他寫入路徑），存檔後統一比對前後差異，把消失的檔案一併刪掉。
// Parse.File.destroy() 需要 Master Key，前端沒有也不該有，所以放在這裡而不是 db.ts。
// 每個 class 只能註冊一個 afterSave，所以稽核紀錄跟孤兒檔清理寫在同一個 handler。
// GCS 附件（gcs: 開頭）不在這裡刪，由前端呼叫 Cloud Run /attachments/delete 處理。
Parse.Cloud.afterSave('Activity', async (request) => {
  if (isAttachmentMigration(request)) {
    // 搬遷期間 Back4App 原檔先保留（場域測試後確認無誤再清），稽核只記一筆摘要
    const moved = request.context.attachmentMigration.moved || 0;
    await writeAudit({
      action: 'update',
      targetClass: 'Activity',
      targetId: request.object.id,
      targetName: request.object.get('name') || '',
      activityId: request.object.id,
      actorId: '',
      actorName: '系統（附件搬移）',
      changes: [],
      summary: `附件搬移到 GCS：${moved} 個檔案（內容不變，只換存放位置）`,
    });
    return;
  }
  await auditSave('Activity', request);
  if (!request.original) return; // 新建的活動沒有舊檔案可比對

  // 同一個檔案網址可能同時掛在別的分類或別的活動（「歷史檔案」挑選會重用既有網址），
  // 只有整個系統都不再引用時才真的刪掉底層檔案，不然會把別處還在用的檔案一起刪掉。
  const stillHere = referencedUrls(request.object);
  const candidates = new Set();
  for (const url of referencedUrls(request.original)) {
    if (!url.startsWith('gcs:') && !stillHere.has(url)) candidates.add(url);
  }
  if (!candidates.size) return;

  try {
    await new Parse.Query('Activity')
      .notEqualTo('objectId', request.object.id)
      .select(...FOLDER_FIELDS)
      .each(
        (other) => {
          for (const url of referencedUrls(other)) candidates.delete(url);
        },
        { useMasterKey: true },
      );
  } catch (err) {
    // 查不到其他活動的引用狀況就不刪，寧可留孤兒檔也不能誤刪別人還在用的檔案
    console.error('查詢附件引用失敗，略過清檔', err);
    return;
  }

  for (const url of candidates) {
    let filename = '';
    try {
      filename = decodeURIComponent(url.split('/').pop() || '');
    } catch (err) {
      console.error(`檔案網址格式錯誤：${url}`, err);
      continue;
    }
    if (!filename) continue;
    try {
      await new Parse.File(filename).destroy({ useMasterKey: true });
    } catch (err) {
      console.error(`刪除檔案失敗：${filename}`, err);
    }
  }
});

Parse.Cloud.afterDelete('Activity', (request) => auditDelete('Activity', request));

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

  stampActor(request, 'GenerationJob');
});

Parse.Cloud.afterSave('GenerationJob', (request) => auditSave('GenerationJob', request));
Parse.Cloud.afterDelete('GenerationJob', (request) => auditDelete('GenerationJob', request));
