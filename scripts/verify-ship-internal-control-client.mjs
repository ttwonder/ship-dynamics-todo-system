import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
 assert.equal(fs.existsSync('src/shipInternalControl.ts'),true,'ship submission needs an exact, durable request/receipt adapter');
 const api=await server.ssrLoadModule('/src/shipInternalControl.ts');
 const form=await server.ssrLoadModule('/src/InternalControlModals.tsx');
 const draft=form.createInternalControlBatchDraft('v1','維修');draft.reporterNameAndRole='  QA 報告人／大副  ';Object.assign(draft.rows[0],{description:'只新增內控',status:'待協助',departments:['管理組'],syncToTask:true,closedDate:'2026-09-19'});
 draft.rows[0].expectedDate='2026-10-10';
 const actor='11111111-1111-4111-8111-111111111111',operation='22222222-2222-4222-8222-222222222222';
 const pending=api.prepareShipInternalControlSubmission(draft,actor,operation);
 assert.equal(pending.items.length,1);assert.equal(pending.items[0].description,'只新增內控\n\n報告人姓名＋職務：QA 報告人／大副','append reporter to the actual main-site body, not a new RPC field');
 assert.equal(pending.items[0].expectedDate,'2026-10-10','ship DL is part of the immutable submission');
 assert.equal(pending.version,3,'new local envelope is distinguished from already-persisted old submissions');
 for(const reporterNameAndRole of [undefined,'','  ','字'.repeat(121)])assert.throws(()=>api.prepareShipInternalControlSubmission({...draft,reporterNameAndRole},actor,operation),/報告人/);
 const batch={...draft,rows:[...draft.rows,{...draft.rows[0],key:'row-2',description:'第二筆內控'}]};
 assert.deepEqual(api.prepareShipInternalControlSubmission(batch,actor,operation).items.map(x=>x.description),['只新增內控\n\n報告人姓名＋職務：QA 報告人／大副','第二筆內控\n\n報告人姓名＋職務：QA 報告人／大副']);
 const suffix='\n\n報告人姓名＋職務：QA 報告人／大副';
 const bounded={...draft,rows:[{...draft.rows[0],description:'字'.repeat(10000-suffix.length)}]};
 assert.equal(api.prepareShipInternalControlSubmission(bounded,actor,operation).items[0].description.length,10000);
 assert.throws(()=>api.prepareShipInternalControlSubmission({...bounded,rows:[{...bounded.rows[0],description:bounded.rows[0].description+'字'}]},actor,operation),/10,000/);
 assert.throws(()=>api.prepareShipInternalControlSubmission({...draft,rows:[{...draft.rows[0],description:'  '}]},actor,operation),/事項內容/);
 for(const field of ['syncToTask','closedDate','id','createdBy','ownerUserIds','taskCategories'])assert.equal(Object.hasOwn(pending.items[0],field),false);
 const config={supabaseUrl:'http://127.0.0.1:9999',supabaseAnonKey:'qa-unit-public',workspaceKey:'qa',tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
 const committed={ok:true,status:'committed',operation_id:operation,workspace_key:'qa',vessel_id:'v1',case_ids:[`ship-internal-case:${operation}:1`],item_count:1,revision:9,updated_at:'2026-09-19T00:00:00Z',replayed:false};
 assert.deepEqual(api.parseShipInternalControlReceipt(committed,pending,'qa'),committed);
 for(const patch of [{operation_id:actor},{workspace_key:'other'},{vessel_id:'v2'},{case_ids:[]},{item_count:2},{revision:NaN},{status:'accepted'}])assert.throws(()=>api.parseShipInternalControlReceipt({...committed,...patch},pending,'qa'));
 const notFound={data:{ok:false,status:'not-found',operation_id:operation},error:null};
 const scenarios=[
  {name:'normal',responses:[notFound,{data:committed,error:null}],kind:'committed',calls:2},
  {name:'lost ACK recovery',responses:[notFound,{data:null,error:{code:'',message:'network failure'},status:503},{data:{...committed,replayed:true},error:null}],kind:'committed',calls:3},
  {name:'unknown stays pending',responses:[notFound,{data:null,error:{code:'',message:'network failure'},status:503},notFound],kind:'unknown',calls:3},
  {name:'SQL rejection keeps input editable',responses:[notFound,{data:null,error:{code:'22023',message:'ship-internal-invalid-content'},status:400},notFound],kind:'rejected',calls:3},
  {name:'reload finds existing receipt without submit',responses:[{data:{...committed,replayed:true},error:null}],kind:'committed',calls:1},
 ];
 for(const scenario of scenarios){const calls=[];const client={rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args:structuredClone(args)});return scenario.responses[calls.length-1];}})};const repo=new api.ShipInternalControlRepository(config,client,()=>true);const result=await repo.submit(pending);assert.equal(result.kind,scenario.kind,scenario.name);assert.equal(calls.length,scenario.calls,scenario.name);for(const call of calls){assert.equal(call.args.p_operation_id,operation);assert.deepEqual(call.args.p_items,pending.items);}}
 let current=true;const staleClient={rpc:()=>({abortSignal:async()=>{current=false;return {data:committed,error:null};}})};const stale=new api.ShipInternalControlRepository(config,staleClient,()=>current);assert.equal((await stale.submit(pending)).kind,'unknown');
 const store=new Map();const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const catalog={taskCategories:['維修'],priorities:['急','高','中','低'],departments:['管理組'],equipmentFailureSubcategories:['机舱设备']};
 const record={version:1,vessel:{id:'v1',name:'QA',shortName:'QA',fullName:'QA'},catalog,draft,pending};
 const configuredByAuthority={...config};delete configuredByAuthority.storageMode;
 const catalogClient={rpc:()=>({abortSignal:async()=>({data:{vessels:[record.vessel],vessel:record.vessel,catalog},error:null})})};
 const inferred=new api.ShipInternalControlRepository(configuredByAuthority,catalogClient,()=>true);
 assert.equal((await inferred.catalog('v1')).vessel.id,'v1','published config need not declare storageMode; the dedicated RPC enforces admitted records authority');
 const key=api.shipInternalControlDraftKey(config,'v1');api.saveShipInternalControlDraft(storage,key,record);assert.deepEqual(api.readShipInternalControlDraft(storage,key),record);
 assert.equal(draft.rows[0].description,'只新增內控','formatting must not alter editable source or append twice');
 const legacyV2=await server.ssrLoadModule('/scripts/fixtures/ship-internal-control-v2.ts');
 const v2Draft=structuredClone(draft);delete v2Draft.rows[0].expectedDate;
 const v2Pending=legacyV2.prepareShipInternalControlSubmission(v2Draft,actor,operation);
 const v2Record={...record,draft:v2Draft,pending:v2Pending};storage.setItem(key,JSON.stringify(v2Record));
 assert.deepEqual(api.readShipInternalControlDraft(storage,key),v2Record,'actual v2 pending survives unchanged; no optional date appended');
 assert.equal(v2Pending.version,2);assert.equal(Object.hasOwn(v2Pending.items[0],'expectedDate'),false);
 const legacyApi=await server.ssrLoadModule('/scripts/fixtures/ship-internal-control-v1.ts');
 const oldDraft=structuredClone(draft);delete oldDraft.reporterNameAndRole;
 const oldPending=legacyApi.prepareShipInternalControlSubmission(oldDraft,actor,operation);
 const oldRecord={...record,draft:oldDraft,pending:oldPending};legacyApi.saveShipInternalControlDraft(storage,key,oldRecord);
 const originalBytes=storage.getItem(key),restored=api.readShipInternalControlDraft(storage,key);
 assert.equal(restored.pending.version,1);assert.equal(JSON.stringify(restored),originalBytes);assert.equal(restored.pending.items[0].description,'只新增內控');
 const oldCalls=[];const oldRepo=new api.ShipInternalControlRepository(config,{rpc:(name,args)=>({abortSignal:async()=>{oldCalls.push({name,args:structuredClone(args)});return {data:{...committed,replayed:true},error:null};}})},()=>true);
 assert.equal((await oldRepo.submit(restored.pending)).kind,'committed');assert.equal(oldCalls.length,1);assert.equal(oldCalls[0].name,'get_ship_dynamics_internal_control_public_receipt_v1');assert.equal(JSON.stringify(oldCalls[0].args.p_items),JSON.stringify(oldPending.items));
 legacyApi.saveShipInternalControlDraft(storage,key,{...oldRecord,pending:undefined});assert.equal(api.readShipInternalControlDraft(storage,key).draft.rows[0].description,'只新增內控','unsubmitted old draft remains editable');
 api.saveShipInternalControlDraft(storage,key,{...record,draft:{...draft,reporterNameAndRole:'另一位／輪機長'}});const tampered=storage.getItem(key);assert.throws(()=>api.readShipInternalControlDraft(storage,key),/草稿/);assert.equal(storage.getItem(key),tampered,'unknown pending mismatch never cleared');
 assert.notEqual(key,api.shipInternalControlDraftKey({...config,workspaceKey:'other'},'v1'));assert.notEqual(key,api.shipInternalControlDraftKey(config,'v2'));
 assert.throws(()=>api.saveShipInternalControlDraft({setItem:()=>{throw Error('quota');}},key,record),/草稿/);
 console.log('PASS ship internal-control client: reporter required/batch/body limits, actual old-codec v1 replay unchanged, v2 frozen reporter, closed payload, exact ACK, lost ACK, immutable retry, stale config, durable scoped draft, quota fail-closed');
}finally{await server.close();}
