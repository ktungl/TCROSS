// cloud/main.js 的伺服器端驗證測試（doc/TESTING.md TC-18～TC-24）。
// 執行：node --test cloud/tests/
//
// 不依賴 parse-server：用最小的假 Parse 物件載入 main.js，把 Parse.Cloud.* 註冊的
// handler 收集起來，再直接呼叫 beforeSave／beforeDelete 模擬各種請求。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ───────────────────────── 假 Parse ─────────────────────────

class FakeParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
FakeParseError.VALIDATION_ERROR = 142;
FakeParseError.OPERATION_FORBIDDEN = 119;

class FakeObject {
  constructor(className, attrs = {}, id) {
    this.className = className;
    this.id = id;
    this.attributes = { ...attrs };
    this._dirty = new Set();
  }
  get(key) {
    return this.attributes[key];
  }
  set(key, value) {
    this.attributes[key] = value;
    this._dirty.add(key);
    return this;
  }
  unset(key) {
    delete this.attributes[key];
    this._dirty.add(key);
    return this;
  }
  dirtyKeys() {
    return [...this._dirty];
  }
  setACL() {}
  async save() {
    return this;
  }
}

class FakeUser extends FakeObject {
  constructor(attrs, id) {
    super('_User', attrs, id);
  }
}

class FakeQuery {
  constructor(className) {
    this.className = className;
  }
  async get() {
    throw new Error('not found');
  }
  notEqualTo() {
    return this;
  }
  select() {
    return this;
  }
  async each() {}
}

const handlers = {};
function register(kind) {
  return (target, fn) => {
    if (typeof target === 'function' && fn === undefined) {
      handlers[kind] = target; // afterLogin／afterLogout 沒有 class 參數
      return;
    }
    const className = target === FakeUser ? '_User' : target;
    handlers[`${kind}:${className}`] = fn;
  };
}

const Parse = {
  applicationId: 'TEST_APP',
  Error: FakeParseError,
  Object: FakeObject,
  User: FakeUser,
  Query: FakeQuery,
  ACL: class {
    setRoleReadAccess() {}
  },
  File: class {
    async destroy() {}
  },
  Cloud: {
    beforeSave: register('beforeSave'),
    afterSave: register('afterSave'),
    beforeDelete: register('beforeDelete'),
    afterDelete: register('afterDelete'),
    afterLogin: register('afterLogin'),
    afterLogout: register('afterLogout'),
    define: register('define'),
  },
};

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
vm.compileFunction(source, ['Parse'], { filename: 'cloud/main.js' })(Parse);

// ───────────────────────── 測試輔助 ─────────────────────────

const alice = new FakeUser({ username: 'alice', displayName: '愛麗絲' }, 'userAlice');

/**
 * 模擬一次存檔請求。
 * originalAttrs 有值＝修改既有物件（request.original 存在），沒有＝新建。
 * changes 是這次前端送出的欄位，會成為 object 的 dirty keys。
 */
function makeRequest(className, { originalAttrs, changes = {}, user = alice, master = false, id = 'obj1', context } = {}) {
  const build = (attrs) => (className === '_User' ? new FakeUser(attrs, id) : new FakeObject(className, attrs, id));
  const original = originalAttrs ? build(originalAttrs) : undefined;
  const object = build({ ...(originalAttrs || {}) });
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) object.unset(k);
    else object.set(k, v);
  }
  return { object, original, user: user || undefined, master, context: context || {} };
}

async function run(kind, className, opts) {
  const fn = handlers[`${kind}:${className}`];
  assert.ok(fn, `沒有註冊 ${kind}:${className}`);
  const request = makeRequest(className, opts);
  await fn(request);
  return request;
}

async function rejects(kind, className, opts, pattern, code = FakeParseError.VALIDATION_ERROR) {
  await assert.rejects(
    async () => run(kind, className, opts),
    (err) => {
      assert.ok(err instanceof FakeParseError, `應該丟 Parse.Error，實際：${err}`);
      assert.equal(err.code, code);
      if (pattern) assert.match(err.message, pattern);
      return true;
    },
  );
}

const baseActivity = { name: '社區合照活動', date: '2026-10-19' };
const gcsFile = (name, extra = {}) => ({ name, size: 1024, url: `gcs:attachments/act1/${name}`, ...extra });

