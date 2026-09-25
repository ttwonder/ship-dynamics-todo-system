import assert from 'node:assert/strict';
export async function shipTrackingChecks({a,b,page,qa,native,read,source,until,check,evidence}){
 const ship=await page('anonymous-ship','tracking');assert.notEqual(ship.context,a.context);
 const action=(p,ref,label)=>p.activate(`[...(${p.row(ref)})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()===${JSON.stringify(label)})`);
 const refresh=async()=>{await ship.click('讀取最新資料');await until(()=>ship.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='讀取最新資料'&&!n.disabled)"),'ship refresh completed');};
 const active=async()=> (await native.observer.query('select section_key,locked_by,lease_version from ship_dynamics_edit_locks where workspace_key=$1 and expires_at>clock_timestamp() order by section_key',[qa.workspace])).rows;
 await check('anonymous-ship-create-is-visible-in-original-shore-App',async()=>{
  await ship.click('＋ 新增／批量新增');await ship.fill('[aria-label="第 1 筆 項目編號"]','SHIP-PEER');await ship.fill('[aria-label="第 1 筆 內容摘要／工程內容"]','船岸同一筆測試');await ship.fill('[aria-label="第 1 筆 最新進度"]','船端初始');await ship.submit();await ship.done();
  await a.sync();await a.tracking();await until(()=>a.eval(`Boolean(${a.row('SHIP-PEER')})`),'shore source visible');assert.equal((await source('SHIP-PEER')).progress,'船端初始');
 });
 await check('shore-held-bundle-blocks-ship-and-releases-after-ACK',async()=>{
  await a.progress('SHIP-PEER','岸端確認更新');const before=await read();await action(ship,'SHIP-PEER','進度');await until(async()=>(await ship.text()).includes('編輯權未取得或已失效'),'ship blocked');assert.equal(await ship.eval("Boolean(document.querySelector('.modal-backdrop'))"),false);assert.deepEqual(await read(),before);
  await a.submit();await a.done();await refresh();await until(()=>ship.eval(`(${ship.row('SHIP-PEER')})?.innerText.includes('岸端確認更新')`),'ship sees shore update');
 });
 await check('actual-ship-renewal-loss-freezes-same-draft-and-reconciles',async()=>{
  await ship.progress('SHIP-PEER','船端失鎖保留原文');await ship.eval('void(window.__qaProgress=document.querySelector(\'[aria-label="SHIP-PEER 最新進度"]\'))');
  await b.sync();await b.tracking();const before=await read();await action(b,'SHIP-PEER','進度');await until(async()=>evidence.dialogs?.some(d=>d.actor==='qa-operator'&&d.message.startsWith('此項目正在由')),'office blocked by ship');assert.equal(await b.eval("Boolean(document.querySelector('.tracking-modal'))"),false);assert.deepEqual(await read(),before);
  const id=(await source('SHIP-PEER')).id;await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2",[qa.workspace,'tracking:'+id]);
  await until(()=>ship.eval("document.querySelector('[aria-label=\"SHIP-PEER 最新進度\"]')?.matches(':disabled')"),'real heartbeat freezes expired editor',20000);
  assert.equal(await ship.eval("document.querySelector('[aria-label=\"SHIP-PEER 最新進度\"]')===window.__qaProgress"),true);assert.equal(await ship.eval('window.__qaProgress.value'),'船端失鎖保留原文');
  await a.progress('SHIP-PEER','岸端取得接手後更新');await a.submit();await a.done();
  await ship.click('重新取得編輯權／核對最新資料');await until(async()=>(await ship.text()).includes('已核對最新版本；原輸入保留'),'ship explicit reconcile');assert.equal(await ship.eval('window.__qaProgress.value'),'船端失鎖保留原文');await ship.submit();await ship.done();
  const saved=await source('SHIP-PEER');assert.equal(saved.progress,'船端失鎖保留原文');assert.ok(saved.statusLogs.some(l=>l.text==='岸端取得接手後更新'));assert.equal((await active()).length,0);
 });
 await ship.screen('ship-two-contexts-complete');await a.screen('shore-two-contexts-complete');
}
