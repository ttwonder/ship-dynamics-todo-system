import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Original shore/ship entries with synthetic data; no hosted writes.
export async function trackingActionColorsChecks({qa,call,evaluate,click,nodeClick,until,screen,check,output,audience}) {
 const labels=['批量修正','修改急迫度','修正分類','批量更新進度','同步到內控','查看歷史記錄'];
 const button=label=>`[...document.querySelectorAll('.tracking-toolbar button')].find(n=>n.innerText.trim()===${JSON.stringify(label)})`;
 const measure=()=>evaluate(`(()=>{const bar=document.querySelector('.tracking-toolbar');return {viewport:innerWidth,document:document.documentElement.scrollWidth,buttons:[...bar.querySelectorAll('button')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {label:n.innerText.trim(),background:s.backgroundColor,color:s.color,opacity:Number(s.opacity),disabled:n.disabled,outline:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),focusVisible:n.matches(':focus-visible'),geometry:{width:r.width,height:r.height,font:s.font,padding:s.padding,margin:s.margin,border:s.borderWidth,whiteSpace:s.whiteSpace},left:r.left,right:r.right};})};})()`);
 const lum=color=>{const v=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
 const contrast=b=>{const a=lum(b.color),c=lum(b.background);return (Math.max(a,c)+.05)/(Math.min(a,c)+.05);};
 const measurements=[];
 const record=()=>fs.writeFileSync(path.join(output,'action-colors.json'),JSON.stringify({audience,measurements},null,2));
 const before=await qa.read();
 await click('清除選取');
 await nodeClick("document.querySelector('.tracking-table tbody .tracking-check input')");
 await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 1 項'"),'selected color controls');
 // Capture the actual baseline before the first failing assertion too.
 for(const width of [1440,390])for(const theme of ['light','dark']) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  await evaluate("document.querySelector('.tracking-toolbar').scrollIntoView({block:'center'})");
  const value=await measure();measurements.push({width,theme,...value});record();
  await screen(`${audience}-action-colors-${width}-${theme}`);
 }
 await check(`${audience}-six-distinct-action-colors-three-prominent-actions-readable-desktop-mobile`,async()=>{
  const baseline=process.env.QA_ACTION_COLORS_BASELINE?JSON.parse(fs.readFileSync(process.env.QA_ACTION_COLORS_BASELINE,'utf8')):null;
  if(baseline)assert.equal(baseline.audience,audience);
  for(const m of measurements){
   const selected=labels.map(label=>{const b=m.buttons.find(n=>n.label===label);assert.ok(b,label);return b;});
   assert.equal(new Set(selected.map(b=>b.background)).size,6,'six marked actions must not share one background');
   for(const b of selected){assert.equal(b.disabled,false);assert.equal(b.opacity,1);assert.ok(contrast(b)>=4.5,'text contrast '+b.label);assert.ok(b.left>=0&&b.right<=m.width+1,'button stays inside viewport');}
   for(const label of ['修改急迫度','批量更新進度','查看歷史記錄'])assert.equal(selected.find(b=>b.label===label).color,'rgb(255, 255, 255)','important actions use solid color / white text');
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
}
