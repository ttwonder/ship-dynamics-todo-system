import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import ExcelJS from 'exceljs';import {build} from 'vite';
export async function runComponents({mode,qa,evaluate,call,until,input,click,text,screen,caseResult,output,drafts,inputHash}){
 const excel=await qa.loadModule('/src/itinerary/itineraryExcel.ts'),types=await qa.loadModule('/src/itinerary/itineraryTypes.ts');
 const shoreDoc=types.createEmptyItineraryDocument({workspaceKey:'isolated-record-ui-qa',vesselId:'qa-v1',vesselName:'R4 SHORE SYNTHETIC',rowId:'r4-rate'});
 Object.assign(shoreDoc.rows[0],{previousPortName:'PREVIOUS',portDockName:'RATE PORT',cargoQuantityText:'1200',operation:'To Load',portTimeZone:'UTC+8',operationQuantityMt:1200,operationRateMtPerHour:100,ldRateText:'100',operationHours:12,etaMode:'manual',etbMode:'manual',etcMode:'manual',etdMode:'manual',etaUtc:'2026-09-07T00:00:00Z',etbUtc:'2026-09-07T00:00:00Z',etcUtc:'2026-09-07T12:00:00Z',etdUtc:'2026-09-07T12:00:00Z'});
 const sqlValid=async rows=>(await qa.db.query('select sd_itinerary_rows_valid($1::jsonb) valid',[JSON.stringify(rows)])).rows[0].valid;assert.equal(await sqlValid(shoreDoc.rows),true);
 const template=fs.readFileSync('public/templates/itinerary-template-v1.xlsx'),validBytes=Buffer.from(await excel.buildItineraryWorkbook([shoreDoc],template));fs.writeFileSync(path.join(output,'F5-valid.xlsx'),validBytes);
 const book=new ExcelJS.Workbook();await book.xlsx.load(validBytes);book.worksheets[0].getCell('A3').value='BROKEN HEADER ONLY A3';const badBytes=Buffer.from(await book.xlsx.writeBuffer());fs.writeFileSync(path.join(output,'F5-only-A3-broken.xlsx'),badBytes);
 const validParsed=await excel.parseItineraryWorkbook(validBytes),badParsed=await excel.parseItineraryWorkbook(badBytes);assert.equal(validParsed.sheets[0].issues.length,0);assert.ok(badParsed.sheets[0].issues.some(i=>i.code==='invalid-template'));
 const data={shoreDoc,validParsed,badParsed};let latestSubmission=null;
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Editor from './src/itinerary/ItineraryEditor.tsx';import Preview from './src/itinerary/ItineraryImportPreview.tsx';import './src/itinerary/itinerary.css';
 const data=await(await fetch('/__qa/r4-data')).json();const mode=new URLSearchParams(location.search).get('mode');const root=createRoot(document.getElementById('root'));window.__r4Unmount=()=>root.unmount();
 root.render(mode==='shore'?<Editor document={data.shoreDoc} actorId="r4-shore-synthetic" lease={{vesselId:'qa-v1',leaseId:'r4-prop-only',fencingToken:1,holderId:'r4-qa',holderLabel:'QA'}} onSave={async d=>await(await fetch('/__qa/r4-validator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})).json()} onRenewLease={async()=>{throw Error('Renewal outside focused validator scope')}} onCancel={async()=>root.unmount()} onSaved={()=>{throw Error('No mock ACK allowed')}}/>:<Preview fileName={mode==='valid'?'valid.xlsx':'only-A3-broken.xlsx'} parsed={mode==='valid'?data.validParsed:data.badParsed} documents={[data.shoreDoc]} selectedVesselIds={['qa-v1']} onApply={async()=>{throw Error('Preview only: must not apply')}} onClose={()=>root.unmount()}/>);`;
 const virtualEntry=path.resolve('review-r4-entry.tsx').replaceAll('\\','/');
 const bundled=await build({configFile:false,logLevel:'silent',plugins:[{name:'isolated-review-entry',resolveId:id=>id===virtualEntry?virtualEntry:null,load:id=>id===virtualEntry?entry:null}],build:{write:false,minify:false,target:'esnext',rollupOptions:{input:virtualEntry,output:{codeSplitting:false,entryFileNames:'r4.js',assetFileNames:'r4.[ext]'}}}});
 const js=bundled.output.find(f=>f.type==='chunk').code,css=bundled.output.find(f=>f.fileName.endsWith('.css'))?.source||'';
 const reply=(res,v)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
 qa.setUiMiddleware(async(req,res,next)=>{const url=new URL(req.url,qa.origin);
  if(url.pathname==='/__qa/r4-data')return reply(res,data);
  if(url.pathname==='/__qa/r4-validator'){const chunks=[];for await(const c of req)chunks.push(c);const document=JSON.parse(Buffer.concat(chunks));latestSubmission={document,valid:await sqlValid(document.rows),inputHash:inputHash(document)};return reply(res,{ok:false,code:'validation',message:'QA validator only; no save attempted'});}
  if(url.pathname==='/__qa/r4.js'){res.setHeader('Content-Type','application/javascript');res.end(js);return;}
  if(url.pathname==='/__qa/r4.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(url.pathname==='/__qa/r4.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/__qa/r4.css"></head><body><aside>真實 UI＋測試資料｜controlled original component + PGlite validator, no commit</aside><div id="root"></div><script type="module" src="/__qa/r4.js"></script></body></html>');return;}
  next();
 });
 if(mode==='f4'){
  await call('Page.navigate',{url:qa.origin+'/__qa/r4.html?mode=shore'});await until(()=>evaluate("!!document.querySelector('.itinerary-editor-modal')"),'shore component');
  await input('input[aria-label="預計L/D rate (MT/h)"]','200');await click('保存並同步');await until(()=>latestSubmission,'SQL validator');
  caseResult('F4-observation',{shoreDoc,submitted:latestSubmission});assert.equal(latestSubmission.document.rows[0].operationHours,6,'R4-F4 derived hours follows rate');assert.equal(latestSubmission.valid,true,'unchanged SQL validator accepts rate update');
  const fields=['etaUtc','etbUtc','etcUtc','etdUtc','etaMode','etbMode','etcMode','etdMode'];for(const k of fields)assert.equal(latestSubmission.document.rows[0][k],shoreDoc.rows[0][k],'manual field unchanged: '+k);
  latestSubmission=null;await input('input[aria-label="預計L/D rate (MT/h)"]','100');await click('保存並同步');await until(()=>latestSubmission,'normal rate revert');assert.equal(latestSubmission.document.rows[0].operationHours,12);assert.equal(latestSubmission.valid,true);
  caseResult('R4-F4',{status:'PASS',layer:'controlled original Editor + actual PGlite validator; no App commit',submitted:latestSubmission});await screen('F4-GREEN');
 }else{
  await call('Page.navigate',{url:qa.origin+'/__qa/r4.html?mode=valid'});await until(()=>evaluate("!!document.querySelector('.itinerary-import-modal')"),'valid preview');assert.match(await text(),/可覆蓋/);
  await call('Page.navigate',{url:qa.origin+'/__qa/r4.html?mode=bad'});await until(()=>evaluate("!!document.querySelector('.itinerary-import-modal')"),'invalid preview');const ready=await evaluate("[...document.querySelectorAll('button')].some(n=>n.innerText==='確認覆蓋 1 艘'&&!n.disabled)");const resolved=excel.resolveParsedItinerarySheet(badParsed.sheets[0],{});
  caseResult('F5-observation',{parsed:badParsed.sheets[0].issues,resolved:resolved.issues,ready,ui:await text()});assert.equal(ready,false,'R4-F5 structural errors must block original Preview');assert.ok(resolved.issues.some(i=>i.code==='invalid-template'));
  const offsetBook=new ExcelJS.Workbook();await offsetBook.xlsx.load(validBytes);offsetBook.worksheets[0].getCell('O4').value='';const offsetParsed=await excel.parseItineraryWorkbook(Buffer.from(await offsetBook.xlsx.writeBuffer()));const offsetFixed=excel.resolveParsedItinerarySheet(offsetParsed.sheets[0],{[offsetParsed.sheets[0].rows[0].rowId]:'UTC+8'});
  assert.ok(offsetParsed.sheets[0].issues.length);assert.equal(offsetFixed.issues.length,0,'valid offset completion still resolves');assert.ok(excel.resolveParsedItinerarySheet(resolved,{}).issues.some(i=>i.code==='invalid-template'),'repeated resolution preserves structure');
  caseResult('R4-F5',{status:'PASS',layer:'original Preview + actual ExcelJS; no apply',inputHash:inputHash({valid:validBytes.toString('base64'),bad:badBytes.toString('base64')}),offsetBefore:offsetParsed.sheets[0].issues,offsetAfter:offsetFixed.issues});await screen('F5-GREEN');
 }
 await evaluate('window.__r4Unmount()');
}
