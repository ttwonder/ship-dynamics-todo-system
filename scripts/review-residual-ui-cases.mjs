import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function prepareFixture(initial,vite){
 const at=initial.updatedAt,owner=initial.users[0],template=structuredClone(initial.tasks[0]),meetingTemplate=structuredClone(initial.meetings[0]);
 initial.users.push({...structuredClone(owner),id:'qa-vessel',name:'QA VESSEL ACCOUNT',username:'qa-vessel',role:'vessel',managedVesselIds:['qa-v1']});
 initial.settings.departments=['督導'];
 initial.vessels.forEach(v=>{v.assignedUserIds=['qa-owner'];v.delegateManagers=[];v.weeklyAttention=[];v.manualAttentionLevel='';});
 for(const k of ['tasks','meetings','internalControlCases','taskDismissals','notifications','auditLogs','agendaReports'])initial[k]=[];
 const {reconcileMeetingTasks,meetingDecisionCompletionSummary}=await vite.ssrLoadModule('/src/meetingTaskWorkflow.ts');
 const category=initial.settings.meetingTaskCategories[0];
 const logSet=prefix=>[4,3,2,1].map(n=>({id:prefix+'-'+n,at:new Date(Date.parse(at)-(4-n)*86400000).toISOString(),by:'QA OWNER',byUserId:'qa-owner',text:prefix+(n===1?'_OLDEST_SENTINEL':n===2?'_SECOND_OLDEST_SENTINEL':'_RECENT_'+n)}));
 const meeting=(id,subject,vessels)=>({...structuredClone(meetingTemplate),id,subject,meetingDate:at.slice(0,10),status:'進行中',vessels,vesselScopeMode:'vessels',reason:'Synthetic residual UI verification',departments:['督導'],participantUserIds:['qa-owner'],trackingUserIds:['qa-owner'],responsibleUserIds:['qa-owner'],isInternalControl:false,isAbnormal:false,taskItems:[],taskDescription:'',resolution:'QA resolution',statusLogs:[]});
 for(const [id,label,closed] of [['residual-shared','R6A SHARED HISTORY',false],['residual-closed','R2A CLOSED SHARED',true]]){
  const m=meeting(id+'-meeting',label+' MEETING',['qa-v1','qa-v2']);
  m.taskItems=[{id:id+'-item',description:label,categories:[category],distributeToVessels:true,isClosed:closed,...(closed?{closedDate:at.slice(0,10),closedBy:'qa-owner'}:{})}];
  const result=reconcileMeetingTasks({tasks:initial.tasks,meetingId:m.id,vesselIds:m.vessels,vesselScopeMode:'vessels',followUps:m.taskItems,priority:'中',expectedDate:'',departments:['督導'],ownerUserIds:['qa-owner'],meetingTaskCategories:initial.settings.meetingTaskCategories,initialStatus:'QA current',actorId:'qa-owner',actorName:'QA OWNER',at,createTaskId:()=>id});
  assert.equal(result.created.length,1);const task=result.created[0];
  task.isClosed=closed;task.statusLogs=logSet(id+'_OVERALL');
  if(closed){task.closedDate=at.slice(0,10);task.closedBy='qa-owner';}
  task.vesselProgress=['qa-v1','qa-v2'].map((vesselId,i)=>({vesselId,status:'QA member '+vesselId,isClosed:closed,updatedAt:at,updatedBy:'qa-owner',statusLogs:logSet(id+(i===0?'_A':'_B')),...(closed?{closedDate:at.slice(0,10),closedBy:'qa-owner'}:{})}));
  initial.meetings.push(m);
  const summary=meetingDecisionCompletionSummary(m,initial.tasks);assert.equal(summary.allCompleted,closed);assert.equal(summary.items[0].state,closed?'closed':'open');
 }
 const plain={...template,id:'residual-plain',description:'R6A PLAIN CONTROL',internalControlCaseId:undefined,sourceInternalControlCaseId:undefined,isInternalControl:false,isAbnormal:false,isAware:false,sourceType:'manual',sourceMeetingId:undefined,sourceMeetingItemId:undefined,distributeToVessels:false,vesselId:'qa-v1',vesselIds:['qa-v1'],vesselProgress:[],ownerUserIds:['qa-owner'],isClosed:true,closedDate:at.slice(0,10),closedBy:'qa-owner',statusLogs:logSet('PLAIN_A'),status:'QA plain closed',attentionDimension:'task'};
 initial.tasks.push(plain);initial.meetings.unshift(meeting('residual-meeting','R2B EDIT MEETING',['qa-v1']));
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');Object.assign(initial,normalizeAppData(initial));
}

