import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
export async function runManagementAckForms({a,qa,read,call,until,wait,write,receipt,setCase,setRelease,mode}){
 const sub=async label=>a.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=async name=>a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const field=label=>`[...document.querySelectorAll('.management-form label')].find(n=>n.textContent===${JSON.stringify(label)})?.querySelector('input')`;
 const {applyCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {normalizeRolePermissions,PERMISSION_LABELS}=await qa.loadModule('/src/permissions.ts');
 const newer=mode==='forms-newer';
 const specs=mode==='forms-settings'?['category-task','category-meeting','category-equipment','role-switch','site-password']:newer?['person-create','vessel-update','category-task','category-meeting','category-equipment','site-password']:['person-create','person-clear','person-disable','vessel-create','vessel-update','vessel-disable','category-task','category-meeting','category-equipment','role-switch','site-password'];
 await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'management forms');
 await a.eval("void(window.__mgNotices=[]);void(new MutationObserver(()=>{const text=document.querySelector('.management-save-toast')?.textContent;if(text)window.__mgNotices.push({text,at:Date.now()});}).observe(document.body,{childList:true,subtree:true,characterData:true}))");
 for(const kind of specs){
  setCase('MGACK-FORM-'+kind+(newer?'-newer':'-clean'));let click,continuationField,oldValue,expected,release,held=false,notice='';const intent={kind};
  if(kind.startsWith('person')){
   await sub('人員');
   if(kind==='person-create'){await a.click('＋ 新增');await a.fill(field('姓名'),'QA NEW PERSON');await a.fill(field('用戶名'),'qa-new-person');intent.name='QA NEW PERSON';intent.username='qa-new-person';intent.department=await a.eval("document.querySelector('select[aria-label=人員部門]').value");click=()=>a.click('建立人員');continuationField=field('姓名');oldValue=intent.name;notice='人員已建立';}
   else{await choose('QA SPARE');intent.id='qa-spare';if(kind==='person-clear'){continuationField="document.querySelector('.management-detail input[type=password]')";await a.fill(continuationField,'synthetic-unsent-field');oldValue='synthetic-unsent-field';click=()=>a.click('清除密碼');notice='密碼已清除';}else{click=()=>a.click('停用');continuationField=field('姓名');oldValue='QA SPARE';}}
  }else if(kind.startsWith('vessel')){
   await sub('船舶');
   if(kind==='vessel-create'){await a.click('＋ 新增');await a.fill(field('系統名稱'),'QA NEW VESSEL');await a.fill(field('簡稱'),'QA NEW VESSEL');intent.name='QA NEW VESSEL';click=()=>a.click('建立船舶');notice='船舶已建立';}
   else{await choose(kind==='vessel-disable'?'QA VESSEL 1':'QA VESSEL 2');intent.id=kind==='vessel-disable'?'qa-v1':'qa-v2';if(kind==='vessel-update'){await a.fill(field('完整船名'),'QA ACK FULL NAME');intent.fullName='QA ACK FULL NAME';click=()=>a.click('保存變更');notice='船舶資料已保存';}else click=()=>a.click('停用');}
   continuationField=kind==='vessel-update'?field('完整船名'):field('系統名稱');oldValue=await a.eval(`(${continuationField}).value`);
  }else if(kind.startsWith('category')){
   await sub('分類管理');const index=['category-task','category-meeting','category-equipment'].indexOf(kind);
   continuationField=`document.querySelectorAll('.task-category-editor')[${index}].querySelector('input')`;
   intent.value='QA ACK CATEGORY '+index;intent.index=index;await a.fill(continuationField,intent.value);oldValue=intent.value;
   click=()=>a.activate(`document.querySelectorAll('.task-category-editor')[${index}].querySelector('.management-editor-actions button')`);notice=['要事分類已保存','臨會/專題待辦分類已保存','設備故障細項已保存'][index];
  }else if(kind==='role-switch'){
   await sub('角色權限');const selector="document.querySelector('.permission-switch input:not(:disabled)')";
   const row=await a.eval(`(()=>{const n=${selector},r=n.closest('.permission-row');return {label:r.querySelector('span>b').textContent,index:[...r.querySelectorAll('input')].indexOf(n),checked:n.checked};})()`);
   intent.role=['owner','admin','operator','vessel'][row.index];intent.key=Object.keys(PERMISSION_LABELS).find(k=>PERMISSION_LABELS[k].label===row.label);assert.ok(intent.key);intent.value=!row.checked;oldValue=row.checked;continuationField=selector;
   click=async()=>{await a.eval(`(${selector}).focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},a.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},a.s);};
  }else{
   await sub('Owner 與雲端');await a.activate("[...document.querySelectorAll('.management-master button')].find(n=>n.querySelector('b')?.innerText==='進站密碼')");continuationField="document.querySelector('.management-password input')";await a.fill(continuationField,'synthetic-site-new');oldValue='synthetic-site-new';intent.hash=createHash('sha256').update(oldValue).digest('hex');click=()=>a.click('保存');notice='進站密碼已更新';
  }
  const before=await read(),started=Date.now(),networkStart=receipt.network.length,dialogsStart=(receipt.dialogs||[]).length;write(kind+'-before',before);write(kind+'-intent',intent);
  qa.setRecordFault({before:async({name,body})=>{
   if(name!=='apply_ship_dynamics_record_patch_v1')return;
   const ops=body.p_operations;expected=structuredClone(before.payload);
   const bounded=value=>{assert.ok(Date.parse(value)>=started-1000&&Date.parse(value)<=Date.now()+1000);return value;};
   const entity=(collection,id)=>{const list=ops.filter(o=>o.kind==='entity'&&o.collection===collection&&(!id||o.entityId===id));assert.equal(list.length,1);return list[0].value;};
   let action,entityType,entityId,detail;
   if(kind==='person-create'){
    const sent=entity('users');assert.ok(sent.id.startsWith('user_')&&!expected.users.some(u=>u.id===sent.id));
    expected.users.push({id:sent.id,createdAt:bounded(sent.createdAt),updatedAt:bounded(sent.updatedAt),passwordHash:'',department:intent.department,name:intent.name,username:intent.username,role:'operator',isActive:true,managedVesselIds:[]});
    action='新增人員';entityType='user';entityId=sent.id;detail=intent.name;
   }else if(kind.startsWith('person')){
    const user=expected.users.find(u=>u.id===intent.id),sent=entity('users',intent.id);user.updatedAt=bounded(sent.updatedAt);if(kind==='person-clear')user.passwordHash='';else{user.isActive=false;expected.vessels.forEach(v=>{v.assignedUserIds=v.assignedUserIds.filter(id=>id!==intent.id);v.delegateManagers=v.delegateManagers.filter(d=>d.userId!==intent.id);});}
    action=kind==='person-clear'?'清除人員密碼':'停用人員';entityType='user';entityId=intent.id;detail=kind==='person-clear'?`${user.name} 改為無密碼登入`:user.name;
   }else if(kind==='vessel-create'){
    const sent=entity('vessels'),at=bounded(sent.createdAt);assert.ok(sent.id.startsWith('vessel_')&&!expected.vessels.some(v=>v.id===sent.id));
    expected.vessels.push({id:sent.id,createdAt:at,updatedAt:bounded(sent.updatedAt),name:intent.name,shortName:intent.name,fullName:'',shipType:'',fleetCategory:'tanker fleet',fleetTags:[],assignedUserIds:[],delegateManagers:[],isActive:true,position:{source:'manual',location:'',speedKnots:0,navigationStatus:'航行',lastPort:'',nextPort:'',eta:'',etb:'',etd:'',updatedAt:at,manualRemark:''},cargo:{source:'manual',loadStatus:'空載',name:'',quantity:'',items:[],updatedAt:at},note:{statusList:[],statusSupplement:'',captain:'',chiefOfficer:'',chiefEngineer:'',firstEngineer:'',recentDynamics:'',maintenanceOverview:'',subsequentDynamics:'',updatedAt:at},weeklyAttention:[]});
    action='新增船舶';entityType='vessel';entityId=sent.id;detail=intent.name;
   }else if(kind.startsWith('vessel')){
    const vessel=expected.vessels.find(v=>v.id===intent.id),sent=entity('vessels',intent.id);vessel.updatedAt=bounded(sent.updatedAt);
    if(kind==='vessel-update')vessel.fullName=intent.fullName;else{vessel.isActive=false;expected.users.forEach(u=>{const bound=u.managedVesselIds.includes(intent.id);if(bound&&u.role==='vessel')u.isActive=false;});}
    action=kind==='vessel-update'?'更新船舶':'停用船舶';entityType='vessel';entityId=intent.id;detail=vessel.fullName||vessel.name||vessel.shortName;
   }else{
    entityType='settings';
    if(kind.startsWith('category')){const keys=['taskCategories','meetingTaskCategories','equipmentFailureSubcategories'],schemas=['taskCategorySchemaVersion','meetingTaskCategorySchemaVersion','equipmentFailureSubcategorySchemaVersion'];expected.settings[keys[intent.index]][0]=intent.value;expected.settings[schemas[intent.index]]=intent.index===2?1:2;action=['更新要事分類','更新臨會/專題待辦分類','更新內控設備故障細項'][intent.index];entityId=['task-categories','meeting-task-categories','internal-control-equipment-subcategories'][intent.index];detail=expected.settings[keys[intent.index]].join('、');}
    else if(kind==='role-switch'){expected.settings.rolePermissions[intent.role][intent.key]=intent.value;expected.settings.rolePermissions=normalizeRolePermissions(expected.settings.rolePermissions);action='更新角色權限';entityId='role-permissions';const {roleLabel}=await qa.loadModule('/src/utils.ts');detail=`${roleLabel(intent.role)}｜${PERMISSION_LABELS[intent.key].label}｜${intent.value?'開啟':'關閉'}`;}
    else{expected.settings.sitePasswordHash=intent.hash;action='修改進站密碼';entityId='site-password';detail='Owner 更新進站密碼';}
   }
   const sentAudit=entity('auditLogs');const audit={id:sentAudit.id,at:bounded(sentAudit.at),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action,entityType,entityId,detail};assert.ok(!expected.auditLogs.some(a=>a.id===audit.id));assert.deepEqual(sentAudit,audit);expected.auditLogs=[audit,...expected.auditLogs].slice(0,500);
   assert.deepEqual(applyCloudBlockPatch(before.payload,ops),expected,'full independent before-SQL intent graph');audit.ipAddress='192.0.2.30';audit.ipCountryCode='TW';write(kind+'-expected-before-sql',expected);
  },after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await new Promise(r=>{release=r;setRelease(r);});}return false;}});
  await a.eval('void(window.__mgNotices=[])');await click();await until(()=>held,'form committed ACK held '+kind);
  assert.deepEqual(await a.eval('window.__mgNotices'),[],'no early original form toast');assert.equal((receipt.dialogs||[]).slice(dialogsStart).includes('進站密碼已更新'),false);
  if(kind==='role-switch')assert.equal(await a.eval(`(${continuationField}).checked`),oldValue,'switch waits for confirmed data');
  else assert.equal(await a.eval(`(${continuationField}).value`),oldValue,'held retains editor');
  if(newer){await a.eval(`void(window.__mgFormNode=${continuationField})`);await a.fill(continuationField,'NEWER B');}
  await a.screen(kind+'-held');release();await until(()=>receipt.network.slice(networkStart).some(r=>r.rpc==='apply_ship_dynamics_record_patch_v1'&&r.finished),'form ACK body');
  if(notice&&!newer)await until(async()=>kind==='site-password'?(receipt.dialogs||[]).includes(notice):(await a.eval("document.querySelector('.management-save-toast')?.textContent||''")).includes(notice),'original form continuation '+kind);else await wait(400);
  write(kind+'-post-ack-ui',{text:await a.text()});
  if(kind==='person-disable'||kind==='vessel-disable')assert.notEqual(await a.eval(`(${continuationField}).value`),oldValue,'confirmed disable must perform original next-selection continuation');
  if(newer){assert.deepEqual(await a.eval('window.__mgNotices'),[]);assert.equal(await a.eval(`(${continuationField}).value`),'NEWER B');assert.equal(await a.eval(`window.__mgFormNode===(${continuationField})`),true);if(kind==='site-password')assert.equal((receipt.dialogs||[]).slice(dialogsStart).includes('進站密碼已更新'),false);}
  const after=await read();assert.equal(after.revision,before.revision+1);assert.deepEqual(after.payload,{...expected,revision:after.revision,updatedAt:after.payload.updatedAt},'complete authoritative form graph');write(kind+'-after',after);
  assert.equal(new Set(receipt.network.slice(networkStart).filter(r=>r.rpc==='apply_ship_dynamics_record_patch_v1').map(r=>r.operationId)).size,1);
  receipt.cases.push({caseId:'MGACK-FORM-'+kind+(newer?'-newer':'-clean'),layer:'original-UI-native-PG',status:'PASS'});qa.setRecordFault(null);
 }
}
