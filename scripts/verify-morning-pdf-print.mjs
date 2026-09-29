import assert from 'node:assert/strict';
import {printMorningReportPdf,morningReportPdfDocumentTitle} from '../src/morningReportPdf.ts';
let printed=0,timer,afterPrint,allowed=true;
const classes=new Set();
globalThis.document={title:'original',body:{classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}}};
globalThis.window={setTimeout:fn=>{timer=fn;},print:()=>printed++,addEventListener:(name,fn)=>afterPrint=fn,removeEventListener:()=>{}};
try{
 assert.equal(morningReportPdfDocumentTitle('2026/09/29'),'船舶早會動態暨待辦報告_2026-09-29');
 printMorningReportPdf('2026-09-29',()=>allowed);assert.ok(classes.has('printing-report'));timer();assert.equal(printed,1);afterPrint();assert.equal(document.title,'original');assert.equal(classes.size,0);
 printMorningReportPdf('2026-09-29',()=>allowed);allowed=false;timer();assert.equal(printed,1,'cancelled/changed authority must not print after the scheduled delay');assert.equal(document.title,'original');assert.equal(classes.size,0);
 console.log('PASS morning PDF real print helper: title, healthy print, cleanup, delayed cancellation');
}finally{delete globalThis.document;delete globalThis.window;}
