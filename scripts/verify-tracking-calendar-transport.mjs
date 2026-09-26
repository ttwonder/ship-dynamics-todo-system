import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Component/transport contracts only; real downloads and Excel interaction run separately.
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
const check=async(name,fn)=>{try{await fn();cases.push({name,status:'PASS'});}catch(error){cases.push({name,status:'FAIL',error:error.message});}};
try{
 const {default:ImportModal}=await vite.ssrLoadModule('/src/tracking/TrackingImportModal.tsx');
 const {downloadTrackingBytes}=await vite.ssrLoadModule('/src/tracking/trackingExcel.ts');
 await check('file-picker-accepts-xlsm-and-legacy-xlsx',()=>{
  const html=renderToStaticMarkup(React.createElement(ImportModal,{vesselId:'qa-v1',vesselName:'測試輪 QA SHIP',workspace:'qa',actorId:'qa-owner',identity:'qa-session',canCreate:true,canClose:true,data:{trackingItems:[]},callbacks:{},onClose(){},registerGuard(){}}));
  const input=html.match(/<input\b[^>]*type="file"[^>]*>/)?.[0];assert.ok(input);
  const accept=input.match(/\baccept="([^"]*)"/)?.[1].split(',');
  assert.ok(accept.includes('.xlsm'),'Calendar XLSM must be selectable, not filtered out by the file picker');
  assert.ok(accept.includes('.xlsx'),'Keep old templates and ordinary XLSX imports');
  assert.ok(accept.includes('application/vnd.ms-excel.sheet.macroEnabled.12'));
  assert.match(input,/aria-label="選擇跟蹤 Excel"/);
 });
 await check('download-mime-follows-format-with-stale-owner-zero-download',()=>{
  const originals={document:globalThis.document,window:globalThis.window,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const blobs=[],downloads=[],revoked=[];
  try{
   globalThis.document={body:{append(){}},createElement(){return{click(){downloads.push(this.download);},remove(){}};}};
   globalThis.window={setTimeout(fn){fn();return 0;}};
   URL.createObjectURL=blob=>{blobs.push(blob);return `blob:qa-${blobs.length}`;};URL.revokeObjectURL=url=>revoked.push(url);
   const bytes=new Uint8Array([80,75]).buffer;
   assert.equal(downloadTrackingBytes(bytes,'template.xlsm',()=>true),true);
   assert.equal(blobs[0].type,'application/vnd.ms-excel.sheet.macroenabled.12');
   assert.equal(downloadTrackingBytes(bytes,'report.xlsx',()=>true),true);
   assert.equal(blobs[1].type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   assert.equal(downloadTrackingBytes(bytes,'stale.xlsm',()=>false),false);
   assert.deepEqual(downloads,['template.xlsm','report.xlsx']);assert.equal(blobs.length,2);assert.equal(revoked.length,2);
  }finally{
   if(originals.document===undefined)delete globalThis.document;else globalThis.document=originals.document;
   if(originals.window===undefined)delete globalThis.window;else globalThis.window=originals.window;
   URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;
  }
 });
}finally{
 if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;
 await vite.close();const result={gate:'tracking-calendar-transport',evidenceLayer:'SSR-component-and-download-helper',status:cases.length===2&&cases.every(c=>c.status==='PASS')?'PASS':'FAIL',cases};
 if(process.env.QA_OUTPUT){fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.QA_OUTPUT,`transport-${process.env.QA_STAGE||'current'}.json`),JSON.stringify(result,null,2));}
 console.log(JSON.stringify(result,null,2));if(result.status!=='PASS')process.exitCode=1;
}
