import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='e07fb60d556a284eac34823afe291194c5139438',rows=[];
for(const path of ['src/App.tsx','src/Management.tsx','src/TemporaryMeetings.tsx']){
 const old=execFileSync('git',['show',base+':'+path],{encoding:'utf8',maxBuffer:5e6}),current=fs.readFileSync(path,'utf8');
 const jsx=source=>{source=source.replace(/\r\n/g,'\n');const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),items=[];const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){items.push(n.getText(tree));return;}ts.forEachChild(n,visit);};visit(tree);return items;};
 assert.deepEqual(jsx(current),jsx(old),path+' unchanged full JSX');rows.push({path,jsxRoots:jsx(old).length});
}
for(const path of execFileSync('git',['ls-files','src/*.css','src/main.tsx'],{encoding:'utf8'}).trim().split(/\r?\n/))assert.equal(fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n'),execFileSync('git',['show',base+':'+path],{encoding:'utf8'}).replace(/\r\n/g,'\n'),path);
console.log(JSON.stringify({status:'PASS',base,rows,mainAndStyles:'unchanged'}));
