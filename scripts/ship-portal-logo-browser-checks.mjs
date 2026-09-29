import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Real production entries/assets; isolated local demo or deliberately inert config.
// Header/rendering proof only, not hosted services or successful cloud submission.
export async function shipPortalLogoChecks({call,evaluate,until,screen,origin,base,sourceUrl,evidence}) {
 const cases=[
  {name:'itinerary',file:'ship-itinerary.html?itineraryDemo=1',title:'船端 Itinerary',host:'.ship-portal-header'},
  {name:'tracking',file:'packageorwork-tracking.html',title:'船端配件／物料／工程跟蹤',host:'.ship-portal-header'},
  {name:'internal-control',file:'ship-internal-control.html',title:'船端內控/訴求',host:'.ship-portal-header'},
  {name:'itinerary-unconfigured',file:'ship-itinerary.html',title:'船端服務設定不完整',host:'.ship-state-card'},
 ];
 const originalBytes=fs.readFileSync(path.resolve('src/assets/fpmc-logo.png'));
 assert.equal(createHash('sha256').update(originalBytes).digest('hex'),'bc79ff64d006cdc036117c3051dd70223db4dc10a8e1a58dca0b20e9d0dd9bc0','approved asset retained byte-for-byte');
 const {identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const n=document.createElement('div');n.textContent='真實 UI＋本機測試／隔離設定｜非正式環境';n.style.cssText='position:fixed;bottom:0;right:0;z-index:2147483647;padding:3px 8px;background:#fff2c6;color:#563900;font:12px sans-serif;pointer-events:none;max-width:100%';document.body.append(n);});`});
 const results=[],assets=new Set();
 try {
  for(const item of cases) {
   await call('Page.navigate',{url:origin+base+item.file});
   await until(()=>evaluate(`document.readyState==='complete' && [...document.querySelectorAll('h1')].some(n=>n.textContent===${JSON.stringify(item.title)})`),item.name+' actual entry ready');
   await until(()=>evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(item.host)})?.querySelector('img[alt="FPMC LOGO"]');return !i||i.complete;})()`),item.name+' image load settled');
   for(const width of [1440,1024,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const g=await evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(item.host)}),i=h?.querySelector('img[alt="FPMC LOGO"]'),t=h?.querySelector('h1'),p=h?.querySelector('p');const rect=n=>{const r=n?.getBoundingClientRect();return r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,host:rect(h),logoCount:h?.querySelectorAll('img[alt="FPMC LOGO"]').length,logo:i?{complete:i.complete,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,src:i.src,objectFit:getComputedStyle(i).objectFit,transform:getComputedStyle(i).transform,...rect(i)}:null,title:{text:t?.textContent,...rect(t)},subtitle:{text:p?.textContent,...rect(p)},controls:[...h.querySelectorAll('button,a,select')].map(n=>({label:n.getAttribute('aria-label')||n.textContent.trim(),...rect(n)}))};})()`);
    results.push({page:item.name,...g});await screen('logo-'+item.name+'-'+width);
    if(g.logo?.src)assets.add(g.logo.src);
   }
  }
  evidence.portalLogos=results;
  // Keep pre-change screenshots for all three headers even when the first is RED.
  for(const g of results) {
   assert.equal(g.logoCount,1,g.page+': exactly one logo before the title');
   assert.ok(g.logo.complete&&g.logo.naturalWidth===241&&g.logo.naturalHeight===197,g.page+': genuine loaded image');
   assert.equal(g.logo.transform,'none','approved direction, no rotation');
   assert.ok(Math.abs(g.logo.width/g.logo.height-241/197)<0.01,'no stretched or cropped logo');
   assert.ok(g.logo.width>=48&&g.logo.width<=80,'compact bounded logo dimensions');
   assert.ok(g.logo.right<=g.title.x&&g.title.height>0&&g.subtitle.height>0,'logo left of visible title/subtitle');
   assert.ok(g.scrollWidth<=g.width&&g.logo.x>=0&&g.logo.right<=g.width&&g.title.right<=g.width,'header fits viewport');
   for(const c of g.controls){assert.ok(c.width>0&&c.height>0&&c.x>=0&&c.right<=g.width,'existing control remains visible');assert.ok(c.x>=g.logo.right||c.y>=g.logo.bottom||c.bottom<=g.logo.y,'logo does not overlap controls');assert.ok(c.x>=g.title.right||c.y>=g.subtitle.bottom||c.bottom<=g.title.y,'brand copy does not overlap controls');}
  }
  for(const url of assets){assert.ok(url.startsWith(origin+base),'asset honors repository subpath');const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),originalBytes,'served logo exact approved PNG, not fallback HTML');}
  evidence.cases.push('three original portal headers plus unconfigured Itinerary: correct logo/ratio/title/control geometry at 1440/1024/390','served logo bytes match supplied approved asset under repository subpath');
 } finally {
  evidence.portalLogos=results;
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await call('Page.navigate',{url:sourceUrl});
  await until(()=>evaluate("document.querySelectorAll('#ship-vessel-select option').length > 1"),'restore original local demo for shortcut regression');
 }
}
