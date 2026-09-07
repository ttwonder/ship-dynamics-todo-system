import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const saved={window:globalThis.window,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
const cfg={supabaseUrl:'http://127.0.0.1:54329',supabaseAnonKey:'closed-fixture',tableName:'ship_dynamics_app_state',workspaceKey:'freshness',storageMode:'records-v1',readMode:'delta-v1'};
const clone=x=>JSON.parse(JSON.stringify(x));
let result,requests=0;
try{
 globalThis.window={SHIP_DYNAMICS_SUPABASE_CONFIG:cfg};globalThis.localStorage={getItem:()=>null};
 globalThis.fetch=async(input)=>{assert.equal(new URL(String(input)).origin,cfg.supabaseUrl);requests++;return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});};
 const cloud=await vite.ssrLoadModule('/src/cloud.ts');
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
 const {resolveItemEditSession}=await vite.ssrLoadModule('/src/itemEditSession.ts');
 const payload=createInitialData();payload.revision=7;
 const envelope={protocol:'ship-dynamics-delta-v1',workspace_key:cfg.workspaceKey,revision:7,payload_token:'exact-private-raw'};
 result={...envelope,status:'snapshot',payload};
 const confirmed=await cloud.fetchCloudData(cfg);
 const expected=normalizeAppData(clone(payload));expected.revision=7;
 result={...envelope,status:'delta',base_revision:7,base_token:envelope.payload_token,root:{set:{},deleted:[]},collections:[]};
 let materializations=0;const parse=JSON.parse;
 JSON.parse=function(...args){const value=parse(...args);if(value?.vessels&&value?.tasks&&value?.settings&&value?.users)materializations++;return value;};
 let remote;try{remote=await cloud.fetchCloudData(cfg,undefined,confirmed);}finally{JSON.parse=parse;}
 assert.deepEqual(remote,expected,'complete normalized AppData preserved');
 assert.deepEqual(cloud.cloudStoragePayloadFor(remote),payload,'complete private raw storage baseline preserved');
 let authorized=0;
 const session={live:confirmed,confirmed,remote,equals:(a,b)=>JSON.stringify(a)===JSON.stringify(b),select:s=>s.vessels[0],authorize:()=>{authorized++;return false;}};
 assert.equal(resolveItemEditSession(session).status,'unauthorized');assert.equal(authorized,1,'unchanged still checks authorization');
 assert.equal(resolveItemEditSession({...session,live:{...confirmed,revision:8}}).status,'local-dirty');
 console.log(JSON.stringify({layer:'controlled',case:'exact-empty-complete-and-authorized',requests,materializations}));
 assert.equal(materializations,0,'exact unchanged freshness must not materialize a complete snapshot');
 console.log('PASS exact-empty-complete-and-authorized');

 const cases=['exact-empty-complete-and-authorized'];
 const check=async(id,run)=>{await run();cases.push(id);console.log('PASS '+id);};
 const empty=()=>({...envelope,status:'delta',base_revision:7,base_token:envelope.payload_token,root:{set:{},deleted:[]},collections:[]});
 const seed=async()=>{await cloud.fetchCloudData(null);result={...envelope,status:'snapshot',payload};return cloud.fetchCloudData(cfg);};
 const measure=async(fn)=>{let count=0;const original=JSON.parse;JSON.parse=function(...args){const value=original(...args);if(value?.vessels&&value?.tasks&&value?.users&&value?.settings)count++;return value;};try{return {value:await fn(),count};}finally{JSON.parse=original;}};
 await check('default-still-materializes',async()=>{await seed();result=empty();assert.ok((await measure(()=>cloud.fetchCloudData(cfg))).count>0);});
 for(const kind of ['clone','mutated','missing-cache','nonexact-base'])await check(kind,async()=>{
  let base=await seed();if(kind==='clone')base=clone(base);if(kind==='mutated')base.vessels[0].name='DRAFT';
  if(kind==='nonexact-base'){result={...envelope,status:'snapshot',payload_token:'different-raw-token',payload};await cloud.fetchCloudData(cfg);}
  if(kind==='missing-cache'){await cloud.fetchCloudData(null);result={...envelope,status:'snapshot',payload};}else result=empty();
  if(kind==='nonexact-base'){result.base_token='different-raw-token';result.payload_token='different-raw-token';}
  const read=await measure(()=>cloud.fetchCloudData(cfg,undefined,base));assert.ok(read.count>0);assert.deepEqual(read.value,expected);if(kind==='mutated')assert.equal(base.vessels[0].name,'DRAFT');
 });
 await check('equivalent-private-raw-detachment',async()=>{const base=await seed();result=empty();await cloud.fetchCloudData(cfg);const read=await measure(()=>cloud.fetchCloudData(cfg,undefined,base));assert.equal(read.count,0);assert.equal(read.value,base);});
 await check('same-token-different-private-raw',async()=>{const base=await seed();const other={...payload,legacyExtension:{changed:true}};result={...envelope,status:'snapshot',payload:other};await cloud.fetchCloudData(cfg);result=empty();const read=await measure(()=>cloud.fetchCloudData(cfg,undefined,base));assert.ok(read.count>0);assert.deepEqual(cloud.cloudStoragePayloadFor(read.value),other);});
 await check('unsupported-table',async()=>{const base=await seed();result=empty();const before=requests;await assert.rejects(cloud.fetchCloudData({...cfg,tableName:'not-supported'},undefined,base));assert.equal(requests,before);});
 const {consumeCloudDeltaResponse}=await vite.ssrLoadModule('/src/cloudDelta.ts');
 const changes={
  'same-revision-wrong-token':r=>{r.payload_token='other';},'new-revision':r=>{r.revision++;},
  snapshot:r=>Object.assign(r,{status:'snapshot',payload}),
  'other-vessel-value':r=>{r.collections=[{collection:'vessels',upserts:[{...payload.vessels[0],name:'PEER'}],deleted:[]}];},
  permission:r=>{r.root.set.users=[];}, deletion:r=>{r.collections=[{collection:'vessels',upserts:[],deleted:[payload.vessels[0].id],order:payload.vessels.slice(1).map(v=>v.id)}];},
  order:r=>{r.collections=[{collection:'vessels',upserts:[],deleted:[],order:payload.vessels.map(v=>v.id).reverse()}];},
  audit:r=>{r.root.set.auditLogs=[];},notifications:r=>{r.root.set.notifications=[];},'root-delete':r=>{r.root.deleted=['legacyExtension'];},
 };
 for(const [id,change]of Object.entries(changes))await check(id,async()=>{
  const base=await seed();result=empty();change(result);
  const raw=consumeCloudDeltaResponse(result,cfg.workspaceKey,{revision:7,token:envelope.payload_token,payload}).payload;
  const wanted=normalizeAppData(clone(raw));wanted.revision=result.revision;
  const read=await measure(()=>cloud.fetchCloudData(cfg,undefined,base));assert.ok(read.count>0);assert.deepEqual(read.value,wanted);assert.deepEqual(cloud.cloudStoragePayloadFor(read.value),{...raw,revision:result.revision});
 });
 for(const [id,change]of Object.entries({protocol:r=>r.protocol='bad',workspace:r=>r.workspace_key='bad','base-revision':r=>r.base_revision=6,'base-token':r=>r.base_token='bad',revision:r=>r.revision=-1,token:r=>r.payload_token='',root:r=>r.root=null,collections:r=>r.collections={},'deleted-malformed':r=>r.root.deleted=['x','x']}))await check('reject-'+id,async()=>{const base=await seed();result=empty();change(result);await assert.rejects(cloud.fetchCloudData(cfg,undefined,base));});
 await check('missing',async()=>{const base=await seed();result={...envelope,status:'missing'};assert.equal(await cloud.fetchCloudData(cfg,undefined,base),null);});
 const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
 const transport=globalThis.fetch;
 const hold=()=>{const started=defer(),release=defer();globalThis.fetch=async(...args)=>{globalThis.fetch=transport;const response=await transport(...args);started.resolve();await release.promise;return response;};return{started,release};};
 await check('mutated-inflight',async()=>{const base=await seed();result=empty();const h=hold(),pending=cloud.fetchCloudData(cfg,undefined,base);await h.started.promise;base.vessels[0].name='INFLIGHT DRAFT';h.release.resolve();const read=await pending;assert.notEqual(read,base);assert.deepEqual(read,expected);assert.equal(base.vessels[0].name,'INFLIGHT DRAFT');});
 await check('abort',async()=>{const base=await seed();result=empty();const h=hold(),controller=new AbortController(),pending=cloud.fetchCloudData(cfg,controller.signal,base);const rejected=assert.rejects(pending,e=>e.name==='AbortError');await h.started.promise;controller.abort();h.release.resolve();await rejected;});
 for(const kind of ['newer','newer-missing','older-missing','config-ABA','key-change','workspace-change','url-change','storage-change'])await check('inflight-'+kind,async()=>{
  const base=await seed();result=kind==='older-missing'?{...envelope,status:'missing'}:empty();const h=hold(),old=cloud.fetchCloudData(cfg,undefined,base);await h.started.promise;
  let wanted;
  if(kind==='newer-missing'){result={...envelope,status:'missing'};assert.equal(await cloud.fetchCloudData(cfg),null);wanted=null;}
  else if(kind==='newer'||kind==='older-missing'){result={...envelope,status:'snapshot',revision:8,payload:{...payload,revision:8}};wanted=await cloud.fetchCloudData(cfg);}
  else{const next={...cfg,...(kind==='key-change'?{supabaseAnonKey:'successor'}:kind==='workspace-change'?{workspaceKey:'other'}:kind==='url-change'?{supabaseUrl:cfg.supabaseUrl+'/other'}:kind==='storage-change'?{storageMode:'legacy'}:{workspaceKey:'other'})};result={...envelope,status:'missing',workspace_key:next.workspaceKey};await cloud.fetchCloudData(next);if(kind==='config-ABA'){result={...envelope,status:'snapshot',payload};await cloud.fetchCloudData(cfg);}wanted=expected;}
  h.release.resolve();const read=await old;assert.deepEqual(read,wanted);if(read)assert.notEqual(read,base,'old response cannot reuse caller after cache change');
 });
 console.log(JSON.stringify({layer:'controlled',cases:cases.length,ids:cases}));

}finally{Object.assign(globalThis,saved);await vite.close();}
