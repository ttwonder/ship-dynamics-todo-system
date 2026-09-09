// Morning 有限收尾：固定基準與精確內部替換，不是全域 release audit。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base="dc65d6d4ab02354dce3ea22d1acb4d8740c44b3e";
// 僅含已核對且由原 UI/native gates 覆蓋的內部讀取、續行、context、metadata 替換。
const changes=[
  {
    "path": "src/App.tsx",
    "before": "import { CloudBlockPatchRejectedError, CloudBlockPatchUnavailableError, CloudBlockPatchV2UnavailableError, CloudConflictError, applyCloudBlockPatch as applyCloudBlockPatchRpc, applyCloudBlockPatchV2, claimEditLock, cloudStoragePayloadFor, fetchCloudData as fetchCloudDataRpc, getCloudBlockPatchReceipt, getSupabaseConfig, releaseEditLock, renewEditLock, saveCloudData, saveSupabaseConfig, subscribeToCloudRevision, type ResolvedSupabaseConfig, type SupabaseConfig } from './cloud';\nimport { buildRecordScopePatch, cleanRecordHomeCacheMatches, recordRecoveryReadScope, unionRecordScopes, recordScopeKey, type RecordReadScope } from './cloudRecordScopes';\nimport { CloudBlockPatchConfirmedRefreshError, CloudBlockPatchOutcomeUnknownError, runCloudBlockPatchWithReceipt } from './cloudBlockReceipt';\n",
    "after": "import { CloudBlockPatchRejectedError, CloudBlockPatchUnavailableError, CloudBlockPatchV2UnavailableError, CloudConflictError, applyCloudBlockPatch as applyCloudBlockPatchRpc, applyCloudBlockPatchV2, claimEditLock, cloudStoragePayloadFor, fetchCloudData as fetchCloudDataRpc, getCloudBlockPatchReceipt, getSupabaseConfig, releaseEditLock, renewEditLock, saveCloudData, saveSupabaseConfig, subscribeToCloudRevision, type ResolvedSupabaseConfig, type SupabaseConfig } from './cloud';\nimport { isMorningRecordScope, buildRecordScopePatch, cleanRecordHomeCacheMatches, recordRecoveryReadScope, unionRecordScopes, recordScopeKey, type RecordReadScope } from './cloudRecordScopes';\nimport { CloudBlockPatchConfirmedRefreshError, CloudBlockPatchOutcomeUnknownError, runCloudBlockPatchWithReceipt } from './cloudBlockReceipt';\n"
  },
  {
    "path": "src/App.tsx",
    "before": "    setSelectedVesselDetailId('');\n    const statsOwner=(nextTab==='stats'||nextTab==='reports')?{generation:actionScopeGeneration.current+1,actor:liveCurrentUserId.current,session:identitySessionGeneration.current}:null;\n    if(!await loadRecordActionScope((['dashboard','total','closed','work','internalControl','meeting','stats','reports'] as Tab[]).includes(nextTab)?'home':'full'))return;\n    if(statsOwner&&(statsOwner.generation!==actionScopeGeneration.current||statsOwner.actor!==liveCurrentUserId.current||statsOwner.session!==identitySessionGeneration.current))return;\n",
    "after": "    setSelectedVesselDetailId('');\n    const statsOwner=(nextTab==='stats'||nextTab==='reports'||nextTab==='morning')?{generation:actionScopeGeneration.current+1,actor:liveCurrentUserId.current,session:identitySessionGeneration.current}:null;\n    if(!await loadRecordActionScope(nextTab==='morning'?'morning':(['dashboard','total','closed','work','internalControl','meeting','stats','reports'] as Tab[]).includes(nextTab)?'home':'full'))return;\n    if(statsOwner&&(statsOwner.generation!==actionScopeGeneration.current||statsOwner.actor!==liveCurrentUserId.current||statsOwner.session!==identitySessionGeneration.current))return;\n"
  },
  {
    "path": "src/App.tsx",
    "before": "    if(scope==='overall'){\n      if(!await loadRecordActionScope({targets:[{collection:'tasks',id:member.taskId}]},scopeIsCurrent))return null;\n      if(!scopeIsCurrent())return null;\n",
    "after": "    if(scope==='overall'){\n      if(!await loadRecordActionScope(isMorningRecordScope(recordReadScope.current)?unionRecordScopes(recordReadScope.current,{targets:[{collection:'tasks',id:member.taskId}]}):{targets:[{collection:'tasks',id:member.taskId}]},scopeIsCurrent))return null;\n      if(!scopeIsCurrent())return null;\n"
  },
  {
    "path": "src/App.tsx",
    "before": "  const openTask = async (task: TaskItem, vesselId = '', returnVesselId = ''):Promise<TaskOpenResult> => {\n    if(!(getSupabaseConfig()?.storageMode==='records-v1'&&usesPerVesselProgress(task))&&!await loadRecordActionScope({targets:[{collection:'tasks',id:task.id}]}))return 'failed';\n    const requestGeneration=taskOpenRequests.current.begin({vesselId:returnVesselId,batchManaged:false});\n",
    "after": "  const openTask = async (task: TaskItem, vesselId = '', returnVesselId = ''):Promise<TaskOpenResult> => {\n    if(!(getSupabaseConfig()?.storageMode==='records-v1'&&usesPerVesselProgress(task))&&!await loadRecordActionScope(isMorningRecordScope(recordReadScope.current)?unionRecordScopes(recordReadScope.current,{targets:[{collection:'tasks',id:task.id}]}):{targets:[{collection:'tasks',id:task.id}]}))return 'failed';\n    const requestGeneration=taskOpenRequests.current.begin({vesselId:returnVesselId,batchManaged:false});\n"
  },
  {
    "path": "src/cloud.ts",
    "before": "import { isPlaceholder, sanitizeAppDataForStorage } from './utils';\nimport { normalizeAppData } from './normalize';\n",
    "after": "import { isPlaceholder, sanitizeAppDataForStorage } from './utils';\nimport { latestManualReport } from './morningHistory';\nimport { normalizeAppData } from './normalize';\n"
  },
  {
    "path": "src/cloud.ts",
    "before": "import { consumeRecordSnapshot, usesRecordStorage } from './cloudRecords';\nimport { consumeRecordScopes, recordScopePayload, recordScopeVersions, recordScopeKey, type RecordReadScope, type RecordScopeSnapshot } from './cloudRecordScopes';\n\n",
    "after": "import { consumeRecordSnapshot, usesRecordStorage } from './cloudRecords';\nimport { isMorningRecordScope, consumeRecordScopes, recordScopePayload, recordScopeVersions, recordScopeKey, type RecordReadScope, type RecordScopeSnapshot } from './cloudRecordScopes';\n\n"
  },
  {
    "path": "src/cloud.ts",
    "before": "async function fetchCloudRecordScope(cfg:ResolvedSupabaseConfig,supabase:SupabaseClient,scope:RecordReadScope,signal?:AbortSignal):Promise<AppData|null>{\n  signal?.throwIfAborted();\n",
    "after": "async function fetchCloudRecordScope(cfg:ResolvedSupabaseConfig,supabase:SupabaseClient,scope:RecordReadScope,signal?:AbortSignal):Promise<AppData|null>{\n  if(isMorningRecordScope(scope)){\n    // No partial model is published: discover then read one coherent revision.\n    for(let attempt=0;attempt<3;attempt++){\n      const home=await fetchCloudRecordScope(cfg,supabase,'home',signal);\n      if(!home)return null;\n      if(home.agendaReports.some(report=>report.__recordSnapshotAvailable&&!report.__recordMorningTimes))throw new Error('morning-read-metadata-unavailable');\n      const report=latestManualReport(home.agendaReports,new Date().toISOString());\n      const targets=[...(['tasks','internalControlCases','meetings'] as const).flatMap(collection=>home[collection].map(row=>({collection,id:row.id}))),...(report?[{collection:'agendaReports' as const,id:report.id}]:[]),...(typeof scope==='object'?scope.targets:[])];\n      const unique=[...new Map(targets.map(t=>[JSON.stringify(t),t])).values()];\n      const detail=await fetchCloudRecordScope(cfg,supabase,{targets:unique},signal);\n      if(detail&&detail.revision===home.revision)return detail;\n    }\n    throw new Error('morning-read-revision-changed');\n  }\n  signal?.throwIfAborted();\n"
  },
  {
    "path": "src/cloud.ts",
    "before": "  if (usesRecordStorage(cfg)) throw new CloudBlockPatchRejectedError('record-full-save-disabled');\n  if(payload.agendaReports.some(report=>Object.prototype.hasOwnProperty.call(report,'__recordSnapshotAvailable')))throw new CloudBlockPatchRejectedError('record-summary-not-writable');\n  const cleanPayload = sanitizeAppDataForStorage(payload);\n",
    "after": "  if (usesRecordStorage(cfg)) throw new CloudBlockPatchRejectedError('record-full-save-disabled');\n  if(payload.agendaReports.some(report=>(Object.prototype.hasOwnProperty.call(report,'__recordSnapshotAvailable')||Object.prototype.hasOwnProperty.call(report,'__recordMorningTimes'))))throw new CloudBlockPatchRejectedError('record-summary-not-writable');\n  const cleanPayload = sanitizeAppDataForStorage(payload);\n"
  },
  {
    "path": "src/cloudBlockPatch.ts",
    "before": "    if(value===null)continue;\n    if(operation.collection==='agendaReports'&&Object.prototype.hasOwnProperty.call(value,'__recordSnapshotAvailable'))throw new TypeError('record-summary-not-writable');\n    if(value.id!==operation.entityId)throw new TypeError(`${operation.collection}:${operation.entityId} ${label} id mismatch`);\n",
    "after": "    if(value===null)continue;\n    if(operation.collection==='agendaReports'&&(Object.prototype.hasOwnProperty.call(value,'__recordSnapshotAvailable')||Object.prototype.hasOwnProperty.call(value,'__recordMorningTimes')))throw new TypeError('record-summary-not-writable');\n    if(value.id!==operation.entityId)throw new TypeError(`${operation.collection}:${operation.entityId} ${label} id mismatch`);\n"
  },
  {
    "path": "src/cloudRecordScopes.ts",
    "before": "export type RecordTarget = { collection: 'tasks' | 'internalControlCases' | 'meetings' | 'agendaReports'; id: string };\nexport type RecordReadScope = 'home' | 'full' | { targets: RecordTarget[] };\ntype Row = { version: number; detail?: boolean; value: Record<string, unknown> };\n",
    "after": "export type RecordTarget = { collection: 'tasks' | 'internalControlCases' | 'meetings' | 'agendaReports'; id: string };\nexport type RecordReadScope = 'home' | 'full' | 'morning' | { targets: RecordTarget[]; morning?: true };\nexport const isMorningRecordScope=(scope:RecordReadScope)=>scope==='morning'||(typeof scope==='object'&&scope.morning===true);\ntype Row = { version: number; detail?: boolean; value: Record<string, unknown> };\n"
  },
  {
    "path": "src/cloudRecordScopes.ts",
    "before": "  const targets=[...(typeof left==='object'?left.targets:[]),...(typeof right==='object'?right.targets:[])];\n  return targets.length?{targets:[...new Map(targets.map(t=>[JSON.stringify([t.collection,t.id]),t])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}:'home';\n",
    "after": "  const targets=[...(typeof left==='object'?left.targets:[]),...(typeof right==='object'?right.targets:[])];\n  if(isMorningRecordScope(left)||isMorningRecordScope(right))return {morning:true,targets};\n  return targets.length?{targets:[...new Map(targets.map(t=>[JSON.stringify([t.collection,t.id]),t])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}:'home';\n"
  },
  {
    "path": "src/cloudRecordScopes.ts",
    "before": "  const keys=new Set(typeof scope==='object'?scope.targets.map(t=>key(t.collection,t.id)):[]);\n  let changed=true;\n",
    "after": "  const keys=new Set(typeof scope==='object'?scope.targets.map(t=>key(t.collection,t.id)):[]);\n  if(isMorningRecordScope(scope))for(const name of ['tasks','internalControlCases','meetings'] as const)for(const row of raw[name])keys.add(key(name,row.id));\n  let changed=true;\n"
  },
  {
    "path": "src/cloudRecordScopes.ts",
    "before": "    const snapshot=v.snapshot;\n    if(object(snapshot)&&Array.isArray(snapshot.vessels)&&Array.isArray(snapshot.tasks)&&Array.isArray(snapshot.meetings))v.__recordSnapshotAvailable=true;\n    delete v.snapshot;\n",
    "after": "    const snapshot=v.snapshot;\n    if(object(snapshot)&&Array.isArray(snapshot.vessels)&&Array.isArray(snapshot.tasks)&&Array.isArray(snapshot.meetings)){v.__recordSnapshotAvailable=true;v.__recordMorningTimes={windowEndedAt:typeof snapshot.windowEndedAt==='string'?snapshot.windowEndedAt:'',capturedAt:typeof snapshot.capturedAt==='string'?snapshot.capturedAt:''};}\n    delete v.snapshot;\n"
  },
  {
    "path": "src/morningHistory.ts",
    "before": "  if (report.kind !== 'daily-morning' || report.source === 'scheduled') return undefined;\n  return validInstant(report.snapshot?.windowEndedAt) || validInstant(report.createdAt) || validInstant(report.snapshot?.capturedAt);\n}\n\nfunction latestManualReport(reports: AgendaReport[], endedAt: string, excludedReportId = ''): AgendaReport | undefined {\n  const candidates = reports\n",
    "after": "  if (report.kind !== 'daily-morning' || report.source === 'scheduled') return undefined;\n  return validInstant(report.snapshot?.windowEndedAt ?? report.__recordMorningTimes?.windowEndedAt) || validInstant(report.createdAt) || validInstant(report.snapshot?.capturedAt ?? report.__recordMorningTimes?.capturedAt);\n}\n\nexport function latestManualReport(reports: AgendaReport[], endedAt: string, excludedReportId = ''): AgendaReport | undefined {\n  const candidates = reports\n"
  },
  {
    "path": "src/normalize.ts",
    "before": "      snapshot: validSnapshot,\n      ...(item.snapshot === undefined && item.__recordSnapshotAvailable === true ? {__recordSnapshotAvailable:true as const} : {}),\n",
    "after": "      snapshot: validSnapshot,\n      ...(item.snapshot === undefined && object(item.__recordMorningTimes) ? {__recordMorningTimes:{windowEndedAt:text(object(item.__recordMorningTimes)!.windowEndedAt),capturedAt:text(object(item.__recordMorningTimes)!.capturedAt)}} : {}),\n      ...(item.snapshot === undefined && item.__recordSnapshotAvailable === true ? {__recordSnapshotAvailable:true as const} : {}),\n"
  },
  {
    "path": "src/types.ts",
    "before": "  readonly __recordSnapshotAvailable?: true;\n}\n",
    "after": "  readonly __recordSnapshotAvailable?: true;\n  readonly __recordMorningTimes?: { windowEndedAt?: string; capturedAt?: string };\n}\n"
  },
  {
    "path": "supabase/development/20260908_appdata_record_scoped_read.sql",
    "before": "  end if;\n  result:=result-'__recordSnapshotAvailable';\n  if jsonb_typeof(p_body->'snapshot')='object' and jsonb_typeof(p_body->'snapshot'->'vessels')='array' and jsonb_typeof(p_body->'snapshot'->'tasks')='array' and jsonb_typeof(p_body->'snapshot'->'meetings')='array' then\n    result:=result || jsonb_build_object('__recordSnapshotAvailable',true);\n  end if;\n",
    "after": "  end if;\n  result:=result-'__recordSnapshotAvailable'-'__recordMorningTimes';\n  if jsonb_typeof(p_body->'snapshot')='object' and jsonb_typeof(p_body->'snapshot'->'vessels')='array' and jsonb_typeof(p_body->'snapshot'->'tasks')='array' and jsonb_typeof(p_body->'snapshot'->'meetings')='array' then\n    result:=result || jsonb_build_object('__recordSnapshotAvailable',true,'__recordMorningTimes',jsonb_build_object('windowEndedAt',case when jsonb_typeof(p_body->'snapshot'->'windowEndedAt')='string' then p_body->'snapshot'->>'windowEndedAt' else '' end,'capturedAt',case when jsonb_typeof(p_body->'snapshot'->'capturedAt')='string' then p_body->'snapshot'->>'capturedAt' else '' end));\n  end if;\n"
  }
];
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024*1024});
const old=p=>git('show',base+':'+p);
const text=b=>b.toString('utf8').replaceAll('\r\n','\n');
const product=p=>p.startsWith('src/')||p.startsWith('supabase/')||p.startsWith('public/')||['index.html','ship-itinerary.html','package.json','package-lock.json','tsconfig.json','vite.config.ts'].includes(p);
const original=git('ls-tree','-rz','--name-only',base).toString('utf8').split('\0').filter(product);
const current=git('ls-files','-z','--cached','--others','--exclude-standard').toString('utf8').split('\0').filter(product);
assert.deepEqual([...new Set(current)].sort(),original.sort(),'產品路徑不可增刪');
const changed=new Set(changes.map(c=>c.path));
const expected=new Map(original.map(p=>[p,old(p)]));
for(const p of changed){let value=text(expected.get(p));for(const c of changes.filter(c=>c.path===p)){assert.equal(value.split(c.before).length,2,p+' 唯一原始替換範圍');value=value.replace(c.before,c.after);}expected.set(p,Buffer.from(value));}
// 工作檔 raw CRLF 不等於 Git blob；凍結檔依該路徑現行 clean filter 比對。
function check(p,bytes){if(changed.has(p))assert.equal(text(bytes),text(expected.get(p)),p+' 精確內部替換（僅忽略 CRLF）');else {const cleanOid=execFileSync('git',['hash-object','--stdin','--path='+p],{input:bytes,encoding:'utf8'}).trim();const baseOid=execFileSync('git',['hash-object','--stdin'],{input:expected.get(p),encoding:'utf8'}).trim();assert.equal(cleanOid,baseOid,p+' Git-clean 原檔完整保留');}}
for(const p of original)check(p,fs.readFileSync(p));
function jsx(source){const sf=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),values=[];function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){values.push(n.getText(sf));return;}ts.forEachChild(n,visit);}visit(sf);return values;}
const originalJsx=jsx(text(old('src/App.tsx'))),currentJsx=jsx(text(fs.readFileSync('src/App.tsx')));
assert.ok(originalJsx.length>0);assert.deepEqual(currentJsx,originalJsx,'App 全部 JSX（包含 props、文案與 role 條件）不變');
const cloud=text(fs.readFileSync('src/cloud.ts')),sql=text(fs.readFileSync('supabase/development/20260908_appdata_record_scoped_read.sql'));
for(const span of ['attempt<3','detail.revision===home.revision','latestManualReport(home.agendaReports','morning-read-metadata-unavailable','morning-read-revision-changed'])assert.ok(cloud.includes(span),span);
assert.ok(sql.includes("result:=result-'__recordSnapshotAvailable'-'__recordMorningTimes';"));
assert.ok(sql.includes("return result-'snapshot';"));
assert.ok(text(fs.readFileSync('src/types.ts')).includes('readonly __recordMorningTimes?'));
for(const p of ['src/cloud.ts','src/cloudBlockPatch.ts'])assert.ok(text(fs.readFileSync(p)).includes("Object.prototype.hasOwnProperty.call("+(p.endsWith('cloud.ts')?'report':'value')+",'__recordMorningTimes')"));
// 只在記憶體注入反例，證明 UI／權限／metadata 邊界會拒絕；不改產品檔。
const negatives=[['src/MorningWorkspace.tsx',b=>Buffer.concat([b,Buffer.from('\n// visible drift')])],['src/permissions.ts',b=>Buffer.concat([b,Buffer.from('\n// role drift')])],['src/App.tsx',b=>Buffer.from(text(b).replace('isMorningRecordScope, buildRecordScopePatch','buildRecordScopePatch'))],['src/cloud.ts',b=>Buffer.from(text(b).replace("'__recordMorningTimes'","'__recordMorningTimes_REMOVED'"))],['supabase/development/20260908_appdata_record_scoped_read.sql',b=>Buffer.from(text(b).replace("-'__recordMorningTimes'",''))]];
for(const [p,mutate] of negatives)assert.throws(()=>check(p,mutate(fs.readFileSync(p))),p+' 反例必須被拒絕');
assert.notDeepEqual(jsx(text(fs.readFileSync('src/App.tsx'))+'\nconst forbiddenUi=<button>新按鈕</button>;'),originalJsx,'JSX 反例必須不同');
const result={status:'PASS',layer:'fixed-base-source-UI-boundary',base,productPaths:[...changed].sort(),authorizedSpanCount:changes.length,frozenFileCount:original.length-changed.size,appJsxRoots:originalJsx.length,negativeControls:negatives.length+1,scope:'MorningWorkspace、Report UI、全部 JSX/CSS/role/PDF/mobile source 保留；App 僅內部讀取、續行 fence、保留 morning context',limitation:'source 保留證據；原 UI/native 執行證據另見 matrix7，不宣稱新 pixel/mobile/PDF QA'};
console.log(JSON.stringify(result));
if(process.env.QA_EVIDENCE_ROOT){fs.mkdirSync(process.env.QA_EVIDENCE_ROOT,{recursive:true});fs.writeFileSync(path.join(process.env.QA_EVIDENCE_ROOT,'boundary.json'),JSON.stringify(result,null,2));}
