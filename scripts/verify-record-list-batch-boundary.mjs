import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const parse=text=>ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
export function stripListBatchContext(text){
 const file=parse(text),edits=[],calls=[];
 const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ListPanel')calls.push(node);ts.forEachChild(node,visit);};visit(file);
 assert.equal(calls.length,2,'exact two named ListPanel callsites');
 for(const [index,node] of calls.entries()){
  const attrs=node.attributes.properties;const task=attrs.find(a=>a.name?.text==='tasks');const filter=attrs.find(a=>a.name?.text==='filters');
  assert.equal(task?.getText(file),index===0?'tasks={filteredTasks}':'tasks={closedTasks}');assert.equal(filter?.getText(file),index===0?'filters={filters}':'filters={closedFilters}');
  const props=attrs.filter(a=>a.name?.text==='batchContext');assert.equal(props.length,1);assert.equal(props[0].getText(file),'batchContext={listBatchContext}');edits.push([props[0].pos,props[0].end]);
 }
 for(const [start,end] of edits.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+text.slice(end);return text;
}
export function jsx(text){const file=parse(text),roots=[];const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){roots.push(n.getText(file));return;}ts.forEachChild(n,visit);};visit(file);return roots;}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const base='b5207efa0fabace10a30e2cde870e64e3291d0c7',git=(...args)=>execFileSync('git',args,{encoding:'utf8'}),paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html').trim().split('\n');let roots=0,jsxFiles=0;
 for(const path of paths){const before=execFileSync('git',['show',base+':'+path]),now=fs.readFileSync(path);if(path==='src/App.tsx'){const current=now.toString().replace(/\r\n/g,'\n'),expected=jsx(before.toString());assert.deepEqual(jsx(stripListBatchContext(current)),expected);roots+=expected.length;jsxFiles++;
  const rejects=changed=>assert.throws(()=>assert.deepEqual(jsx(stripListBatchContext(changed)),expected));
  rejects(current.replace("?'本船待辦清單':'總清單'","?'本船待辦清單':'changed label'"));
  rejects(current.replace('title="已結案清單"','title="changed label"'));
  rejects(current.replace('batchContext={listBatchContext}', 'batchContext={wrongContext}'));
  rejects(current.replace('tasks={closedTasks} data={roleVisibleData}', 'tasks={closedTasks} data={data}'));
 }else if(before.includes(0))assert.deepEqual(now,before,path);else{assert.equal(now.toString().replace(/\r\n/g,'\n'),before.toString(),path);if(/\.tsx$/.test(path)){roots+=jsx(now.toString()).length;jsxFiles++;}}}
 console.log(JSON.stringify({gate:'ListPanel exact internal-prop allowlist + other JSX/CSS/entry/SQL preserved',base,paths:paths.length,jsxFiles,roots,allowlist:[{component:'ListPanel',tasks:'filteredTasks',prop:'batchContext',value:'listBatchContext'},{component:'ListPanel',tasks:'closedTasks',prop:'batchContext',value:'listBatchContext'}],negativeMutations:4}));
}
