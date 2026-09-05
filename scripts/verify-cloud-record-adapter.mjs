import assert from 'node:assert/strict';

// Invoked by verify-cloud-record-store.mjs with the same real isolated SQL runtime.
// Supabase JS requests execute the new SQL; injected responses are only negative
// protocol/transport probes and are never used to manufacture a successful save.
export async function verifyRecordAdapter({ db, vite, payload, workspace, requestFor, read, apply, receipt, check }) {
  const globals = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const config = { supabaseUrl:'http://127.0.0.1:54329',supabaseAnonKey:'local-fixture-only',workspaceKey:workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1' };
  const requests = [];
  let intercept = null;
  const response = (data,status=200) => new Response(JSON.stringify(data),{ status,headers:{'content-type':'application/json'} });
  const decode = body => ({ workspace:body.p_workspace_key,id:body.p_operation_id,operations:body.p_operations,savedBy:body.p_saved_by,actor:body.p_actor_user_id,guard:body.p_actor_guard,authorization:body.p_authorization_guard,locks:body.p_lock_guards });
  const deferred = () => { let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve}; };
  try {
    globalThis.window={SHIP_DYNAMICS_SUPABASE_CONFIG:config};
    globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('No browser storage writes in this fixture');}};
    globalThis.fetch=async (input,init={})=>{
      const url=new URL(String(input));
      assert.equal(url.origin,config.supabaseUrl,'all outbound network forbidden');
      const body=init.body?JSON.parse(String(init.body)):null;
      const request={path:url.pathname,body}; requests.push(request);
      if(intercept){const handler=intercept;intercept=null;return handler(request);}
      if(url.pathname==='/rest/v1/ship_dynamics_app_state'){
        assert.equal(init.method||'GET','GET');
        const key=url.searchParams.get('workspace_key').replace(/^eq\./,'');
        return response((await db.query('select payload,revision from public.ship_dynamics_app_state where workspace_key=$1',[key])).rows[0]??null);
      }
      assert.equal(init.method,'POST');
      if(url.pathname==='/rest/v1/rpc/read_ship_dynamics_records_v1')return response(await read(body.p_workspace_key));
      if(url.pathname==='/rest/v1/rpc/apply_ship_dynamics_record_patch_v1')return response(await apply(decode(body)));
      if(url.pathname==='/rest/v1/rpc/get_ship_dynamics_record_receipt_v1')return response(await receipt(decode(body)));
      throw new Error(`Unexpected endpoint: ${url.pathname}`);
    };
    const cloud=await vite.ssrLoadModule('/src/cloud.ts');
    const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
    const {actorStorageAuthorizationGuard,assertActorAuthorizedForCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudAuthorization.ts');
    const {runCloudBlockPatchWithReceipt}=await vite.ssrLoadModule('/src/cloudBlockReceipt.ts');
    const {CloudBlockPatchConflictError}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
    const {consumeRecordSnapshot}=await vite.ssrLoadModule('/src/cloudRecords.ts');
    const args=request=>[request.id,request.operations,request.savedBy??'TEST OWNER',request.actor??'qa-owner',request.guard,request.authorization??null,request.locks,config];
    const submit=request=>cloud.applyCloudBlockPatchV2(...args(request));
    const lookup=request=>cloud.getCloudBlockPatchReceipt(...args(request));
    const equalAuthority=async data=>{
      const stored=(await read()).payload;
      const expected=normalizeAppData(structuredClone(stored)); assert.ok(expected);
      assert.deepEqual(data,expected);
      assert.deepEqual(cloud.cloudStoragePayloadFor(data),stored,'raw authority stays separate from normalized UI values');
    };
    await check('adapter: default remains legacy; explicit opt-in reads real row authority',async()=>{
      const {storageMode,...legacy}=config;
      assert.equal(await cloud.fetchCloudData(legacy),null); assert.equal(requests.at(-1).path,'/rest/v1/ship_dynamics_app_state');
      await equalAuthority(await cloud.fetchCloudData(config)); assert.equal(requests.at(-1).path,'/rest/v1/rpc/read_ship_dynamics_records_v1');
    });
    await check('adapter: unchanged authorization validator + storage guard + block patch reach new SQL',async()=>{
      const current=await cloud.fetchCloudData(config); const storage=cloud.cloudStoragePayloadFor(current);
      const request=await requestFor(storage,'client-save');
      assertActorAuthorizedForCloudBlockPatch(current,request.operations,'qa-owner');
      request.guard=actorStorageAuthorizationGuard(current,storage,'qa-owner');
      const before=(await read()).revision;
      const ack=await submit(request); assert.equal(ack.revision,before+1);
      assert.equal((await lookup(request)).status,'committed');
      await equalAuthority(await cloud.fetchCloudData(config));
      assert.equal((await read()).payload.auditLogs.filter(row=>row.id==='audit-client-save').length,1);
    });
    await check('adapter: lost ACK recovers original committed receipt without a second save',async()=>{
      const request=await requestFor((await read()).payload,'lost-ack'); const before=(await read()).revision; const count=requests.length;
      intercept=async request=>{await apply(decode(request.body));throw new TypeError('QA lost response after actual SQL commit');};
      const result=await runCloudBlockPatchWithReceipt({operationId:request.id,submit:()=>submit(request),lookup:()=>lookup(request),shouldReconcile:()=>true,assertCurrent:()=>{},sleep:async()=>{}});
      assert.equal(result.replayed,true); assert.equal(result.revision,before+1);
      assert.deepEqual(requests.slice(count).map(row=>row.path),['/rest/v1/rpc/apply_ship_dynamics_record_patch_v1','/rest/v1/rpc/get_ship_dynamics_record_receipt_v1']);
      assert.equal((await read()).payload.auditLogs.filter(row=>row.id==='audit-lost-ack').length,1);
      await equalAuthority(await cloud.fetchCloudData(config));
    });
    await check('adapter: missing capability does not redirect or fall back into legacy writes',async()=>{
      const request=await requestFor((await read()).payload,'missing-rpc'); const before=requests.length; const snapshot=await read();
      intercept=()=>response({code:'PGRST202',message:'QA unavailable capability'},404);
      await assert.rejects(submit(request),error=>error instanceof cloud.CloudBlockPatchV2UnavailableError);
      assert.equal(requests.length,before+1);
      await assert.rejects(cloud.applyCloudBlockPatch(...args(request).slice(1)),error=>error.code==='record-v1-fallback-disabled');
      await assert.rejects(cloud.saveCloudData(snapshot.payload,snapshot.revision,'TEST OWNER',config),error=>error.code==='record-full-save-disabled');
      assert.equal(requests.length,before+1); assert.deepEqual(await read(),snapshot);
    });
    await check('adapter: valid wrong workspace, malformed revision and unknown mode fail closed',async()=>{
      const snapshot=await read();
      for(const malformed of [{...snapshot,workspace_key:'other'},{...snapshot,revision:snapshot.revision+1},{...snapshot,revision:'2'},{...snapshot,status:'unknown'}]){
        intercept=()=>response(malformed); await assert.rejects(cloud.fetchCloudData(config));
      }
      const count=requests.length;
      for(const invalid of [{...config,storageMode:'unknown'},{...config,tableName:'other_table'},{...config,readMode:'delta-v1'}])await assert.rejects(cloud.fetchCloudData(invalid));
      assert.equal(requests.length,count);
      assert.throws(()=>consumeRecordSnapshot({status:'missing',protocol:'wrong',workspace_key:workspace},workspace));
      assert.equal(await cloud.fetchCloudData({...config,workspaceKey:'missing-workspace'}),null);
    });
    await check('adapter: response after abort is not published; UI mutation cannot alter stored authority',async()=>{
      const started=deferred(),release=deferred();
      intercept=async()=>{const snapshot=await read();started.resolve();await release.promise;return response(snapshot);};
      const controller=new AbortController(); const promise=cloud.fetchCloudData(config,controller.signal);
      const rejected=assert.rejects(promise,error=>error.name==='AbortError');
      await started.promise;controller.abort();release.resolve();await rejected;
      const data=await cloud.fetchCloudData(config);data.vessels[0].note.recentDynamics='UNSAVED DRAFT';
      await equalAuthority(await cloud.fetchCloudData(config));
    });
    await check('adapter: stale CAS remains a typed conflict and Realtime is explicitly not enabled',async()=>{
      const stale=await requestFor(payload,'stale-client');
      await assert.rejects(submit(stale),error=>error instanceof CloudBlockPatchConflictError);
      const statuses=[];const count=requests.length;
      const stop=cloud.subscribeToCloudRevision(()=>{throw new Error('Must not subscribe to legacy authority');},status=>statuses.push(status),config);
      assert.deepEqual(statuses,['RECORD_STORAGE_REALTIME_NOT_ENABLED']);stop();assert.equal(requests.length,count);
    });
  } finally {
    intercept=null;globalThis.window=globals.window;globalThis.localStorage=globals.localStorage;globalThis.fetch=globals.fetch;
  }
}
