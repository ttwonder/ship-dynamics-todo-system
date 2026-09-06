import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const base='bbace3bc022c9296729fd6ba1e427fd29235a6c8';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const source=path=>fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const parse=(path,text)=>ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const jsx=(path,text)=>{const file=parse(path,text),values=[];const visit=node=>{if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){values.push(node.getText(file));return;}ts.forEachChild(node,visit);};visit(file);return values;};
const permitted=new Set();
const paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html').trim().split('\n');
let jsxBlocks=0,jsxFiles=0;
for(const path of paths){
 const originalBytes=execFileSync('git',['show',base+':'+path]),currentBytes=fs.readFileSync(path);
 if(originalBytes.includes(0)){assert.deepEqual(currentBytes,originalBytes,'unchanged binary '+path);continue;}
 const before=originalBytes.toString('utf8'),now=source(path);
 if(/\.(tsx|jsx)$/.test(path)){const expected=jsx(path,before);assert.deepEqual(jsx(path,now),expected,'exact JSX boundary '+path);jsxFiles++;jsxBlocks+=expected.length;}
 if(!permitted.has(path))assert.equal(now,before,'unchanged root/source/style/public/SQL '+path);
}
assert.match(source('src/main.tsx'),/import App from ['"]\.\/App/);
console.log(JSON.stringify({gate:'exact original UI and SQL boundary',base,checkedPaths:paths.length,jsxFiles,jsxBlocks,nonJsxLogicOnly:[...permitted]}));