// ───────────────────────── TC-18 封存鎖定 ─────────────────────────

test('TC-18 已封存活動：編輯其他欄位被拒', async () => {
  await rejects(
    'beforeSave',
    'Activity',
    { originalAttrs: { ...baseActivity, archivedAt: '2026-10-01T00:00:00Z' }, changes: { name: '改名' } },
    /已封存/,
  );
});

test('TC-18 已封存活動：加附件也被拒', async () => {
  await rejects(
    'beforeSave',
    'Activity',
    {
      originalAttrs: { ...baseActivity, archivedAt: '2026-10-01T00:00:00Z' },
      changes: { photoFiles: [gcsFile('a.jpg')] },
    },
    /已封存/,
  );
});

test('TC-18 已封存活動：刪除被拒', async () => {
  await rejects(
    'beforeDelete',
    'Activity',
    { originalAttrs: { ...baseActivity, archivedAt: '2026-10-01T00:00:00Z' } },
    /已封存/,
  );
});

test('TC-18 對照：解除封存可以，未封存活動可編輯與刪除，Master Key 放行', async () => {
  await run('beforeSave', 'Activity', {
    originalAttrs: { ...baseActivity, archivedAt: '2026-10-01T00:00:00Z', archivedByName: '愛麗絲' },
    changes: { archivedAt: undefined },
  });
  await run('beforeSave', 'Activity', { originalAttrs: baseActivity, changes: { name: '改名' } });
  await run('beforeDelete', 'Activity', { originalAttrs: baseActivity });
  await run('beforeSave', 'Activity', {
    originalAttrs: { ...baseActivity, archivedAt: '2026-10-01T00:00:00Z' },
    changes: { name: '後台改名' },
    user: null,
    master: true,
  });
  await run('beforeDelete', 'Activity', {
    originalAttrs: { ...baseActivity, archivedAt: '2026-10-01T00:00:00Z' },
    user: null,
    master: true,
  });
});

// ───────────────────────── TC-19 AuditLog 不可改 ─────────────────────────

test('TC-19 非 master 新增 AuditLog 被拒', async () => {
  await rejects('beforeSave', 'AuditLog', { changes: { action: 'create' } }, /稽核紀錄/, FakeParseError.OPERATION_FORBIDDEN);
});

test('TC-19 非 master 修改 AuditLog 被拒', async () => {
  await rejects(
    'beforeSave',
    'AuditLog',
    { originalAttrs: { action: 'create', actorName: '愛麗絲' }, changes: { actorName: '別人' } },
    /稽核紀錄/,
    FakeParseError.OPERATION_FORBIDDEN,
  );
});

test('TC-19 非 master 刪除 AuditLog 被拒', async () => {
  await rejects('beforeDelete', 'AuditLog', { originalAttrs: { action: 'create' } }, /稽核紀錄/, FakeParseError.OPERATION_FORBIDDEN);
});

test('TC-19 對照：master 可寫入 AuditLog', async () => {
  await run('beforeSave', 'AuditLog', { changes: { action: 'create' }, user: null, master: true });
  await run('beforeDelete', 'AuditLog', { originalAttrs: { action: 'create' }, user: null, master: true });
});

// ───────────────────────── TC-20 Activity 欄位格式 ─────────────────────────

test('TC-20 活動名稱空白被拒', async () => {
  await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, name: '   ' } }, /名稱不能為空/);
  await rejects('beforeSave', 'Activity', { changes: { date: '2026-10-19' } }, /名稱不能為空/);
});

test('TC-20 活動名稱超過 200 字被拒（剛好 200 字可以）', async () => {
  await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, name: '字'.repeat(201) } }, /過長/);
  await run('beforeSave', 'Activity', { changes: { ...baseActivity, name: '字'.repeat(200) } });
});

test('TC-20 人數負數被拒', async () => {
  for (const field of ['maleCount', 'femaleCount', 'totalCount', 'headcount']) {
    await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, [field]: -1 } }, /不小於 0/);
  }
  await run('beforeSave', 'Activity', { changes: { ...baseActivity, maleCount: 0, femaleCount: 3, totalCount: 3 } });
});

