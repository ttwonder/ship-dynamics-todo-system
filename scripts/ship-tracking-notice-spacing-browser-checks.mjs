import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Actual ship UI + synthetic private SQL; long warning is a DOM-only CSS wrapping probe, not an unknown-ACK test.
export async function shipTrackingNoticeSpacingChecks({qa,call,evaluate,screen,check,output}){
 const before=await qa.read(),selector='.ship-tracking-portal>.ship-notice';
 const original=await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
 const longWarning='尚未確認保存；請保留原輸入，使用原提交確認結果或核對資料。'.repeat(2);
 const measurements=[];
 await check('ship-notice-compact-outer-gaps-desktop-mobile-and-wrapped-text',async()=>{
  try{
   for(const width of [1440,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for(const [state,message] of [['confirmed-real-state',original],['warning-DOM-wrap-probe',longWarning]]){
     await evaluate(`(()=>{document.querySelector(${JSON.stringify(selector)}).textContent=${JSON.stringify(message)};window.scrollTo(0,0);})()`);await evaluate('document.fonts.ready');
     const m=await evaluate(`(()=>{const shell=document.querySelector('.ship-tracking-portal'),header=shell.querySelector(':scope>.ship-portal-header'),notice=shell.querySelector(':scope>.ship-notice'),list=shell.querySelector(':scope>.tracking-page'),h=header.getBoundingClientRect(),n=notice.getBoundingClientRect(),l=list.getBoundingClientRect(),s=getComputedStyle(notice);return{viewport:innerWidth,document:document.documentElement.scrollWidth,topGap:n.top-h.bottom,bottomGap:l.top-n.bottom,gridGap:parseFloat(getComputedStyle(shell).rowGap),marginTop:s.marginTop,marginBottom:s.marginBottom,text:notice.textContent,role:notice.getAttribute('role'),header:{width:h.width,height:h.height,top:h.top},notice:{width:n.width,height:n.height,font:s.font,lineHeight:s.lineHeight,padding:s.padding,color:s.color,background:s.backgroundColor},list:{width:l.width,height:l.height},noticeBottom:n.bottom,listTop:l.top};})()`);
     measurements.push({state,...m});await screen('ship-notice-'+state+'-'+width);
    }
   }
  }finally{await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent=${JSON.stringify(original)}`);}
  fs.writeFileSync(path.join(output,'notice-spacing.json'),JSON.stringify(measurements,null,2));
  assert.ok(measurements.find(m=>m.viewport===390&&m.state==='warning-DOM-wrap-probe').notice.height>measurements.find(m=>m.viewport===390&&m.state==='confirmed-real-state').notice.height,'narrow long-text probe must actually wrap');
  for(const m of measurements){assert.equal(m.marginTop,'0px','notice paragraph must not add space above the existing grid gap');assert.equal(m.marginBottom,'0px');assert.ok(Math.abs(m.topGap-m.gridGap)<0.5&&Math.abs(m.bottomGap-m.gridGap)<0.5);assert.ok(m.topGap<=6.5&&m.bottomGap<=6.5);assert.ok(m.document<=m.viewport+1);assert.equal(m.role,'status');assert.equal(m.text,m.state==='confirmed-real-state'?original:longWarning);}
 });
 await check('ship-notice-layout-only-original-text-and-business-state-preserved',async()=>{
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`),original);assert.deepEqual(await qa.read(),before);
 });
}
