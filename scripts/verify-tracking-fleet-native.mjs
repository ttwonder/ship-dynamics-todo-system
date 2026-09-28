import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';
import { createRecordStorageLocalQa } from './record-storage-local-qa.mjs';
import { installTrackingBrowserMigrations, installTrackingFieldRevision } from './tracking-browser-fixture.mjs';
const root = process.env.QA_EVIDENCE_ROOT; assert.ok(root && path.isAbsolute(root));
const output = fs.mkdtempSync(path.join(root, 'tracking-fleet-native-'));
const evidence = { label: 'Native PostgreSQL＋測試資料，非正式環境', cases: [], productionContacted: false }; let native, qa, failure;
const check = async (name, run) => { await run(); evidence.cases.push(name); console.log('PASS', name); };
try {
  native = await createNativeRecordQa(output, evidence, { httpTransactions: true });
  qa = await createRecordStorageLocalQa({ internalControl: true, browserAuthority: true, scopedRead: true, shipInternalControl: true, tracking: true, taskMember: true, databaseFactory: async () => native.adapter });
  await installTrackingBrowserMigrations(qa.db); await installTrackingFieldRevision(qa.db, { fleetStatistics: false });
  const migration = 'supabase/migrations/20260927130000_tracking_fleet_statistics.sql';
  const publicCatalog = async () => (await qa.db.query("select md5(string_agg(oid::text||pg_get_functiondef(oid)||coalesce(proacl::text,''),E'\\n' order by oid)) value from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname<>'read_ship_dynamics_tracking_statistics_public_v1'")).rows[0].value;
  const prior = await publicCatalog(), beforeInstall = await qa.read();
  assert.equal((await qa.db.query("select to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)') value")).rows[0].value,null);
  let sql=fs.readFileSync(migration,'utf8');
  if(process.argv.includes('--crlf-install'))sql=sql.replace(/\r?\n/g,'\r\n');
  await qa.db.exec(sql); await qa.db.exec(sql);
  assert.equal(await publicCatalog(), prior); assert.deepEqual(await qa.read(), beforeInstall);
  await check('operator-readback-exact-body-ACL-prerequisites',async()=>{
    const result=await qa.db.exec(fs.readFileSync('supabase/verification/tracking-fleet-statistics-readback.sql','utf8'));
    const rows=(Array.isArray(result)?result:[result]).flatMap(r=>r.rows||[]);
    assert.deepEqual(rows,[{status:'PASS',checks:'6',failures:[]}]);
    evidence.readback=rows;assert.deepEqual(await qa.read(),beforeInstall);
  });
  const query = { from: '', to: '', type: 'all', urgency: 'all' };
  let statisticsRpc='read_ship_dynamics_tracking_statistics_public_v1';
  const rpc = (scope, filters = query, workspace = qa.workspace) => qa.db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select public.${statisticsRpc}($1,$2::jsonb,$3::jsonb) result`, [workspace, JSON.stringify(scope), JSON.stringify(filters)])).rows[0].result; });
  await check('additive-idempotent-anonymous-summary-only', async () => {
    let result; try { result = await rpc({ kind: 'all', value: '' }); } catch (e) { assert.fail('Anonymous fleet statistics must return a confirmed summary: ' + e.message); }
    assert.deepEqual(Object.keys(result).sort(), ['protocol', 'workspace', 'vessels', 'vesselIds', 'at', 'today', 'stats'].sort());
    assert.deepEqual(Object.keys(result.stats).sort(), ['categories', 'summary']); assert.equal(result.stats.categories.length, 6);
    for (const v of result.vessels) assert.deepEqual(Object.keys(v).sort(), ['id', 'name', 'shortName', 'fullName', 'shipType', 'fleetCategory'].sort());
    const dbToday = (await qa.db.query("select to_char(clock_timestamp() at time zone 'Asia/Taipei','YYYY-MM-DD') today")).rows[0].today; assert.equal(result.today, dbToday);
  });
  await check('v2-upgrade-idempotent-exact-readback-and-unchanged-business',async()=>{
    const before=await qa.read();let sql=fs.readFileSync('supabase/migrations/20260928140000_tracking_annual_types.sql','utf8');
    if(process.argv.includes('--crlf-install'))sql=sql.replace(/\r?\n/g,'\r\n');
    await qa.db.exec(sql);await qa.db.exec(sql);assert.deepEqual(await qa.read(),before);
    const result=await qa.db.exec(fs.readFileSync('supabase/verification/tracking-annual-types-readback.sql','utf8'));
    const rows=result.flatMap(r=>r.rows||[]);assert.deepEqual(rows,[{status:'PASS',checks:'6',failures:[]}]);evidence.annualReadback=rows;
  });
  await check('reclassification-upgrade-preserves-statistics-and-readback',async()=>{
    const before=await qa.read();let sql=fs.readFileSync('supabase/migrations/20260928180000_tracking_reclassification.sql','utf8');
    if(process.argv.includes('--crlf-install'))sql=sql.replace(/\r?\n/g,'\r\n');
    await qa.db.exec(sql);assert.deepEqual(await qa.read(),before);
    const rows=(await qa.db.exec(fs.readFileSync('supabase/verification/tracking-reclassification-readback.sql','utf8'))).flatMap(r=>r.rows||[]);
    assert.deepEqual(rows,[{status:'PASS',checks:'9',failures:[]}]);evidence.reclassificationReadback=rows;
  });
  statisticsRpc='read_ship_dynamics_tracking_statistics_public_v2';
  const today=(await rpc({kind:'all',value:''})).today;
  const row = (id, patch = {}) => ({ id, vesselId: 'qa-v1', kind: 'supply', requestType: 'spares', referenceNo: 'PRIVATE NUMBER', description: 'PRIVATE CONTENT', applicationDate: '2026-09-15', expectedDate: '2020-01-01', urgency: 'normal', deliveryStatus: 'not-delivered', isClosed: false, progress: 'PRIVATE PROGRESS', statusLogs: [], ...patch });
  const fixture = [row('stat-a', { deliveryStatus: 'delivered', actualDeliveryDate: '2020-01-01' }), row('stat-b', { vesselId: 'qa-v2', urgency: 'urgent' }), row('stat-c', { isClosed: true, closureOutcome: 'cancelled' }), row('stat-d', { kind: 'engineering', requestType: 'repair', completionDate: '2026-09-20' }), row('stat-e', { kind: 'engineering', requestType: 'drydock', completionDate: 'bad', expectedDate: '2099-01-01' }), row('stat-f', { requestType: 'semiannual-materials', deliveryStatus: 'partially-delivered', expectedDate: '' }), row('stat-g', { requestType: 'temporary-materials', deliveryStatus: 'delivered', expectedDate: '2026-09-01' }), row('stat-h', { kind: 'engineering', requestType: 'spares', completionDate: '2026-09-01', applicationDate: '2026-02-30', expectedDate: '' }), row('stat-closed', { isClosed: true, closureOutcome: 'completed' }), row('stat-off', { vesselId: 'qa-off' }), row('stat-detached')];
  fixture.push(row('annual-due-today',{kind:'engineering',requestType:'annual-inspection',expectedDate:today}),
    row('annual-late-open',{kind:'engineering',requestType:'annual-inspection'}),
    row('annual-on-time',{kind:'engineering',requestType:'annual-inspection',completionDate:'2020-01-01'}),
    row('annual-late-done',{kind:'engineering',requestType:'annual-inspection',completionDate:'2020-01-02'}),
    row('annual-cancelled',{kind:'engineering',requestType:'annual-inspection',isClosed:true,closureOutcome:'cancelled'}),
    row('annual-blank',{kind:'engineering',requestType:'annual-inspection',expectedDate:''}),
    row('annual-invalid',{kind:'engineering',requestType:'annual-inspection',expectedDate:'2026-02-30'}),
    row('dock-spares',{requestType:'drydock-spares'}),row('dock-materials',{requestType:'drydock-materials'}));
  await qa.db.transaction(async tx => {
    await tx.query("update ship_dynamics_records set value=value||jsonb_build_object('shipType',case when entity_id='qa-v1' then '巴拿馬散' else '成品油' end,'fleetCategory',case when entity_id='qa-v1' then 'bulk fleet' else 'tanker fleet' end) where workspace_key=$1 and collection='vessels'", [qa.workspace]);
    await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) select workspace_key,collection,'qa-off',value||'{\"id\":\"qa-off\",\"isActive\":false}'::jsonb,revision from ship_dynamics_records where workspace_key=$1 and collection='vessels' and entity_id='qa-v1'", [qa.workspace]);
    await tx.query("update ship_dynamics_record_collections set ids=ids||'[\"qa-off\"]'::jsonb where workspace_key=$1 and collection='vessels'", [qa.workspace]);
    await tx.query("insert into ship_dynamics_record_collections(workspace_key,collection,ids) values($1,'trackingItems','[]') on conflict do nothing", [qa.workspace]);
    for (const item of fixture) await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'trackingItems',$2,$3::jsonb,1)", [qa.workspace, item.id, JSON.stringify(item)]);
    await tx.query("update ship_dynamics_record_collections set ids=ids||$2::jsonb where workspace_key=$1 and collection='trackingItems'", [qa.workspace, JSON.stringify(fixture.filter(r => r.id !== 'stat-detached').map(r => r.id))]);
  });
  const baseline = await qa.read(), api = await qa.loadModule('/src/tracking/trackingStatistics.ts'), scopeApi = await qa.loadModule('/src/tracking/trackingStatisticsScope.ts');
  const scopes = [{ kind: 'all', value: '' }, { kind: 'fleet', value: 'bulk fleet' }, { kind: 'fleet', value: 'tanker fleet' }, { kind: 'type', value: '巴拿馬散' }, { kind: 'type', value: 'missing' }, { kind: 'vessel', value: 'qa-v2' }];
  await check('SQL-TS-parity-all-fleet-type-single-filters-and-unknown-dates', async () => {
    for (const scope of scopes) for (const filters of [query, ...['materials','annual-inspection','drydock-spares','drydock-materials'].map(type=>({...query,type})), { ...query, type: 'engineering' }, { ...query, urgency: 'urgent' }, { ...query, from: '2026-09-01', to: '2026-09-30' }]) {
      const result = await rpc(scope, filters), vesselIds = scopeApi.resolveStatisticsVessels(result.vessels, scope);
      assert.deepEqual(result.vesselIds, vesselIds);assert.equal(result.protocol,'ship-tracking-statistics-v2');assert.equal(result.stats.categories.length,9);scopeApi.parseStatisticsSnapshot(result,qa.workspace,scope);
      const expected = api.calculateTrackingStatistics(baseline.payload.trackingItems, { ...filters, vesselId: '', vesselIds }, result.today);
      assert.deepEqual(result.stats, { summary: expected.summary, categories: expected.categories }, JSON.stringify([scope, filters]));
      assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!result.vesselIds.includes('qa-off'));
    }
    assert.deepEqual(await qa.read(), baseline);
  });
  await check('annual-expiry-subset-v1-remains-six-categories-with-complete-total',async()=>{
    const v2=await rpc(scopes[0]),a=v2.stats.categories.find(c=>c.value==='annual-inspection').summary;
    assert.equal(a.total,7);assert.equal(a.cancelled,1);assert.equal(a.overdueIncomplete,1);assert.equal(a.overdueCompleted,1);assert.equal(a.noDeadline,2);assert.equal(a.notYetDue,1);assert.equal(a.delayEligible,3);assert.equal(a.delayRate,2/3);
    statisticsRpc='read_ship_dynamics_tracking_statistics_public_v1';
    try{const old=await rpc(scopes[0]);assert.equal(old.protocol,'ship-tracking-statistics-v1');assert.equal(old.stats.categories.length,6);assert.deepEqual(old.stats.summary,v2.stats.summary);assert.throws(()=>scopeApi.parseStatisticsSnapshot(old,qa.workspace,scopes[0]));
      const newTypes=['annual-inspection','drydock-spares','drydock-materials','unclassified'];
      assert.equal(old.stats.categories.find(c=>c.value==='unclassified').summary.total,v2.stats.categories.filter(c=>newTypes.includes(c.value)).reduce((n,c)=>n+c.summary.total,0));
    }finally{statisticsRpc='read_ship_dynamics_tracking_statistics_public_v2';}
    assert.deepEqual(await qa.read(),baseline);
  });
  await check('invalid-scope-query-workspace-and-direct-table-access-fail-closed', async () => {
    for (const s of [{ kind: 'all', value: '', extra: true }, { kind: 'invalid', value: '' }, { kind: 'fleet', value: 'unknown' }, { kind: 'vessel', value: 'qa-off' }]) await assert.rejects(() => rpc(s));
    for (const q of [{ ...query, from: '2026-02-30' }, { ...query, from: '2026-10-01', to: '2026-09-01' }, { ...query, type: 'wrong' }, { ...query, details: true }]) await assert.rejects(() => rpc(scopes[0], q));
    await assert.rejects(() => rpc(scopes[0], query, 'different-workspace'));
    await assert.rejects(() => qa.db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query('select * from public.ship_dynamics_records'); }), /permission denied/);
    assert.deepEqual(await qa.read(), baseline);
  });
} catch (e) { failure = String(e.stack || e); }
finally { if (qa) await qa.close().catch(() => {}); if (native) await native.close().catch(e => { failure ||= String(e); evidence.cleanupError = String(e); }); }
evidence.failure = failure || null; evidence.status = failure ? 'FAIL' : 'PASS';
fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ output, status: evidence.status, cases: evidence.cases, failure })); if (failure) process.exitCode = 1;
