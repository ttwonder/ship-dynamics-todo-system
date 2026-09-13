import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {createServer}=await import(pathToFileURL(path.resolve('node_modules/vite/dist/node/index.js')).href);
const vite=await createServer({root:process.cwd(),server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const oldFetch=globalThis.fetch;let authority,reads=0;
globalThis.fetch=async()=>{reads++;return new Response(JSON.stringify(authority),{status:200,headers:{'Content-Type':'application/json'}});};
const results=[];
try{
 const {MainSessionItineraryRepository}=await vite.ssrLoadModule('/src/itinerary/itinerarySourceAuthority.ts');
 const {createEmptyItineraryDocument}=await vite.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
 const {pendingOperationForDocument}=await vite.ssrLoadModule('/src/itinerary/itineraryOperation.ts');
 const workspace='fresh-preparation-controls';
 const config={supabaseUrl:'https://fixture.invalid',supabaseAnonKey:randomUUID(),workspaceKey:workspace,tableName:'ship_dynamics_app_state',enabled:true,storageMode:'records-v1',readMode:'scoped-v1'};
 const configBefore=JSON.stringify(config);
 const initial=()=>({workspace,managed:false,source:null,epoch:0,pauseState:'unmanaged',admitted:true});
 const target=()=>({workspace,managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true});
 async function fixture(){
  authority=initial();reads=0;
  const doc=createEmptyItineraryDocument({workspaceKey:workspace,vesselId:'v',vesselName:'V',rowId:'r'});doc.revision=7;
  const x={doc,calls:[],remote:structuredClone(doc),renewOk:true,wrongFence:false,onRenew:null};
  const client={rpc:async(name,args)=>{
   x.calls.push({name,args});
   if(name.includes('load_many'))return{data:[{vesselId:'v',document:x.remote}],error:null};
   if(name.includes('claim_lease')||name.includes('renew_lease')){
    if(name.includes('renew_lease')){x.onRenew?.();if(!x.renewOk)return{data:{ok:false},error:null};}
    return{data:{ok:true,leaseId:'lease-fixed',fencingToken:x.wrongFence?2:1,expiresAt:new Date(Date.now()+75000).toISOString()},error:null};
   }
   if(name.includes('operation_status'))return{data:{ok:true,document:{...doc,revision:8}},error:null};
   if(name.endsWith('_save')||name.endsWith('_save_v1'))return{data:{ok:true,document:{...doc,revision:8}},error:null};
   throw Error('unexpected-rpc:'+name);
  }};
  x.backend=new MainSessionItineraryRepository({userId:'actor'},config,client);
  await x.backend.loadDocument('v');x.lease=(await x.backend.claimLease('v',{holderId:'holder',holderLabel:'Actor'})).lease;
  x.input={document:doc,expectedRevision:7,lease:x.lease};x.calls=[];reads=0;
  return x;
 }
 const check=async(id,fn)=>{await fn();assert.equal(JSON.stringify(config),configBefore);results.push({id,status:'PASS'});};
 await check('PREP-SAME-SOURCE-NO-EXTRA-LEASE-IO',async()=>{const x=await fixture();const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.ok,true);assert.equal(v.lease,x.lease);assert.equal(x.calls.length,0);});
 await check('PREP-TARGET-SAME-PHYSICAL-LEASE',async()=>{const x=await fixture();const old=structuredClone(x.lease);authority=target();const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.ok,true);assert.deepEqual(x.lease,old);assert.equal(v.lease.leaseId,old.leaseId);assert.equal(v.lease.holderId,old.holderId);assert.equal(v.lease.fence,old.fence);assert.equal(v.lease.sourceAuthority.source,'legacy');assert.equal(v.lease.sourceAuthority.epoch,1);assert.deepEqual(x.calls.map(r=>r.name),['sd_itinerary_main_load_many','sd_itinerary_main_renew_lease']);x.calls=[];const saved=await x.backend.save({...x.input,lease:v.lease,operationId:randomUUID(),actorLabel:'Actor'});assert.equal(saved.ok,true);assert.deepEqual(x.calls.map(r=>r.name),['sd_itinerary_main_save']);});
 await check('PREP-PAUSED-NO-RPC',async()=>{const x=await fixture();authority={...target(),admitted:false,pauseState:'paused'};const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.ok,false);assert.equal(v.notDispatched,true);assert.equal(x.calls.length,0);});
 await check('PREP-REVISION-DRIFT-NO-RENEW',async()=>{const x=await fixture();authority=target();x.remote.revision=8;const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.code,'revision-conflict');assert.equal(v.currentRevision,8);assert.deepEqual(x.calls.map(r=>r.name),['sd_itinerary_main_load_many']);});
 await check('PREP-MISSING-EXISTING-DOC',async()=>{const x=await fixture();authority=target();x.remote=null;assert.equal((await x.backend.prepareFreshSave(x.input)).code,'revision-conflict');assert.equal(x.calls.length,1);});
 await check('PREP-EXPIRED-LEASE',async()=>{const x=await fixture();authority=target();x.renewOk=false;assert.equal((await x.backend.prepareFreshSave(x.input)).code,'lease-expired');assert.ok(!x.calls.some(r=>r.name.endsWith('_save')));});
 await check('PREP-NO-SUCCESSOR-REBIND',async()=>{const x=await fixture();authority=target();x.wrongFence=true;assert.equal((await x.backend.prepareFreshSave(x.input)).code,'lease-mismatch');assert.ok(!x.calls.some(r=>r.name.includes('claim_lease')||r.name.endsWith('_save')));});
 await check('PREP-PAUSE-DURING-RENEW',async()=>{const x=await fixture();authority=target();x.onRenew=()=>{authority={...target(),admitted:false,pauseState:'paused'};};const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.ok,false);assert.equal(v.notDispatched,true);});
 await check('PREP-WORKSPACE-MISMATCH-NO-LOOKUP',async()=>{const x=await fixture();const v=await x.backend.prepareFreshSave({...x.input,document:{...x.doc,workspaceKey:'other'}});assert.equal(v.code,'operation-mismatch');assert.equal(reads,0);assert.equal(x.calls.length,0);});
 await check('PREP-MALFORMED-AUTHORITY',async()=>{const x=await fixture();authority={...target(),source:'invalid'};const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.ok,false);assert.equal(v.notDispatched,true);assert.equal(x.calls.length,0);});
 await check('PREP-TO-SAVE-PAUSE-LOCAL-NOT-DISPATCHED',async()=>{const x=await fixture();authority=target();const v=await x.backend.prepareFreshSave(x.input);assert.equal(v.ok,true);authority={...target(),admitted:false,pauseState:'paused'};x.calls=[];const saved=await x.backend.save({...x.input,lease:v.lease,operationId:randomUUID(),actorLabel:'Actor'});assert.equal(saved.ok,false);assert.equal(saved.notDispatched,true);assert.equal(x.calls.length,0);authority=target();assert.equal((await x.backend.save({...x.input,lease:v.lease,operationId:randomUUID(),actorLabel:'Actor'})).ok,true);assert.deepEqual(x.calls.map(r=>r.name),['sd_itinerary_main_save']);});
 await check('HISTORICAL-PENDING-REMAINS-STATUS-ONLY',async()=>{const x=await fixture();const pending={...pendingOperationForDocument(x.doc,null),sourceAuthority:structuredClone(x.lease.sourceAuthority)};const original=JSON.stringify(pending);authority={...target(),admitted:false,pauseState:'paused'};x.calls=[];reads=0;const result=await x.backend.save({...x.input,operationId:pending.id,pendingOperation:pending,actorLabel:'Actor'});assert.equal(result.ok,true);assert.equal(result.replayed,true);assert.equal(result.notDispatched,undefined);assert.equal(reads,0);assert.equal(JSON.stringify(pending),original);assert.deepEqual(x.calls.map(r=>r.name),['sd_itinerary_record_operation_status_v1']);});
 console.log(JSON.stringify({status:'PASS',layer:'CONTROLLED_REAL_ADAPTER_NO_SQL_NO_MOUNTED',count:results.length,cases:results}));
 // Execute the production submit function and Dashboard context predicate.
 // Hook setters and persistence/transport timing are controlled; this is not
 // React mounting, IndexedDB, or SQL evidence (those have separate receipts).
 const contextRoot=process.env.QA_EDITOR_CONTEXT_SOURCE_ROOT||process.cwd();
 const ts=(await import('typescript')).default;
 const sourceAst=file=>{const text=fs.readFileSync(path.join(contextRoot,file),'utf8');return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);};
 const editorAst=sourceAst('src/itinerary/ItineraryEditor.tsx');
 const dashboardAst=sourceAst('src/itinerary/ItineraryDashboard.tsx');
 let submitExpression,contextExpression;
 const visitSubmit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(editorAst)==='submit')submitExpression=n.initializer.getText(editorAst);ts.forEachChild(n,visitSubmit);};visitSubmit(editorAst);
 const visitContext=n=>{if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(dashboardAst)==='ItineraryEditor')for(const p of n.attributes.properties)if(ts.isJsxAttribute(p)&&p.name.getText(dashboardAst)==='isSaveContextCurrent')contextExpression=p.initializer.expression.getText(dashboardAst);ts.forEachChild(n,visitContext);};visitContext(dashboardAst);
 assert.ok(submitExpression,'production submit exists');
 const bind=(expression,env)=>{
  const code=ts.transpileModule('const operation = '+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return Function(...Object.keys(env),code+'\nreturn operation;')(...Object.values(env));
 };
 const {cloudConfigIdentity}=await vite.ssrLoadModule('/src/cloudRecovery.ts');
 const {validateItineraryDocument}=await vite.ssrLoadModule('/src/itinerary/itineraryValidation.ts');
 const {resequenceItineraryRows}=await vite.ssrLoadModule('/src/itinerary/itineraryDomain.ts');
 const contextResults=[];
 for(const mode of ['RAW-CONFIG','ACTOR','UNCHANGED']){
  const x=await fixture();const source={workspace,managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true};
  let liveConfig=config,durable=null,dispatches=0,busy=false,publishes=0;
  const openGenerationRef={current:1},editor={},backend={};
  const parentEnv={editorGeneration:1,openGenerationRef,currentBackendRef:{current:backend},backend,editorRef:{current:editor},editor,demoMode:false,cloudConfigIdentity,getSupabaseConfig:()=>liveConfig,cloudConfigKey:cloudConfigIdentity(config)};
  // Missing prop reproduces the optional-prop behavior of the pinned old UI.
  const isSaveContextCurrent=bind(contextExpression||'()=>true',parentEnv);
  let entered,release;const barrier=new Promise(resolve=>entered=resolve),resume=new Promise(resolve=>release=resolve);
  const pendingOperationRef={current:null};const lifecycleRef={current:{active:true,closing:false,generation:1}};
  const env={readOnly:false,saving:false,lifecycleRef,isCurrent:g=>lifecycleRef.current.active&&lifecycleRef.current.generation===g,isSaveContextCurrent,draft:x.doc,document:x.doc,actorId:'actor',draftKey:'controlled-context-draft',lease:x.lease,pendingOperationRef,resequenceItineraryRows,validateItineraryDocument,pendingOperationForDocument,cloneDocument:structuredClone,
   setSaving:value=>busy=value,setMessage:()=>{},setReadOnly:()=>{},setLease:()=>{},setDirty:()=>{},saveError:()=> 'controlled failure',
   saveItineraryDraft:async record=>{durable=structuredClone(record);if(record.pendingOperation){entered();await resume;}},
   deleteItineraryDraft:async()=>{durable=null;},onSaved:()=>{publishes++;},
   onPrepareSave:async()=>({ok:true,lease:{...x.lease,sourceAuthority:source}}),
   onSave:async()=>{dispatches++;return {ok:false,code:'unknown-outcome'};}};
  const running=bind(submitExpression,env)();await barrier;
  assert.ok(busy);assert.deepEqual(durable.pendingOperation.sourceAuthority,source);
  const before=structuredClone(durable);
  if(mode==='RAW-CONFIG')liveConfig={...config,supabaseAnonKey:randomUUID()};
  if(mode==='ACTOR')openGenerationRef.current++;
  release();await running;
  assert.equal(dispatches,mode==='UNCHANGED'?1:0,mode+': stale submit must not dispatch');
  assert.deepEqual(durable,before,mode+': immutable persisted pending must remain');
  assert.equal(publishes,0);assert.equal(busy,false);
  contextResults.push({id:'SUBMIT-PENDING-'+mode,status:'PASS'});
 }
 console.log(JSON.stringify({status:'PASS',layer:'CONTROLLED_PRODUCTION_SUBMIT_AND_PREDICATE_NOT_MOUNTED',count:contextResults.length,cases:contextResults}));
}finally{globalThis.fetch=oldFetch;await vite.close();}
