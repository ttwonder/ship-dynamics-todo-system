import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const base='436f9cd3a3146e51c7c6d9e61cb069279e13f035';
function roots(text,file){
 const s=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[],out=[];
 function walk(n){
  if(ts.isJsxAttribute(n)){
   const opening=n.parent.parent,tag=opening.tagName?.getText(s),name=n.name.getText(s);
   const task=file==='src/App.tsx'&&tag==='TaskEditModal'&&['canEditOverall','onProgressScopeChange','memberConfirmation'].includes(name);
   const selector=file==='src/EditModals.tsx'&&tag==='select'&&name==='onChange'&&opening.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(s)==='aria-label'&&p.initializer?.getText(s)==='"待辦進度範圍"');
   if(task||selector)edits.push([n.getFullStart(),n.end]);
  }
  ts.forEachChild(n,walk);
 }walk(s);
 function collect(n){
  if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){
   let value=text.slice(n.getStart(s),n.end);
   for(const [a,b]of edits.filter(([a,b])=>a>=n.getStart(s)&&b<=n.end).sort((a,b)=>b[0]-a[0]))value=value.slice(0,a-n.getStart(s))+value.slice(b-n.getStart(s));
   out.push(value);return;
  }ts.forEachChild(n,collect);
 }collect(s);return out;
}
for(const file of ['src/App.tsx','src/EditModals.tsx']){
 const old=execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),now=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
 assert.deepEqual(roots(now,file),roots(old,file),'frozen rendered subtrees: '+file);
}
for(const file of ['src/main.tsx','src/styles.css','src/NormalizedApp.tsx','supabase/development/20260909_task_member_protocol.sql','supabase/development/20260909_task_member_protocol_reverse.sql','scripts/verify-task-member-native.mjs']){
 assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file);
}
console.log('MEMBER-UI-BOUNDARY PASS: exact JSX allowlist; entry/styles/native files unchanged');
