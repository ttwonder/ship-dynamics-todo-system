import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Owner-only in-memory SQL, synthetic fixtures, no remote URL or credentials.
const db = new PGlite();
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const key = 'history-fixture', actor = 'qa-owner', at = '2026-09-06T00:00:00.000Z';
const results = [], snapshots = new Map();
let failure;
const clone = structuredClone;
const query = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.result;
const full = async () => (await query('select read_ship_dynamics_records_v1($1) as result', [key])).payload;
const history = revision => query('select read_ship_dynamics_record_history_v1($1,$2) as result', [key, revision]);
const state = async () => (await db.query(`select kind,value from (
  select 'workspace' kind,to_jsonb(t) value from ship_dynamics_record_workspaces t
  union all select 'collections',to_jsonb(t) from ship_dynamics_record_collections t
  union all select 'records',to_jsonb(t) from ship_dynamics_records t
  union all select 'receipts',to_jsonb(t) from ship_dynamics_record_receipts t
  union all select 'read-bases',to_jsonb(t) from ship_dynamics_record_read_bases t
  union all select 'versions',to_jsonb(t) from ship_dynamics_record_versions t
  union all select 'history',to_jsonb(t) from ship_dynamics_record_history t
  union all select 'task-progress',to_jsonb(t) from public.ship_dynamics_record_task_progress t
  union all select 'task-progress-history',to_jsonb(t) from public.ship_dynamics_record_task_progress_history t
) s order by kind,value::text`)).rows;
const archive = async () => (await state()).filter(row => ['versions', 'history', 'task-progress-history'].includes(row.kind));
const rollbackProbe = async fn => { await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } };
const check = async (name, fn) => { await fn(); results.push(name); console.log('PASS ' + name); };
const verifyAll = async () => {
  for (const [revision, payload] of snapshots) {
    const result = await history(revision);
    assert.equal(result.status, 'snapshot'); assert.equal(result.revision, revision);
    assert.equal(result.workspace_key, key); assert.deepEqual(result.payload, payload);
  }
};
let buildPatch, authorized;
const apply = request => query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as result', request);
const make = async (id, mutate, keys = []) => {
  const base = await full(), next = clone(base); mutate(next);
  const operations = buildPatch(base, next); authorized(base, operations, actor);
  const guard = await query('select ship_dynamics_actor_guard($1::jsonb,$2) as result', [JSON.stringify(base), actor]);
  const auth = await query('select ship_dynamics_authorization_guard($1::jsonb) as result', [JSON.stringify(base)]);
  for (const section of keys) await db.query("insert into ship_dynamics_edit_locks values($1,$2,'qa-lease','QA OWNER',now(),now()+interval '10 minutes') on conflict(workspace_key,section_key) do update set expires_at=excluded.expires_at", [key, section]);
  return [key, id, JSON.stringify(operations), 'QA OWNER', actor, JSON.stringify(guard), JSON.stringify(auth), JSON.stringify(keys.map(section_key => ({ section_key, locked_by: 'qa-lease' })))];
};
const save = async (...args) => {
  const request = await make(...args), result = await apply(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  const payload = await full(); assert.equal(payload.revision, result.revision);
  snapshots.set(result.revision, clone(payload)); return request;
};
try {
  if (process.argv.includes('--probe-failure-exit')) throw new Error('QA_HISTORY_FAILURE_EXIT_PROBE');
  await db.exec('create role anon nologin; create role authenticated nologin;');
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  const legacyCatalog = async () => (await db.query(`select c.relname,c.relrowsecurity,c.relacl::text,
    (select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
      and c.relname not like 'ship_dynamics_record%' order by c.relname`)).rows;
  const legacyBeforeDDL = await legacyCatalog();
  await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_delta.sql', 'utf8'));
  const { createInitialData } = await vite.ssrLoadModule('/src/data/seed.ts');
  ({ buildCloudBlockPatch: buildPatch } = await vite.ssrLoadModule('/src/cloudBlockPatch.ts'));
  ({ assertActorAuthorizedForCloudBlockPatch: authorized } = await vite.ssrLoadModule('/src/cloudAuthorization.ts'));
  const base = createInitialData(); base.revision = 1; base.updatedAt = at;
  base.users = [{ id: actor, name: 'QA OWNER', username: actor, department: '督導', role: 'owner', isActive: true, managedVesselIds: [], passwordHash: '', createdAt: at, updatedAt: at }];
  base.vessels = ['v1', 'v2'].map(id => ({ ...clone(base.vessels[0]), id, assignedUserIds: [], delegateManagers: [] }));
  const taskId = ' 0007:原-ID ', untouchedId = '0007';
  base.tasks = [taskId, untouchedId].map(id => ({ id, vesselId: 'v1', vesselIds: ['v1'], description: '原值', priority: '低', isAware: false, isAbnormal: false, isInternalControl: false, category: '其他', categories: ['其他'], status: '處理中', statusLogs: [], expectedDate: '', reportDate: '2026-09-06', departments: ['督導'], ownerUserIds: [], isClosed: false, sourceType: 'morning', createdBy: actor, updatedBy: actor, createdAt: at, updatedAt: at, unknownRow: { nested: [null, false, '保留'] } }));
  for (const name of ['internalControlCases', 'meetings', 'agendaReports', 'notifications', 'auditLogs']) base[name] = [];
  delete base.taskDismissals;
  base.unknownRoot = { nested: [null, false, '保留'] };
  await query('select import_ship_dynamics_records_v1($1,$2::jsonb) as result', [key, JSON.stringify(base)]);
  await db.query('insert into ship_dynamics_app_state(workspace_key,payload,revision) values($1,$2::jsonb,1)', [key, JSON.stringify({ ...base, unknownRoot: { legacyAuthority: true } })]);
  await db.query("insert into ship_dynamics_app_revisions(workspace_key,revision,payload,saved_by) values($1,0,'{\"legacyHistory\":\"保留原地\"}','QA') on conflict do nothing", [key]);
  const legacyRows = async () => (await db.query(`select kind,value from (
    select 'state' kind,to_jsonb(t) value from ship_dynamics_app_state t
    union all select 'history',to_jsonb(t) from ship_dynamics_app_revisions t
    union all select 'operations',to_jsonb(t) from ship_dynamics_block_operations t
  ) s order by kind,value::text`)).rows;
  const legacyBefore = await legacyRows();
  const untouched = async () => (await db.query("select value,revision,xmin::text,ctid::text from ship_dynamics_records where workspace_key=$1 and collection='tasks' and entity_id=$2", [key, untouchedId])).rows;
  const untouchedBefore = await untouched();
  snapshots.set(base.revision, clone(base));
  await check('same row edited twice retains exact imported and committed AppData at every revision', async () => {
    for (const text of ['第一次', '第二次']) await save(text, draft => { draft.tasks[0].description = text; }, ['task:' + taskId]);
    await verifyAll();
  });
  await check('settings, order-only revision and first optional collection preserve all prior versions', async () => {
    const { withAudit } = await vite.ssrLoadModule('/src/utils.ts');
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-forwarded-for': '192.0.2.50', 'cf-ipcountry': 'TW' })]);
    await save('settings', draft => {
      draft.settings.taskCategories.push('歷史設定');
      Object.assign(draft, withAudit(draft, draft.users[0], '更新設定', 'settings', 'settings', '本機歷史驗證'));
    });
    assert.equal((await full()).auditLogs[0].ipAddress, '192.0.2.50');
    const bodiesBefore = (await archive()).filter(row => row.kind === 'history');
    await save('order', draft => { draft.tasks.reverse(); draft.vessels.reverse(); });
    assert.deepEqual((await archive()).filter(row => row.kind === 'history'), bodiesBefore, 'order only must archive no body');
    await save('optional', draft => { draft.taskDismissals = [{ id: ' d:001 ', itemKind: 'task', itemId: taskId, userId: actor, dismissedBy: actor, dismissedAt: at }]; });
    assert.equal(Object.hasOwn((await history(1)).payload, 'taskDismissals'), false);
    await verifyAll();
  });
  await check('real linked case/task helper update reconstructs both endpoints and audit at each revision', async () => {
    const ic = await vite.ssrLoadModule('/src/internalControlData.ts');
    await save('linked-create', draft => {
      ic.createInternalControlCases(draft, [{ id: ' case:原01 ', vesselId: 'v1', reportDate: '2026-09-06', reportSource: '訪船', description: '聯動原值', priority: '高', category: '船舶管理', isAware: true, status: '安排處理', departments: ['督導'], syncToTask: true, isClosed: false, createdBy: actor, updatedBy: actor, createdAt: at, updatedAt: at, statusLogs: [], unknownCase: ['原值'] }], draft.users[0], at, { ' case:原01 ': { categories: ['船舶管理'], expectedDate: '', ownerUserIds: [], isAbnormal: false } });
    }, ['internal-control-create:history']);
    const item = (await full()).internalControlCases[0];
    await save('linked-update', draft => {
      ic.updateInternalControlCase(draft, { ...draft.internalControlCases[0], description: '聯動新版' }, item.updatedAt, draft.users[0], '2026-09-06T01:00:00.000Z');
    }, ['internal-control:' + item.id, 'task:' + item.linkedTaskId]);
    const latest = await full(); assert.equal(latest.tasks.find(t => t.id === item.linkedTaskId).description, '聯動新版');
    await verifyAll();
  });
  await check('delete then reuse the exact string ID creates distinct, non-overlapping lifetimes', async () => {
    const original = clone((await full()).tasks.find(t => t.id === taskId));
    await save('delete', draft => { draft.tasks = draft.tasks.filter(t => t.id !== taskId); }, ['task:' + taskId]);
    const deletedRevision = (await full()).revision;
    await save('reuse', draft => { draft.tasks.push({ ...original, description: '同ID新生命', unknownRow: { replacement: true } }); }, ['task-create:v2:v1:' + taskId]);
    await save('reuse-edit', draft => { draft.tasks.find(t => t.id === taskId).description = '新生命再更新'; }, ['task:' + taskId]);
    const intervals = (await db.query("select valid_from_revision f,valid_to_revision t,value from ship_dynamics_record_history where workspace_key=$1 and collection='tasks' and entity_id=$2 order by valid_from_revision", [key, taskId])).rows;
    assert.deepEqual(intervals.map(i => [i.f, i.t]), [[1, 2], [2, 3], [3, deletedRevision], [deletedRevision + 1, deletedRevision + 2]]);
    assert.equal((await history(deletedRevision)).payload.tasks.some(t => t.id === taskId), false);
    assert.equal((await history(deletedRevision + 1)).payload.tasks.find(t => t.id === taskId).description, '同ID新生命');
    await verifyAll();
  });
  await check('only changed bodies are archived; original IDs, unknown fields and untouched physical row survive', async () => {
    assert.deepEqual(await untouched(), untouchedBefore);
    assert.equal((await db.query('select count(*)::integer n from ship_dynamics_record_history where workspace_key=$1 and entity_id=$2', [key, untouchedId])).rows[0].n, 0);
    assert.deepEqual((await history(1)).payload, base);
    assert.deepEqual((await full()).unknownRoot, base.unknownRoot);
    assert.deepEqual((await history(3)).payload.tasks[0].unknownRow, base.tasks[0].unknownRow);
  });
  await check('receipt-stage SQL exception rolls back body history, metadata and all record transaction effects', async () => {
    const request = await make('crash', draft => { draft.tasks.find(t => t.id === taskId).description += '不得留下'; draft.settings.taskCategories.push('不得留下'); draft.tasks.reverse(); }, ['task:' + taskId]);
    const before = await state();
    const count = (await db.query('select count(*)::integer n from ship_dynamics_record_history')).rows[0].n;
    await db.exec(`create function qa_history_crash() returns trigger language plpgsql as $$begin
      if (select count(*) from ship_dynamics_record_history)<=${count} then raise exception 'QA_HISTORY_WAS_NOT_WRITTEN'; end if;
      if not exists(select 1 from ship_dynamics_record_versions where workspace_key=new.workspace_key and revision=(new.result->>'revision')::integer) then raise exception 'QA_VERSION_WAS_NOT_WRITTEN'; end if;
      raise exception 'QA_HISTORY_LATE_EXCEPTION'; end$$;
      create trigger qa_history_crash before insert on ship_dynamics_record_receipts for each row execute function qa_history_crash()`);
    try { await assert.rejects(apply(request), /QA_HISTORY_LATE_EXCEPTION/); assert.deepEqual(await state(), before); await verifyAll(); }
    finally { await db.exec('drop trigger qa_history_crash on ship_dynamics_record_receipts; drop function qa_history_crash()'); }
  });
  await check('lost ACK exact replay after lease expiry and no-op commit add no history', async () => {
    const request = await make('lost-ack', draft => { draft.tasks.find(t => t.id === taskId).description += ' lost ACK'; }, ['task:' + taskId]);
    await apply(request); // Deliberately discard the committed acknowledgement.
    const committed = await full(); snapshots.set(committed.revision, clone(committed));
    const before = await state();
    await db.exec("update ship_dynamics_edit_locks set expires_at=now()-interval '1 second'");
    const replay = await apply(request); assert.equal(replay.ok, true); assert.equal(replay.replayed, true); assert.equal(replay.revision, committed.revision);
    assert.deepEqual(await state(), before);
    const historyBefore = await archive(); const noop = await make('noop', () => {});
    assert.equal((await apply(noop)).revision, committed.revision); assert.equal((await apply(noop)).replayed, true);
    assert.deepEqual(await archive(), historyBefore); await verifyAll();
  });
  await check('pruned delta bases require a real snapshot without pruning durable history', async () => {
    await db.query('delete from ship_dynamics_record_read_bases where workspace_key=$1', [key]);
    const delta = await query('select read_ship_dynamics_record_delta_v1($1,1,$2) as result', [key, 'missing-base']);
    assert.equal(delta.status, 'snapshot'); assert.deepEqual(delta.payload, await full()); await verifyAll();
  });
  await check('missing revision metadata never succeeds or fabricates current/legacy payload', async () => {
    for (const revision of [0, -1, null, (await full()).revision + 1]) {
      const missing = await history(revision); assert.equal(missing.status, 'missing'); assert.equal(Object.hasOwn(missing, 'payload'), false);
    }
    await rollbackProbe(async () => {
      await db.query('delete from ship_dynamics_record_versions where workspace_key=$1 and revision=2', [key]);
      const missing = await history(2); assert.equal(missing.status, 'missing'); assert.equal(Object.hasOwn(missing, 'payload'), false);
    });
  });
  await check('missing body and ambiguous lifetime fail closed rather than returning partial AppData', async () => {
    await rollbackProbe(async () => {
      await db.query('delete from ship_dynamics_record_history where workspace_key=$1 and entity_id=$2 and valid_from_revision=1', [key, taskId]);
      await assert.rejects(history(1), /record-history-incomplete/);
    });
    await rollbackProbe(async () => {
      await db.query('insert into ship_dynamics_record_history(workspace_key,collection,entity_id,valid_from_revision,valid_to_revision,value,task_progress_meta) select workspace_key,collection,entity_id,0,2,value,task_progress_meta from ship_dynamics_record_history where workspace_key=$1 and entity_id=$2 and valid_from_revision=1', [key, taskId]);
      await assert.rejects(history(1), /record-history-incomplete/);
    });
    await verifyAll();
  });
  await check('DDL/import replay is history-neutral and legacy tables/schema/ACL remain unchanged', async () => {
    const before = await state();
    await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql', 'utf8'));
    assert.equal((await query('select import_ship_dynamics_records_v1($1,$2::jsonb) as result', [key, JSON.stringify(base)])).replayed, true);
    assert.deepEqual(await state(), before); assert.deepEqual(await legacyRows(), legacyBefore); assert.deepEqual(await legacyCatalog(), legacyBeforeDDL);
    assert.deepEqual(await untouched(), untouchedBefore);
    await verifyAll();
  });
  await check('history tables use RLS and invoker function has no PUBLIC/anon/authenticated access', async () => {
    const tables = ['ship_dynamics_record_versions', 'ship_dynamics_record_history'];
    for (const table of tables) assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [table])).rows[0].relrowsecurity, true);
    const signature = 'read_ship_dynamics_record_history_v1(text,integer)';
    const catalog = (await db.query("select prosecdef,provolatile,proconfig,(select count(*)::integer from aclexplode(coalesce(proacl,acldefault('f',proowner))) where grantee=0 and privilege_type='EXECUTE') public_execute from pg_proc where oid=$1::regprocedure", [signature])).rows[0];
    assert.equal(catalog.prosecdef, false); assert.equal(catalog.provolatile, 's'); assert.equal(catalog.public_execute, 0); assert.ok(catalog.proconfig.includes('search_path=pg_catalog, public'));
    for (const role of ['anon', 'authenticated']) {
      for (const table of tables) assert.equal((await db.query("select has_table_privilege($1,$2,'select,insert,update,delete,truncate,references,trigger') allowed", [role, table])).rows[0].allowed, false);
      assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0].allowed, false);
      await db.exec('set role ' + role);
      try { await assert.rejects(history(1), /permission denied/); for (const table of tables) await assert.rejects(db.query('select * from ' + table), /permission denied/); }
      finally { await db.exec('reset role'); }
    }
  });
  const storedRevisions = (await db.query('select revision from ship_dynamics_record_versions where workspace_key=$1 order by revision', [key])).rows.map(row => row.revision);
  assert.deepEqual(storedRevisions, [...snapshots.keys()].sort((a, b) => a - b), 'every stored revision is included in full reconstruction assertions');
  console.log(JSON.stringify({ recordHistory: 'PASS', cases: results.length, reconstructedRevisions: snapshots.size, storedRevisions, results, hosted: 'NOT_RUN', browser: 'NOT_RUN', realMultiConnection: 'NOT_RUN' }));
} catch (error) {
  failure = error; console.error(JSON.stringify({ error: error.message, code: error.code, where: error.where, stack: error.stack, actual: error.actual, expected: error.expected }));
} finally { await vite.close(); await db.close(); }
// PGlite close can reset process.exitCode: publish failure only after cleanup.
if (failure) process.exitCode = 1;
