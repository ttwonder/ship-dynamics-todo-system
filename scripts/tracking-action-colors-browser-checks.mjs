import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Original shore/ship entries with synthetic data; no hosted writes.
export async function trackingActionColorsChecks({qa,call,evaluate,click,nodeClick,until,screen,check,output,audience}) {
 const labels=['批量修正','修改急迫度','修正分類','批量更新進度','批量送達／更正','同步到內控','查看歷史記錄'];
 const changedLabels=['批量修正','批量送達／更正','批量完工／更正','同步到內控'];
 const views=[{key:'supply',tab:'未送船清單',date:'批量送達／更正'},{key:'engineering',tab:'未完成工程單',date:'批量完工／更正'}];
 const tab=async label=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'color list ready');};
 const selectOne=async()=>{await click('清除選取');await nodeClick("document.querySelector('.tracking-table tbody .tracking-check input')");await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 1 項'"),'selected color controls');};
 const cancel=async()=>{await nodeClick("[...document.querySelectorAll('.modal button')].find(n=>['取消','關閉'].includes(n.innerText.trim()))");if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'color dialog closed');};
 const button=label=>`[...document.querySelectorAll('.tracking-toolbar button')].find(n=>n.innerText.trim()===${JSON.stringify(label)})`;
 const measure=()=>evaluate(`(()=>{const one=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {label:n.innerText.trim(),background:s.backgroundColor,color:s.color,opacity:Number(s.opacity),disabled:n.disabled,selected:n.getAttribute('aria-selected'),shadow:s.boxShadow,outline:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),focusVisible:n.matches(':focus-visible'),geometry:{width:r.width,height:r.height,font:s.font,padding:s.padding,margin:s.margin,border:s.borderWidth,whiteSpace:s.whiteSpace},left:r.left,right:r.right};};return {viewport:innerWidth,document:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.tracking-toolbar button')].map(one),entryButtons:[...document.querySelectorAll('.tracking-heading button,.tracking-tabs button')].map(one)};})()`);
 const lum=color=>{const v=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
 const contrast=b=>{const a=lum(b.color),c=lum(b.background);return (Math.max(a,c)+.05)/(Math.min(a,c)+.05);};
 const entryLabels=['＋ 新增／批量新增','統計資訊'];
 const entryButton=label=>`[...document.querySelectorAll('.tracking-heading button,.tracking-tabs button')].find(n=>n.innerText.trim()===${JSON.stringify(label)})`;
 const measurements=[],completionMeasurements=[],states=[];
 const record=()=>fs.writeFileSync(path.join(output,'action-colors.json'),JSON.stringify({audience,measurements,completionMeasurements,states},null,2));
 // Create an actual engineering fixture before the color-only zero-write baseline.
 await check(`${audience}-action-color-engineering-fixture-through-original-create`,async()=>{
  await tab(views[1].tab);await click('＋ 新增／批量新增');
  for(const [label,value] of [['第 1 筆 申請單號(材料或工程)','COLOR-ENGINEERING'],['第 1 筆 內容摘要/工程內容','工程按鈕配色測試']]){
   const selector=`[aria-label="${label}"]`;await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),'engineering fixture input');
   await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.select();})()`);await call('Input.insertText',{text:value});
  }
  await click('確認保存 1 項');await until(()=>evaluate('!document.querySelector(".modal-backdrop")&&document.querySelector(".tracking-table")?.innerText.includes("COLOR-ENGINEERING")'),'engineering fixture confirmed');
  assert.equal((await qa.read()).payload.trackingItems.find(r=>r.referenceNo==='COLOR-ENGINEERING')?.kind,'engineering');
 });
 const before=await qa.read();
 // Capture both business captions on the actual mounted entries before assertions.
 for(const view of views){
  await tab(view.tab);await selectOne();
  for(const width of [1440,390])for(const theme of ['light','dark']) {
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
   await evaluate("document.querySelector('.tracking-heading').scrollIntoView({block:'start'})");
   const value=await measure();(view.key==='supply'?measurements:completionMeasurements).push({width,theme,view:view.key,...value});record();
   await screen(`${audience}-action-colors-${view.key}-${width}-${theme}`);
  }
 }
 await tab(views[0].tab);await selectOne();
 await check(`${audience}-three-prominent-groups-including-delivery-and-completion-white-text`,async()=>{
  const baseline=process.env.QA_ACTION_COLORS_BASELINE?JSON.parse(fs.readFileSync(process.env.QA_ACTION_COLORS_BASELINE,'utf8')):null;
  if(baseline)assert.equal(baseline.audience,audience);
  for(const m of [...measurements,...completionMeasurements]){
   const view=views.find(v=>v.key===m.view);
   for(const [label,background] of [['批量修正','rgb(71, 85, 105)'],[view.date,'rgb(180, 83, 9)'],['同步到內控','rgb(109, 40, 217)']]){
    const b=m.buttons.find(b=>b.label===label);assert.ok(b,label);assert.equal(b.background,background,label+' prominent background');assert.equal(b.color,'rgb(255, 255, 255)');assert.ok(contrast(b)>=4.5);assert.ok(!b.disabled&&b.opacity===1);assert.ok(b.left>=0&&b.right<=m.width+1);
   }
   assert.ok(!m.buttons.some(b=>b.label===views.find(v=>v!==view).date),'correct date-action caption for this business kind');assert.ok(m.document<=m.width+1);
   if(baseline){const old=(m.view==='supply'?baseline.measurements:baseline.completionMeasurements).find(b=>b.width===m.width&&b.theme===m.theme);assert.deepEqual(m.buttons.map(b=>({label:b.label,geometry:b.geometry})),old.buttons.map(b=>({label:b.label,geometry:b.geometry})),'both kinds preserve button order, captions and geometry');for(const b of m.buttons.filter(b=>!changedLabels.includes(b.label))){const a=old.buttons.find(a=>a.label===b.label);assert.equal(b.background,a.background);assert.equal(b.color,a.color);}}
  }
 });
 await check(`${audience}-create-green-statistics-blue-white-text-with-original-entry-geometry`,async()=>{
  const baseline=process.env.QA_ACTION_COLORS_BASELINE?JSON.parse(fs.readFileSync(process.env.QA_ACTION_COLORS_BASELINE,'utf8')):null;
  if(baseline)assert.equal(baseline.audience,audience);
  for(const m of measurements){
   for(const [label,background] of [['＋ 新增／批量新增','rgb(21, 128, 61)'],['統計資訊','rgb(3, 105, 161)']]){
    const b=m.entryButtons.find(n=>n.label===label);assert.ok(b,label);assert.equal(b.background,background,label+' prominent background');assert.equal(b.color,'rgb(255, 255, 255)');assert.ok(contrast(b)>=4.5);assert.ok(!b.disabled&&b.opacity===1);assert.ok(b.left>=0&&b.right<=m.width+1);
   }
   if(baseline){const old=baseline.measurements.find(b=>b.width===m.width&&b.theme===m.theme);assert.deepEqual(m.entryButtons.map(b=>({label:b.label,geometry:b.geometry})),old.entryButtons.map(b=>({label:b.label,geometry:b.geometry})),'entry order, captions and density unchanged');for(const b of m.entryButtons.filter(b=>!entryLabels.includes(b.label))){const a=old.entryButtons.find(a=>a.label===b.label);assert.equal(b.background,a.background);assert.equal(b.color,a.color);}}
  }
 });
 await check(`${audience}-seven-distinct-action-colors-readable-desktop-mobile`,async()=>{
  const baseline=process.env.QA_ACTION_COLORS_BASELINE?JSON.parse(fs.readFileSync(process.env.QA_ACTION_COLORS_BASELINE,'utf8')):null;
  if(baseline)assert.equal(baseline.audience,audience);
  for(const m of measurements){
   const selected=labels.map(label=>{const b=m.buttons.find(n=>n.label===label);assert.ok(b,label);return b;});
   assert.equal(new Set(selected.map(b=>b.background)).size,7,'seven actions must not share one background');
   for(const b of selected){assert.equal(b.disabled,false);assert.equal(b.opacity,1);assert.ok(contrast(b)>=4.5,'text contrast '+b.label);assert.ok(b.left>=0&&b.right<=m.width+1,'button stays inside viewport');}
   for(const label of ['批量修正','修改急迫度','批量更新進度','批量送達／更正','同步到內控','查看歷史記錄'])assert.equal(selected.find(b=>b.label===label).color,'rgb(255, 255, 255)','important actions use solid color / white text');
   assert.deepEqual(m.buttons.filter(b=>labels.includes(b.label)).map(b=>b.label),labels,'urgency is between edit and reclassify');
   assert.ok(m.document<=m.width+1,'no document overflow');
   if(baseline){const old=baseline.measurements.find(b=>b.width===m.width&&b.theme===m.theme);assert.deepEqual(m.buttons.map(b=>({label:b.label,geometry:b.geometry})),old.buttons.map(b=>({label:b.label,geometry:b.geometry})),'order, caption, density and geometry unchanged');for(const b of m.buttons.filter(b=>!labels.includes(b.label))){const a=old.buttons.find(a=>a.label===b.label);assert.equal(b.background,a.background);assert.equal(b.color,a.color);}}
  }
 });
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 await check(`${audience}-hover-and-keyboard-focus-preserve-readable-colors`,async()=>{
  for(const label of labels){
   const pos=await evaluate(`(()=>{const n=${button(label)};n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
   const hovered=(await measure()).buttons.find(b=>b.label===label);assert.ok(contrast(hovered)>=4.5);assert.notEqual(hovered.background,measurements[0].buttons.find(b=>b.label===label).background,'visible hover');
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   await evaluate(`void (${button(label)}).focus()`);
   const focused=(await measure()).buttons.find(b=>b.label===label);assert.ok(focused.focusVisible&&focused.outline==='solid'&&focused.outlineWidth>=2,'visible keyboard focus');
  }
 });
 await check(`${audience}-same-action-dialogs-and-readonly-history`,async()=>{
  for(const label of labels){
   const start=qa.metrics.length;
   await click(label);await until(()=>evaluate('Boolean(document.querySelector(".modal"))'),'original dialog '+label);
   if(label==='查看歷史記錄'){
    assert.ok(await evaluate('Boolean(document.querySelector(".tracking-history-modal"))'));
    assert.deepEqual(qa.metrics.slice(start).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[]);
    await click('關閉紀錄');
   }else{
    if(label==='批量更新進度')assert.ok(await evaluate('Boolean(document.querySelector(".tracking-progress-modal"))'));
    await nodeClick("[...document.querySelectorAll('.modal button')].find(n=>['取消','關閉'].includes(n.innerText.trim()))");
    if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');
   }
   await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'dialog closed');
  }
  assert.deepEqual(await qa.read(),before,'opening and canceling colored actions cannot mutate business data');
 });
 await check(`${audience}-no-selection-keeps-actions-disabled`,async()=>{
  await click('清除選取');const m=await measure();
  for(const label of labels){const b=m.buttons.find(b=>b.label===label);assert.equal(b.disabled,true);assert.ok(b.opacity<1,'disabled remains visibly muted');}
  await screen(`${audience}-action-colors-disabled`);
 });
 await check(`${audience}-entry-hover-focus-and-native-disabled-style`,async()=>{
  for(const label of entryLabels){
   const pos=await evaluate(`(()=>{const n=${entryButton(label)};n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
   const hovered=(await measure()).entryButtons.find(b=>b.label===label);assert.ok(contrast(hovered)>=4.5);assert.notEqual(hovered.background,measurements[0].entryButtons.find(b=>b.label===label).background);
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await evaluate(`void (${entryButton(label)}).focus()`);
   const focused=(await measure()).entryButtons.find(b=>b.label===label);assert.ok(focused.focusVisible&&focused.outline==='solid'&&focused.outlineWidth>=2);
   states.push({label,hovered,focused});
  }
  // CSS-only native disabled-state probe, not a claim about runtime permission checks.
  const label='＋ 新增／批量新增';assert.equal(await evaluate(`(${entryButton(label)}).disabled`),false);
  try{await evaluate(`void ((${entryButton(label)}).disabled=true)`);const disabled=(await measure()).entryButtons.find(b=>b.label===label);assert.ok(disabled.disabled&&disabled.opacity<1);states.push({label,disabled});}finally{await evaluate(`void ((${entryButton(label)}).disabled=false)`);}
  record();
 });
 await check(`${audience}-statistics-selected-color-and-original-create-cancel-no-business-writes`,async()=>{
  await click('統計資訊');await until(()=>evaluate('Boolean(document.querySelector("[aria-label=統計摘要]"))'),'confirmed statistics');await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  for(const width of [1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate("document.querySelector('.tracking-heading').scrollIntoView({block:'start'})");
   const m=await measure(),b=m.entryButtons.find(n=>n.label==='統計資訊');assert.equal(b.selected,'true');assert.equal(b.background,'rgb(7, 89, 133)');assert.equal(b.color,'rgb(255, 255, 255)');assert.ok(contrast(b)>=4.5);assert.notEqual(b.shadow,'none');assert.ok(m.document<=width+1);states.push({width,selected:b});await screen(`${audience}-entry-statistics-selected-${width}`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith('未送船清單'))");await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'return to original list');
  await click('＋ 新增／批量新增');await until(()=>evaluate('Boolean(document.querySelector(".tracking-form-row"))'),'original create form');await nodeClick("[...document.querySelectorAll('.modal button')].find(n=>['取消','關閉'].includes(n.innerText.trim()))");if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'create canceled');
  assert.deepEqual(await qa.read(),before,'color, statistics and cancel probes do not mutate business data');record();
 });
 for(const view of views)await check(`${audience}-${view.key}-date-action-hover-focus-cancel-and-disabled`,async()=>{
  await tab(view.tab);await selectOne();const label=view.date;
  const pos=await evaluate(`(()=>{const n=${button(label)};n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
  const hovered=(await measure()).buttons.find(b=>b.label===label);assert.equal(hovered.background,'rgb(146, 64, 14)');assert.ok(contrast(hovered)>=4.5);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await evaluate(`void (${button(label)}).focus()`);
  const focused=(await measure()).buttons.find(b=>b.label===label);assert.ok(focused.focusVisible&&focused.outline==='solid'&&focused.outlineWidth>=2);
  await click(label);await until(()=>evaluate('Boolean(document.querySelector(".modal input[aria-label=同時結案]"))'),'original date and close opt-in dialog');
  assert.equal(await evaluate('document.querySelector(".modal input[aria-label=同時結案]").checked'),false);await cancel();
  await click('清除選取');const m=await measure();
  for(const name of ['批量修正',view.date,'同步到內控']){const b=m.buttons.find(b=>b.label===name);assert.ok(b.disabled&&b.opacity<1,'no selection remains disabled: '+name);}
  states.push({view:view.key,label,hovered,focused,disabled:m.buttons.filter(b=>['批量修正',view.date,'同步到內控'].includes(b.label))});record();
  assert.deepEqual(await qa.read(),before,'no business change after date dialog cancellation');
 });
}
