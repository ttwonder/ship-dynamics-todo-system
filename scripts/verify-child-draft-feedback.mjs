import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const source=fs.readFileSync('src/App.tsx','utf8');
const parse=s=>ts.createSourceFile('App.tsx',s.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const ast=parse(source),app=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App');
const declaration=name=>app.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name)).getText(ast);
const effect=app.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='useEffect'&&n.getText(ast).includes('if(!pageDraftFeedbackPending.current')).expression.arguments[0].getText(ast);
const code=['hasPageDraftContext','retainPageDraftFeedback','syncLatest','saveChanges'].map(declaration).join('\n')+'\nreturn {hasPageDraftContext,retainPageDraftFeedback,syncLatest,saveChanges,settle:'+effect+'};';
const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const ref=current=>({current});
const cases=[];
const unsafe=t=>/可以安全關閉|沒有未保存修改|沒有尚未保存的修改/.test(t);
function fixture(){
 const data={revision:1,updatedAt:'test',vessels:[]},config={workspace:'local-synthetic'};
 const e={data,pageEditorContextRef:ref(false),vesselLeaseIncidentRef:ref(null),activeEditLockRef:ref(null),batchManagedOpenRef:ref(false),pendingTaskCreationsRef:ref([]),vesselAttentionSaveQueue:ref({hasPending:()=>false}),pageDraftFeedbackPending:ref(false),hasUnsavedWork:ref(false),savePhaseRef:ref('saved'),cloudWriteBlocked:false,cloudSaveInFlight:ref(null),cloudSyncInFlight:ref(false),pendingCloudData:ref({size:()=>0,rejectAll:()=>{}}),confirmedCloudData:ref(data),liveData:ref(data),saveTimer:ref(null),vesselAttentionSaveStates:{},lastCloudRevision:ref(1),durableCloudRevisionFloors:ref(new Map()),activeCloudIdentity:ref('local'),currentUser:{id:'test'},writes:0,toasts:[],status:'',getSupabaseConfig:()=>config,durableRevisionFloorRegistryIsValid:()=>true,confirm:()=>true,cachedCloudIdentityFor:()=> 'local',localStorage:{getItem:()=>null},STORAGE_KEY:'synthetic',setCloudSyncing:()=>{},setCloudWriteBlocked:v=>{e.cloudWriteBlocked=v;},setSavePhase:v=>{e.savePhaseRef.current=v;},setCloudStatus:v=>{e.status=v;},clearStaleSaveSuccessToast:()=>{e.toasts=[];},showSaveToast:(k,t,d)=>e.toasts.push(t+' '+d),savedStatus:t=>t,appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),nowIso:()=> 'test',rememberCloudIdentity:()=>{},setStaleBrowserRecoveryOffered:()=>{},setData:v=>{e.data=v;e.liveData.current=v;},confirmCloudSnapshot:(_,v)=>{e.confirmedCloudData.current=v;},assertRemoteExtendsDurableHistory:()=>{},prepareCloudSyncSnapshot:(_,l,r)=>r,cloudIdentity:()=> 'local',enqueueCloudSave:async()=>{e.writes++;},StaleAsyncConfigError:Error,fetchCloudData:async()=>data};
 e.configIoCoordinator=ref({invalidate:()=>{},begin:c=>({config:c}),isCurrent:()=>true,run:async(t,g,f)=>f(t.config)});
 const api=new Function('env','with(env){'+compiled+'}')(e);return {e,api};
}
async function test(caseId,fn){await fn();cases.push({caseId,layer:'source-executed-composed-controlled-io',status:'PASS'});console.log('PASS',caseId);}
await test('C1-clean-save',async()=>{const {e,api}=fixture();await api.saveChanges();assert.equal(e.toasts.some(unsafe),true);assert.equal(e.writes,0);});
for(const [id,set] of [
 ['C2-editor-without-lease',e=>e.pageEditorContextRef.current=true],
 ['C3-incident-without-lease',e=>e.vesselLeaseIncidentRef.current={mode:'frozen'}],
 ['C4-batch',e=>e.batchManagedOpenRef.current=true],
 ['C5-pending-creation',e=>e.pendingTaskCreationsRef.current=[{}]],
 ['C6-lease-context',e=>e.activeEditLockRef.current={status:'owned'}],
 ['C7-pending-attention',e=>e.vesselAttentionSaveQueue.current={hasPending:()=>true}],
])await test(id,async()=>{const {e,api}=fixture();set(e);e.hasUnsavedWork.current=true;e.toasts=['可以安全關閉'];await api.saveChanges();assert.equal(e.toasts.some(unsafe),false);assert.equal(e.hasUnsavedWork.current,true);assert.equal(e.savePhaseRef.current,'dirty');assert.equal(e.writes,0);});
await test('C8-blocked-lease-no-editor',async()=>{const {e,api}=fixture();e.activeEditLockRef.current={status:'blocked'};assert.equal(api.hasPageDraftContext(),false);});
await test('C9-cancel-settles-feedback',async()=>{const {e,api}=fixture();e.pageEditorContextRef.current=true;api.retainPageDraftFeedback();e.pageEditorContextRef.current=false;api.settle();assert.equal(e.savePhaseRef.current,'saved');assert.equal(e.hasUnsavedWork.current,false);});
await test('C10-cancel-cannot-clear-model-dirty',async()=>{const {e,api}=fixture();e.pageEditorContextRef.current=true;api.retainPageDraftFeedback();e.pageEditorContextRef.current=false;e.hasUnsavedWork.current=true;api.settle();assert.equal(e.savePhaseRef.current,'dirty');});
await test('C11-enter-during-sync',async()=>{const {e,api}=fixture();let release;e.fetchCloudData=()=>new Promise(r=>release=r);const p=api.syncLatest();assert.equal(typeof release,'function');e.pageEditorContextRef.current=true;release(e.data);await p;assert.equal(e.toasts.some(unsafe),false);assert.equal(e.savePhaseRef.current,'dirty');assert.equal(e.cloudSyncInFlight.current,false);assert.equal(e.writes,0);});
await test('C12-exit-during-sync',async()=>{const {e,api}=fixture();let release;e.pageEditorContextRef.current=true;e.fetchCloudData=()=>new Promise(r=>release=r);const p=api.syncLatest();e.pageEditorContextRef.current=false;release(e.data);await p;assert.equal(e.toasts.some(unsafe),true);assert.equal(e.savePhaseRef.current,'saved');assert.equal(e.writes,0);});
for(const editor of [true,false])await test(editor?'C13-sync-model-ACK-with-child':'C14-sync-model-ACK-clean',async()=>{const {e,api}=fixture();e.liveData.current={...e.data,vessels:[{id:'changed'}]};e.pageEditorContextRef.current=editor;e.enqueueCloudSave=async()=>{e.writes++;e.savePhaseRef.current='saved';e.toasts=['可以安全關閉'];};await api.syncLatest();assert.equal(e.toasts.some(unsafe),!editor);assert.equal(e.savePhaseRef.current,editor?'dirty':'saved');assert.equal(e.writes,1);});
// Source boundary is integrity evidence, separate from executed behavior.
const base=execFileSync('git',['show','253e71035565bea292e1d20f2bc2c4fedd95c6a5:src/App.tsx'],{encoding:'utf8'});
function boundary(s){const a=parse(s),jsx=[],literals=new Set();const walk=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))literals.add(n.text);if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){jsx.push(n.getText(a));return;}ts.forEachChild(n,walk);};walk(a);return {jsx,literals};}
const old=boundary(base),now=boundary(source);assert.deepEqual(now.jsx,old.jsx,'all JSX roots unchanged; no internal prop exceptions');assert.deepEqual([...now.literals].filter(v=>!old.literals.has(v)),[],'no new visible string literals');
const result={status:'PASS',cases,count:cases.length,boundary:{jsxRoots:now.jsx.length,jsxExact:true,newLiterals:0,internalPropAllowlist:[]},inputSha256:createHash('sha256').update(source).digest('hex')};
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'composed.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
