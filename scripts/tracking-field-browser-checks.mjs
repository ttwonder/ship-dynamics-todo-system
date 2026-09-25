import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import ExcelJS from 'exceljs';
// Real mounted shore/ship UI and native PostgreSQL; synthetic data only.
export async function trackingFieldChecks(c){
 const {qa,evaluate,call,click,nodeClick,fill,select,until,screen,check,output}=c;
 const finish=()=>until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))")&&(await evaluate('document.body.innerText')).includes('已收到伺服器確認並讀回'),'field edit exact ACK');
 const save=async(n)=>{await until(()=>evaluate(`[...document.querySelectorAll('.tracking-modal button')].some(n=>n.innerText===${JSON.stringify('確認保存 '+n+' 項')}&&!n.disabled)`),'save dialog ready');await click('確認保存 '+n+' 項');};
 const date=async(label,value)=>{await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')}))`),'date editor ready');await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});if(!n)throw new Error('date absent');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 const choose=async refs=>{await click('清除選取');for(const ref of refs)await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(ref)})).querySelector('input[type=checkbox]')`);};
 const tab=label=>nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);
 const toggle=label=>nodeClick(`[...document.querySelectorAll('.tracking-page summary')].find(n=>n.innerText===${JSON.stringify(label)})`);
 await check('discard-confirmation-cancel-keep-restore-and-exact-local-delete',async()=>{
  const before=await qa.read();await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 內容摘要/工程內容"]','只捨棄這份未送出草稿');await click('取消');
  assert.equal(await evaluate("[...document.querySelectorAll('.tracking-navigation button')].some(n=>n.innerText==='捨棄草稿並關閉')"),true,'explicit discard option required');await screen('fields-discard-confirmation');
  await click('取消切換');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 內容摘要/工程內容\"]').value"),'只捨棄這份未送出草稿');await click('取消');await click('保留草稿並繼續');await until(()=>evaluate("!document.querySelector('.modal-backdrop')"),'kept draft closed');await click('恢復本船未送出草稿');await click('取消');await click('捨棄草稿並關閉');await until(()=>evaluate("!document.querySelector('.modal-backdrop')"),'discard closed');
  assert.equal(await evaluate("Object.keys(localStorage).filter(k=>k.startsWith('[\"tracking-unsent-v1\"')).length"),0);assert.deepEqual(await qa.read(),before,'discard does not write business data');
 });
 const types=['repair','drydock','semiannual-materials','temporary-materials','spares'];const refs=types.map((_,i)=>'FIELD-UI-'+i);
 await check('one-cell-urgency-equal-notes-progress-five-types-mixed-batch-create',async()=>{
  const before=await qa.read();await click('＋ 新增／批量新增');
  await check('compact-create-header-desktop-mobile-and-fixed-vessel',async()=>{
   const header=()=>evaluate("(()=>{const n=document.querySelector('[aria-label=新增跟蹤說明]');if(!n)return null;return {text:n.textContent,controls:n.querySelectorAll('input,select,textarea').length,vessel:n.querySelector('strong').textContent,selected:document.querySelector('.tracking-heading select').selectedOptions[0].textContent,children:[...n.children].map(x=>{const r=x.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,width:r.width};}),viewport:innerWidth,scroll:document.documentElement.scrollWidth};})()");
   const desktop=await header();assert.ok(desktop,'compact header must be visible');assert.equal(desktop.controls,0);assert.equal(desktop.vessel,'船舶：'+desktop.selected);assert.ok(!desktop.text.includes('本次精確選取'));assert.ok(desktop.text.includes('保存後等待雲端確認。'));assert.ok(Math.abs(desktop.children[0].top-desktop.children[1].top)<3,'desktop vessel and explanation share one line');
   await screen('header-compact-desktop');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate("document.querySelector('[aria-label=新增跟蹤說明]').scrollIntoView({block:'start'})");
   const mobile=await header();assert.equal(mobile.vessel,desktop.vessel);assert.ok(mobile.scroll<=mobile.viewport+1);assert.ok(mobile.children.every(n=>n.left>=0&&n.right<=mobile.viewport+1&&n.width>0));await screen('header-compact-mobile');fs.writeFileSync(path.join(output,'header-compact-geometry.json'),JSON.stringify({desktop,mobile},null,2));await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});assert.deepEqual(await qa.read(),before,'header presentation does not write business data');
  });
  const measureLines=()=>evaluate("[...document.querySelectorAll('.tracking-input-line')].map(line=>[...line.children].map(n=>{const r=n.getBoundingClientRect();return {width:r.width,y:r.y,left:r.left,right:r.right,bottom:r.bottom};}))");
  const geometry=await measureLines();
  fs.writeFileSync(path.join(output,'field-form-geometry.json'),JSON.stringify(geometry,null,2));await screen('third-row-desktop');
  assert.deepEqual(geometry.map(line=>line.length),[4,4,3],'ordinary and urgent share one cell; notes and progress occupy the remaining two cells');
  for(const line of geometry.slice(0,2))assert.ok(Math.max(...line.map(n=>n.width))-Math.min(...line.map(n=>n.width))<1,'first two rows keep four equal fields');
  for(const line of geometry)assert.ok(Math.max(...line.map(n=>n.y))-Math.min(...line.map(n=>n.y))<1,'each desktop row stays aligned');
  const [urgency,notes,progress]=geometry[2];
  assert.ok(Math.abs(urgency.width-geometry[0][0].width)<1,'urgency group occupies exactly one original column');
  assert.ok(Math.abs(notes.width-progress.width)<1&&notes.width>urgency.width,'notes and progress equally share the other three columns');
  assert.ok(Math.abs(progress.right-geometry[0][3].right)<1&&notes.left>urgency.right&&progress.left>notes.right,'third row fills the same width without overlap');
  const urgencyState=()=>evaluate("(()=>{const line=document.querySelector('[aria-label=\"第 1 筆 第三行\"]');const inputs=[...line.querySelectorAll('input')];return inputs.map(n=>({label:n.getAttribute('aria-label'),type:n.type,checked:n.checked,sharedCell:n.closest('label').parentElement===line.firstElementChild}));})()");
  const initialUrgency=await urgencyState();assert.deepEqual(initialUrgency.map(n=>[n.label,n.type,n.checked,n.sharedCell]),[['第 1 筆 普通','checkbox',true,true],['第 1 筆 緊急','checkbox',false,true]]);
  const notesText='補充說明：長文保持完整，核對備件與工程所需安排。'.repeat(6),progressText='最新進度：已聯絡廠商確認，等待下一次回覆。'.repeat(6);
  await fill('[aria-label="第 1 筆 補充說明"]',notesText);await fill('[aria-label="第 1 筆 最新進度"]',progressText);
  for(const [label,expected] of [['緊急',[false,true]],['普通',[true,false]],['緊急',[false,true]]]){await nodeClick(`document.querySelector('[aria-label="第 1 筆 ${label}"]')`);assert.deepEqual((await urgencyState()).map(n=>n.checked),expected,'existing exclusive checkbox behavior retained');}
  await screen('third-row-desktop-filled');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate("document.querySelector('[aria-label=\"第 1 筆 第三行\"]').scrollIntoView({block:'center'})");
  const mobileGeometry=await measureLines(),mobileThird=mobileGeometry[2];
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.ok(mobileThird.every(n=>n.width>0&&n.left>=0&&n.right<=391));
  assert.ok(Math.max(...mobileThird.map(n=>n.width))-Math.min(...mobileThird.map(n=>n.width))<1,'mobile keeps full-width stacked fields');
  assert.ok(mobileThird[1].y>=mobileThird[0].bottom&&mobileThird[2].y>=mobileThird[1].bottom,'mobile group and text fields do not overlap');
  const mobileOptions=await evaluate("[...document.querySelector('[aria-label=\"第 1 筆 第三行\"]').querySelectorAll('input[type=checkbox]')].map(n=>{const r=n.closest('label').getBoundingClientRect();return {top:r.top,left:r.left,right:r.right};})");
  assert.ok(Math.abs(mobileOptions[0].top-mobileOptions[1].top)<1&&mobileOptions[0].right<mobileOptions[1].left,'mobile urgency choices stay together on one line');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 補充說明\"]').value"),notesText);assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 最新進度\"]').value"),progressText);
  fs.writeFileSync(path.join(output,'third-row-mobile-geometry.json'),JSON.stringify({lines:mobileGeometry,options:mobileOptions},null,2));await screen('third-row-mobile-filled');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});assert.deepEqual(await qa.read(),before,'layout/input probes do not save before explicit submission');
  assert.deepEqual(await evaluate("[...document.querySelector('[aria-label=\"第 1 筆 類型\"]').options].map(n=>n.text)"),['維修工程','塢修工程','半年物料','臨時物料','備件']);
  for(let i=0;i<types.length;i++){
   if(i)await click('＋ 新增一列');await fill(`[aria-label="第 ${i+1} 筆 申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="第 ${i+1} 筆 內容摘要/工程內容"]`,'中性欄位測試 '+i);await select(`document.querySelector('[aria-label="第 ${i+1} 筆 類型"]')`,types[i]);await date(`第 ${i+1} 筆 申請/開單日期`,'2026-09-25');
  }
  await screen('fields-create-desktop');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await screen('fields-create-mobile');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await save(5);await finish();const saved=await qa.read();assert.equal(saved.revision,before.revision+1);for(let i=0;i<types.length;i++){const row=saved.payload.trackingItems.find(r=>r.referenceNo===refs[i]);assert.equal(row.requestType,types[i]);assert.equal(row.kind,i<2?'engineering':'supply');assert.equal(row.isClosed,false);}
  const firstSaved=saved.payload.trackingItems.find(r=>r.referenceNo===refs[0]);assert.equal(firstSaved.urgency,'urgent');assert.equal(firstSaved.supplementalNotes,notesText);assert.equal(firstSaved.progress,progressText);
 });
 await check('dropdown-filter-settings-selection-and-global-search',async()=>{
  await toggle('全部欄位篩選');assert.equal(await evaluate("document.querySelectorAll('.tracking-filter-grid input:not([type=checkbox]),.tracking-filter-grid textarea').length"),0);
  await nodeClick("document.querySelector('[aria-label=\"類型篩選內容\"]')");await nodeClick("[...document.querySelectorAll('[aria-label=\"類型多選\"] label')].find(n=>n.textContent==='半年物料').querySelector('input')");
  await until(()=>evaluate("document.querySelectorAll('.tracking-table tbody tr .tracking-reference').length===1"),'request type dropdown narrows table');assert.ok(await evaluate("document.querySelector('.tracking-table').innerText.includes('FIELD-UI-2')"));await screen('fields-dropdown');await click('清除條件');await toggle('全部欄位篩選');
  await toggle('欄位設定');const settings=await evaluate("document.querySelector('.tracking-preferences').textContent");for(const old of ['備貨完成日期','供應商','預計供料日期','實際全部送達日期'])assert.ok(!settings.includes(old));assert.ok(settings.includes('類型'));await toggle('欄位設定');await fill('[aria-label="搜尋跟蹤"]','FIELD-UI');await until(()=>evaluate("document.querySelectorAll('.tracking-table tbody tr .tracking-reference').length===3"),'global search still works');await click('清除條件');
 });
 await check('explicit-multiselect-batch-edit-delivery-close-and-reopen',async()=>{
  const supply=refs.slice(2),before=await qa.read();await choose(supply);await click('批量更新');await until(()=>evaluate("document.querySelectorAll('.tracking-form-row').length===3"),'batch full field editor');
  for(let i=0;i<3;i++){await fill(`[aria-label="第 ${i+1} 筆 請購案號(非必填)"]`,'0000'+i);await fill(`[aria-label="第 ${i+1} 筆 最新進度"]`,'批量更新的進度 '+i);}
  await date('第 1 筆 實際送達/完工日期','2026-09-28');await date('第 1 筆 實際送達/完工日期','');await save(3);await finish();let saved=await qa.read();assert.equal(saved.revision,before.revision+1);assert.deepEqual(saved.payload.trackingItems.filter(r=>!supply.includes(r.referenceNo)),before.payload.trackingItems.filter(r=>!supply.includes(r.referenceNo)));
  await choose(supply);await click('批量送達／更正');await date('實際送達/完工日期','2026-09-26');await save(3);await finish();await tab('已送船清單');
  for(const ref of supply){const row=(await qa.read()).payload.trackingItems.find(r=>r.referenceNo===ref);assert.equal(row.deliveryStatus,'delivered');assert.equal(row.isClosed,false);}
  await choose(supply);await click('批量結案');await date('結案日期','2026-09-27');await save(3);await finish();await choose(supply);await click('重開所選');await save(3);await finish();
  for(const ref of supply){const row=(await qa.read()).payload.trackingItems.find(r=>r.referenceNo===ref);assert.equal(row.isClosed,false);assert.equal(row.actualDeliveryDate,'2026-09-26');}
 });
 await check('engineering-batch-completion-independent-of-close-reopen',async()=>{
  await tab('未完成工程單');await choose(refs.slice(0,2));await click('批量完工／更正');await date('實際送達/完工日期','2026-09-26');await save(2);await finish();await tab('已完成工程單');
  for(const ref of refs.slice(0,2)){const row=(await qa.read()).payload.trackingItems.find(r=>r.referenceNo===ref);assert.equal(row.completionDate,'2026-09-26');assert.equal(row.isClosed,false);}
  await choose(refs.slice(0,2));await click('批量結案');await date('結案日期','2026-09-27');await save(2);await finish();await choose(refs.slice(0,2));await click('重開所選');await save(2);await finish();
  assert.equal(await evaluate("document.querySelectorAll('.tracking-table tbody tr .tracking-reference').length"),2);await screen('fields-engineering-completed');await tab('未送船清單');
 });
 await check('import-same-kind-type-change-preserves-partial-delivery-native-ACK',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('跟蹤資料'),keys=['referenceNo','description','applicationDate','deliveryStatus','actualDeliveryDate','normal','urgent','supplementalNotes'];
  sheet.addRow(keys.map(key=>'tracking:'+key));sheet.addRow(keys);sheet.addRow(['FIELD-PARTIAL-LEGACY','中性部分送船資料','2026-09-25','部分送船','','是','否','原說明']);sheet.addRow(['FIELD-PARTIAL-EDIT','中性人工核對資料','2026-09-25','未送船','','是','否','原說明']);book.addWorksheet('_tracking_schema').addRows([['version','ship-tracking/1'],['kind','supply']]);
  const file=path.join(output,'fields-partial-delivery-import.xlsx');await book.xlsx.writeFile(file);const before=await qa.read();await click('導入 Excel');await until(()=>evaluate("Boolean(document.querySelector('input[type=file]'))"),'partial import entry');
  const document=await call('DOM.getDocument'),{nodeId}=await call('DOM.querySelector',{nodeId:document.root.nodeId,selector:'input[type=file]'});await call('DOM.setFileInputFiles',{nodeId,files:[file]});
  await until(()=>evaluate("Boolean(document.querySelector('[aria-label=確認本次選船]:not(:disabled)'))"),'partial workbook parsed');await nodeClick("document.querySelector('[aria-label=確認本次選船]')");await click('選取全部候選');
  for(const [row,type] of [[3,'semiannual-materials'],[4,'spares']]){
   await nodeClick(`[...document.querySelectorAll('.tracking-import-rows fieldset')].find(n=>n.querySelector('[aria-label="選取來源第${row}列"]')).querySelector('summary')`);
   if(row===4)await select(`document.querySelector('[aria-label="匯入第 ${row} 列 送船狀態"]')`,'partially-delivered');
   assert.equal(await evaluate(`document.querySelector('[aria-label="匯入第 ${row} 列 送船狀態"]').value`),'partially-delivered');
   // Select one option, like a mouse choice; keyboard traversal commits intermediate kinds.
   await evaluate(`(()=>{const n=document.querySelector('[aria-label="匯入第 ${row} 列 類型"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(type)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`document.querySelector('[aria-label="匯入第 ${row} 列 類型"]').value===${JSON.stringify(type)}`),'single type choice');
   assert.equal(await evaluate(`document.querySelector('[aria-label="匯入第 ${row} 列 送船狀態"]').value`),'partially-delivered','type-only changes preserve independent status');assert.equal(await evaluate(`document.querySelector('[aria-label="匯入第 ${row} 列 實際送達/完工日期"]').value`),'');
  }
  await screen('fields-import-partial-preserved');await click('確認保存所選 2 項');await until(()=>evaluate("document.body.innerText.includes('本批 2 項已確認並權威讀回')"),'partial import exact native ACK',40000);const saved=await qa.read(),imported=saved.payload.trackingItems.filter(row=>row.referenceNo.startsWith('FIELD-PARTIAL-'));
  assert.equal(imported.length,2);assert.equal(saved.revision,before.revision+1);assert.deepEqual(saved.payload.trackingItems.filter(row=>!row.referenceNo.startsWith('FIELD-PARTIAL-')),before.payload.trackingItems);for(const row of imported){assert.equal(row.deliveryStatus,'partially-delivered');assert.equal(row.actualDeliveryDate,'');assert.equal(row.supplementalNotes,'原說明');assert.equal(row.isClosed,false);}assert.deepEqual(imported.map(row=>row.requestType).sort(),['semiannual-materials','spares']);await click('關閉導入');
 });
 await check('same-application-current-first-row-fresh-items-required-body-and-native-ACK',async()=>{
  const before=await qa.read();await click('＋ 新增／批量新增');
  const input=(i,label)=>`[aria-label="第 ${i} 筆 ${label}"]`;
  const value=(i,label)=>evaluate(`document.querySelector(${JSON.stringify(input(i,label))}).value`);
  const type=async(i,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(input(i,'類型'))});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`document.querySelector(${JSON.stringify(input(i,'類型'))}).value===${JSON.stringify(value)}`),'same-application type selected');};
  const named=async i=>Promise.all(['申請單號(材料或工程)','申請/開單日期','類型','期望完成日期/DL'].map(label=>value(i,label)));
  const fresh=async i=>{for(const label of ['請購案號(非必填)','原項次','內容摘要/工程內容','實際送達/完工日期','補充說明','最新進度'])assert.equal(await value(i,label),'',`row ${i}: ${label} must not be copied`);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input(i,'普通'))}).checked`),true);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input(i,'緊急'))}).checked`),false);};
  await fill(input(1,'申請單號(材料或工程)'),'SAME-APP-INITIAL');await date('第 1 筆 申請/開單日期','2026-10-01');await type(1,'semiannual-materials');await date('第 1 筆 期望完成日期/DL','2026-11-01');
  for(const [label,text] of [['內容摘要/工程內容','第一筆獨立內容'],['請購案號(非必填)','P-FIRST-ONLY'],['原項次','01'],['補充說明','第一筆獨立說明'],['最新進度','第一筆獨立進度']])await fill(input(1,label),text);
  await date('第 1 筆 實際送達/完工日期','2026-10-02');await nodeClick(`document.querySelector(${JSON.stringify(input(1,'緊急'))})`);
  await click('同申請單號新增一筆');assert.deepEqual(await named(2),['SAME-APP-INITIAL','2026-10-01','semiannual-materials','2026-11-01']);await fresh(2);
  await fill(input(2,'內容摘要/工程內容'),'第二筆獨立內容');await fill(input(2,'申請單號(材料或工程)'),'SAME-APP-OTHER');await type(2,'temporary-materials');await date('第 2 筆 期望完成日期/DL','2027-01-01');
  assert.deepEqual(await named(1),['SAME-APP-INITIAL','2026-10-01','semiannual-materials','2026-11-01'],'editing appended row does not mutate first');
  await fill(input(1,'申請單號(材料或工程)'),'SAME-APP-LATEST');await date('第 1 筆 申請/開單日期','2026-10-03');await type(1,'spares');await date('第 1 筆 期望完成日期/DL','2026-11-03');await click('同申請單號新增一筆');
  assert.deepEqual(await named(3),['SAME-APP-LATEST','2026-10-03','spares','2026-11-03'],'new click uses current first, not initial first or last');await fresh(3);assert.deepEqual(await named(2),['SAME-APP-OTHER','2026-10-01','temporary-materials','2027-01-01'],'previous append is an independent snapshot');
  const ids=await evaluate("[...document.querySelectorAll('.tracking-form-row legend')].map(n=>n.innerText.split('｜')[1])");assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);assert.ok(ids.every(id=>id&&!before.payload.trackingItems.some(row=>row.id===id)));
  await save(3);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input(3,'內容摘要/工程內容'))}).validity.valueMissing`),true);assert.deepEqual(await qa.read(),before,'adding rows and invalid submit do not write business data');
  await fill(input(3,'內容摘要/工程內容'),'第三筆獨立內容');await click('取消');await click('取消切換');assert.deepEqual(await named(3),['SAME-APP-LATEST','2026-10-03','spares','2026-11-03']);
  await evaluate("document.querySelector('.tracking-modal .modal-actions').scrollIntoView({block:'center'})");await screen('same-application-desktop');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate("document.querySelector('.tracking-modal .modal-actions').scrollIntoView({block:'center'})");
  const geometry=await evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.tracking-modal .modal-actions button')].map(n=>{const r=n.getBoundingClientRect();return {label:n.innerText,left:r.left,right:r.right,width:r.width};})})");fs.writeFileSync(path.join(output,'same-application-mobile-geometry.json'),JSON.stringify(geometry,null,2));assert.ok(geometry.document<=geometry.viewport+1);assert.ok(geometry.buttons.every(n=>n.left>=0&&n.right<=geometry.viewport+1&&n.width>0));await screen('same-application-mobile');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await save(3);await finish();const saved=await qa.read(),created=saved.payload.trackingItems.filter(row=>ids.includes(row.id));assert.equal(saved.revision,before.revision+1);assert.equal(created.length,3);assert.deepEqual(saved.payload.trackingItems.filter(row=>!ids.includes(row.id)),before.payload.trackingItems);assert.deepEqual(saved.payload.internalControlCases,before.payload.internalControlCases);assert.deepEqual(saved.payload.tasks,before.payload.tasks);
  const first=created.find(row=>row.id===ids[0]),second=created.find(row=>row.id===ids[1]),third=created.find(row=>row.id===ids[2]);for(const row of [first,third])for(const [key,value] of Object.entries({referenceNo:'SAME-APP-LATEST',applicationDate:'2026-10-03',requestType:'spares',expectedDate:'2026-11-03'}))assert.equal(row[key],value);
  assert.equal(first.actualDeliveryDate,'2026-10-02');assert.equal(first.deliveryStatus,'delivered');assert.equal(second.referenceNo,'SAME-APP-OTHER');assert.equal(second.requestType,'temporary-materials');assert.equal(second.expectedDate,'2027-01-01');
  for(const row of [second,third]){assert.equal(row.kind,'supply');assert.equal(row.vesselId,first.vesselId);assert.equal(row.isClosed,false);assert.equal(row.deliveryStatus,'not-delivered');assert.equal(row.urgency,'normal');assert.deepEqual(row.statusLogs,[]);for(const key of ['purchaseNos','originalItemNo','actualDeliveryDate','completionDate','supplementalNotes','progress'])assert.ok(!row[key],`${key} stays fresh after authoritative save`);assert.ok(!row.linkedCaseId&&!row.source);}
  assert.equal(third.description,'第三筆獨立內容');assert.equal(first.description,'第一筆獨立內容');assert.equal(second.description,'第二筆獨立內容');
 });
}
