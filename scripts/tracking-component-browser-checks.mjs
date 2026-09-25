import assert from 'node:assert/strict';
export async function componentChecks({qa,call,evaluate,click,nodeClick,fill,until,text,screen,check}){
 await call('Page.navigate',{url:qa.origin+'/scripts/fixtures/tracking-ui.html'});
 await until(()=>evaluate('Boolean(window.__trackingQA&&document.querySelector(".tracking-table"))'),'component fixture');
 const rowIds=()=>evaluate("[...document.querySelectorAll('.tracking-table tbody tr[data-tracking-id]')].map(n=>n.dataset.trackingId)");
 const selectPage=()=>nodeClick("document.querySelector('[aria-label=選取本頁]')");
 await check('component-65-row-sort-before-page-selection-filter-and-hidden-filter',async()=>{
   assert.equal((await rowIds()).length,30);assert.ok((await text()).includes('已選 0 項'));
   await click('申請單號(材料或工程) ↕');assert.equal((await rowIds())[0],'r64');
   await selectPage();assert.ok((await text()).includes('已選 30 項'));
   await click('下一頁');assert.equal((await rowIds())[0],'r34');assert.ok((await text()).includes('已選 30 項'));
   await click('末頁');assert.equal((await rowIds()).length,5);await fill('[aria-label="跳到頁碼"]','2');await click('跳頁');assert.equal((await rowIds())[0],'r34');
   await click('選取全部符合條件 65 項');assert.ok((await text()).includes('已選 65 項'));await click('申請單號(材料或工程) ↑');assert.ok((await text()).includes('已選 65 項'));
   await nodeClick("[...document.querySelectorAll('summary')].find(n=>n.innerText==='全部欄位篩選')");await nodeClick("document.querySelector('[aria-label=\"請購案號(非必填)篩選內容\"]')");await nodeClick("[...document.querySelectorAll('[aria-label=\"請購案號(非必填)多選\"] label')].find(n=>n.textContent==='A').querySelector('input')");assert.ok((await text()).includes('已選 0 項'));assert.ok((await text()).includes('已清除原選取'));
   await nodeClick("[...document.querySelectorAll('summary')].find(n=>n.innerText==='欄位設定')");
   await nodeClick("[...document.querySelectorAll('.tracking-preferences label')].find(n=>n.innerText==='請購案號(非必填)').querySelector('input')");
   assert.ok(await evaluate("document.querySelector('[aria-label=有效篩選]').innerText.includes('請購案號(非必填)（隱藏欄）')"));
   assert.ok((await text()).includes('共 32 項'));await click('清除條件');
   await screen('tracking-component-filter-preferences');
 });
 await check('component-column-preferences-actor-scope-keyboard-width-and-reset',async()=>{
   const first=await evaluate("document.querySelector('th.tracking-reference').getBoundingClientRect().width");
   await evaluate("document.querySelector('[aria-label=\"調整申請單號(材料或工程)欄寬\"]').focus()");await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
   assert.ok(await evaluate("document.querySelector('th.tracking-reference').getBoundingClientRect().width")>first);
   await evaluate("window.__trackingQA.change({actorId:'component-b',identity:'session-b'})");await until(()=>evaluate("Boolean([...document.querySelectorAll('.tracking-sort')].find(n=>n.innerText.startsWith('請購案號(非必填)')))"),'independent actor preference');
   await evaluate("window.__trackingQA.change({actorId:'component-a',identity:'session-a'})");await until(()=>evaluate("!Boolean([...document.querySelectorAll('.tracking-sort')].find(n=>n.innerText.startsWith('請購案號(非必填)')))"),'actor preference restored');
   await nodeClick("[...document.querySelectorAll('summary')].find(n=>n.innerText==='欄位設定')");await click('重設欄位配置');assert.ok(await evaluate("Boolean([...document.querySelectorAll('.tracking-sort')].find(n=>n.innerText.startsWith('請購案號(非必填)')))"));
 });
 await check('component-pointer-resize-header-drag-no-accidental-sort',async()=>{
   await evaluate("document.querySelector('.tracking-table-scroll').scrollIntoView()");
   const point=await evaluate("(()=>{const r=document.querySelector('[aria-label=\"調整申請單號(材料或工程)欄寬\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:document.querySelector('th.tracking-reference').getBoundingClientRect().width,sort:document.querySelector('th[aria-sort=descending]')?.innerText||document.querySelector('th[aria-sort=ascending]')?.innerText};})()");
   await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+44,y:point.y,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+44,y:point.y,button:'left',buttons:0,clickCount:1});
   assert.ok(await evaluate("document.querySelector('th.tracking-reference').getBoundingClientRect().width")>point.w);assert.equal(await evaluate("document.querySelector('th[aria-sort=descending]')?.innerText||document.querySelector('th[aria-sort=ascending]')?.innerText"),point.sort);
   await evaluate(`(()=>{const h=[...document.querySelectorAll('th')],from=h.find(n=>n.innerText.includes('請購案號')),to=h.find(n=>n.innerText.includes('申請/開單日期')),d=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));to.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:d}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d}));to.querySelector('button').click();from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:d}));})()`);
   const h=await evaluate("[...document.querySelectorAll('th')].map(n=>n.innerText)");assert.ok(h.findIndex(n=>n.includes('請購案號'))<h.findIndex(n=>n.includes('申請/開單日期')));assert.equal(await evaluate("document.querySelector('th[aria-sort=descending]')?.innerText||document.querySelector('th[aria-sort=ascending]')?.innerText"),point.sort);
   await evaluate('window.scrollTo(0,0)');
 });
 await check('component-mobile-390-light-dark-wrap-local-scroll',async()=>{
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   for(const theme of ['light','dark']){
     await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
     const g=await evaluate("(()=>{const s=document.querySelector('.tracking-table-scroll');const cell=document.querySelector('.tracking-cell-text');return {viewport:innerWidth,document:document.documentElement.scrollWidth,local:s.scrollWidth>s.clientWidth,whiteSpace:getComputedStyle(cell).whiteSpace,foreground:getComputedStyle(cell).color,background:getComputedStyle(cell.closest('td')).backgroundColor};})()");
     assert.equal(g.viewport,390);assert.ok(g.document<=390,JSON.stringify(g));assert.equal(g.local,true);assert.equal(g.whiteSpace,'pre-wrap');assert.notEqual(g.foreground,g.background);
     const contrast=await evaluate(`(()=>{const n=document.querySelector('.tracking-heading h2');let a=n,bg;while(a){bg=getComputedStyle(a).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;a=a.parentElement;}const lum=s=>{const v=s.match(/[0-9.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};const x=lum(getComputedStyle(n).color),y=lum(bg||'rgb(255,255,255)');return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);})()`);assert.ok(contrast>=4.5,'heading contrast '+contrast);await screen('tracking-component-390-'+theme);
   }
   await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 });
 await check('component-dirty-navigation-keep-cancel-user-vessel-draft',async()=>{
   await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 申請單號(材料或工程)"]','LOCAL-DRAFT');
   await click('取消');await click('取消切換');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 申請單號(材料或工程)\"]').value"),'LOCAL-DRAFT');
   await click('取消');await click('保留草稿並繼續');assert.ok(!await evaluate("Boolean(document.querySelector('[role=dialog]'))"));
   await evaluate("window.__trackingQA.change({actorId:'component-b',identity:'session-b'})");assert.ok(!(await text()).includes('恢復本船未送出草稿'));
   await evaluate("window.__trackingQA.change({actorId:'component-a',identity:'session-a'})");await until(async()=>(await text()).includes('恢復本船未送出草稿'),'owned draft');await click('恢復本船未送出草稿');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 申請單號(材料或工程)\"]').value"),'LOCAL-DRAFT');
 });
 await check('component-rejected-save-retains-draft-selection-and-exact-retry',async()=>{
   await fill('[aria-label="第 1 筆 內容摘要/工程內容"]','拒絕草稿');await evaluate("window.__trackingQA.change({mode:'reject'})");await click('確認保存 1 項');await until(async()=>(await text()).includes('確認結果／重試相同提交'),'rejected retained');
   await fill('[aria-label="第 1 筆 內容摘要/工程內容"]','拒絕後新輸入');await click('確認結果／重試相同提交');
   await until(()=>evaluate('window.__trackingQA.submissions.length===2'),'second exact submission');assert.ok(await evaluate('JSON.stringify(window.__trackingQA.submissions[0])===JSON.stringify(window.__trackingQA.submissions[1])'));
 });
 await check('component-owner-config-generation-change-fences-original-pending',async()=>{
   const before=await evaluate('window.__trackingQA.submissions.length');await evaluate("window.__trackingQA.change({identity:'successor-config'})");await click('確認結果／重試相同提交');assert.equal(await evaluate('window.__trackingQA.submissions.length'),before);assert.ok((await text()).includes('先前工作階段'));
   await evaluate("window.__trackingQA.change({actorId:'component-b',identity:'session-b',canWrite:false,allowed:['v2']})");await until(()=>evaluate("document.querySelector('[aria-label=跟蹤船舶]').value==='v2'"),'authorized vessel reset');assert.ok(!(await text()).includes('＋ 新增／批量新增'));assert.ok(!(await text()).includes('LOCAL-DRAFT'));assert.equal((await rowIds()).length,0);
 });
}