test('TC-20 日期字串不是 YYYY-MM-DD 被拒', async () => {
  for (const date of ['2026/10/19', '20261019', '2026-1-9', '明天']) {
    await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, date } }, /YYYY-MM-DD/);
  }
});

test('TC-20 日期不是字串（數字、物件）也被拒', async () => {
  await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, date: 20261019 } }, /YYYY-MM-DD/);
  await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, date: { iso: 'x' } } }, /YYYY-MM-DD/);
});

// ───────────────────────── TC-21 附件來源、大小、大事紀張數 ─────────────────────────

test('TC-21 新附件 url 不是 gcs:attachments/ 被拒', async () => {
  await rejects(
    'beforeSave',
    'Activity',
    { changes: { ...baseActivity, photoFiles: [{ name: 'x.jpg', size: 10, url: 'https://evil.example.com/x.jpg' }] } },
    /不是透過系統上傳/,
  );
  await rejects(
    'beforeSave',
    'Activity',
    {
      originalAttrs: { ...baseActivity, photoFiles: [] },
      changes: { photoFiles: [{ name: 'x.jpg', size: 10, url: 'https://parsefiles.back4app.com/TEST_APP/other.jpg' }] },
    },
    /不是透過系統上傳/,
  );
  await rejects(
    'beforeSave',
    'Activity',
    { changes: { ...baseActivity, photoFiles: [{ name: 'x.jpg', size: 10, url: 'javascript:alert(1)' }] } },
    /檔案網址必須是/,
  );
});

test('TC-21 對照：原有的舊網址保留可以，搬到別的分類也可以', async () => {
  const legacy = { name: 'old.jpg', size: 10, url: 'https://parsefiles.back4app.com/TEST_APP/old.jpg' };
  await run('beforeSave', 'Activity', {
    originalAttrs: { ...baseActivity, photoFiles: [legacy] },
    changes: { photoFiles: [legacy, gcsFile('new.jpg')] },
  });
  await run('beforeSave', 'Activity', {
    originalAttrs: { ...baseActivity, photoFiles: [legacy] },
    changes: { photoFiles: [], recordFiles: [legacy] },
  });
});

test('TC-21 單檔超過 50MB 被拒（剛好 50MB 可以）', async () => {
  const limit = 50 * 1024 * 1024;
  await rejects(
    'beforeSave',
    'Activity',
    { changes: { ...baseActivity, mediaFiles: [gcsFile('big.mp4', { size: limit + 1 })] } },
    /大小上限/,
  );
  await run('beforeSave', 'Activity', { changes: { ...baseActivity, mediaFiles: [gcsFile('ok.mp4', { size: limit })] } });
});

test('TC-21 大事紀照片超過 3 張被拒（垃圾桶裡的不算）', async () => {
  const photos = (n, extra) => Array.from({ length: n }, (_, i) => gcsFile(`p${i}.jpg`, { ledger: true, ...extra }));
  await rejects('beforeSave', 'Activity', { changes: { ...baseActivity, photoFiles: photos(4) } }, /最多 3 張/);
  await run('beforeSave', 'Activity', { changes: { ...baseActivity, photoFiles: photos(3) } });
  await run('beforeSave', 'Activity', {
    changes: {
      ...baseActivity,
      photoFiles: [...photos(3), gcsFile('trash.jpg', { ledger: true, deletedAt: '2026-10-01T00:00:00Z' })],
    },
  });
});

// ───────────────────────── TC-22 操作者蓋章 ─────────────────────────

const forged = { createdById: 'evil', createdByName: '冒名者', updatedById: 'evil', updatedByName: '冒名者' };

test('TC-22 新建活動：偽造的建立者／修改者被覆蓋成實際登入者', async () => {
  const { object } = await run('beforeSave', 'Activity', { changes: { ...baseActivity, ...forged } });
  assert.equal(object.get('createdById'), 'userAlice');
  assert.equal(object.get('createdByName'), '愛麗絲');
  assert.equal(object.get('updatedById'), 'userAlice');
  assert.equal(object.get('updatedByName'), '愛麗絲');
});

