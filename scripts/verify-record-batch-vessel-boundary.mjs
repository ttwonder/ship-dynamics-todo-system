import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='1878acdb7cb9c6b82b0a0b66cb6b1dd3a75ce777';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html').trim().split('\n');
let jsxFiles=0,jsxBlocks=0;
for(const path of paths){
 const original=execFileSync('git',['show',base+':'+path]),current=fs.readFileSync(path);
 if(original.includes(0)){assert.deepEqual(current,original,path);continue;}
 const before=original.toString('utf8'),now=current.toString('utf8').replace(/\r\n/g,'\n');
 assert.equal(now,before,'unchanged source/UI/style/SQL/public/root '+path);
 if(/\.(tsx|jsx)$/.test(path)){
  jsxFiles++;const file=ts.createSourceFile(path,now,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){jsxBlocks++;return;}ts.forEachChild(node,visit);};visit(file);
 }
}
assert.match(fs.readFileSync('src/main.tsx','utf8'),/import App from ['"]\.\/App/);
console.log(JSON.stringify({gate:'unchanged original source/UI/SQL',base,checkedPaths:paths.length,jsxFiles,jsxBlocks,allowedProductChanges:[]}));
