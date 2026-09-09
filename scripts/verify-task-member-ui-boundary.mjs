import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const base='436f9cd3a3146e51c7c6d9e61cb069279e13f035';
function taskQuickInput(n,s,file){
 if(file!=='src/EditModals.tsx'||!ts.isJsxAttribute(n)||n.name.getText(s)!=='onChange'||n.parent.parent.tagName?.getText(s)!=='textarea')return false;
 let owner=n;while(owner&&!ts.isFunctionDeclaration(owner))owner=owner.parent;
 return owner?.name?.getText(s)==='TaskEditModal';
}
function roots(text,file){
 const s=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[],out=[];
 function walk(n){
  if(ts.isJsxAttribute(n)){
   const opening=n.parent.parent,tag=opening.tagName?.getText(s),name=n.name.getText(s);
   const task=file==='src/App.tsx'&&tag==='TaskEditModal'&&['canEditOverall','onProgressScopeChange','memberConfirmation','memberQuickStatus','memberDraftChanged'].includes(name);
   const selector=file==='src/EditModals.tsx'&&tag==='select'&&name==='onChange'&&opening.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(s)==='aria-label'&&p.initializer?.getText(s)==='"待辦進度範圍"');
   if(task||selector||taskQuickInput(n,s,file))edits.push([n.getFullStart(),n.end]);
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
const allowed={
 canEditOverall:'{Boolean((memberEditor.current||!taskEditorReadOnly)&&editingTaskCanMutate&&canEditOverallTask)}',
 onProgressScopeChange:'{memberEditor.current?changeTaskMemberScope:undefined}',
 memberConfirmation:'{memberEditor.current?.confirmation}',
 memberQuickStatus:'{memberEditor.current?.quickStatus}',
 memberDraftChanged:'{captureTaskMemberDraft}',
};
const app=ts.createSourceFile('App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),seen=[];
function inspect(n){if(ts.isJsxAttribute(n)&&n.parent.parent.tagName?.getText(app)==='TaskEditModal'&&Object.hasOwn(allowed,n.name.getText(app))){const name=n.name.getText(app);assert.equal(n.initializer.getText(app),allowed[name],name+' exact internal value');seen.push(name);}ts.forEachChild(n,inspect);}inspect(app);assert.deepEqual(seen.sort(),Object.keys(allowed).sort());
const modal=ts.createSourceFile('src/EditModals.tsx',fs.readFileSync('src/EditModals.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),quick=[];
function inspectQuick(n){if(taskQuickInput(n,modal,'src/EditModals.tsx'))quick.push(n.initializer.getText(modal));ts.forEachChild(n,inspectQuick);}inspectQuick(modal);
assert.deepEqual(quick,['{event=>changeQuickStatus(event.target.value)}'],'only the exact synchronous TaskEditModal quick-input handler is allowed');
console.log('MEMBER-UI-BOUNDARY PASS: exact JSX allowlist including TaskEditModal quick onChange; entry/styles/native files unchanged');
