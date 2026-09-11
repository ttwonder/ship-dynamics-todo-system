import assert from 'node:assert/strict';
import fs from 'node:fs';

import {createHash} from 'node:crypto';
export async function rehearseHandoverMigration({db,phase,receipt}){
 const file='supabase/development/20260911_vessel_manager_handover.sql';
 const definitions=async()=> (await db.query("select oid::text,proname,prosecdef,proacl::text,pg_get_functiondef(oid) definition from pg_proc where proname in ('apply_ship_dynamics_record_patch_v1','save_ship_dynamics_task_member_v1') order by proname")).rows;
 if(phase==='before'){
  const old=fs.readFileSync('scripts/fixtures/vessel-handover-before-reopen.sql','utf8');
  assert.equal(createHash('sha256').update(old.replaceAll('\r\n','\n')).digest('hex'),'3e0371985dc801ae501b875abc0f4a7f030c1e245f74de03f19ffea00bc73d70','immutable parent SQL fixture');await db.exec(old);
  const rows=await definitions();assert.ok(rows.find(r=>r.proname==='apply_ship_dynamics_record_patch_v1').definition.includes('-- handover-read-revision-v1'));assert.ok(rows.every(r=>!r.definition.includes('ship_dynamics_reopened_responsibilities_v1')));
  receipt.migrationRehearsal={oldTree:'d1659e30516b9f06cb424ec9071ae74d2973408f',oldSqlSHA256:createHash('sha256').update(old).digest('hex'),oldHandoverInstalled:true};return;
 }
 assert.equal(phase,'after-import');
 const read=async()=>(await db.query("select read_ship_dynamics_records_v1('isolated-record-ui-qa') r")).rows[0].r;
 const before=await read(),source=fs.readFileSync(file,'utf8');assert.ok(before.payload.tasks.length>0);
 await db.exec(source);const first=await definitions();assert.ok(first.every(r=>r.definition.includes('ship_dynamics_reopened_responsibilities_v1')));
 await db.exec(source);assert.deepEqual(await definitions(),first,'repeat preserves definitions, IDs and ACLs');
 await db.exec(fs.readFileSync('supabase/development/20260909_task_member_protocol.sql','utf8'));await db.exec(source);assert.deepEqual(await definitions(),first,'member protocol reapply restores exactly one reopen hook');
 assert.deepEqual(await read(),before,'upgrade/reapply preserve complete pre-upgrade records and revision');
 Object.assign(receipt.migrationRehearsal,{seededDataPreserved:true,repeatExact:true,memberReapplyExact:true});receipt.cases.push({caseId:'VH-NATIVE-MIGRATION-UPGRADE-AND-REAPPLY',layer:'private-native-PG',status:'PASS'});
}
export async function runLegacyHandover({a,qa,native,call,until,receipt,setCase}){
 const read=async()=>(await native.observer.query('select payload,revision from ship_dynamics_app_state where workspace_key=$1',[qa.workspace])).rows[0];
 const before=await read(),recordBefore=(await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
 setCase('VH-LEGACY-SNAPSHOT-ORIGINAL-HANDOVER');await a.click('管理');
 await a.activate("[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith('船舶'))");await a.activate("[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText==='QA VESSEL 1')");
 for(const name of ['QA OPERATOR','QA SPARE']){await a.eval(`([...document.querySelectorAll('.management-assignment label')].find(n=>n.textContent.includes(${JSON.stringify(name)}))?.querySelector('input[type=checkbox]')).focus()`);await a.key(' ','Space');}
 await a.click('保存變更');await until(()=>receipt.network.some(r=>r.rpc==='apply_ship_dynamics_block_patch_v2'),'legacy protocol request');const sent=receipt.network.findLast(r=>r.rpc==='apply_ship_dynamics_block_patch_v2');assert.equal(sent.handoverReadRevisionPresent,false,'legacy protocol must not receive records-only revision guard');await until(async()=>JSON.stringify((await read()).payload.vessels[0].assignedUserIds)==='["qa-spare"]','legacy SQL save');await until(()=>a.saved(),'legacy ACK');
 const after=await read();assert.ok(after.revision>before.revision);const team=(id,vid)=>after.payload.tasks.find(t=>t.id===id).vesselResponsibilities.find(r=>r.vesselId===vid).managerUserIds;
 assert.deepEqual(team('handover-single','qa-v1'),['qa-spare']);assert.deepEqual(team('handover-shared','qa-v1'),['qa-spare']);assert.deepEqual(team('handover-shared','qa-v2'),['qa-operator']);
 for(const key of ['tasks','internalControlCases','meetings'])for(const old of before.payload[key]){const next=structuredClone(after.payload[key].find(n=>n.id===old.id));if(!old.vesselResponsibilities)delete next.vesselResponsibilities;assert.deepEqual(next,old,'legacy common contacts/history/closed rows '+key+' '+old.id);}
 assert.deepEqual(after.payload.taskDismissals,before.payload.taskDismissals);assert.deepEqual(after.payload.agendaReports,before.payload.agendaReports);assert.deepEqual((await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r,recordBefore,'legacy path never switches write authority');
 assert.ok(receipt.network.some(r=>r.rpc==='apply_ship_dynamics_block_patch_v2'&&r.finished),'actual legacy RPC completed');
 await call('Page.reload',{},a.s);await until(async()=>(await a.text()).includes('QA OWNER'),'reloaded original UI');await a.sync();
 const model=await a.eval("import('/src/cloud.ts').then(m=>m.fetchCloudData())");const {normalizeAppData}=await qa.loadModule('/src/normalize.ts');assert.deepEqual(model,JSON.parse(JSON.stringify(normalizeAppData({...after.payload,revision:after.revision}))),'fresh document original legacy adapter');
 const cached=await a.eval("JSON.parse(localStorage.getItem('ship-dynamics-app-data-v1'))");for(const key of ['tasks','internalControlCases','meetings'])assert.deepEqual(cached[key],model[key],'real local cache retains responsibility '+key);
 await a.screen('legacy-snapshot-reloaded');receipt.cases.push({caseId:'VH-LEGACY-SNAPSHOT-ORIGINAL-HANDOVER',layer:'original-App-native-input-private-native-PG',status:'PASS'},{caseId:'VH-LEGACY-RELOAD-AND-LOCAL-CACHE',layer:'original-App-new-document-native-PG',status:'PASS'});
}
export function prepareHandover(d){
 const a=d.users.find(u=>u.id==='qa-operator'),b=d.users.find(u=>u.id==='qa-spare');
 a.managedVesselIds=['qa-v1','qa-v2'];b.managedVesselIds=[];
 d.vessels.forEach(v=>{v.assignedUserIds=[a.id];v.delegateManagers=[];});
 const template=structuredClone(d.tasks[0]);template.status=template.statusLogs[0].text;
 d.tasks=['single','shared','closed','other'].map((id,i)=>({...structuredClone(template),id:'handover-'+id,description:'HANDOVER '+id,sourceType:'manual',sourceMeetingId:undefined,sourceMeetingTaskItemId:undefined,attentionDimension:'task',vesselId:i===3?'qa-v2':'qa-v1',vesselIds:i===1?['qa-v1','qa-v2']:[i===3?'qa-v2':'qa-v1'],ownerUserIds:[a.id,'qa-owner'],isClosed:i===2,isInternalControl:i===2,statusLogs:structuredClone(template.statusLogs),vesselProgress:[]}));
 d.taskDismissals=['qa-operator','qa-spare','qa-admin','qa-owner'].flatMap(userId=>[{id:'dismiss-task-'+userId,userId,itemKind:'task',itemId:userId==='qa-owner'?'handover-shared':'handover-single',dismissedAt:d.updatedAt,dismissedBy:userId},{id:'dismiss-case-'+userId,userId,itemKind:'internal-control',itemId:'handover-standalone',dismissedAt:d.updatedAt,dismissedBy:userId}]);
 const meeting=structuredClone(d.meetings[0]),item=structuredClone(d.internalControlCases[0]);
 const linked={...structuredClone(d.tasks[0]),id:'handover-linked',description:'HANDOVER linked',isInternalControl:true,internalControlCaseId:'handover-case',vesselIds:undefined};
 const c={...item,id:'handover-case',vesselId:'qa-v1',description:linked.description,category:linked.category,priority:linked.priority,isAware:linked.isAware,status:linked.status,statusLogs:structuredClone(linked.statusLogs),reportDate:linked.reportDate,departments:[...linked.departments],isClosed:false,syncToTask:true,linkedTaskId:linked.id,origin:'task'};
 d.tasks.push(linked);d.internalControlCases=[c,{...structuredClone(c),id:'handover-standalone',syncToTask:false,linkedTaskId:undefined,origin:'internal-control'}];
 const child={...structuredClone(d.tasks[1]),id:'handover-meeting-task',description:'HANDOVER meeting',sourceType:'temporary',sourceMeetingId:'handover-meeting',sourceMeetingItemId:'handover-decision',attentionDimension:'meeting',category:'船員管理',categories:['船員管理'],distributeToVessels:true,vesselProgress:['qa-v1','qa-v2'].map(vesselId=>({vesselId,status:'member',isClosed:false,statusLogs:structuredClone(template.statusLogs)}))};
 d.tasks.push(child,{...structuredClone(child),id:'handover-member-closed',sourceMeetingItemId:'handover-closed-decision',vesselProgress:child.vesselProgress.map(r=>({...r,isClosed:r.vesselId==='qa-v1'}))});
 d.meetings=[{...meeting,id:'handover-meeting',subject:'HANDOVER MEETING',vessels:['qa-v1','qa-v2'],vesselScopeMode:'vessels',trackingUserIds:[a.id,'qa-owner'],responsibleUserIds:[a.id,'qa-owner'],participantUserIds:[a.id,'qa-owner'],status:'追蹤中',taskItems:[{id:'handover-decision',description:child.description,categories:['船員管理'],distributeToVessels:true},{id:'handover-closed-decision',description:child.description,categories:['船員管理'],distributeToVessels:true}]}];
 if(process.env.QA_MGACK_MODE==='handover-reopen'){const closed=d.tasks.find(t=>t.id==='handover-closed');closed.isInternalControl=process.env.QA_HANDOVER_GENERATED_CASE==='1';closed.vesselResponsibilities=[{vesselId:'qa-v1',managerUserIds:[a.id]}];const member=d.tasks.find(t=>t.id==='handover-member-closed');member.description='HANDOVER closed member';member.vesselResponsibilities=['qa-v1','qa-v2'].map(vesselId=>({vesselId,managerUserIds:[a.id]}));d.meetings[0].taskItems[1].description=member.description;}
 if(process.env.QA_MGACK_MODE==='handover-reopen'){for(const item of [linked,...d.internalControlCases]){item.isClosed=true;item.vesselResponsibilities=[{vesselId:'qa-v1',managerUserIds:[a.id]}];}d.internalControlCases[1].description='HANDOVER standalone closed';}
 if(process.env.QA_MGACK_MODE==='handover-reopen')d.meetings.push({...structuredClone(d.meetings[0]),id:'handover-closed-meeting',subject:'HANDOVER CLOSED MEETING',status:'已完成',taskItems:[],vesselResponsibilities:[...['qa-v1','qa-v2'].map(vesselId=>({vesselId,managerUserIds:[a.id]})),{vesselId:'retained-vessel-history',managerUserIds:[a.id]}]});
 if(process.env.QA_MGACK_MODE==='handover-reopen'&&['all','types'].includes(process.env.QA_HANDOVER_REOPEN_SCOPE)){const meeting=d.meetings.find(m=>m.id==='handover-closed-meeting');meeting.vessels=[];meeting.vesselScopeMode=process.env.QA_HANDOVER_REOPEN_SCOPE;meeting.vesselTypeScopes=[d.vessels[0].shipType];}
 for(const scopeMode of ['all','types'])d.meetings.push({...structuredClone(d.meetings[0]),id:'handover-legacy-'+scopeMode,subject:'HANDOVER LEGACY '+scopeMode,vessels:[],vesselScopeMode:scopeMode,vesselTypeScopes:[d.vessels[0].shipType],taskItems:[]});
}
export async function runHandover({a,qa,read,call,until,wait,write,receipt,setCase,freshReadback,mode,setRelease,native,makePage,login}){
 const sub=label=>a.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=name=>a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 await a.click('管理');await until(()=>a.eval("!!document.querySelector('.management-view')"),'management');await sub('船舶');await choose('QA VESSEL 1');await until(()=>a.saved(),'baseline saved');
 const before=await read();setCase('VH-SINGLE-SHARED-ORIGINAL-SAVE');
 const expectedTeam=mode==='handover-multi'?['qa-admin','qa-spare']:mode==='handover-person'?['qa-operator','qa-spare']:['qa-spare'];
 if(mode==='handover-person'){await sub('人員');await choose('QA SPARE');}
 for(const name of mode==='handover-person'?['QA VESSEL 1']:mode==='handover-multi'?['QA OPERATOR','QA SPARE','QA ADMIN']:['QA OPERATOR','QA SPARE']){
  const expr=`[...document.querySelectorAll('.management-assignment label')].find(n=>n.textContent.includes(${JSON.stringify(name)})&&n.querySelector('input[type=checkbox]'))?.querySelector('input[type=checkbox]')`;
  await a.eval(`(()=>{const n=${expr};if(!n)throw new Error('manager checkbox missing');n.focus();})()`);await a.key(' ','Space');
 }
 await a.screen('handover-before-save');
 let request,held=false,release,changedByPeer;
 const rpc='apply_ship_dynamics_record_patch_v1';
 qa.setRecordFault({before:async({name,body})=>{
  if(name!==rpc||request)return;request=structuredClone(body);
  if(mode==='handover-race-new'||mode==='handover-race-reopen'){
   const latest=structuredClone((await read()).payload),baseTask=latest.tasks.find(t=>t.id==='handover-single');
   if(mode.endsWith('new'))latest.tasks.push({...structuredClone(baseTask),id:'handover-racing-new'});
   else latest.tasks.find(t=>t.id==='handover-closed').isClosed=false;
   // A separate real native SQL writer publishes after discovery, before this RPC.
   const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
   const peerBefore=(await read()).payload,ops=buildCloudBlockPatch(peerBefore,latest),target=mode.endsWith('new')?'handover-racing-new':'handover-closed';
   const peerOwner='qa-handover-peer',guard={section_key:mode.endsWith('new')?'task-create:v2:qa-owner:'+target:'task:'+target,locked_by:peerOwner};
   await native.observer.query('select claim_ship_dynamics_edit_lock($1,$2,$3,$4,75)',[qa.workspace,guard.section_key,peerOwner,'QA PEER']);
   const result=(await native.observer.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,null,$7::jsonb)',[qa.workspace,'qa-peer-'+mode,JSON.stringify(ops),'QA OWNER','qa-owner',JSON.stringify(body.p_actor_guard),JSON.stringify([guard])])).rows[0].apply_ship_dynamics_record_patch_v1;
   assert.equal(result.ok,true,'native peer rejected: '+result.code);
   await native.observer.query('select release_ship_dynamics_edit_lock($1,$2,$3)',[qa.workspace,guard.section_key,peerOwner]);
   changedByPeer=await read();
  }
 },after:async({name})=>{
  if(name===rpc&&mode==='handover-held'){held=true;await new Promise(r=>{release=r;setRelease(r);});}
  return name===rpc&&mode==='handover-lost';
 }});
 await a.click('保存變更');
 if(mode.startsWith('handover-race')){
  await until(()=>receipt.network.some(n=>n.caseId==='VH-SINGLE-SHARED-ORIGINAL-SAVE'&&n.rpc===rpc&&n.finished),'rejection returned');
  assert.ok(changedByPeer,'peer publication completed');assert.deepEqual(await read(),changedByPeer,'outdated handover writes nothing');
  assert.ok(receipt.network.some(n=>n.rpc===rpc&&n.conflictKey==='handover-read-revision'),'server publication guard rejects stale discovery');
  assert.equal(await a.saved(),false,'draft not confirmed');
  await a.screen(mode);receipt.cases.push({caseId:mode,layer:'original-App-native-input-private-native-PG',status:'PASS'});qa.setRecordFault(null);return;
 }
 if(mode==='handover-held'){
  await until(()=>held,'committed ACK held');assert.equal(await a.saved(),false,'no early UI ACK');
  assert.deepEqual((await read()).payload.vessels[0].assignedUserIds,expectedTeam);release();
 }
 await until(()=>a.saved(),'handover ACK');qa.setRecordFault(null);
 const after=await read();write('handover-before',before);write('handover-after',after);await a.screen('handover-after-ack');
 assert.deepEqual(after.payload.vessels[0].assignedUserIds,expectedTeam,'original control assignment committed');
 const team=(d,id,vesselId)=>d.tasks.find(t=>t.id===id)?.vesselResponsibilities?.find(r=>r.vesselId===vesselId)?.managerUserIds;
 assert.deepEqual(team(after.payload,'handover-single','qa-v1'),expectedTeam,'single-vessel responsibility follows original Management Save');
 assert.deepEqual(team(after.payload,'handover-shared','qa-v1'),expectedTeam,'shared S1 successor');
 assert.deepEqual(team(after.payload,'handover-shared','qa-v2'),['qa-operator'],'shared S2 retained');
 for(const t of before.payload.tasks){const next=structuredClone(after.payload.tasks.find(n=>n.id===t.id));if(!t.vesselResponsibilities)delete next.vesselResponsibilities;assert.deepEqual(next,t,'contacts/history/closed and other vessels unchanged '+t.id);}
 for(const collection of ['meetings','internalControlCases'])for(const row of before.payload[collection]){
  const next=structuredClone(after.payload[collection].find(r=>r.id===row.id));
  assert.deepEqual(next.vesselResponsibilities?.find(r=>r.vesselId==='qa-v1')?.managerUserIds,row.status==='已完成'||row.isClosed?['qa-operator']:expectedTeam,collection+' S1 team');
  if(!row.vesselResponsibilities)delete next.vesselResponsibilities;assert.deepEqual(next,row,collection+' full source history and contacts');
 }
 assert.deepEqual(team(after.payload,'handover-linked','qa-v1'),mode==='handover-reopen'?['qa-operator']:expectedTeam);
 assert.deepEqual(team(after.payload,'handover-meeting-task','qa-v1'),expectedTeam);
 assert.deepEqual(team(after.payload,'handover-member-closed','qa-v1'),mode==='handover-reopen'?['qa-operator']:undefined,'closed member never touched');
 assert.deepEqual(after.payload.agendaReports,before.payload.agendaReports,'frozen report');
 assert.deepEqual(after.payload.notifications,before.payload.notifications,'prior notifications');
 assert.deepEqual(after.payload.taskDismissals,before.payload.taskDismissals,'personal dismissals');
 write('handover-receipt-identity',{operationId:request.p_operation_id,readRevision:request.p_authorization_guard.handoverReadRevision,baseRevision:before.revision});
 receipt.cases.push({caseId:'VH-SINGLE-SHARED-ORIGINAL-SAVE',layer:'original-App-native-input-private-native-PG',status:'PASS'});
 await freshReadback('handover',after);
 // Selectors and normal round-trip use the same durable responsibility, not a global owner replacement.
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts');
 const model=normalizeAppData(after.payload);assert.deepEqual(model.internalControlCases.find(c=>c.id==='handover-case').vesselResponsibilities,after.payload.internalControlCases.find(c=>c.id==='handover-case').vesselResponsibilities,'linked normalizer retains current responsibility');
 const {vesselResponsibilityIncludes}=await qa.loadModule('/src/vesselManagerHandover.ts');
 const shared=model.tasks.find(t=>t.id==='handover-shared'),b=model.users.find(u=>u.id==='qa-spare'),old=model.users.find(u=>u.id==='qa-operator');
 assert.equal(vesselResponsibilityIncludes(shared,model.vessels[0],b),true);assert.equal(vesselResponsibilityIncludes(shared,model.vessels[1],b),false);assert.equal(vesselResponsibilityIncludes(shared,model.vessels[1],old),true);
 const args=[request.p_workspace_key,request.p_operation_id,JSON.stringify(request.p_operations),request.p_saved_by,request.p_actor_user_id,JSON.stringify(request.p_actor_guard),JSON.stringify(request.p_authorization_guard),JSON.stringify(request.p_lock_guards)];
 const replay=(await native.observer.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args)).rows[0].r;
 assert.equal(replay.replayed,true,'exact receipt recovered after read revision and leases advanced');assert.deepEqual(await read(),after,'replay produces no additional writes');
 const altered=[...args];altered[6]=JSON.stringify({...request.p_authorization_guard,handoverReadRevision:after.revision});
 const mismatch=(await native.observer.query('select get_ship_dynamics_record_receipt_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',altered)).rows[0].r;
 assert.equal(mismatch.ok,false,'same op with changed read revision not original receipt');
 if(mode==='handover-authority'){
  const previous=(await read()).payload,task=previous.tasks.find(t=>t.id==='handover-single'),value=structuredClone(task);delete value.vesselResponsibilities;
  const guard={section_key:'task:'+task.id,locked_by:'qa-responsibility-negative'};
  await native.observer.query('select claim_ship_dynamics_edit_lock($1,$2,$3,$4,75)',[qa.workspace,guard.section_key,guard.locked_by,'QA OWNER']);
  const actor=(await native.observer.query('select ship_dynamics_actor_guard($1::jsonb,$2) g',[JSON.stringify(previous),'qa-owner'])).rows[0].g;
  const result=(await native.observer.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,null,$7::jsonb) r',[qa.workspace,'qa-missing-handover-guard',JSON.stringify([{kind:'entity',collection:'tasks',entityId:task.id,expected:task,value}]),'QA OWNER','qa-owner',JSON.stringify(actor),JSON.stringify([guard])])).rows[0].r;
  assert.equal(result.code,'invalid-responsibility-change','ordinary save cannot erase per-vessel responsibility');assert.deepEqual((await read()).payload,previous);
 }
 if(mode==='handover'){
  for(const section of ['船舶','人員']){
   await sub(section);if(section==='人員')await choose('QA SPARE');
   let ordinaryRequest;qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1')ordinaryRequest=body;}});const start=receipt.network.length;await a.click('保存變更');await until(()=>receipt.network.slice(start).some(r=>r.rpc==='apply_ship_dynamics_record_patch_v1'&&r.finished),'ordinary save ACK');await until(()=>a.saved(),'ordinary saved');
   const next=(await read()).payload;for(const key of ['tasks','meetings','internalControlCases'])assert.deepEqual(next[key],after.payload[key],'ordinary unchanged '+section+' responsibilities');
   assert.equal(ordinaryRequest?.p_authorization_guard?.handoverReadRevision,undefined,'ordinary save has no new handover scan/guard');qa.setRecordFault(null);
   receipt.cases.push({caseId:'VH-ORDINARY-NOOP-'+section,layer:'original-App-native-input-private-native-PG',status:'PASS'});
  }
 }
 if(mode==='handover-reopen'){
  setCase('VH-REOPEN-INVALID-RESPONSIBILITY-REJECTED');
  const old=after.payload.tasks.find(t=>t.id==='handover-closed'),bad={...structuredClone(old),isClosed:false,vesselResponsibilities:[{vesselId:'qa-v1',managerUserIds:['qa-admin']}]};
  const guard={section_key:'task:'+old.id,locked_by:'qa-invalid-reopen'};await native.observer.query('select claim_ship_dynamics_edit_lock($1,$2,$3,$4,75)',[qa.workspace,guard.section_key,guard.locked_by,'QA OWNER']);
  const ag=(await native.observer.query('select ship_dynamics_actor_guard($1::jsonb,$2) g',[JSON.stringify(after.payload),'qa-owner'])).rows[0].g;
  const rejected=(await native.observer.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,null,$7::jsonb) r',[qa.workspace,'qa-invalid-reopen',JSON.stringify([{kind:'entity',collection:'tasks',entityId:old.id,expected:old,value:bad}]),'QA OWNER','qa-owner',JSON.stringify(ag),JSON.stringify([guard])])).rows[0].r;
  assert.equal(rejected.code,'invalid-responsibility-change');assert.deepEqual(await read(),after,'wrong current team rejected with zero writes');await native.observer.query('select release_ship_dynamics_edit_lock($1,$2,$3)',[qa.workspace,guard.section_key,guard.locked_by]);
  receipt.cases.push({caseId:'VH-REOPEN-INVALID-RESPONSIBILITY-REJECTED',layer:'private-native-PG',status:'PASS'});
  setCase('VH-EXPLICIT-CLOSED-TASK-REOPEN');
  await a.click('已結案');
  const row="[...document.querySelectorAll('tr')].find(n=>n.innerText.includes('HANDOVER closed'))";
  await until(()=>a.eval(`Boolean(${row})`),'closed task list');await a.activate(`${row}?.querySelector('button')`);
  await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'closed task editor');
  await a.click('重新開啟');await a.click('保存變更');await until(()=>a.saved(),'explicit reopen ACK');
  const reopened=await read();write('reopened-task',reopened);
  assert.equal(reopened.payload.tasks.find(t=>t.id==='handover-closed').isClosed,false,'explicit reopen committed');
  assert.deepEqual(team(reopened.payload,'handover-closed','qa-v1'),expectedTeam,'newly reopened stored team must bind current permanent managers');
  for(const t of after.payload.tasks.filter(t=>t.id!=='handover-closed'))assert.deepEqual(reopened.payload.tasks.find(n=>n.id===t.id),t,'unrelated task untouched');
  await freshReadback('reopened-task',reopened);receipt.cases.push({caseId:'VH-EXPLICIT-CLOSED-TASK-REOPEN',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  const context=(await call('Target.createBrowserContext')).browserContextId,b=await makePage('qa-spare',context);await login(b);
  if(process.env.QA_HANDOVER_MATRIX==='1'){
   setCase('VH-SUCCESSOR-ORDINARY-S1-EDIT');await b.click('船隊看板');await b.open('qa-v1');await b.activate("[...document.querySelectorAll('.modal-task-row')].find(n=>n.innerText.includes('HANDOVER single'))");await until(()=>b.eval("Boolean(document.querySelector('#task-edit-title'))"),'successor ordinary editor');const ordinaryBefore=await read();await b.fill("document.querySelector('.quick-status-bar textarea')",'SUCCESSOR ORDINARY UPDATE');await b.click('加入狀態紀錄');await b.click('保存變更');await until(()=>b.eval("!document.querySelector('#task-edit-title')"),'ordinary successor saved');await b.click('取消並關閉');await until(()=>b.saved(),'ordinary successor ACK');const ordinaryAfter=await read();assert.equal(ordinaryAfter.payload.tasks.find(t=>t.id==='handover-single').status,'SUCCESSOR ORDINARY UPDATE');for(const t of ordinaryBefore.payload.tasks.filter(t=>t.id!=='handover-single'))assert.deepEqual(ordinaryAfter.payload.tasks.find(n=>n.id===t.id),t,'ordinary edit does not touch other tasks');assert.deepEqual(ordinaryAfter.payload.vessels.find(v=>v.id==='qa-v2'),ordinaryBefore.payload.vessels.find(v=>v.id==='qa-v2'));receipt.cases.push({caseId:'VH-SUCCESSOR-ORDINARY-S1-EDIT',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  }
  const openMember=async description=>{await b.click('船隊看板');await b.open('qa-v1');await b.activate(`[...document.querySelectorAll('.modal-task-row')].find(n=>n.innerText.includes(${JSON.stringify(description)}))`);await until(()=>b.eval("document.querySelector('[aria-label=單船目前狀態]')?.contentEditable==='true'"),'successor member lease');};
  setCase('VH-SUCCESSOR-S1-ONLY-MEMBER-EDIT');await openMember('HANDOVER meeting');
  assert.equal(await b.eval("[...document.querySelector('select[aria-label=待辦進度範圍]').options].some(o=>o.value==='qa-v2')"),false,'S2 not an editable successor scope');
  const memberBefore=await read();await b.fill("document.querySelector('.quick-status-bar textarea')",'SUCCESSOR S1 UPDATE');await b.click('加入狀態紀錄');await b.click('保存變更');
  await until(()=>b.eval("!document.querySelector('#task-edit-title')"),'member saved');await b.click('取消並關閉');await until(()=>b.saved(),'successor saved');
  const edited=await read(),get=(d,id)=>d.payload.tasks.find(t=>t.id===id);
  assert.equal(get(edited,'handover-meeting-task').vesselProgress.find(r=>r.vesselId==='qa-v1').status,'SUCCESSOR S1 UPDATE');
  assert.deepEqual(get(edited,'handover-meeting-task').vesselProgress.find(r=>r.vesselId==='qa-v2'),get(memberBefore,'handover-meeting-task').vesselProgress.find(r=>r.vesselId==='qa-v2'),'S2 exact member history retained');
  assert.deepEqual(get(edited,'handover-meeting-task').ownerUserIds,get(memberBefore,'handover-meeting-task').ownerUserIds,'independent same-ID common contacts retained');
  receipt.cases.push({caseId:'VH-SUCCESSOR-S1-ONLY-MEMBER-EDIT',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  setCase('VH-SUCCESSOR-CLOSED-MEMBER-REOPEN');await b.click('已結案');const closedRow="[...document.querySelectorAll('tr')].find(n=>n.innerText.includes('HANDOVER closed member'))";await until(()=>b.eval(`Boolean(${closedRow})`),'successor closed member list');await b.activate(`${closedRow}?.querySelector('button')`);await until(()=>b.eval("Boolean(document.querySelector('#task-edit-title'))"),'closed member editor');await b.click('重新開啟');await b.click('保存變更');
  await until(()=>b.eval("!document.querySelector('#task-edit-title')"),'member reopened');await until(()=>b.saved(),'successor reopen saved');
  const mr=await read();write('member-reopened',mr);assert.deepEqual(team(mr.payload,'handover-member-closed','qa-v1'),expectedTeam,'explicit member reopen rebinds old stored team');
  assert.deepEqual(get(mr,'handover-member-closed').vesselProgress.find(r=>r.vesselId==='qa-v2'),get(edited,'handover-member-closed').vesselProgress.find(r=>r.vesselId==='qa-v2'));
  assert.deepEqual(team(mr.payload,'handover-member-closed','qa-v2'),['qa-operator']);
  setCase('VH-EXPLICIT-MEETING-REOPEN');await a.click('臨會/專題');await a.click('已完成清單');
  const meetingRow="[...document.querySelectorAll('.meeting-register-table tr')].find(n=>n.innerText.includes('HANDOVER CLOSED MEETING'))";
  await until(()=>a.eval(`Boolean(${meetingRow})`),'closed meeting list');await a.activate(`${meetingRow}?.querySelector('button')`);
  if(process.env.QA_HANDOVER_MATRIX==='1'){
   await a.click('取得編輯權');const select="[...document.querySelectorAll('select[required]')].find(n=>[...n.options].some(o=>o.value==='追蹤中')&&[...n.options].some(o=>o.value==='已完成'))";await until(()=>a.eval(`Boolean(${select})&&!(${select}).disabled&&!(${select}).closest('fieldset[disabled]')`),'meeting status editor');const idx=await a.eval(`[...(${select}).options].findIndex(o=>o.value==='追蹤中')`);assert.ok(idx>=0);await a.eval(`(${select}).focus()`);await a.key('Home','Home');for(let i=0;i<idx;i++)await a.key('ArrowDown','ArrowDown');await a.key('Tab','Tab');assert.equal(await a.eval(`(${select}).value`),'追蹤中');await a.click('保存並退出編輯');
  }else await a.click('重新開啟會議');await until(async()=>(await read()).payload.meetings.find(m=>m.id==='handover-closed-meeting').status==='追蹤中','meeting reopen SQL');await until(()=>a.saved(),'meeting reopen ACK');
  const reopenedMeeting=await read();write('meeting-reopened',reopenedMeeting);const rm=reopenedMeeting.payload.meetings.find(m=>m.id==='handover-closed-meeting');
  assert.deepEqual(rm.vesselResponsibilities,[{vesselId:'qa-v1',managerUserIds:expectedTeam},{vesselId:'qa-v2',managerUserIds:['qa-operator']},{vesselId:'retained-vessel-history',managerUserIds:['qa-operator']}],'explicit whole meeting reopen binds current team');
  assert.deepEqual(reopenedMeeting.payload.tasks,mr.payload.tasks,'whole meeting reopen must not reopen children');
  receipt.cases.push({caseId:'VH-EXPLICIT-MEETING-REOPEN',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  const caseActor=process.env.QA_HANDOVER_MATRIX==='1'?b:a;
  setCase('VH-EXPLICIT-LINKED-AND-STANDALONE-CASE-REOPEN');await caseActor.click('內控異常');await until(()=>caseActor.eval("Boolean(document.querySelector('.ic-tabs'))"),'case page ready');
  for(const [id,description] of [['handover-case','HANDOVER linked'],['handover-standalone','HANDOVER standalone closed']]){
   await caseActor.activate("[...document.querySelectorAll('.ic-tabs button')].find(n=>n.innerText.startsWith('內控結案清單'))");
   const row=`[...document.querySelectorAll('.internal-control-page tr')].find(n=>n.innerText.includes(${JSON.stringify(description)}))`;
   await until(()=>caseActor.eval(`Boolean(${row})`),'closed case row');await caseActor.activate(`${row}?.querySelector('button')`);await until(()=>caseActor.eval("Boolean(document.querySelector('.ic-close-toggle input'))"),'case reopen toggle');
   await caseActor.eval("document.querySelector('.ic-close-toggle input').focus()");await caseActor.key(' ','Space');await caseActor.click('保存更新');await until(()=>caseActor.saved(),'case reopen ACK');
   const c=await read();write('case-reopened-'+id,c);assert.equal(c.payload.internalControlCases.find(c=>c.id===id).isClosed,false);assert.deepEqual(c.payload.internalControlCases.find(c=>c.id===id).vesselResponsibilities,[{vesselId:'qa-v1',managerUserIds:expectedTeam}],'explicit case reopen rebinds stored team');
   if(id==='handover-case'){assert.equal(c.payload.tasks.find(t=>t.id==='handover-linked').isClosed,false);assert.deepEqual(team(c.payload,'handover-linked','qa-v1'),expectedTeam,'linked task reopen in same transaction');}
  }
  receipt.cases.push({caseId:'VH-EXPLICIT-LINKED-AND-STANDALONE-CASE-REOPEN',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  if(process.env.QA_HANDOVER_MATRIX==='1')receipt.cases.push({caseId:'VH-SUCCESSOR-LINKED-STANDALONE-CASE-AND-MEETING-EDITOR',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  const final=await read();assert.deepEqual(final.payload.taskDismissals,before.payload.taskDismissals,'reopens keep each personal dismissal owner');await freshReadback('all-reopens',final);
  await b.activate("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>b.eval("Boolean(document.querySelector('.work-task-list'))"),'successor work list');
  assert.equal(await b.eval("[...document.querySelectorAll('.work-task-row')].some(n=>n.innerText.includes('HANDOVER single'))"),false,'B personal dismissal retained');
  assert.equal(final.payload.tasks.some(t=>t.id==='handover-single'),true,'personal marker never deletes common record');
  await a.activate("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>a.eval("Boolean(document.querySelector('.work-task-list'))"),'other common contact work list');
  assert.equal(await a.eval("[...document.querySelectorAll('.work-task-row')].some(n=>n.innerText.includes('HANDOVER single'))"),true,'other responsible user still sees personally dismissed task');
  assert.deepEqual(final.payload.agendaReports,before.payload.agendaReports,'frozen report histories retained after explicit reopens');
  for(const key of ['tasks','meetings','internalControlCases'])for(const old of before.payload[key]){const now=final.payload[key].find(r=>r.id===old.id);assert.equal(now.createdBy,old.createdBy);assert.equal(now.createdAt,old.createdAt);for(const contacts of ['ownerUserIds','trackingUserIds','responsibleUserIds','participantUserIds'])assert.deepEqual(now[contacts],old[contacts],'independent contacts '+key+' '+old.id);assert.deepEqual((now.statusLogs||[]).slice(-(old.statusLogs||[]).length),old.statusLogs||[],'existing authored history '+key+' '+old.id);}
  receipt.cases.push({caseId:'VH-PERSONAL-DISMISSAL-OWNERSHIP',layer:'original-App-native-input-private-native-PG',status:'PASS'});
  await b.screen('successor-1440');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},b.s);await b.screen('successor-390');
  receipt.cases.push({caseId:'VH-SUCCESSOR-CLOSED-MEMBER-REOPEN',layer:'original-App-native-input-private-native-PG',status:'PASS'});

 }
 if(mode==='handover-lost')assert.ok(receipt.network.some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'&&r.operationId===request.p_operation_id&&r.finished),'same operation receipt reconciled');
 receipt.cases.push({caseId:mode,layer:'original-App-native-input-private-native-PG',status:'PASS'});
 receipt.cases.push({caseId:'VH-FRESH-READBACK',layer:'original-App-new-document-native-PG',status:'PASS'});
}
