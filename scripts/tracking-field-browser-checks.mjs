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
 await check('three-equal-width-lines-five-types-mixed-batch-create',async()=>{
  const before=await qa.read();await click('＋ 新增／批量新增');
  const geometry=await evaluate("[...document.querySelectorAll('.tracking-input-line')].map(line=>[...line.children].map(n=>({width:n.getBoundingClientRect().width,y:n.getBoundingClientRect().y})))");
  fs.writeFileSync(path.join(output,'field-form-geometry.json'),JSON.stringify(geometry,null,2));assert.deepEqual(geometry.map(line=>line.length),[4,4,4]);for(const line of geometry){assert.ok(Math.max(...line.map(n=>n.width))-Math.min(...line.map(n=>n.width))<2);assert.ok(Math.max(...line.map(n=>n.y))-Math.min(...line.map(n=>n.y))<2);}
  assert.deepEqual(await evaluate("[...document.querySelector('[aria-label=\"第 1 筆 類型\"]').options].map(n=>n.text)"),['維修工程','塢修工程','半年物料','臨時物料','備件']);
  for(let i=0;i<types.length;i++){
   if(i)await click('＋ 新增一列');await fill(`[aria-label="第 ${i+1} 筆 申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="第 ${i+1} 筆 內容摘要/工程內容"]`,'中性欄位測試 '+i);await select(`document.querySelector('[aria-label="第 ${i+1} 筆 類型"]')`,types[i]);await date(`第 ${i+1} 筆 申請/開單日期`,'2026-09-25');
  }
  await screen('fields-create-desktop');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await screen('fields-create-mobile');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await save(5);await finish();const saved=await qa.read();assert.equal(saved.revision,before.revision+1);for(let i=0;i<types.length;i++){const row=saved.payload.trackingItems.find(r=>r.referenceNo===refs[i]);assert.equal(row.requestType,types[i]);assert.equal(row.kind,i<2?'engineering':'supply');assert.equal(row.isClosed,false);}
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
}
