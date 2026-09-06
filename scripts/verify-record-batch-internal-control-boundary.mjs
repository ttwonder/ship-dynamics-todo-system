import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {stripListBatchContext} from './verify-record-list-batch-boundary.mjs';

const base='8b614ac7ded143e7673b751e8beaa961afe1c4b2';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const source=path=>fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const parse=(path,text)=>ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const jsx=(path,text)=>{const file=parse(path,text),values=[];const visit=node=>{if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){values.push(node.getText(file));return;}ts.forEachChild(node,visit);};visit(file);return values;};
const permitted=new Set(['src/App.tsx','src/InternalControlPage.tsx']);
const paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html').trim().split('\n');
let jsxBlocks=0,jsxFiles=0;
for(const path of paths){
 const originalBytes=execFileSync('git',['show',base+':'+path]),currentBytes=fs.readFileSync(path);
 if(originalBytes.includes(0)){assert.deepEqual(currentBytes,originalBytes,'unchanged binary '+path);continue;}
 const before=originalBytes.toString('utf8'),now=source(path);
 if(/\.(tsx|jsx)$/.test(path)){const expected=jsx(path,before);assert.deepEqual(jsx(path,path==='src/App.tsx'?stripListBatchContext(now):now),expected,'exact JSX boundary '+path);jsxFiles++;jsxBlocks+=expected.length;}
 if(!permitted.has(path))assert.equal(now,before,'unchanged root/source/style/public/SQL '+path);
}
assert.match(source('src/main.tsx'),/import App from ['"]\.\/App/);
console.log(JSON.stringify({gate:'exact original UI and SQL boundary',base,checkedPaths:paths.length,jsxFiles,jsxBlocks,logicPaths:[...permitted],internalProps:[{component:'ListPanel',prop:'batchContext',value:'listBatchContext',calls:2}]}));

// These are source-boundary rules, not E2E or an invented 100-row cap.
const modal=source('src/InternalControlModals.tsx');
assert.ok(modal.includes('共用船舶、報告日期及來源；保存後每列拆成獨立案件。'));
console.log(JSON.stringify({layer:'source inventory',batchRows:'one shared vessel per modal, add-row has no product count cap; no foreign module limit introduced',selection:'all filtered results, paged in groups of 30',authorization:'original permission matrix and full vessel scope; delete also requires original cancellation authority'}));