test('TC-22 修改活動：建立者沿用原值、修改者改成實際登入者', async () => {
  const { object } = await run('beforeSave', 'Activity', {
    originalAttrs: { ...baseActivity, createdById: 'userBob', createdByName: '鮑伯', updatedById: 'userBob', updatedByName: '鮑伯' },
    changes: { name: '改名', ...forged },
  });
  assert.equal(object.get('createdById'), 'userBob');
  assert.equal(object.get('createdByName'), '鮑伯');
  assert.equal(object.get('updatedById'), 'userAlice');
  assert.equal(object.get('updatedByName'), '愛麗絲');
});

test('TC-22 附件上傳者／刪除者、封存人以伺服器為準', async () => {
  const prev = gcsFile('old.jpg', { uploadedById: 'userBob', uploadedByName: '鮑伯', uploadedAt: '2026-01-01T00:00:00Z' });
  const { object } = await run('beforeSave', 'Activity', {
    originalAttrs: { ...baseActivity, photoFiles: [prev] },
    changes: {
      photoFiles: [
        { ...prev, uploadedById: 'evil', uploadedByName: '冒名者', deletedAt: '2026-10-19T00:00:00Z', deletedByName: '冒名者' },
        gcsFile('new.jpg', { uploadedById: 'evil', uploadedByName: '冒名者' }),
      ],
      archivedAt: '2026-10-19T00:00:00Z',
      archivedByName: '冒名者',
    },
  });
  const [oldF, newF] = object.get('photoFiles');
  assert.equal(oldF.uploadedById, 'userBob');
  assert.equal(oldF.uploadedByName, '鮑伯');
  assert.equal(oldF.deletedById, 'userAlice');
  assert.equal(oldF.deletedByName, '愛麗絲');
  assert.equal(newF.uploadedById, 'userAlice');
  assert.equal(newF.uploadedByName, '愛麗絲');
  assert.equal(object.get('archivedByName'), '愛麗絲');
});

test('TC-22 Plan／Category／GenerationJob 也覆蓋偽造的操作者', async () => {
  for (const [className, changes] of [
    ['Plan', { name: '計畫一' }],
    ['Category', { name: '分類一' }],
    ['GenerationJob', { activity: { id: 'act1' }, kind: '成果報告' }],
  ]) {
    const { object } = await run('beforeSave', className, { changes: { ...changes, ...forged } });
    assert.equal(object.get('createdByName'), '愛麗絲', className);
    assert.equal(object.get('updatedById'), 'userAlice', className);
  }
});

test('TC-22 對照：未登入也非 master 的寫入被拒', async () => {
  await rejects('beforeSave', 'Activity', { changes: baseActivity, user: null }, /需要登入/);
});

test('TC-22 非 master 帶 attachmentMigration context 不能跳過蓋章', async () => {
  const { object } = await run('beforeSave', 'Activity', {
    changes: { ...baseActivity, ...forged },
    context: { attachmentMigration: { moved: 1 } },
  });
  assert.equal(object.get('createdById'), 'userAlice');
});

// ───────────────────────── TC-23 GenerationJob ─────────────────────────

test('TC-23 非 master 新建 status 不是 pending 的工作被拒', async () => {
  for (const status of ['processing', 'done', 'error']) {
    await rejects('beforeSave', 'GenerationJob', { changes: { activity: { id: 'act1' }, status } }, /待處理/);
  }
  await rejects(
    'beforeSave',
    'GenerationJob',
    { changes: { activity: { id: 'act1' }, status: 'pending', resultFile: 'generated/x.docx' } },
    /待處理/,
  );
});

test('TC-23 對照：非 master 新建 pending 工作可以；master 可以新建其他狀態', async () => {
  await run('beforeSave', 'GenerationJob', {
    changes: { activity: { id: 'act1' }, status: 'pending', sourceFiles: ['activities/act1/photo/a.jpg'] },
  });
  await run('beforeSave', 'GenerationJob', { changes: { activity: { id: 'act1' } } });
  await run('beforeSave', 'GenerationJob', { changes: { activity: { id: 'act1' }, status: 'done' }, user: null, master: true });
});

test('TC-23 非 master 建立後改 activity 被拒', async () => {
  await rejects(
    'beforeSave',
    'GenerationJob',
    {
      originalAttrs: { activity: { id: 'act1' }, status: 'pending', kind: '成果報告' },
      changes: { activity: { id: 'act2' } },
    },
    /所屬活動建立後不能修改/,
  );
});

