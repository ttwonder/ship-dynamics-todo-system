import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Real PostgreSQL-in-WASM execution, never a hosted connection. The client
// integration added below uses an outbound-denying transport, not fabricated SQL.
const db = new PGlite();
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const clone = value => JSON.parse(JSON.stringify(value));
const workspace = 'record-fixture';
const actor = 'qa-owner';
const savedBy = 'TEST OWNER';
const at = '2026-09-06T00:00:00.000Z';
let passed = 0;
let failure = null;
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
const call = async (sql, params = []) => (await db.query(sql, params)).rows[0].result;
const read = async (key = workspace) => call('select public.read_ship_dynamics_records_v1($1) as result', [key]);
const importData = async (payload, key = workspace) => call('select public.import_ship_dynamics_records_v1($1,$2::jsonb) as result', [key, JSON.stringify(payload)]);
const allRows = async () => (await db.query(`select table_name,body from (
  select 'workspaces' as table_name,to_jsonb(w) as body from public.ship_dynamics_record_workspaces w
  union all select 'collections',to_jsonb(c) from public.ship_dynamics_record_collections c
  union all select 'records',to_jsonb(r) from public.ship_dynamics_records r
  union all select 'receipts',to_jsonb(r) from public.ship_dynamics_record_receipts r
  union all select 'read-bases',to_jsonb(r) from public.ship_dynamics_record_read_bases r
) state order by table_name,body::text`)).rows;
const issue = async (fn, request) => call(`select public.${fn}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as result`, [
  request.workspace ?? workspace, request.id, JSON.stringify(request.operations), request.savedBy ?? savedBy, request.actor ?? actor,
  request.guard === null ? null : JSON.stringify(request.guard), request.authorization == null ? null : JSON.stringify(request.authorization), JSON.stringify(request.locks),
]);
const apply = request => issue('apply_ship_dynamics_record_patch_v1', request);
const receipt = request => issue('get_ship_dynamics_record_receipt_v1', request);
const guardFor = async payload => call('select public.ship_dynamics_actor_guard($1::jsonb,$2) as result', [JSON.stringify(payload), actor]);
const lease = async (id, expires = "interval '75 seconds'") => db.query(`insert into public.ship_dynamics_edit_locks values($1,$2,$3,$4,now(),now()+${expires}) on conflict(workspace_key,section_key) do update set expires_at=excluded.expires_at,locked_by=excluded.locked_by`, [workspace, `vessel:${id}`, `lease-${id}`, savedBy]);
let buildPatch, applyDraft, maskDraft, withAudit;
const requestFor = async (payload, id, vesselId = 'v1') => {
  const next = clone(payload);
  const vessel = next.vessels.find(row => row.id === vesselId);
  const candidate = clone(vessel);
  candidate.note.recentDynamics = `SAVED ${id}`;
  candidate.note.updatedAt = at;
  // Same pure mutation and audit producer as App.saveVesselEditorDraft; no UI edit.
  applyDraft(vessel, maskDraft(vessel, candidate), at);
  const audited = withAudit(next, next.users.find(row => row.id === actor), '快速更新船舶', 'vessel', vesselId, '保存快速更新並關閉');
  // Only fixture identity/time are pinned; all business audit fields come from withAudit.
  audited.auditLogs[0].id = `audit-${id}`; audited.auditLogs[0].at = at;
  return { id, operations: buildPatch(payload, audited), guard: await guardFor(payload), locks: [{ section_key: `vessel:${vesselId}`, locked_by: `lease-${vesselId}` }] };
};
const rejectWithoutWrites = async (request, code) => {
  const before = await allRows();
  const result = await apply(request);
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.deepEqual(await allRows(), before, 'no entity/order/revision/receipt may survive rejection');
};
try {
  if (process.argv.includes('--probe-failure-exit')) throw new Error('QA_FAILURE_EXIT_PROBE');
  await db.exec('create role anon nologin; create role authenticated nologin;');
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  const sql = fs.readFileSync('supabase/development/20260906_appdata_record_store.sql', 'utf8');
  await db.exec(sql);
  const { createInitialData } = await vite.ssrLoadModule('/src/data/seed.ts');
  ({ buildCloudBlockPatch: buildPatch } = await vite.ssrLoadModule('/src/cloudBlockPatch.ts'));
  ({ applyVesselOperationalDraft: applyDraft, applyItineraryOperationalWriteMask: maskDraft } = await vite.ssrLoadModule('/src/vesselOperationalDraft.ts'));
  ({ withAudit } = await vite.ssrLoadModule('/src/utils.ts'));
  const payload = createInitialData();
  payload.revision = 1; payload.updatedAt = at;
  payload.users = [{ id: actor, department: 'QA', name: savedBy, username: actor, role: 'owner', passwordHash: '', isActive: true, managedVesselIds: ['v1','v2'], createdAt: at, updatedAt: at }];
  payload.vessels = ['v1','v2'].map(id => ({ ...clone(payload.vessels[0]), id, name: `TEST ${id}`, assignedUserIds: [], delegateManagers: [], updatedAt: at }));
  for (const name of ['tasks','internalControlCases','meetings','agendaReports','notifications','auditLogs']) payload[name] = [];
  delete payload.taskDismissals;
  payload.legacyExtension = { nested: ['原值', null, false], number: 2.5 };
  await check('lossless row import and exact AppData reconstruction, preserving absent keys', async () => {
    assert.equal((await importData(payload)).replayed, false);
    assert.deepEqual((await read()).payload, payload);
    assert.equal((await db.query('select count(*)::integer as count from public.ship_dynamics_app_state')).rows[0].count, 0);
  });
  await check('DDL rerun and exact import replay do not mutate the current authority', async () => {
    const before = await allRows(); await db.exec(sql);
    assert.equal((await importData(payload)).replayed, true);
    assert.deepEqual(await allRows(), before);
    await assert.rejects(importData({ ...payload, legacyExtension: { changed: true } }), /record-import-mismatch/);
    assert.deepEqual(await allRows(), before);
  });
  await check('malformed legacy IDs abort import atomically without coercion or deduplication', async () => {
    for (const vessels of [[{ id: 'dup' },{ id: 'dup' }], [{ id: 3 }], [{ id: '' }]]) {
      const before = await allRows();
      await assert.rejects(importData({ ...payload, vessels }, 'bad-import'), /invalid-record-id/);
      assert.deepEqual(await allRows(), before);
    }
  });
  await check('candidate routines and tables are not exposed to browser roles', async () => {
    const signatures = ['import_ship_dynamics_records_v1(text,jsonb)', 'read_ship_dynamics_records_v1(text)', 'get_ship_dynamics_record_receipt_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)', 'apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'];
    for (const role of ['anon','authenticated']) {
      for (const signature of signatures) assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed',[role,`public.${signature}`])).rows[0].allowed,false);
      assert.equal((await db.query("select has_table_privilege($1,'public.ship_dynamics_records','select,insert,update,delete') as allowed",[role])).rows[0].allowed,false);
    }
    await db.exec('set role anon');
    await assert.rejects(read(), /permission denied/);
    await db.exec('reset role');
  });
  await lease('v1'); await lease('v2');
  const first = await requestFor(payload, 'first');
  await check('real block-patch producer saves vessel + audit and leaves the other physical row untouched', async () => {
    const unrelated = (await db.query("select value,revision,xmin::text as xmin,ctid::text as ctid from public.ship_dynamics_records where collection='vessels' and entity_id='v2'")).rows;
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({ 'x-forwarded-for': '192.0.2.10', 'cf-ipcountry': 'TW' })]);
    const ack = await apply(first); assert.equal(ack.ok,true); assert.equal(ack.revision,2);
    const current = (await read()).payload;
    assert.equal(current.vessels[0].note.recentDynamics,'SAVED first');
    assert.equal(current.auditLogs[0].ipAddress,'192.0.2.10'); assert.equal(current.auditLogs[0].ipCountryCode,'TW');
    assert.deepEqual((await db.query("select value,revision,xmin::text as xmin,ctid::text as ctid from public.ship_dynamics_records where collection='vessels' and entity_id='v2'")).rows,unrelated);
    assert.equal((await db.query('select count(*)::integer as count from public.ship_dynamics_app_state')).rows[0].count,0);
  });
  await check('same operation returns original receipt after lease expiry; changed operation identity is rejected', async () => {
    await lease('v1', "interval '-1 second'"); const before = await allRows();
    assert.equal((await apply(first)).replayed,true); assert.equal((await receipt(first)).revision,2);
    assert.deepEqual(await allRows(),before);
    const changed = clone(first); changed.operations[0].value.note.recentDynamics='MISMATCH';
    await rejectWithoutWrites(changed,'operation-id-mismatch');
    assert.equal((await receipt(changed)).status,'mismatch'); await lease('v1');
  });
  await check('same-row stale CAS and late graph failure leave zero partial writes', async () => {
    await rejectWithoutWrites({ ...first,id:'stale' },'block-conflict');
    const request = await requestFor((await read()).payload,'bad-order');
    request.operations.find(op => op.kind==='order').valueIds.push('missing-audit');
    await rejectWithoutWrites(request,'invalid-order-result');
  });
  await check('wrong entity, wrong owner, missing and expired leases reject with no writes', async () => {
    const request = await requestFor((await read()).payload,'lock-case');
    await rejectWithoutWrites({ ...request, locks: [] },'lock-conflict');
    await rejectWithoutWrites({ ...request, locks: [{ section_key:'vessel:v2',locked_by:'lease-v2' }] },'lock-conflict');
    await rejectWithoutWrites({ ...request, locks: [{ section_key:'vessel:v1',locked_by:'WRONG' }] },'lock-conflict');
    await lease('v1', "interval '-1 second'"); await rejectWithoutWrites(request,'lock-conflict'); await lease('v1');
  });
  await check('actor guard and malformed operations fail closed, never falling back to the legacy blob', async () => {
    const request = await requestFor((await read()).payload,'guard-case');
    await rejectWithoutWrites({ ...request,guard:null },'authorization-conflict');
    const stale = clone(request.guard); stale.actor.isActive=false;
    await rejectWithoutWrites({ ...request,guard:stale },'authorization-conflict');
    const unsupported=clone(request); unsupported.operations[0].collection='unknown';
    await rejectWithoutWrites(unsupported,'invalid-collection');
    await rejectWithoutWrites({ ...request,operations:[{kind:'settings',expected:null,value:{}}] },'invalid-settings-operation');
  });
  await check('the second vessel saves from the latest baseline without overwriting the first', async () => {
    const before=(await read()).payload;
    const request=await requestFor(before,'second','v2');
    assert.equal((await apply(request)).ok,true);
    const after=(await read()).payload;
    assert.deepEqual(after.vessels[0],before.vessels[0]);
    assert.equal(after.vessels[1].note.recentDynamics,'SAVED second');
    assert.equal(after.auditLogs.length,2);
  });
  await check('post-edit import replay never resets saved rows; rejected audit forging and deletion are atomic', async () => {
    const before=await allRows(); assert.equal((await importData(payload)).replayed,true); assert.deepEqual(await allRows(),before);
    const current=(await read()).payload; const request=await requestFor(current,'forgery');
    const bad=clone(request); bad.operations.find(op=>op.kind==='entity'&&op.collection==='auditLogs').value.actorId='other';
    await rejectWithoutWrites(bad,'unaccompanied-audit');
    await rejectWithoutWrites({ ...request,operations:request.operations.filter(op=>op.collection!=='auditLogs') },'incomplete-vessel-audit-operation');
  });
  await check('SQL exception after row writes rolls back records, revision, orders and receipt together', async () => {
    const request=await requestFor((await read()).payload,'crash'); const before=await allRows();
    await db.exec("create function public.qa_reject_receipt() returns trigger language plpgsql as $$begin raise exception 'QA receipt failure'; end$$; create trigger qa_receipt_failure before insert on public.ship_dynamics_record_receipts for each row execute function public.qa_reject_receipt()");
    try { await assert.rejects(apply(request),/QA receipt failure/); assert.deepEqual(await allRows(),before); }
    finally { await db.exec('drop trigger qa_receipt_failure on public.ship_dynamics_record_receipts; drop function public.qa_reject_receipt()'); }
  });
  await check('no-op replay and duplicate operations preserve business state', async () => {
    const before = await read();
    const empty = { id:'empty',operations:[],guard:await guardFor(before.payload),locks:[] };
    assert.equal((await apply(empty)).revision,before.revision);
    assert.deepEqual(await read(),before);
    assert.equal((await apply(empty)).replayed,true);
    const duplicate=await requestFor(before.payload,'duplicate');
    duplicate.operations.push(clone(duplicate.operations.at(-1)));
    await rejectWithoutWrites(duplicate,'duplicate-operation');
  });
  await check('every changed vessel requires its own accompanying audit', async () => {
    const before=(await read()).payload;
    const request=await requestFor(before,'missing-second-audit');
    const second=await requestFor(before,'second-without-audit','v2');
    request.operations.unshift(second.operations.find(op=>op.collection==='vessels'));
    request.locks.push(...second.locks);
    await rejectWithoutWrites(request,'incomplete-vessel-audit-operation');
  });
  await check('same real UI mutation produces legacy-equivalent SQL content and audit side effects', async () => {
    const baseline=(await read()).payload;
    const request=await requestFor(baseline,'legacy-oracle');
    const oracle=new PGlite();
    try {
      await oracle.exec('create role anon nologin; create role authenticated nologin;');
      await oracle.exec(fs.readFileSync('supabase/schema.sql','utf8'));
      await oracle.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values ($1,$2::jsonb,$3)',[workspace,JSON.stringify(baseline),baseline.revision]);
      await oracle.query("insert into public.ship_dynamics_edit_locks values($1,'vessel:v1','lease-v1',$2,now(),now()+interval '75 seconds')",[workspace,savedBy]);
      await oracle.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-forwarded-for':'192.0.2.10','cf-ipcountry':'TW'})]);
      const legacy=(await oracle.query('select public.apply_ship_dynamics_block_patch_v2($1,$2,$3::jsonb,$4,$5,$6::jsonb,null,$7::jsonb) as result',[workspace,request.id,JSON.stringify(request.operations),savedBy,actor,JSON.stringify(request.guard),JSON.stringify(request.locks)])).rows[0].result;
      assert.equal(legacy.ok,true);
      const current=await apply(request); assert.equal(current.ok,true); assert.equal(current.revision,legacy.revision);
      const oldPayload=(await oracle.query('select payload from public.ship_dynamics_app_state where workspace_key=$1',[workspace])).rows[0].payload;
      const newPayload=(await read()).payload;
      assert.ok(Number.isFinite(Date.parse(oldPayload.updatedAt))&&Number.isFinite(Date.parse(newPayload.updatedAt)));
      // Separate commits have different wall clocks; every other JSON value must agree.
      assert.deepEqual({...newPayload,updatedAt:'SERVER_COMMIT_CLOCK'},{...oldPayload,updatedAt:'SERVER_COMMIT_CLOCK'});
      assert.equal(newPayload.auditLogs[0].action,'快速更新船舶'); assert.equal(newPayload.auditLogs[0].detail,'保存快速更新並關閉');
      assert.equal((await db.query('select count(*)::integer as count from public.ship_dynamics_app_state')).rows[0].count,0,'record path did not dual-write legacy');
    } finally { await oracle.close(); }
  });
  await check('existing 500-row audit retention removes only the oldest fixture alongside the vessel save', async () => {
    const key='retention-fixture'; const baseline=clone(payload);
    baseline.auditLogs=Array.from({length:500},(_,i)=>({id:`old-${String(i).padStart(3,'0')}`,at,actorId:actor,actorName:savedBy,actorRole:'owner',action:'歷史測試',entityType:'vessel',entityId:'v1',detail:'保留不改',ipAddress:'192.0.2.1',ipCountryCode:'TW'}));
    await importData(baseline,key);
    await db.query("insert into public.ship_dynamics_edit_locks values($1,'vessel:v1','lease-v1',$2,now(),now()+interval '75 seconds')",[key,savedBy]);
    const request={...await requestFor(baseline,'retention-save'),workspace:key};
    const {assertActorAuthorizedForCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudAuthorization.ts');
    assertActorAuthorizedForCloudBlockPatch(baseline,request.operations,actor);
    assert.equal((await apply(request)).ok,true);
    const saved=(await read(key)).payload;
    assert.equal(saved.auditLogs.length,500); assert.equal(saved.auditLogs[0].id,'audit-retention-save');
    assert.deepEqual(saved.auditLogs.slice(1),baseline.auditLogs.slice(0,499));
    assert.equal(saved.vessels[0].note.recentDynamics,'SAVED retention-save');
  });
  const sqlCases = passed;
  const { verifyRecordAdapter } = await import('./verify-cloud-record-adapter.mjs');
  await verifyRecordAdapter({ db, vite, payload, workspace, requestFor, read, apply, receipt, check });
  console.log(JSON.stringify({ record_store_sql:'PASS',sqlCases,adapterCases:passed-sqlCases,totalCases:passed,hostedSupabase:'NOT_RUN',realMultiConnection:'NOT_RUN',legacyWrites:0 }));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, detail: error.detail, where: error.where, actual: error.actual, expected: error.expected }));
  failure = error;
} finally { await vite.close(); await db.close(); }
// PGlite disposal may reset process.exitCode. Publish the verdict after cleanup.
if (failure) process.exitCode = 1;
