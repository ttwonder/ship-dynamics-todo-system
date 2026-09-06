import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {jsx} from './verify-record-list-batch-boundary.mjs';
const base='73228e6714bf1c18d6f14b17c095a4ab0c7b6edd';
function strip(text){
 const file=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls=[];
 const visit=n=>{if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==='WorkCenter')calls.push(n);ts.forEachChild(n,visit);};visit(file);assert.equal(calls.length,1);
 const attrs=calls[0].attributes.properties,props=attrs.filter(a=>a.name?.text==='batchContext');assert.equal(props.length,1);assert.equal(props[0].getText(file),'batchContext={listBatchContext}');assert.equal(attrs.find(a=>a.name?.text==='data').getText(file),'data={roleVisibleData}');assert.equal(attrs.find(a=>a.name?.text==='user').getText(file),'user={currentUser}');
 return text.slice(0,props[0].pos)+text.slice(props[0].end);
}
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}),paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html').trim().split('\n');let roots=0,jsxFiles=0;
for(const path of paths){const before=execFileSync('git',['show',base+':'+path]),now=fs.readFileSync(path),current=now.toString().replace(/\r\n/g,'\n');
 if(['src/App.tsx','src/WorkCenter.tsx'].includes(path)){const expected=jsx(before.toString());assert.deepEqual(jsx(path==='src/App.tsx'?strip(current):current),expected,path);roots+=expected.length;jsxFiles++;
 if(path==='src/App.tsx'){for(const changed of [current.replace('onDismiss={dismissFromMyWorkCenter} batchContext={listBatchContext}','onDismiss={dismissFromMyWorkCenter} batchContext={wrongContext}'),current.replace('onDismiss={dismissFromMyWorkCenter} batchContext','onDismiss={wrongCallback} batchContext'),current.replace('data={roleVisibleData}\n        user={currentUser}', 'data={data}\n        user={currentUser}')])assert.throws(()=>assert.deepEqual(jsx(strip(changed)),expected));}
 else assert.throws(()=>assert.deepEqual(jsx(current.replace('<h1>我的待辦</h1>','<h1>changed label</h1>')),expected));
 }else if(before.includes(0))assert.deepEqual(now,before,path);else{assert.equal(current,before.toString(),path);if(/\.tsx$/.test(path)){roots+=jsx(current).length;jsxFiles++;}}
}
console.log(JSON.stringify({gate:'exact WorkCenter internal prop; all other JSX/CSS/entry/SQL preserved',base,paths:paths.length,jsxFiles,roots,allowlist:[{component:'WorkCenter',prop:'batchContext',value:'listBatchContext',data:'roleVisibleData',user:'currentUser'}],negativeMutations:4}));