test('TC-23 非 master 建立後改 status 被拒，只改 deletedAt 可以', async () => {
  const originalAttrs = { activity: { id: 'act1' }, status: 'pending', kind: '成果報告' };
  await rejects('beforeSave', 'GenerationJob', { originalAttrs, changes: { status: 'done' } }, /狀態建立後不能修改/);
  await run('beforeSave', 'GenerationJob', { originalAttrs, changes: { deletedAt: '2026-10-19T00:00:00Z' } });
});

test('TC-23 非 master 素材指到別的活動被拒', async () => {
  await rejects(
    'beforeSave',
    'GenerationJob',
    { changes: { activity: { id: 'act1' }, sourceFiles: ['activities/act2/photo/a.jpg'] } },
    /素材檔案/,
  );
  await rejects(
    'beforeSave',
    'GenerationJob',
    { changes: { activity: { id: 'act1' }, sourceFiles: ['generated/act1/report.docx'] } },
    /素材檔案/,
  );
});

// ───────────────────────── TC-24 _User ─────────────────────────

test('TC-24 非 master 修改 _User 的 username 被拒', async () => {
  await rejects(
    'beforeSave',
    '_User',
    { originalAttrs: { username: 'alice', displayName: '愛麗絲' }, changes: { username: 'bob' } },
    /只能由管理者修改/,
    FakeParseError.OPERATION_FORBIDDEN,
  );
});

test('TC-24 非 master 修改 displayName 也被拒；改其他欄位可以；master 可以改名', async () => {
  const originalAttrs = { username: 'alice', displayName: '愛麗絲' };
  await rejects(
    'beforeSave',
    '_User',
    { originalAttrs, changes: { displayName: '鮑伯' } },
    /只能由管理者修改/,
    FakeParseError.OPERATION_FORBIDDEN,
  );
  await run('beforeSave', '_User', { originalAttrs, changes: { password: 'newpass' } });
  await run('beforeSave', '_User', { originalAttrs, changes: { username: 'bob' }, user: null, master: true });
});

// ───────────────── 跨語言清單一致性 ─────────────────
// 同一份清單在前端（TS）、Cloud Code、中介層（Python）各寫一份，讀原始碼比對內容，改一邊忘了改另一邊就會失敗。

function listLiteral(file, name) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
  const m = new RegExp(`\\b${name}\\s*=\\s*[\\[{(]`).exec(src);
  assert.ok(m, `${file} 找不到 ${name}`);
  const open = m.index + m[0].length - 1;
  const close = src.indexOf({ '[': ']', '{': '}', '(': ')' }[src[open]], open);
  const body = src.slice(open + 1, close).replace(/(\/\/|#).*$/gm, '');
  return [...body.matchAll(/['"]([A-Za-z0-9]+)['"]/g)].map((x) => x[1]).sort();
}

test('禁止上傳的副檔名：前端、Cloud Code、中介層一致', () => {
  const cloud = listLiteral('cloud/main.js', 'BLOCKED_EXTENSIONS');
  assert.ok(cloud.includes('exe') && cloud.includes('svg'));
  assert.deepEqual(listLiteral('src/types.ts', 'BLOCKED_EXTENSIONS'), cloud);
  assert.deepEqual(listLiteral('server/utils.py', 'BLOCKED_EXTENSIONS'), cloud);
});

test('附件欄位：Cloud Code 與中介層一致', () => {
  const cloud = listLiteral('cloud/main.js', 'FOLDER_FIELDS');
  assert.equal(cloud.length, 13);
  assert.deepEqual(listLiteral('server/parse_auth.py', 'ATTACHMENT_FIELDS'), cloud);
});

test('AI 生成種類：前端、Cloud Code、中介層一致', () => {
  const kinds = (file, re) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    return [...re.exec(src)[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).sort();
  };
  const cloud = kinds('cloud/main.js', /GENERATION_JOB_KINDS = \[([^\]]+)\]/);
  assert.deepEqual(cloud, ['會議紀錄', '成果報告'].sort());
  assert.deepEqual(kinds('src/types.ts', /type GenerationJobKind = ([^\n]+)/), cloud);
  assert.deepEqual(kinds('server/main.py', /GENERATION_KINDS = \{([^}]+)\}/), cloud);
});
