import assert from 'node:assert/strict';
export function prepareVesselLifecycle(initial){
 initial.vessels[1].assignedUserIds=['qa-operator'];initial.vessels[1].delegateManagers=[];
 initial.users.find(u=>u.id==='qa-operator').managedVesselIds=['qa-v2'];
 initial.users.find(u=>u.id==='qa-vessel').managedVesselIds=['qa-v2'];
 initial.tasks.find(t=>t.id==='stats-c').ownerUserIds=['qa-operator'];
 const shared=initial.tasks.find(t=>t.id==='stats-d');shared.sourceMeetingItemId='stats-decision';shared.isClosed=false;shared.vesselProgress.find(p=>p.vesselId==='qa-v1').isClosed=false;
 const closed=structuredClone(initial.internalControlCases[0]);Object.assign(closed,{id:'vlc-closed-case',description:'VLC CLOSED CASE',isClosed:true,closedDate:closed.reportDate,closedBy:'qa-owner',syncToTask:false,linkedTaskId:undefined});initial.internalControlCases.push(closed);
}
export async function runVesselLifecycle({a,qa,read,call,until,wait,write,receipt,setCase,setRelease,freshReadback,mode}){
 const {applyCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const sub=async()=>{await until(()=>a.eval("Boolean(document.querySelector('.management-sidebar'))"),'management navigation settled');await a.activate("[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith('船舶'))");};
 const choose=()=>a.activate("[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText==='QA VESSEL 2')");
 const check=label=>`[...document.querySelectorAll('.management-view label')].find(n=>n.textContent.trim()===${JSON.stringify(label)})?.querySelector('input[type=checkbox]')`;
 const toggle=async label=>{await a.eval(`(${check(label)}).focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},a.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},a.s);};
 const hasShip=()=>a.eval("[...document.querySelectorAll('.management-master .management-list button b')].some(n=>n.innerText==='QA VESSEL 2')");
 const pass=id=>receipt.cases.push({caseId:id,layer:'original-UI-native-PG',status:'PASS'});
 await a.click('待辦總表');await until(()=>a.eval("Boolean(document.querySelector('.selected-task-list-panel'))"),'baseline daily list');await a.sync();await a.click('清除篩選');await until(async()=>(await a.text()).includes('STATS C'),'active baseline before disable');
 await a.click('管理');await sub();assert.equal(await a.eval(`(${check('顯示停用船舶')}).checked`),false);await choose();
 await a.eval("void(window.__vlcNotices=[]);void(new MutationObserver(()=>{const n=document.querySelector('.management-save-toast');if(n)window.__vlcNotices.push(n.textContent);}).observe(document.body,{childList:true,subtree:true,characterData:true}))");
 const negative=mode!=='lifecycle';
 for(const entry of negative?['checkbox']:['disable','enable','checkbox','enable-again']){
  const caseId='VLC-NATIVE-'+mode+'-'+entry;setCase(caseId);const activating=entry.startsWith('enable');
  if(activating){await toggle('顯示停用船舶');assert.equal(await hasShip(),true);await choose();assert.equal(await a.eval(`(${check('啟用此船舶')}).checked`),false);}
  if(entry!=='disable')await toggle('啟用此船舶');
  const before=await read(),started=Date.now(),networkStart=receipt.network.length;let expected,held=false,release,rejected=mode==='lifecycle-rejected',drop=false;
  write(caseId+'-before',before);write(caseId+'-intent',{id:'qa-v2',isActive:activating,entry});
  qa.setRecordFault({before:async({name,body})=>{
   if(name!=='apply_ship_dynamics_record_patch_v1')return;
   const ops=body.p_operations;expected=structuredClone(before.payload);
   const sent=ops.find(o=>o.kind==='entity'&&o.collection==='vessels'&&o.entityId==='qa-v2')?.value;assert.ok(sent);
   const bounded=at=>{assert.ok(Date.parse(at)>=started-1000&&Date.parse(at)<=Date.now()+1000);return at;};
   const vessel=expected.vessels.find(v=>v.id==='qa-v2');vessel.isActive=activating;vessel.updatedAt=bounded(sent.updatedAt);
   if(!activating)expected.users.filter(u=>u.role==='vessel'&&u.managedVesselIds.includes(vessel.id)).forEach(u=>u.isActive=false);
   const sentAudit=ops.find(o=>o.kind==='entity'&&o.collection==='auditLogs')?.value;assert.ok(sentAudit);assert.ok(!expected.auditLogs.some(x=>x.id===sentAudit.id));
   const audit={id:sentAudit.id,at:bounded(sentAudit.at),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:entry==='disable'?'停用船舶':'更新船舶',entityType:'vessel',entityId:'qa-v2',detail:'QA VESSEL 2'};assert.deepEqual(sentAudit,audit);expected.auditLogs=[audit,...expected.auditLogs].slice(0,500);
   assert.deepEqual(applyCloudBlockPatch(before.payload,ops),expected,'independent full intent before SQL');audit.ipAddress='192.0.2.30';audit.ipCountryCode='TW';write(caseId+'-expected-before-sql',expected);
   if(rejected)body.p_lock_guards=[...body.p_lock_guards,{section_key:'vessel:qa-v2',locked_by:'qa-invalid-vlc-guard'}];
  },after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;if(mode==='lifecycle-lost'){drop=true;return true;}if(!rejected)await new Promise(r=>{release=r;setRelease(r);});}if(mode==='lifecycle-readback-fail'&&held&&name==='read_ship_dynamics_record_scopes_v1')throw new Error('QA VLC readback unavailable');return false;}});
  await a.eval('void(window.__vlcNotices=[])');await a.click(entry==='disable'?'停用':'保存變更');await until(()=>held,'native SQL outcome');
  if(rejected){await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'rejection feedback');assert.deepEqual(await read(),before);assert.deepEqual(await a.eval('window.__vlcNotices'),[]);assert.equal(await a.eval(`(${check('啟用此船舶')}).checked`),false);pass(caseId);break;}
  if(!drop){assert.deepEqual(await a.eval('window.__vlcNotices'),[]);assert.equal(await hasShip(),true,'master list waits for ACK or explicit inactive inclusion');await a.screen(caseId+'-held');release();}
  if(mode==='lifecycle-readback-fail'){await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'readback failure feedback',40000);assert.deepEqual(await a.eval('window.__vlcNotices'),[]);assert.equal(await a.eval(`(${check('啟用此船舶')}).checked`),false);pass(caseId);break;}
  await until(()=>receipt.network.slice(networkStart).some(r=>r.rpc==='apply_ship_dynamics_record_patch_v1'&&r.finished)||drop,'ACK body');
  if(entry==='disable')await until(async()=>!(await hasShip()),'confirmed disabled list');else await until(()=>a.eval("Boolean(document.querySelector('.management-save-toast'))"),'confirmed original save');
  if(drop)assert.ok(receipt.network.slice(networkStart).some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'),'same-operation receipt recovery');
  const after=await read();assert.equal(after.revision,before.revision+1);assert.deepEqual(after.payload,{...expected,revision:after.revision,updatedAt:after.payload.updatedAt},'complete SQL graph retains all business history');write(caseId+'-after',after);await freshReadback(caseId,after);
  assert.equal(after.payload.users.find(u=>u.id==='qa-vessel').isActive,false,'reactivation never enables account');
  qa.setRecordFault(null);pass(caseId);
  if(entry==='disable'){
   setCase('VLC-4-active-shared-member-save');const memberBefore=await read();let graph;
   await a.click('船隊看板');await a.open('qa-v1');await a.activate("[...document.querySelectorAll('.modal-task-row')].find(n=>n.innerText.includes('STATS D'))");await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'active shared member editor');
   await a.fill("document.querySelector('.quick-status-bar textarea')",'VLC ACTIVE MEMBER');await a.click('加入狀態紀錄');
   qa.setRecordFault({before:async({name,body})=>{if(name!=='save_ship_dynamics_task_member_v1')return;assert.equal(body.p_task_id,'stats-d');assert.equal(body.p_vessel_id,'qa-v1');assert.equal(body.p_command.status,'VLC ACTIVE MEMBER');graph=await (await import('./task-member-shared-oracle.mjs')).prepareMemberGraph(qa,memberBefore,body);write('active-member-expected-before-sql',graph.expected);}});
   await a.click('保存變更');await until(()=>a.eval("!document.querySelector('#task-edit-title')"),'active member confirmed');assert.ok(graph);const memberAfter=await read();graph.verify(memberAfter);assert.deepEqual(memberAfter.payload.tasks.find(t=>t.id==='stats-d').vesselProgress.find(p=>p.vesselId==='qa-v2'),memberBefore.payload.tasks.find(t=>t.id==='stats-d').vesselProgress.find(p=>p.vesselId==='qa-v2'),'inactive sibling exact retained');write('active-member-after',memberAfter);await freshReadback('active-member',memberAfter);qa.setRecordFault(null);if(await a.eval("Boolean(document.querySelector('[role=dialog]'))"))await a.click('取消並關閉');pass('VLC-4-active-shared-member-save');
  }
  if(!negative){
   await a.click('待辦總表');await until(()=>a.eval("Boolean(document.querySelector('.selected-task-list-panel'))"),'daily task list');await a.sync();
   assert.equal((await a.text()).includes('STATS C'),activating,'single-vessel task daily hide/restore');
   await a.click('內控異常');await until(()=>a.eval("Boolean(document.querySelector('.internal-control-page'))"),'daily internal cases');await a.sync();
   assert.equal((await a.text()).includes('STATS STANDALONE'),activating,'unlinked case daily hide/restore');
   await a.click('臨會/專題');await until(async()=>(await a.text()).includes('STATS MEETING'),'shared parent meeting retained');assert.ok((await a.text()).includes('STATS D'),'cross-vessel shared event remains in its original meeting page');
   await a.click('管理');await sub();
  }
  if(activating){if(await a.eval(`(${check('顯示停用船舶')}).checked`))await toggle('顯示停用船舶');await choose();}
  else if(!negative){
   await toggle('顯示停用船舶');await choose();
   for(const [width,height,mobile] of [[1440,1000,false],[390,844,true]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile},a.s);await wait(150);const geometry=await a.eval(`(()=>{const n=${check('顯示停用船舶')},r=n.parentElement.getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,control:{left:r.left,right:r.right,width:r.width},visible:!!n.getClientRects().length};})()`);write(caseId+'-geometry-'+width,geometry);assert.ok(geometry.visible);assert.ok(geometry.document<=geometry.viewport+1,'no document overflow');await a.screen(caseId+'-'+width);}
   await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},a.s);await toggle('顯示停用船舶');
  }
 }
 if(!negative){await call('Page.reload',{},a.s);await until(()=>a.eval("Boolean(document.querySelector('.app'))||[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='管理')"),'fresh original app');await a.click('管理');await sub();assert.equal(await hasShip(),true);assert.equal(await a.eval(`(${check('顯示停用船舶')}).checked`),false);pass('VLC-2-fresh-document-reactivated');}
}
