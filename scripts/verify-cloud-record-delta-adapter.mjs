import assert from 'node:assert/strict';

export async function verifyRecordDeltaAdapter({db,vite,check,save,full,key}) {
 const savedGlobals={window:globalThis.window,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
 const config={supabaseUrl:'http://127.0.0.1:54329',supabaseAnonKey:'local-fixture-only',workspaceKey:key,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'delta-v1'};
 const requests=[];let intercept=null;
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
 const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 const run=async request=>{
  const body=request.body;
  if(request.path==='/rest/v1/rpc/read_ship_dynamics_record_delta_v1')return (await db.query('select read_ship_dynamics_record_delta_v1($1,$2,$3) as result',[body.p_workspace_key,body.p_base_revision,body.p_base_token])).rows[0].result;
  if(request.path==='/rest/v1/rpc/read_ship_dynamics_delta_v1')return (await db.query('select read_ship_dynamics_delta_v1($1,$2,$3) as result',[body.p_workspace_key,body.p_base_revision,body.p_base_token])).rows[0].result;
  throw new Error('Unexpected local SQL endpoint '+request.path);
 };
 try{
  globalThis.window={SHIP_DYNAMICS_SUPABASE_CONFIG:config};globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('Unexpected storage write');}};
  globalThis.fetch=async(input,init={})=>{
   const url=new URL(String(input));assert.equal(url.origin,config.supabaseUrl,'outbound network denied');assert.equal(init.method,'POST');
   const request={path:url.pathname,body:JSON.parse(String(init.body))};requests.push(request);
   if(intercept){const handler=intercept;intercept=null;return handler(request);}
   return response(await run(request));
  };
  const cloud=await vite.ssrLoadModule('/src/cloud.ts');
  const assertCurrent=async data=>assert.deepEqual(cloud.cloudStoragePayloadFor(data),await full());
  await check('delta adapter: record authority uses the real record RPC and detached raw baseline',async()=>{
   const data=await cloud.fetchCloudData(config);await assertCurrent(data);
   assert.equal(requests.at(-1).path,'/rest/v1/rpc/read_ship_dynamics_record_delta_v1');assert.equal(requests.at(-1).body.p_base_revision,null);
   const revision=data.revision;data.tasks[0].description='未保存草稿';
   await assertCurrent(await cloud.fetchCloudData(config));assert.equal(requests.at(-1).body.p_base_revision,revision);
  });
  await check('freshness SQL adapter: exact nochange returns complete verified base without materialization',async()=>{
   const base=await cloud.fetchCloudData(config);let count=0;const parse=JSON.parse;
   JSON.parse=function(...args){const value=parse(...args);if(value?.vessels&&value?.tasks&&value?.settings)count++;return value;};
   let read;try{read=await cloud.fetchCloudData(config,undefined,base);}finally{JSON.parse=parse;}
   assert.equal(count,0);assert.equal(read,base);await assertCurrent(read);
  });
  await check('freshness SQL adapter: changed peer task returns complete raw and normalized snapshot',async()=>{
   const base=await cloud.fetchCloudData(config);
   await save('freshness-peer',draft=>{draft.tasks.find(t=>t.id==='task-0').description='freshness peer';},['task:task-0']);
   const read=await cloud.fetchCloudData(config,undefined,base);assert.notEqual(read,base);await assertCurrent(read);assert.equal(read.tasks.find(t=>t.id==='task-0').description,'freshness peer');
  });
  await check('freshness SQL adapter: held unchanged cannot replace newer full publication',async()=>{
   const base=await cloud.fetchCloudData(config),started=deferred(),release=deferred();
   intercept=async request=>{const data=await run(request);started.resolve();await release.promise;return response(data);};
   const old=cloud.fetchCloudData(config,undefined,base);await started.promise;
   await save('freshness-peer-race',draft=>{draft.tasks.find(t=>t.id==='task-0').description='freshness newest';},['task:task-0']);
   await assertCurrent(await cloud.fetchCloudData(config));release.resolve();const read=await old;assert.notEqual(read,base);await assertCurrent(read);assert.equal(read.tasks.find(t=>t.id==='task-0').description,'freshness newest');
  });
  await check('delta adapter: actual save delta publishes all authoritative fields',async()=>{
   await save('adapter-row-update',draft=>{draft.tasks.find(t=>t.id==='task-0').description='adapter saved';},['task:task-0']);
   await assertCurrent(await cloud.fetchCloudData(config));assert.ok(requests.at(-1).body.p_base_token);
  });
  await check('delta adapter: late old response cannot downgrade a newer committed cache',async()=>{
   const started=deferred(),release=deferred();
   intercept=async request=>{const data=await run(request);started.resolve();await release.promise;return response(data);};
   const old=cloud.fetchCloudData(config);await started.promise;
   await save('adapter-race-new',draft=>{draft.tasks.find(t=>t.id==='task-0').description='newest committed';},['task:task-0']);
   await assertCurrent(await cloud.fetchCloudData(config));release.resolve();await assertCurrent(await old);
  });
  await check('delta adapter: aborted response never advances the cursor',async()=>{
   const started=deferred(),release=deferred();let originalBase;
   intercept=async request=>{originalBase=request.body.p_base_revision;const data=await run(request);started.resolve();await release.promise;return response(data);};
   const controller=new AbortController();const pending=cloud.fetchCloudData(config,controller.signal);const rejected=assert.rejects(pending,e=>e.name==='AbortError');
   await started.promise;controller.abort();release.resolve();await rejected;
   await assertCurrent(await cloud.fetchCloudData(config));assert.equal(requests.at(-1).body.p_base_revision,originalBase);
  });
  await check('delta adapter: legacy and record modes never share an authority cursor',async()=>{
   assert.equal(await cloud.fetchCloudData({...config,storageMode:'legacy'}),null);assert.equal(requests.at(-1).path,'/rest/v1/rpc/read_ship_dynamics_delta_v1');assert.equal(requests.at(-1).body.p_base_revision,null);
   await assertCurrent(await cloud.fetchCloudData(config));assert.equal(requests.at(-1).body.p_base_revision,null);
  });
  await check('delta adapter: missing capability fails without legacy fallback or cache publication',async()=>{
   const count=requests.length;
   intercept=()=>new Response(JSON.stringify({code:'PGRST202',message:'QA unavailable capability'}),{status:404,headers:{'content-type':'application/json'}});
   await assert.rejects(cloud.fetchCloudData(config));assert.equal(requests.length,count+1);
   await assertCurrent(await cloud.fetchCloudData(config));
  });
 }finally{globalThis.window=savedGlobals.window;globalThis.localStorage=savedGlobals.localStorage;globalThis.fetch=savedGlobals.fetch;}
}
