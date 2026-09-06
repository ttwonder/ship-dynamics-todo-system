import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Owner-only in-memory SQL, synthetic fixtures, no remote URL or credentials.
const db = new PGlite();
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const key = 'data-management-fixture', actor = 'qa-owner', at = '2026-09-06T00:00:00.000Z';
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
) s order by kind,value::text`)).rows;
const archive = async () => (await state()).filter(row => ['versions', 'history'].includes(row.kind));
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
  if (process.argv.includes('--probe-failure-exit')) throw new Error('QA_DATA_MANAGEMENT_FAILURE_EXIT_PROBE');
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
  await db.exec(fs.readFileSync('supabase/migrations/20260817143000_data_management_storage.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260818003000_data_management_storage_timeout_fix.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_data_management.sql','utf8'));
  const legacyBefore = await legacyRows();
  const untouched = async () => (await db.query("select value,revision,xmin::text,ctid::text from ship_dynamics_records where workspace_key=$1 and collection='tasks' and entity_id=$2", [key, untouchedId])).rows;
  const untouchedBefore = await untouched();
  snapshots.set(base.revision, clone(base));

  for(let n=2;n<=7;n++) await save('seed-'+n,draft=>{draft.tasks[0].description='revision '+n;},['task:'+taskId]);
  const stats=()=>query('select get_ship_dynamics_record_storage_stats_v1($1,$2) as result',[key,actor]);
  const prune=(expected,selected,operation=crypto.randomUUID(),who=actor,workspace=key)=>query('select prune_ship_dynamics_record_revision_history_v1($1,$2,$3::uuid,$4::jsonb,$5::jsonb) as result',[workspace,who,operation,JSON.stringify(expected),JSON.stringify(selected)]);
  const all=()=>[...snapshots.keys()].sort((a,b)=>a-b);
  const untouchedTables=['ship_dynamics_record_workspaces','ship_dynamics_record_collections','ship_dynamics_records','ship_dynamics_record_history','ship_dynamics_record_read_bases','ship_dynamics_record_receipts','ship_dynamics_app_state','ship_dynamics_app_revisions','ship_dynamics_data_management_operations','ship_dynamics_edit_locks'];
  const rows=async table=>(await db.query(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows;
  const frozen=async()=>Object.fromEntries(await Promise.all(untouchedTables.map(async table=>[table,await rows(table)])));
  const whole=async()=>({...await frozen(),versions:await rows('ship_dynamics_record_versions'),ledger:await rows('ship_dynamics_record_prune_operations')});
  const protectedBefore=await frozen();
  const deltaToken=await query('select token as result from ship_dynamics_record_read_bases where workspace_key=$1 and revision=1',[key]);
  const delta=()=>query('select read_ship_dynamics_record_delta_v1($1,1,$2) as result',[key,deltaToken]);
  const deltaBefore=await delta();assert.equal(deltaBefore.status,'delta');
  await check('record head7 vs legacy head1; logical totals/current collections/items originate only in records',async()=>{
    const s=await stats();assert.equal(s.currentRevision,7);assert.equal(s.revisionHistoryCount,7);
    assert.equal(s.revisionHistoryBytes,s.revisions.reduce((sum,r)=>sum+r.logicalBytes,0));
    assert.deepEqual(s.revisions.filter(r=>r.current).map(r=>r.revision),[7]);
    assert.equal(s.items.find(i=>i.id===taskId).label,'revision 7');assert.ok(s.currentStateBytes>0);
  });
  await check('select older roots -> prune ACK -> stats/readback; EVERY retained history/current/delta and legacy unchanged',async()=>{
    const before=await stats(),selected=[1,3],op=crypto.randomUUID();
    const result=await prune(all(),selected,op);assert.equal(result.ok,true);assert.equal(result.deletedCount,2);
    assert.equal(result.deletedBytes,before.revisions.filter(r=>selected.includes(r.revision)).reduce((s,r)=>s+r.logicalBytes,0));
    for(const n of selected){assert.equal((await history(n)).status,'missing');snapshots.delete(n);}
    await verifyAll();assert.equal((await stats()).revisionHistoryCount,5);assert.deepEqual(await frozen(),protectedBefore);assert.deepEqual(await delta(),deltaBefore);
    assert.deepEqual(await prune(before.revisions.map(r=>r.revision),selected,op),result,'exact committed replay after roots gone');
    assert.equal((await prune(all(),[2],op)).error,'IDEMPOTENCY_MISMATCH');
  });
  await check('active record roles win over contradictory legacy Owner: stats admin only, prune Owner only',async()=>{
    for(const variant of [null,{role:'owner',isActive:false},{role:'member',isActive:true},{role:'admin',isActive:true}])await rollbackProbe(async()=>{
      if(variant)await db.query("update ship_dynamics_records set value=value||$1::jsonb where workspace_key=$2 and collection='users' and entity_id=$3",[JSON.stringify(variant),key,actor]);
      else await db.query("delete from ship_dynamics_records where workspace_key=$1 and collection='users' and entity_id=$2",[key,actor]);
      const s=await stats();assert.equal(s.ok,variant?.role==='admin');if(!s.ok)assert.equal(s.error,'FORBIDDEN');
      assert.equal((await prune(all(),[2])).error,'OWNER_REQUIRED');
    });
    assert.equal((await query('select get_ship_dynamics_record_storage_stats_v1($1,$2) as result',[key,'wrong-actor'])).error,'FORBIDDEN');
    assert.equal((await prune(all(),[2],crypto.randomUUID(),'wrong-actor')).error,'OWNER_REQUIRED');
  });
  await check('current/missing/duplicate/invalid/stale full set reject without deleting roots',async()=>{
    const before=await archive();
    for(const [expected,chosen,code] of [[all(),[7],'CURRENT_REVISION_PROTECTED'],[all(),[999],'INVALID_PAYLOAD'],[all(),[2,2],'INVALID_PAYLOAD'],[[...all(),2],[2],'INVALID_PAYLOAD'],[all(),['2'],'INVALID_PAYLOAD'],[all(),[],'INVALID_PAYLOAD'],[[2,4,5,7],[2],'REVISION_SET_CHANGED']])assert.equal((await prune(expected,chosen)).error,code);
    assert.deepEqual(await archive(),before);
  });
  await check('REJECTED exact replay survives set drift; actor/workspace binding cannot reuse receipt',async()=>{
    const op=crypto.randomUUID(),expected=[2,4],result=await prune(expected,[2],op);assert.equal(result.error,'REVISION_SET_CHANGED');
    await rollbackProbe(async()=>{
      await db.query('delete from ship_dynamics_record_versions where workspace_key=$1 and revision=4',[key]);
      assert.deepEqual(await prune(expected,[2],op),result);
      await db.query("insert into ship_dynamics_records select workspace_key,collection,'other-owner',value||'{\"id\":\"other-owner\"}',revision from ship_dynamics_records where workspace_key=$1 and collection='users' and entity_id=$2",[key,actor]);
      assert.equal((await prune(expected,[2],op,'other-owner')).error,'IDEMPOTENCY_MISMATCH');
      const other={...await full(),revision:1};await query('select import_ship_dynamics_records_v1($1,$2::jsonb) as result',['other-workspace',JSON.stringify(other)]);
      assert.equal((await prune(expected,[2],op,actor,'other-workspace')).error,'IDEMPOTENCY_MISMATCH');
    });
  });
  await check('actual new save after preview rejects the entire old selection; old COMMITTED replay remains exact',async()=>{
    const expected=all(),op=crypto.randomUUID();
    await rollbackProbe(async()=>{
      const committed=await prune(expected,[2],op);assert.equal(committed.ok,true);
      await save('preview-save',draft=>{draft.tasks[0].description='new save after preview';},['task:'+taskId]);
      const before=await archive();
      assert.equal((await prune(expected,[4])).error,'REVISION_SET_CHANGED');assert.deepEqual(await archive(),before);
      assert.deepEqual(await prune(expected,[2],op),committed);
    });snapshots.delete(8);
  });
  await check('missing current root fails closed',async()=>rollbackProbe(async()=>{
    await db.query('delete from ship_dynamics_record_versions where workspace_key=$1 and revision=7',[key]);
    assert.equal((await prune(all().filter(n=>n!==7),[2])).error,'CURRENT_REVISION_HISTORY_MISSING');
  }));
  await check('100 allowed / 101 rejected; multi-batch expected full-set remains CAS',async()=>rollbackProbe(async()=>{
    for(let n=8;n<=109;n++)await save('batch-'+n,draft=>{draft.tasks[0].description='batch '+n;},['task:'+taskId]);
    const set=(await stats()).revisions.map(r=>r.revision),older=set.filter(n=>n!==109).sort((a,b)=>a-b);
    assert.equal((await prune(set,older.slice(0,101))).error,'BATCH_LIMIT_EXCEEDED');
    const r=await prune(set,older.slice(0,100));assert.equal(r.ok,true);assert.equal(r.deletedCount,100);
    const rest=set.filter(n=>!older.slice(0,100).includes(n));
    assert.equal((await prune(set,older.slice(100))).error,'REVISION_SET_CHANGED');
    assert.equal((await prune(rest,older.slice(100))).ok,true);
  }));
  for(const n of [...snapshots.keys()])if(n>7)snapshots.delete(n);
  await check('receipt UPDATE failure after root deletion rolls back ENTIRE transaction',async()=>{
    const before=await whole();
    await db.exec(`create function qa_prune_crash() returns trigger language plpgsql as $$begin
      if new.status='COMMITTED' then
        if exists(select 1 from ship_dynamics_record_versions where workspace_key=new.workspace_key and revision=2) then raise exception 'QA_DELETE_NOT_REACHED'; end if;
        raise exception 'QA_RECEIPT_UPDATE_FAILED';
      end if; return new; end$$;
      create trigger qa_prune_crash before update on ship_dynamics_record_prune_operations for each row execute function qa_prune_crash()`);
    try{await db.exec('begin;savepoint expected_error');await assert.rejects(prune(all(),[2]),/QA_RECEIPT_UPDATE_FAILED/);await db.exec('rollback to savepoint expected_error;commit');}
    finally{await db.exec('drop trigger qa_prune_crash on ship_dynamics_record_prune_operations;drop function qa_prune_crash()');}
    assert.deepEqual(await whole(),before);
  });
  await check('SQL rerun preserves roots, current, bodies, legacy and exact receipts',async()=>{
    const before=await whole();await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_data_management.sql','utf8'));assert.deepEqual(await whole(),before);
  });
  await check('private invoker/fixed search_path/RLS/catalog plus denied local browser roles',async()=>{
    const names=['ship_dynamics_record_version_sizes_v1','get_ship_dynamics_record_storage_stats_v1','prune_ship_dynamics_record_revision_history_v1'];
    const funcs=(await db.query('select proname,prosecdef,proconfig,oid::regprocedure::text signature from pg_proc where proname=any($1::text[])',[names])).rows;assert.equal(funcs.length,3);
    for(const f of funcs){assert.equal(f.prosecdef,false);assert.ok(f.proconfig.includes('search_path=pg_catalog, public'));for(const role of ['anon','authenticated'])assert.equal(await query('select has_function_privilege($1,$2,\'EXECUTE\') as result',[role,f.signature]),false);}
    assert.equal(await query("select relrowsecurity as result from pg_class where relname='ship_dynamics_record_prune_operations'"),true);
    for(const role of ['anon','authenticated']){
      await db.exec(`begin;set local role ${role}`);
      try{for(const action of [stats,()=>prune(all(),[2]),()=>rows('ship_dynamics_record_prune_operations')]){
        await db.exec('savepoint denied');await assert.rejects(action(),/permission denied/);await db.exec('rollback to savepoint denied');
      }}finally{await db.exec('rollback');}
    }
  });
  const adapter=await vite.ssrLoadModule('/src/dataManagement.ts'),calls=[];
  let lost=false,missing=false;const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input.url||String(input));assert.equal(url.origin,'http://127.0.0.1:1');
    const name=url.pathname.split('/').at(-1);calls.push(name);const args=JSON.parse(init.body);
    if(missing)return new Response(JSON.stringify({code:'PGRST202',message:'local missing RPC'}),{status:404});
    let result;
    if(['get_ship_dynamics_record_storage_stats_v1','get_ship_dynamics_storage_stats'].includes(name))result=await query(`select ${name}($1,$2) as result`,[args.p_workspace_key,args.p_actor_user_id]);
    else if(['prune_ship_dynamics_record_revision_history_v1','prune_ship_dynamics_revision_history'].includes(name))result=await query(`select ${name}($1,$2,$3::uuid,$4::jsonb,$5::jsonb) as result`,[args.p_workspace_key,args.p_actor_user_id,args.p_operation_id,JSON.stringify(args.p_expected_revisions),JSON.stringify(args.p_delete_revisions)]);
    else throw new Error('unknown SQL route '+name);
    if(lost){lost=false;return new Response(JSON.stringify({code:'QA_LOST_ACK',message:'actual SQL committed, ACK lost'}),{status:503});}
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };
  const config={supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:'LOCAL_SYNTHETIC_ONLY',workspaceKey:key,tableName:'ship_dynamics_app_state',storageMode:'records-v1'},legacy={...config,storageMode:undefined};
  const storageMap=new Map(),storage={getItem:k=>storageMap.get(k)||null,setItem:(k,v)=>storageMap.set(k,v),removeItem:k=>storageMap.delete(k)};
  try{
    await check('SupabaseJS records vs legacy stats choose distinct SQL authority; missing record RPC never falls back',async()=>{
      assert.equal((await adapter.getShipDynamicsStorageStats(actor,config)).currentRevision,7);assert.equal((await adapter.getShipDynamicsStorageStats(actor,legacy)).currentRevision,1);
      missing=true;try{await assert.rejects(adapter.getShipDynamicsStorageStats(actor,config),e=>e.code==='DATA_MANAGEMENT_SQL_NOT_DEPLOYED');}finally{missing=false;}
      assert.deepEqual(calls.slice(-3),['get_ship_dynamics_record_storage_stats_v1','get_ship_dynamics_storage_stats','get_ship_dynamics_record_storage_stats_v1']);
    });
    await check('old legacy pending namespace survives; record namespace isolated; wrong-authority envelope rejected before RPC',async()=>{
      const req={operationId:crypto.randomUUID(),actorUserId:actor,expectedRevisions:all(),deleteRevisions:[2]};
      const old=adapter.createPendingRevisionPrune(req,legacy),record=adapter.createPendingRevisionPrune(req,config);
      assert.equal(old.configIdentity,'http://127.0.0.1:1|'+key+'|ship_dynamics_app_state');assert.notEqual(old.configIdentity,record.configIdentity);
      adapter.writePendingRevisionPrune(old,legacy,storage);adapter.writePendingRevisionPrune(record,config,storage);assert.equal(storageMap.size,2);
      assert.deepEqual(adapter.readPendingRevisionPrune(legacy,actor,storage),old);assert.deepEqual(adapter.readPendingRevisionPrune(config,actor,storage),record);
      const count=calls.length;await assert.rejects(adapter.pruneShipDynamicsRevisionHistory(old,config),e=>e.code==='IDEMPOTENCY_MISMATCH');assert.equal(calls.length,count);
      await assert.rejects(adapter.pruneShipDynamicsRevisionHistory({...record,workspaceKey:'wrong-workspace'},config),e=>e.code==='IDEMPOTENCY_MISMATCH');assert.equal(calls.length,count);
    });
    await check('real SupabaseJS lost ACK -> durable same operation reconciliation -> exact readback',async()=>{
      const envelope=adapter.createPendingRevisionPrune({operationId:crypto.randomUUID(),actorUserId:actor,expectedRevisions:all(),deleteRevisions:[2]},config);
      adapter.writePendingRevisionPrune(envelope,config,storage);lost=true;
      await assert.rejects(adapter.pruneShipDynamicsRevisionHistory(envelope,config),e=>e.definitive===false);
      assert.equal((await history(2)).status,'missing');
      const pending=adapter.readPendingRevisionPrune(config,actor,storage);assert.deepEqual(pending,envelope);
      const receipt=await adapter.pruneShipDynamicsRevisionHistory(pending,config);assert.equal(receipt.deletedCount,1);
      assert.deepEqual(await adapter.pruneShipDynamicsRevisionHistory(pending,config),receipt);
      adapter.clearPendingRevisionPrune(config,actor,storage);assert.equal(adapter.readPendingRevisionPrune(config,actor,storage),null);assert.ok(adapter.readPendingRevisionPrune(legacy,actor,storage));
      snapshots.delete(2);await verifyAll();assert.deepEqual(await frozen(),protectedBefore);
    });
    await check('same UUID and matching revision sets across authorities cannot replay legacy COMMITTED success',async()=>rollbackProbe(async()=>{
      const expected=all(),op=crypto.randomUUID(),request={operationId:op,actorUserId:actor,expectedRevisions:expected,deleteRevisions:[4]};
      await db.query('update ship_dynamics_app_state set revision=7,payload=$2::jsonb where workspace_key=$1',[key,JSON.stringify(await full())]);
      await db.query('delete from ship_dynamics_app_revisions where workspace_key=$1',[key]);
      for(const revision of expected)await db.query('insert into ship_dynamics_app_revisions(workspace_key,revision,payload,saved_by) values($1,$2,$3::jsonb,$4)',[key,revision,JSON.stringify({...await full(),revision}),actor]);
      const legacyResult=await adapter.pruneShipDynamicsRevisionHistory(request,legacy);assert.equal(legacyResult.deletedCount,1);
      assert.equal((await history(4)).status,'snapshot','legacy commit cannot remove record history');
      const legacyFrozen=await rows('ship_dynamics_data_management_operations');
      const r=await adapter.pruneShipDynamicsRevisionHistory(request,config);assert.equal(r.deletedCount,1);assert.equal((await history(4)).status,'missing');
      assert.deepEqual(await rows('ship_dynamics_data_management_operations'),legacyFrozen);
      assert.deepEqual(await adapter.pruneShipDynamicsRevisionHistory(request,legacy),legacyResult);
    }));
  }finally{globalThis.fetch=originalFetch;}
  assert.deepEqual(await legacyRows(),legacyBefore);
  console.log(JSON.stringify({kind:'REAL_PGLITE_AND_SUPABASE_JS_NOT_HOSTED',count:results.length,results,calls},null,2));
} catch(error){failure=error;console.error(error.stack);}
finally{await vite.close();await db.close();}
if(failure)process.exitCode=1;
