import assert from 'node:assert/strict';
export async function runManagementPrivateDraft({a,qa,read,call,until,wait,write,receipt,setCase,setDialogAccept}){
 const sub=async label=>a.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=async name=>a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const field=label=>`[...document.querySelectorAll('.management-form label')].find(n=>n.textContent===${JSON.stringify(label)})?.querySelector('input')`;
 const name=field('姓名'),short=field('簡稱');
 const dialogs=()=> (receipt.dialogs||[]).length;
 const pass=id=>receipt.cases.push({caseId:id,layer:'original-App-native-input-private-native-PG',status:'PASS'});
 const sample=async stage=>({stage,...await a.eval(`(()=>{const e=new Event('beforeunload',{cancelable:true});return {saved:!!document.querySelector('.save-status-strip.saved'),warns:!window.dispatchEvent(e)};})()`)});
 const dirty=async label=>{const row=await sample(label);write('observation-'+label,row);assert.equal(row.saved,false,label+' not safely saved');assert.equal(row.warns,true,label+' real App synthetic unload listener');};
 const clear=async expr=>{await a.eval(`(${expr}).focus();(${expr}).select()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},a.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},a.s);};
 await a.click('管理');await until(()=>a.eval("!!document.querySelector('.management-view')"),'management ready');await sub('人員');await choose('QA SPARE');await until(()=>a.saved(),'clean baseline');
 const before=await read(),start=receipt.network.length;
 setCase('MG-PRIVATE-UNSUBMITTED');await a.fill(name,'MG PRIVATE UNSUBMITTED');await dirty('typed');await clear(name);await dirty('cleared');
 await a.click('立即保存');await wait(100);assert.equal(await a.eval(`/可以安全關閉|沒有尚未保存的修改|沒有未保存修改/.test(document.querySelector('.save-toast')?.textContent||'')`),false);
 assert.deepEqual(await read(),before);assert.equal(receipt.network.slice(start).filter(r=>r.rpc==='apply_ship_dynamics_record_patch_v1').length,0);pass('MG-PRIVATE-UNSUBMITTED');
 await a.fill(name,'MG PRIVATE UNSUBMITTED');await a.eval(`void(window.__privateNode=(${name}))`);
 setDialogAccept(false);let n=dialogs();await choose('QA OPERATOR');assert.equal(dialogs(),n+1);assert.equal(await a.eval(`window.__privateNode===(${name})&&(${name}).value==='MG PRIVATE UNSUBMITTED'`),true);pass('MG-PRIVATE-ROW-CANCEL');
 n=dialogs();await choose('QA SPARE');assert.equal(dialogs(),n);await sub('船舶');await a.fill(short,'PRIVATE VESSEL');await sub('人員');assert.equal(dialogs(),n);assert.equal(await a.eval(`(${name}).value`),'MG PRIVATE UNSUBMITTED');
 await a.fill("document.querySelector('.management-master-heading input')",'no matching row');assert.equal(dialogs(),n);assert.equal(await a.eval(`(${name}).value`),'MG PRIVATE UNSUBMITTED');await a.fill("document.querySelector('.management-master-heading input')",'QA');pass('MG-PRIVATE-NOLOSS-SEARCH-SECTION');
 n=dialogs();await a.activate("document.querySelector('.management-master-heading button')");assert.equal(dialogs(),n+1);assert.equal(await a.eval(`(${name}).value`),'MG PRIVATE UNSUBMITTED');pass('MG-PRIVATE-NEW-CANCEL');
 setDialogAccept(true);await choose('QA OPERATOR');assert.equal(await a.eval(`(${name}).value`),'QA OPERATOR');await dirty('surviving-vessel');await sub('船舶');assert.equal(await a.eval(`(${short}).value`),'PRIVATE VESSEL');await choose('QA VESSEL 2');pass('MG-PRIVATE-ROW-CONFIRM-OTHER-OWNER-SURVIVES');
 for(const [label,selector] of [['task','input[aria-label="要事分類 新分類名稱"]'],['meeting','input[aria-label="臨會/專題待辦分類 新分類名稱"]'],['equipment','input[aria-label="新增設備故障細項"]']]){
  await sub('分類管理');await a.fill(`document.querySelector(${JSON.stringify(selector)})`,'UNADDED '+label);await dirty(label);setDialogAccept(false);n=dialogs();await sub('關注度說明');assert.equal(dialogs(),n+1);assert.equal(await a.eval(`document.querySelector(${JSON.stringify(selector)}).value`),'UNADDED '+label);setDialogAccept(true);await sub('關注度說明');await sub('分類管理');assert.equal(await a.eval(`document.querySelector(${JSON.stringify(selector)}).value`),'');pass('MG-PRIVATE-NESTED-'+label);
 }
 await sub('Owner 與雲端');await a.fill("document.querySelector('.management-password input')",'synthetic-unsent-only');await dirty('site');n=dialogs();await choose('Supabase 設定');await a.fill(field('工作區'),'synthetic-unsent-workspace');await dirty('config');await choose('進站密碼');assert.equal(await a.eval("document.querySelector('.management-password input').value==='synthetic-unsent-only'"),true);assert.equal(dialogs(),n);pass('MG-PRIVATE-SITE-CONFIG-NOLOSS');
 await sub('人員');await a.fill(name,'NAV PRIVATE');await a.eval(`void(window.__privateNode=(${name}))`);setDialogAccept(false);n=dialogs();await a.click('早會工作台');await until(()=>dialogs()>n,'navigation confirm');assert.equal(dialogs(),n+1);assert.equal(await a.eval(`window.__privateNode===(${name})&&(${name}).value==='NAV PRIVATE'`),true);pass('MG-PRIVATE-NAV-CANCEL');
 for(const [width,mobile] of [[1440,false],[390,true]]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile},a.s);await a.screen('private-draft-'+width);const geometry=await a.eval('({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');write('geometry-'+width,geometry);assert.ok(geometry.scroll<=geometry.client+1,'document overflow '+width);}
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},a.s);
 n=dialogs();await a.click('切換/退出');await until(()=>dialogs()>n,'identity discard confirmation');await wait(100);assert.equal(dialogs(),n+1,'cancel must not raise unrelated alert');assert.equal(await a.eval(`window.__privateNode===(${name})&&(${name}).value==='NAV PRIVATE'`),true);assert.ok((await a.text()).includes('QA OWNER'));pass('MG-PRIVATE-IDENTITY-CANCEL');
 n=dialogs();void call('Page.navigate',{url:qa.origin+'/__qa/blank'},a.s);await until(()=>dialogs()>n,'native beforeunload dialog');await wait(100);assert.ok(await a.eval("!!document.querySelector('.management-view')"));write('native-beforeunload',{promptObserved:true,cancelPreservedDocument:true});pass('MG-PRIVATE-NATIVE-BEFOREUNLOAD-CANCEL');
 assert.deepEqual(await read(),before,'all canceled and unsent paths preserve full SQL graph');assert.equal(receipt.network.slice(start).filter(r=>r.rpc==='apply_ship_dynamics_record_patch_v1').length,0);pass('MG-PRIVATE-ZERO-IMPLICIT-WRITES');
 setDialogAccept(true);await a.click('早會工作台');await until(()=>a.eval("!document.querySelector('.management-view')"),'confirmed navigation');await a.click('管理');await until(()=>a.eval("!!document.querySelector('.management-view')"),'management ready');await sub('人員');await choose('QA SPARE');assert.equal(await a.eval(`(${name}).value`),'QA SPARE');pass('MG-PRIVATE-NAV-CONFIRM');
 await a.fill(name,'EXIT PRIVATE');await a.click('切換/退出');await until(async()=>(await a.text()).includes('人員登入／切換'),'confirmed identity exit');pass('MG-PRIVATE-IDENTITY-CONFIRM');
}

// Original buttons and native input; configuration remains synthetic loopback.
export async function runManagementPrivateClosing({a,qa,read,call,until,wait,write,receipt,setCase,setDialogAccept,setRelease,loginCurrent,mode}){
 const sub=label=>a.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=name=>a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const field=label=>`[...document.querySelectorAll('.management-form label')].find(n=>n.textContent===${JSON.stringify(label)})?.querySelector('input')`;
 const pass=caseId=>receipt.cases.push({caseId,layer:'original-App-native-input-private-native-PG',status:'PASS'});
 const dirty=async()=>assert.equal(await a.saved(),false,'private draft cannot be globally safe');
 await a.click('管理');await until(()=>a.eval("!!document.querySelector('.management-view')"),'management');
 if(mode==='private-config-local-navigation'){
  // Hold the real Web Lock, not an App setter or fabricated persistence response.
  setCase('MG-PRIVATE-CONFIG-NAVIGATION-DURING-WAIT');await sub('Owner 與雲端');await choose('Supabase 設定');await a.fill(field('Anon key'),'isolated-qa-nav-not-a-service-key');
  const before=await read();await a.eval("void(window.__navConfigStored=localStorage.getItem('ship-dynamics-supabase-config'));void(window.__navConfigDocument=true)");
  await a.eval("void import('/src/pendingTaskCreation.ts').then(m=>{window.__configLockName=m.PENDING_TASK_CREATION_STORAGE_LOCK_NAME;void navigator.locks.request(window.__configLockName,{mode:'exclusive'},async()=>{window.__configLockHeld=true;await new Promise(r=>window.__releaseConfigLock=r);});})");
  await until(()=>a.eval('!!window.__configLockHeld'),'native Web Lock held');setDialogAccept(false);const dialogs=(receipt.dialogs||[]).length;
  await a.click('保存設定並重新載入');await until(()=>a.eval("navigator.locks.query().then(s=>s.pending.some(l=>l.name===window.__configLockName))"),'original config save awaiting native Web Lock');
  await sub('分類管理');const input='document.querySelector(\'input[aria-label="要事分類 新分類名稱"]\')';await a.fill(input,'UNSENT DURING CONFIG WAIT');await a.eval(`void(window.__navCategoryNode=(${input}))`);
  await a.eval('window.__releaseConfigLock()');await until(()=>a.eval("navigator.locks.query().then(s=>!s.pending.some(l=>l.name===window.__configLockName))"),'native Web Lock queue drained');await wait(500);
  assert.equal(await a.eval("localStorage.getItem('ship-dynamics-supabase-config')===window.__navConfigStored"),true,'navigation invalidates reload BEFORE config write');
  assert.equal(await a.eval(`!!window.__navConfigDocument&&window.__navCategoryNode===(${input})&&(${input}).value==='UNSENT DURING CONFIG WAIT'`),true,'same new classification draft and document retained');
  assert.equal((receipt.dialogs||[]).length,dialogs,'stale configuration operation causes no late native unload dialog');await dirty();assert.deepEqual(await read(),before,'full SQL unchanged');
  write('config-navigation-retained',{storedConfigUnchanged:true,sameDocumentAndCategoryNode:true,fullSqlUnchanged:true,barrier:'real native Web Lock'});pass('MG-PRIVATE-CONFIG-NAVIGATION-INVALIDATES-PREWRITE');
 }else if(mode.startsWith('private-config')){
  setCase('MG-PRIVATE-CONFIG-SAVE-RELOAD');await sub('Owner 與雲端');await choose('Supabase 設定');
  if(mode.endsWith('other')){await choose('進站密碼');await a.fill("document.querySelector('.management-password input')",'synthetic-unsent-config-peer');await choose('Supabase 設定');}
  // Rotate a synthetic local key: config identity changes, supported table/workspace stay intact.
  // The private HTTP fixture does not simulate Supabase API-key authentication.
  await a.fill(field('Anon key'),'isolated-qa-rotated-not-a-service-key');
  const before=await read(),n=(receipt.dialogs||[]).length;
  await a.eval(`void(window.__configDocumentMarker=true);void(window.__configNode=(${field('Anon key')}));void(window.__configStoredBefore=localStorage.getItem('ship-dynamics-supabase-config'))`);setDialogAccept(false);
  await a.click('保存設定並重新載入');
  if(mode.endsWith('other')){
   await until(()=>(receipt.dialogs||[]).length>n,'other private owner discard prompt');
   assert.equal(await a.eval(`!!window.__configDocumentMarker&&window.__configNode===(${field('Anon key')})&&(${field('Anon key')}).value==='isolated-qa-rotated-not-a-service-key'`),true,'cancel preserves exact config node and draft');
   assert.equal(await a.eval("localStorage.getItem('ship-dynamics-supabase-config')===window.__configStoredBefore"),true,'cancel preserves exact stored config');
   await choose('進站密碼');assert.equal(await a.eval("document.querySelector('.management-password input').value==='synthetic-unsent-config-peer'"),true,'cancel preserves other private owner');await choose('Supabase 設定');
   pass('MG-PRIVATE-CONFIG-OTHER-CANCEL');setDialogAccept(true);await a.click('保存設定並重新載入');
  }
  await until(()=>a.eval('!window.__configDocumentMarker'),'original configuration reload');
  await until(async()=>{const text=await a.text();return text.includes('系統畫面載入失敗')||text.includes('船隊看板')||text.includes('請輸入管理者設定的進站密碼。')||text.includes('人員登入／切換');},'reloaded original UI ready');await wait(500);const reloadError=await a.eval("document.body.innerText.includes('系統畫面載入失敗')?document.querySelector('details')?.textContent:null");write('reload-error',{detail:reloadError});assert.equal(reloadError,null,'reload must render original App');
  assert.equal((receipt.dialogs||[]).length,n+(mode.endsWith('other')?2:0),'only necessary discard prompts; no spurious native unload prompt');
  assert.equal(await a.eval("JSON.parse(localStorage.getItem('ship-dynamics-supabase-config')).supabaseAnonKey==='isolated-qa-rotated-not-a-service-key'"),true,'new document stored synthetic config');
  if(mode.includes('local'))assert.equal(await a.eval("import('/src/cloud.ts').then(m=>m.getSupabaseConfig().supabaseAnonKey==='isolated-qa-rotated-not-a-service-key')"),true,'new document active config identity');
  else assert.equal(await a.eval("import('/src/cloud.ts').then(m=>m.getSupabaseConfig().supabaseAnonKey==='isolated-qa-not-a-service-key')"),true,'public config retains its existing precedence');
  assert.deepEqual(await read(),before);write('supported-config-identity',{localConfigMode:mode.includes('local'),storedChanged:true,fullSqlUnchanged:true,providerKeyAuthentication:'not simulated'});pass(mode.includes('local')?'MG-PRIVATE-CONFIG-LOCAL-IDENTITY-RELOAD':'MG-PRIVATE-CONFIG-SAVE-RELOAD');
 }else if(mode==='private-aba'){
  setCase('MG-PRIVATE-ACTOR-SESSION-ABA');await sub('人員');await choose('QA SPARE');const expr=field('姓名');await a.fill(expr,'ABA COMMITTED');let held=false,release;const start=receipt.network.length;
  qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await new Promise(r=>{release=r;setRelease(r);});}return false;}});
  await a.click('保存變更');await until(()=>held,'ABA committed SQL ACK held');setDialogAccept(true);await a.click('切換/退出');await until(async()=>(await a.text()).includes('人員登入／切換'),'original identity exit');await loginCurrent();await a.click('管理');await until(()=>a.eval("!!document.querySelector('.management-view')"),'new generation management');await sub('人員');await choose('ABA COMMITTED');await a.fill(expr,'ABA SUCCESSOR PRIVATE');await a.eval(`void(window.__abaNode=(${expr}))`);release();await until(()=>receipt.network.slice(start).some(r=>r.rpc==='apply_ship_dynamics_record_patch_v1'&&(r.finished||r.failure)),'old request terminal');await wait(700);assert.equal(await a.eval(`window.__abaNode===(${expr})&&(${expr}).value==='ABA SUCCESSOR PRIVATE'`),true);await dirty();assert.equal(await a.eval("!!document.querySelector('.save-toast.success')||!!document.querySelector('.management-save-toast')"),false);setDialogAccept(false);await choose('QA OPERATOR');assert.equal(await a.eval(`(${expr}).value`),'ABA SUCCESSOR PRIVATE');write('ABA-transport',{oldRequests:receipt.network.slice(start).filter(r=>r.rpc==='apply_ship_dynamics_record_patch_v1').map(r=>({operationId:r.operationId,finished:!!r.finished,failure:r.failure})),sameSuccessorNode:true,privateRetained:true});pass('MG-PRIVATE-ACTOR-SESSION-ABA');qa.setRecordFault(null);
 }else if(mode==='private-generic'){
  setCase('MG-PRIVATE-GENERIC-ACK');await sub('人員');await choose('QA SPARE');const expr=field('姓名');await a.fill(expr,'GENERIC ACK PRIVATE');await a.eval(`void(window.__genericNode=(${expr}))`);
  write('private-copy',{guidance:await a.eval("document.querySelector('.unsaved-work-guidance')?.textContent")});
  assert.equal(await a.eval("document.querySelector('.unsaved-work-guidance')?.textContent.includes('表單')"),true,'private draft copy must direct original form Save');
  const before=await read(),start=receipt.network.length;let held=false,release;
  qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await new Promise(r=>{release=r;setRelease(r);});}return false;}});
  await a.activate("document.querySelector('.user-name-btn')");
  for(const [label,value] of [['舊密碼',qa.password],['新密碼','synthetic-generic-password'],['再次輸入新密碼','synthetic-generic-password']])await a.fill(`[...document.querySelectorAll('.personal-password-modal .field')].find(n=>n.querySelector('label').textContent===${JSON.stringify(label)}).querySelector('input')`,value);
  await a.click('更新密碼');await a.click('立即保存');await until(()=>held,'generic App Save committed ACK held');await dirty();release();await until(()=>receipt.network.slice(start).some(r=>r.rpc==='apply_ship_dynamics_record_patch_v1'&&r.finished),'generic ACK returned');await wait(700);
  assert.equal(await a.eval(`window.__genericNode===(${expr})&&(${expr}).value==='GENERIC ACK PRIVATE'`),true);await dirty();assert.equal(await a.eval("!!document.querySelector('.save-toast.success')"),false);const after=await read();assert.equal(after.payload.users.find(u=>u.id==='qa-spare').name,'QA SPARE');assert.notEqual(after.payload.users.find(u=>u.id==='qa-owner').passwordHash,before.payload.users.find(u=>u.id==='qa-owner').passwordHash);write('generic-ACK',{privateNameUnsubmitted:true,sameNode:true,unsafeToClose:true,operationIds:[...new Set(receipt.network.slice(start).filter(r=>r.rpc==='apply_ship_dynamics_record_patch_v1').map(r=>r.operationId))]});pass('MG-PRIVATE-GENERIC-ACK');qa.setRecordFault(null);
 }else if(mode.startsWith('private-disable')){
  for(const [section,selected,label,id,collection] of [['人員','QA SPARE','姓名','qa-spare','users'],['船舶','QA VESSEL 1','簡稱','qa-v1','vessels']]){
   setCase('MG-PRIVATE-DISABLE-'+collection);await sub(section);await choose(selected);const expr=field(label),before=await read();await a.fill(expr,'UNSUBMITTED DISABLE');await a.eval(`void(window.__disableNode=(${expr}))`);
   setDialogAccept(false);await a.click('停用');await wait(100);assert.deepEqual(await read(),before,'cancel before operation');assert.equal(await a.eval(`window.__disableNode===(${expr})&&(${expr}).value==='UNSUBMITTED DISABLE'`),true);await dirty();pass('MG-PRIVATE-DISABLE-CANCEL-'+collection);
   let release,held=false;qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await new Promise(r=>{release=r;setRelease(r);});}return false;}});
   setDialogAccept(true);await a.click('停用');await until(()=>held,'native disable committed held');const after=await read();assert.equal(after.payload[collection].find(v=>v.id===id).isActive,false);assert.equal(after.payload[collection].find(v=>v.id===id)[collection==='users'?'name':'shortName'],before.payload[collection].find(v=>v.id===id)[collection==='users'?'name':'shortName'],'unsent field not submitted');
   if(mode==='private-disable-newer')await a.fill(expr,'NEWER DISABLE');release();await until(()=>a.eval("!document.querySelector('.save-status-strip.saving')"),'ACK settles');await wait(500);
   if(mode==='private-disable-newer'){assert.equal(await a.eval(`window.__disableNode===(${expr})&&(${expr}).value==='NEWER DISABLE'`),true);await dirty();}else assert.notEqual(await a.eval(`(${expr}).value`),'UNSUBMITTED DISABLE');
   pass('MG-PRIVATE-DISABLE-'+(mode==='private-disable-newer'?'NEWER':'DISCARD')+'-'+collection);qa.setRecordFault(null);
  }
 }
}