export async function runCases({a,qa,read,call,until,wait,write,receipt,setCase,setRelease,native,makePage,login,run,save}){
 const modal="document.querySelector('[role=dialog][aria-labelledby=task-edit-title]')";
 const history="[...document.querySelectorAll('[aria-labelledby=task-edit-title] .status-history article b')].map(n=>n.textContent)";
 const choose=async(p,expr,value)=>{const i=await p.eval(`(()=>{const n=${expr};if(!n||n.disabled)throw Error('enabled select required');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(i>=0);await p.key('Home');for(let j=0;j<i;j++)await p.key('ArrowDown');await p.key('Enter');await until(()=>p.eval(`(${expr}).value===${JSON.stringify(value)}`),'selected '+value);};
 const detail=async p=>{await p.activate("[...document.querySelectorAll('.ship-name-link')].find(n=>n.innerText==='QA VESSEL 1')");await until(()=>p.eval("Boolean(document.querySelector('.vessel-detail-task-table'))"),'vessel detail');};
 const taskFromDetail=async(p,label)=>{const e=`[...document.querySelectorAll('.vessel-detail-task-table tbody tr')].find(n=>n.innerText.includes(${JSON.stringify(label)}))?.querySelector('button')`;await until(()=>p.eval(`Boolean(${e})`),'detail row '+label);await p.activate(e);await until(()=>p.eval(`Boolean(${modal})`),'task dialog '+label);};
 const taskFromList=async(p,label)=>{const e=`[...document.querySelectorAll('.selected-task-list-panel .task-link')].find(n=>n.innerText===${JSON.stringify(label)})`;await until(()=>p.eval(`Boolean(${e})`),'task list '+label);await p.activate(e);await until(()=>p.eval(`Boolean(${modal})`),'task dialog '+label);};
 const fresh=async()=>{const c=await native.connect('residual_fresh');try{return (await c.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;}finally{await c.end();}};
 const capture=async(p,id)=>{write(id+'-dom',{text:await p.text(),history:await p.eval(history)});await p.screen(id);};
 const row=(id,layer='original-App-native-PG')=>{const r={caseId:id,status:'INCOMPLETE',layer};receipt.cases.push(r);setCase(id);save();return r;};
 const network=()=>receipt.network.length;
 const mode=process.env.RESIDUAL_CASE||'all';
 if(mode==='all'||mode==='R6a-F1'){
  const r=row('R6a-F1');const before=await fresh();write('R6a-F1-before',before);
  const context=(await call('Target.createBrowserContext')).browserContextId,p=await makePage('qa-vessel',context);await login(p);
  const initialNetwork=receipt.network.filter(n=>n.actor==='qa-vessel');assert.ok(initialNetwork.some(n=>n.rpc==='read_ship_dynamics_record_scopes_v1'&&n.readScope==='home'));
  assert.equal(initialNetwork.some(n=>n.rpc==='read_ship_dynamics_task_member_v1'),false);
  await detail(p);const start=network();await taskFromDetail(p,'R6A SHARED HISTORY');
  await until(()=>p.eval(`${history}.length>=2`),'readonly history ready');await wait(250);
  const seen=await p.eval(history),stored=before.payload.tasks.find(t=>t.id==='residual-shared').vesselProgress.find(v=>v.vesselId==='qa-v1').statusLogs.map(l=>l.text);
  assert.equal(stored.length,4);assert.ok(stored.includes('residual-shared_A_OLDEST_SENTINEL'));assert.deepEqual(seen,stored,'read-only member must receive all four histories');assert.equal(seen.includes('residual-shared_A_OLDEST_SENTINEL'),true);
  const reads=receipt.network.slice(start).filter(n=>n.actor==='qa-vessel');assert.equal(reads.some(n=>n.rpc==='read_ship_dynamics_task_member_v1'||n.targets?.some(t=>t.collection==='tasks'&&t.id==='residual-shared')),true);
  assert.equal(reads.some(n=>/claim_|apply_|save_/.test(n.rpc)),false);assert.equal((await p.text()).includes('residual-shared_B_'),false);
  r.outcome={storedA:stored,displayedA:seen,oldestMissing:false,exactTaskOrMemberRead:true,writeOrClaim:false,otherVesselHistoryVisible:false};await capture(p,'R6a-F1-bad');
  await p.click('關閉');await until(()=>p.eval(`!(${modal})`),'close readonly');const controlStart=network();await taskFromDetail(p,'R6A PLAIN CONTROL');
  await until(()=>p.eval(`${history}.includes('PLAIN_A_OLDEST_SENTINEL')`),'nonmember complete history');const plainSeen=await p.eval(history);assert.equal(plainSeen.length,4);
  assert.ok(receipt.network.slice(controlStart).some(n=>n.actor==='qa-vessel'&&n.targets?.some(t=>t.id==='residual-plain')));await capture(p,'R6a-F1-plain-control');await p.click('關閉');
  await login(a);await detail(a);const memberStart=network();await taskFromDetail(a,'R6A SHARED HISTORY');await until(()=>a.eval(`${history}.includes('residual-shared_A_OLDEST_SENTINEL')`),'writable member exact history');assert.equal((await a.eval(history)).length,4);assert.ok(receipt.network.slice(memberStart).some(n=>n.rpc==='read_ship_dynamics_task_member_v1'&&n.request.p_task_id==='residual-shared'));await capture(a,'R6a-F1-member-control');await a.click('取消');await until(()=>a.eval(`!(${modal})`),'member control fully detached');
  const after=await fresh();assert.deepEqual(after,before,'read-only and edit-open controls do not write business records');write('R6a-F1-after',after);
  r.positiveControl={nonmemberReadOnly:plainSeen,editableMemberAllFour:true,dbUnchanged:true};r.status='PASS';write('R6a-F1-case-receipt',r);save();
  await a.click('← 回到船隊看板');
 }
 if(mode==='all'||mode==='R2a-F01'){
  const r=row('R2a-F01');if(mode!=='all')await login(a);await a.click('已結案');await until(()=>a.eval("Boolean(document.querySelector('.selected-task-list-panel'))"),'closed task list');await a.click('清除篩選');await taskFromList(a,'R2A CLOSED SHARED');
  await choose(a,"document.querySelector('select[aria-label=待辦進度範圍]')",'overall');await until(()=>a.eval(`Boolean((${modal})?.querySelector('button.btn.primary'))&&!(${modal}).querySelector('button.btn.primary').disabled&&document.querySelector('select[aria-label=待辦進度範圍]').value==='overall'`),'overall writable lifecycle');
  const before=await fresh(),start=network(),dialogs=(receipt.dialogs||[]).length;
  r.controlsBefore=await a.eval(`({scope:document.querySelector('select[aria-label=待辦進度範圍]').value,dateEnabled:!document.querySelector('.task-completion-date-row input').disabled,date:document.querySelector('.task-completion-date-row input').value,reopenEnabled:[...(${modal}).querySelectorAll('button')].some(n=>n.innerText==='重新開啟'&&!n.disabled)})`);
  assert.equal(r.controlsBefore.reopenEnabled,false,'overall lifecycle cannot be submitted');assert.equal(r.controlsBefore.dateEnabled,false);
  assert.deepEqual(await fresh(),before);assert.equal(receipt.network.slice(start).some(n=>n.rpc==='apply_ship_dynamics_record_patch_v1'),false);r.outcome={overallLifecycleDisabled:true,sqlUnchanged:true,patchSent:false};write('R2a-F01-before',before);await capture(a,'R2a-F01-disabled');await a.click('取消');await until(()=>a.eval(`!(${modal})`),'overall editor detached');
  await taskFromList(a,'R2A CLOSED SHARED');await choose(a,"document.querySelector('select[aria-label=待辦進度範圍]')",'qa-v1');await until(()=>a.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v1'&&[...document.querySelectorAll('[role=dialog] button')].some(n=>n.innerText==='重新開啟'&&!n.disabled)"),'A member scope ready');const memberBase=await fresh(),controlStart=network();await a.click('重新開啟');await a.click('保存變更');await until(()=>a.eval(`!(${modal})`),'single vessel reopen saved');const after=await fresh();const oldTask=memberBase.payload.tasks.find(t=>t.id==='residual-closed'),newTask=after.payload.tasks.find(t=>t.id==='residual-closed');assert.equal(newTask.vesselProgress.find(p=>p.vesselId==='qa-v1').isClosed,false);assert.deepEqual(newTask.vesselProgress.find(p=>p.vesselId==='qa-v2'),oldTask.vesselProgress.find(p=>p.vesselId==='qa-v2'));assert.ok(receipt.network.slice(controlStart).some(n=>n.rpc==='save_ship_dynamics_task_member_v1'&&n.finished));
  r.positiveControl={singleVesselReopenPersisted:true,otherVesselExactUnchanged:true};write('R2a-F01-control-after',after);r.status='PASS';write('R2a-F01-case-receipt',r);save();
 }
 if(mode==='all'||mode==='R2b-F01'){
  const r=row('R2b-F01');if(mode!=='all')await login(a);await a.click('臨會/專題');const meetingButton="[...document.querySelectorAll('.temporary-meeting-item')].find(n=>n.innerText.includes('R2B EDIT MEETING'))";await until(()=>a.eval(`Boolean(${meetingButton})`),'meeting list');await a.activate(meetingButton);
  const subject="document.querySelector('.temporary-form-fields input[placeholder=\"例如：颱風避風臨時協調會\"]')";
  await until(()=>a.eval(`Boolean(${meetingButton})&&(${meetingButton}).classList.contains('active')&&Boolean(${subject})&&(${subject}).value==='R2B EDIT MEETING'`),'exact selected meeting and displayed subject ready');
  r.selectionReady={meetingId:'residual-meeting',subject:await a.eval(`(${subject}).value`),active:await a.eval(`(${meetingButton}).classList.contains('active')`)};save();
  const attempt=async(late)=>{await a.click('取得編輯權');await until(()=>a.eval(`Boolean(${subject})&&!(${subject}).matches(':disabled')`),'meeting editing');const sent=late?'R2B SENT A':'R2B CLEAN CONTROL';await a.fill(subject,sent);
   let held=false,release;qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await new Promise(resolve=>{release=resolve;setRelease(resolve);});}return false;}});
   const start=network();await a.click('保存並退出編輯');await until(()=>held,'SQL committed ACK held');const sqlHeld=await fresh();assert.equal(sqlHeld.payload.meetings.find(m=>m.id==='residual-meeting').subject,sent);write('R2b-'+(late?'late':'clean')+'-sql-held',sqlHeld);
   const enabled=await a.eval(`!(${subject}).matches(':disabled')`);assert.equal(enabled,true);
   if(late){await a.fill(subject,'R2B UNSENT B SENTINEL');assert.equal(await a.eval(`(${subject}).value`),'R2B UNSENT B SENTINEL');await capture(a,'R2b-F01-B-before-ACK');}
   release();await until(()=>receipt.network.slice(start).some(n=>n.rpc==='apply_ship_dynamics_record_patch_v1'&&n.finished),'native ACK finished');await wait(200);const value=await a.eval(`(${subject}).value`);const final=await fresh();assert.equal(final.payload.meetings.find(m=>m.id==='residual-meeting').subject,sent);qa.setRecordFault(null);
   if(!late){await until(()=>a.eval(`(${subject}).matches(':disabled')`),'clean save exits');assert.equal(value,sent);await capture(a,'R2b-F01-clean-control');return {sent,uiAfterAck:value,sqlAfterAck:sent,exited:true};}
   assert.equal(value,'R2B UNSENT B SENTINEL','late input must survive committed A acknowledgement');assert.equal(await a.eval(`(${subject}).matches(':disabled')`),false,'keep editing B');const locks=(await native.observer.query("select section_key from ship_dynamics_edit_locks where expires_at>now()")).rows;assert.ok(locks.some(x=>x.section_key==='meeting:residual-meeting'),'retain existing meeting lease');write('R2b-F01-A-committed-B-retained',{ui:value,sql:final,locks});await capture(a,'R2b-F01-B-retained');
   const nextStart=network();await a.click('保存並退出編輯');await until(()=>a.eval(`(${subject}).matches(':disabled')`),'later B save clean exit');const savedB=await fresh();assert.equal(savedB.payload.meetings.find(m=>m.id==='residual-meeting').subject,'R2B UNSENT B SENTINEL');assert.ok(receipt.network.slice(nextStart).some(n=>n.rpc==='apply_ship_dynamics_record_patch_v1'&&n.finished));write('R2b-F01-B-saved-readback',savedB);return {sent,sqlAfterAck:sent,uiAfterAck:value,exited:false,newerInputPreserved:true,leaseRetained:true,followupSavePersisted:true};
  };
  r.positiveControl=await attempt(false);r.outcome=await attempt(true);
  const nextMeeting="[...document.querySelectorAll('.temporary-meeting-item')].find(n=>n.innerText.includes('R6A SHARED HISTORY MEETING'))";await a.activate(nextMeeting);await until(()=>a.eval(`(${nextMeeting}).classList.contains('active')&&(${subject}).value==='R6A SHARED HISTORY MEETING'`),'continuation selected meeting ready');await a.click('取得編輯權');await until(()=>a.eval(`!(${subject}).matches(':disabled')`),'continuation editing');await a.fill(subject,'R2B CONTINUATION A');let held=false,release;
  qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await new Promise(resolve=>{release=resolve;setRelease(resolve);});}return false;}});
  const followStart=network();await a.activate("document.querySelector('.meeting-inline-decision-update')");await until(()=>held,'save before opening decision task committed');const quick="document.querySelector('textarea[aria-label=會議最新狀態]')";await a.fill(quick,'R2B QUICK B SENTINEL');await a.eval(`void(window.__residualQuick=${quick})`);release();await until(()=>receipt.network.slice(followStart).some(n=>n.rpc==='apply_ship_dynamics_record_patch_v1'&&n.finished),'continuation ACK');await wait(200);assert.equal(await a.eval(`(${quick}).value`),'R2B QUICK B SENTINEL');assert.equal(await a.eval(`(${quick})===window.__residualQuick&&!(${quick}).matches(':disabled')`),true);assert.equal(await a.eval(`Boolean(${modal})`),false,'unsubmitted late input blocks task-open continuation');qa.setRecordFault(null);const continued=await fresh();assert.equal(continued.payload.meetings.find(x=>x.id==='residual-shared-meeting').subject,'R2B CONTINUATION A');assert.ok(!JSON.stringify(continued.payload.meetings).includes('R2B QUICK B SENTINEL'));await a.click('加入狀態紀錄');await a.click('保存並退出編輯');await until(()=>a.eval(`(${subject}).matches(':disabled')`),'quick follow-up saved');const savedQuick=await fresh();assert.ok(savedQuick.payload.meetings.find(x=>x.id==='residual-shared-meeting').statusLogs.some(x=>x.text==='R2B QUICK B SENTINEL'));write('R2b-F01-quick-continuation-readback',{continued,savedQuick});r.quickAndContinuation={sameNode:true,lateQuickPreserved:true,noTaskOpen:true,followupStatusSaved:true};r.status='PASS';write('R2b-F01-after',await fresh());write('R2b-F01-case-receipt',r);save();
 }
 assert.equal(receipt.cases.length,mode==='all'?3:1);assert.ok(receipt.cases.every(c=>c.status==='PASS'||c.status==='REJECTED'));
}
