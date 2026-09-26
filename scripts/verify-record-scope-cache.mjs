import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations} from './tracking-browser-fixture.mjs';
const v2=!process.argv.includes('--v1'),readRpc='read_ship_dynamics_record_scopes_'+(v2?'v2':'v1');

// Actual unchanged read adapter over isolated SQL/HTTP; never production.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'External QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const receipt={kind:'real-reader-isolated-SQL-HTTP-not-browser-or-hosted',cases:[],requests:[],productionContacted:false};
let qa,failure;
const nativeFetch=globalThis.fetch;
try{
 qa=await createRecordStorageLocalQa({internalControl:true,scopedRead:true,tracking:v2,performanceTrace:true,preparePerformanceFixture:initial=>{
  for(const row of initial.tasks)row.statusLogs.push(...[1,2,3,4].map(n=>({id:row.id+'-deep-'+n,at:initial.updatedAt,by:'QA OWNER',text:'cache history '+n,qaUnknown:{keep:n}})));
  for(const row of initial.internalControlCases){const task=initial.tasks.find(t=>t.id===row.linkedTaskId);if(task)row.statusLogs=structuredClone(task.statusLogs);}
 }});
 if(v2)await installTrackingBrowserMigrations(qa.db);
 const fullScope=async scope=>(await qa.db.query(`select ${readRpc}($1,$2,$3::jsonb,$4::jsonb${v2?",'[]'::jsonb":''}) r`,[qa.workspace,'targets','{}',JSON.stringify(scope.targets)])).rows[0].r;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url??String(input));
  assert.equal(url.origin,qa.origin,'external network denied');
  const args=JSON.parse(init?.body||'{}');
  const response=await nativeFetch(input,init);
  const data=await response.clone().json();
  receipt.requests.push({rpc:url.pathname.split('/').at(-1),scope:args.p_scope,targets:args.p_targets,versionRows:Object.values(args.p_versions||{}).reduce((n,c)=>n+Object.keys(c).length,0),rows:data.collections?Object.values(data.collections).reduce((n,c)=>n+c.rows.length,0):null,http:response.status});
  return response;
 };
 const cfg={supabaseUrl:qa.origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'};
 const {fetchCloudData,cloudStoragePayloadFor}=await qa.loadModule('/src/cloud.ts');
 const {consumeRecordScopes,recordScopePayload,assertRecordScopePatch}=await qa.loadModule('/src/cloudRecordScopes.ts');
 const baseline=await qa.read();
 const home=await fetchCloudData(cfg,undefined,undefined,'home');
 const cold=receipt.requests.find(r=>r.rpc===readRpc);
 assert.ok(cold.rows>5);assert.equal(cold.versionRows,0);
 receipt.cases.push({id:'home-cold',status:'PASS'});
 // Returned view objects must never mutate the transport's verified cache.
 home.vessels[0].name='UNSAVED CALLER MUTATION';
 const scope={targets:[{collection:'tasks',id:'qa-unrelated-task'}]};
 const target=await fetchCloudData(cfg,undefined,undefined,scope);
 const request=receipt.requests.filter(r=>r.rpc===readRpc).at(-1);
 assert.equal(request.versionRows,cold.rows,'new target must reuse all verified home versions instead of an empty scope cache');
 assert.ok(request.rows>0&&request.rows<cold.rows,'only changed detail coverage is transferred');
 assert.notEqual(target.vessels[0].name,'UNSAVED CALLER MUTATION');
 const complete=await fullScope(scope);
 const exact=recordScopePayload(consumeRecordScopes(complete,qa.workspace,scope,null));
 assert.deepEqual(cloudStoragePayloadFor(target),exact,'borrowed cache reconstructs exact raw authority including unknown/deep fields');
 assert.equal(target.tasks.find(t=>t.id==='qa-unrelated-task').statusLogs.length,5);
 receipt.cases.push({id:'target-reuses-home-with-exact-raw-data',status:'PASS',changedRows:request.rows,totalRows:cold.rows});
 const repeated=await fetchCloudData(cfg,undefined,undefined,scope);
 const repeat=receipt.requests.filter(r=>r.rpc===readRpc).at(-1);
 assert.equal(repeat.rows,0);assert.deepEqual(cloudStoragePayloadFor(repeated),exact);
 receipt.cases.push({id:'repeat-delta-and-caller-isolation',status:'PASS'});
 const caseScope={targets:[{collection:'internalControlCases',id:'qa-withdraw'}]};
 const caseData=await fetchCloudData(cfg,undefined,undefined,caseScope);
 const caseRequest=receipt.requests.filter(r=>r.rpc===readRpc).at(-1);
 assert.equal(caseRequest.versionRows,cold.rows);assert.ok(caseRequest.rows<cold.rows);
 const caseFull=await fullScope(caseScope);
 assert.deepEqual(cloudStoragePayloadFor(caseData),recordScopePayload(consumeRecordScopes(caseFull,qa.workspace,caseScope,null)));
 const linked=caseData.internalControlCases.find(c=>c.id==='qa-withdraw');
 assert.ok(caseData.tasks.find(t=>t.id===linked.linkedTaskId).statusLogs.length>2,'linked graph complete');
 receipt.cases.push({id:'new-case-graph-and-prior-detail-demotion',status:'PASS'});
 await assert.rejects(()=>fetchCloudData({...cfg,workspaceKey:'different-empty-qa-workspace'},undefined,undefined,caseScope),error=>error.code==='QA_SCOPE_MISMATCH');
 assert.equal(receipt.requests.at(-1).versionRows,0,'different workspace cannot borrow');
 receipt.cases.push({id:'workspace-isolation',status:'PASS'});
 assert.throws(()=>assertRecordScopePatch('home',[{kind:'entity',collection:'tasks',entityId:'qa-unrelated-task',expected:{},value:{}}],baseline.payload),/record-detail-not-loaded/);
 assert.deepEqual(await qa.read(),baseline,'read preparation never changes SQL business state');
 receipt.cases.push({id:'summary-write-guard-and-no-business-writes',status:'PASS'});
 receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.error={name:e.name,message:e.message,stack:e.stack};}
finally{
 globalThis.fetch=nativeFetch;if(qa)await qa.close();
 fs.writeFileSync(path.join(root,'cache-receipt.json'),JSON.stringify(receipt,null,2));
}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,receipt:path.join(root,'cache-receipt.json')}));
if(failure)throw failure;
