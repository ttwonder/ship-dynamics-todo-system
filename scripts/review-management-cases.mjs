import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function runR3({a,qa,read,call,until,wait,write,receipt,setCase,freshReadback,native,makePage,login,mode}){
 const id='R3-'+mode.slice(3).toUpperCase();setCase(id);
 const sub=(p,label)=>p.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=(p,name)=>p.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const field=label=>`[...document.querySelectorAll('.management-form label')].find(n=>n.textContent===${JSON.stringify(label)})?.querySelector('input')`;
 const manage=async p=>{await p.click('管理');await until(()=>p.eval("Boolean(document.querySelector('.management-view'))"),'management');};
 const save=async(p,predicate,label)=>{const n=receipt.network.length;await p.click('保存變更');await until(async()=>predicate((await read()).payload),label);await until(()=>receipt.network.slice(n).some(r=>r.rpc==='apply_ship_dynamics_record_patch_v1'&&r.finished&&r.result==='SQL_OK'),'SQL ACK '+label);await until(()=>p.saved(),'saved '+label);};
 const checkbox=async(p,expr)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled)throw new Error('enabled checkbox required');n.focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},p.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},p.s);};
 const links=d=>({users:d.users.map(u=>({id:u.id,managedVesselIds:u.managedVesselIds})),vessels:d.vessels.map(v=>({id:v.id,assignedUserIds:v.assignedUserIds,delegateManagers:v.delegateManagers}))});
 const before=await read();write(id+'-before',before);const detail={caseId:id,layer:'original-App-native-UI-and-native-PG',inputHash:hash(before),status:'INCOMPLETE'};
 receipt.cases.push(detail);
 if(mode==='r3-f1'){
  const ctx=(await call('Target.createBrowserContext')).browserContextId,p=await makePage('qa-admin',ctx);await login(p);await manage(p);await sub(p,'人員');await choose(p,'QA SPARE');
  await p.fill(field('姓名'),'R3 ADMIN OTHER CONTROL');await save(p,d=>d.users.find(u=>u.id==='qa-spare').name==='R3 ADMIN OTHER CONTROL','admin other name control');
  const control=await read();write(id+'-positive-control',control);detail.positiveControl='admin changes another operator name through original UI and receives SQL ACK';
  await choose(p,'QA ADMIN');await p.fill(field('姓名'),'R3 ADMIN SELF NAME');await save(p,d=>d.users.find(u=>u.id==='qa-admin').name==='R3 ADMIN SELF NAME','admin self name ACK');
  const after=await read();assert.equal(after.payload.users.find(u=>u.id==='qa-admin').role,'admin');
  await manage(a);await sub(a,'人員');await choose(a,'QA OWNER');
  const selfRole=await a.eval("[...document.querySelectorAll('.management-form select')].find(n=>[...n.options].some(o=>o.value==='owner'))?.disabled");assert.equal(selfRole,true,'Owner self downgrade remains disabled');
  detail.positiveControl='admin other name + own name ACK; Owner own role remains fixed';await freshReadback(id,after);detail.status='PASS';
 }else if(mode==='r3-f2'){
  await manage(a);await sub(a,'人員');await choose(a,'QA OPERATOR');await a.fill(field('姓名'),'R3 ACTIVE NAME CONTROL');
  await save(a,d=>d.users.find(u=>u.id==='qa-operator').name==='R3 ACTIVE NAME CONTROL','active name control');const control=await read();assert.deepEqual(links(control.payload),links(before.payload));write(id+'-positive-control',control);
  await sub(a,'船舶');await choose(a,'QA VESSEL 1');await a.click('停用');await until(async()=>!(await read()).payload.vessels.find(v=>v.id==='qa-v1').isActive,'disabled vessel');await until(()=>a.saved(),'disable ACK');
  const disabled=await read();assert.deepEqual(links(disabled.payload),links(control.payload),'disable itself retains both directions/delegate');write(id+'-disabled-preserved',disabled);
  await sub(a,'人員');await choose(a,'R3 ACTIVE NAME CONTROL');await a.fill(field('姓名'),'R3 INACTIVE NAME');await save(a,d=>d.users.find(u=>u.id==='qa-operator').name==='R3 INACTIVE NAME','name after disable');
  const managerAfter=await read();write(id+'-manager-after',managerAfter);assert.deepEqual(links(managerAfter.payload),links(control.payload),'R3-F2 inactive manager links survive unrelated name save');
  await choose(a,'QA SPARE');await a.fill(field('姓名'),'R3 INACTIVE DELEGATE');await save(a,d=>d.users.find(u=>u.id==='qa-spare').name==='R3 INACTIVE DELEGATE','delegate name after disable');
  const after=await read();assert.deepEqual(links(after.payload),links(control.payload),'inactive delegate retained');
  await sub(a,'船舶');await checkbox(a,"document.querySelector('.management-department-filter input[type=checkbox]')");await choose(a,'QA VESSEL 1');await checkbox(a,"document.querySelector('.switch-line input[type=checkbox]')");
  await save(a,d=>d.vessels.find(v=>v.id==='qa-v1').isActive,'reactivate vessel');assert.deepEqual(links((await read()).payload),links(control.payload),'reactivation retains both directions and delegate');
  await sub(a,'人員');await choose(a,'R3 INACTIVE NAME');const managerBox="[...document.querySelectorAll('.management-assignment label')].find(n=>n.textContent.includes('QA VESSEL 2'))?.querySelector('input[type=checkbox]')";
  await checkbox(a,managerBox);await save(a,d=>!d.users.find(u=>u.id==='qa-operator').managedVesselIds.includes('qa-v2'),'ordinary manager remove');
  await checkbox(a,managerBox);await save(a,d=>d.users.find(u=>u.id==='qa-operator').managedVesselIds.includes('qa-v2'),'ordinary manager add');
  await choose(a,'R3 INACTIVE DELEGATE');const delegateBox="[...document.querySelectorAll('.delegate-manager-option')].find(n=>n.textContent.includes('QA VESSEL 1'))?.querySelector('input[type=checkbox]')";
  await checkbox(a,delegateBox);await save(a,d=>!d.vessels.find(v=>v.id==='qa-v1').delegateManagers.length,'ordinary delegate remove');
  await checkbox(a,delegateBox);await save(a,d=>d.vessels.find(v=>v.id==='qa-v1').delegateManagers.some(v=>v.userId==='qa-spare'),'ordinary delegate add');
  detail.positiveControl='active edits + disable/name save/reactivate + normal manager/delegate remove/add';await freshReadback(id,await read());detail.status='PASS';
 }else if(mode==='r3-f6'){
  await manage(a);await sub(a,'角色權限');const {PERMISSION_LABELS}=await qa.loadModule('/src/permissions.ts');
  const row=label=>`[...document.querySelectorAll('.permission-row')].find(n=>n.querySelector('span>b')?.textContent===${JSON.stringify(label)})`;
  const target=`(${row(PERMISSION_LABELS.manageUsers.label)}).querySelectorAll('input')[1]`;
  const controlInfo=await a.eval(`(()=>{const n=[...document.querySelectorAll('.permission-row input:not(:disabled)')].find(n=>n!==(${target}));const r=n.closest('.permission-row');return {label:r.querySelector('span>b').textContent,index:[...r.querySelectorAll('input')].indexOf(n),checked:n.checked};})()`);
  const controlKey=Object.keys(PERMISSION_LABELS).find(k=>PERMISSION_LABELS[k].label===controlInfo.label),role=['owner','admin','operator','vessel'][controlInfo.index];
  await checkbox(a,`(${row(controlInfo.label)}).querySelectorAll('input')[${controlInfo.index}]`);await until(async()=>(await read()).payload.settings.rolePermissions[role][controlKey]===!controlInfo.checked,'configurable permission control');await until(()=>a.saved(),'permission control ACK');
  const control=await read();write(id+'-positive-control',control);const uiBefore=await a.eval(`({checked:(${target}).checked,disabled:(${target}).disabled})`);assert.deepEqual(uiBefore,{checked:true,disabled:true},'R3-F6 fixed admin manageUsers cannot be toggled');
  const box=await a.eval(`(()=>{const r=(${target}).closest('label').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box},a.s);await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box},a.s);await wait(1100);
  assert.deepEqual(await read(),control,'fixed control cannot emit audit or mutate');assert.equal(await a.eval(`(${target}).checked`),true);assert.equal(await a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),false);
  detail.positiveControl={role,key:controlKey,persisted:!controlInfo.checked};detail.fixedControl=uiBefore;await freshReadback(id,control);detail.status='PASS';
 }else if(mode==='r3-f3'){
  const ctx=(await call('Target.createBrowserContext')).browserContextId,b=await makePage('qa-owner',ctx);await login(b);await manage(a);await sub(a,'船舶');await choose(a,'QA VESSEL 1');await a.fill(field('年份'),'R3-YEAR-2026');
  await call('Page.bringToFront',{},b.s);await manage(b);await sub(b,'船舶');await choose(b,'QA VESSEL 1');
  for(const name of ['QA OPERATOR','QA SPARE'])await checkbox(b,`[...document.querySelectorAll('.management-assignment label')].find(n=>n.textContent.includes(${JSON.stringify(name)})&&n.querySelector('input[type=checkbox]'))?.querySelector('input[type=checkbox]')`);
  await save(b,d=>JSON.stringify(d.vessels.find(v=>v.id==='qa-v1').assignedUserIds)==='["qa-spare"]','second owner handover');const handover=await read();write(id+'-positive-control-handover',handover);
  const team=d=>d.tasks.find(t=>t.id==='handover-single').vesselResponsibilities?.find(r=>r.vesselId==='qa-v1')?.managerUserIds;assert.deepEqual(team(handover.payload),['qa-spare']);
  const n=receipt.network.length;await call('Page.bringToFront',{},a.s);await wait(1600);
  // The original user-facing sync requests authoritative revision refresh; no React setter or artificial response.
  await a.sync();await until(()=>receipt.network.slice(n).some(r=>r.rpc.startsWith('read_ship_dynamics_record')&&r.finished&&r.revision>=handover.revision),'first owner authoritative refresh');
  const draft=await a.eval(`({year:(${field('年份')}).value,checked:[...document.querySelectorAll('.management-assignment label')].filter(n=>n.querySelector('input[type=checkbox]')?.checked).map(n=>n.textContent.trim())})`);write(id+'-after-refresh-ui',draft);assert.equal(draft.year,'R3-YEAR-2026');
  await save(a,d=>d.vessels.find(v=>v.id==='qa-v1').yearLabel==='R3-YEAR-2026','first owner year save');const after=await read();write(id+'-after',after);
  const actual=after.payload.vessels.find(v=>v.id==='qa-v1').assignedUserIds;detail.positiveControl={handoverAck:true,team:team(handover.payload),revision:handover.revision};detail.badOutcome={draft,actualManagerIds:actual,taskTeam:team(after.payload)};await a.screen(id+'-result');await freshReadback(id,after);
  assert.deepEqual(actual,['qa-spare'],'R3-F3 unrelated year must retain confirmed handover');assert.deepEqual(team(after.payload),['qa-spare']);
  await a.fill(field('年份'),'R3 LOCAL CONFLICT');await b.sync();await b.fill(field('年份'),'R3 REMOTE CONFLICT');
  await save(b,d=>d.vessels.find(v=>v.id==='qa-v1').yearLabel==='R3 REMOTE CONFLICT','same field remote ACK');await a.sync();
  const conflictBefore=await read();await a.click('保存變更');await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'same-field conflict rejected');
  assert.deepEqual(await read(),conflictBefore,'conflict is zero-write');assert.equal(await a.eval(`(${field('年份')}).value`),'R3 LOCAL CONFLICT','conflict retains private input');
  assert.match(await a.text(),/管理表單欄位已由其他人更新/);write(id+'-conflict-control',conflictBefore);detail.status='PASS';
 }
 detail.finalRevision=(await read()).revision;write(id+'-case-receipt',detail);
}
