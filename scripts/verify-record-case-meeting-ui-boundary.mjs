import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='eee31b6a527de1f19034eba751c711ae728c47ed';
const files=['src/App.tsx','src/InternalControlPage.tsx','src/TemporaryMeetings.tsx'];
const allowlist=[
 ['InternalControlPage',' loadCase={loadInternalControlScope}'],
 ['TemporaryMeetingsPage',' loadMeetings={loadMeetingScope} authorizationEpoch={authorizationEpoch}'],
];
function jsx(source,file,strip){
 source=source.replace(/\r\n/g,'\n'); // Git clean-filter line endings, not JSX semantic normalization.
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),rows=[];
 function visit(node){
  if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){
   let text=node.getText(sf);
   if(strip&&file==='src/App.tsx')for(const [name,props] of allowlist)text=text.replace('<'+name+props,'<'+name);
   rows.push(text);return;
  }
  ts.forEachChild(node,visit);
 }
 visit(sf);return rows;
}
for(const file of files){
 const old=execFileSync('git',['show',base+':'+file],{encoding:'utf8'}),now=fs.readFileSync(file,'utf8');
 assert.deepEqual(jsx(now,file,true),jsx(old,file,false),file+': original complete JSX trees, except exact named internal props');
}
console.log(JSON.stringify({status:'PASS',base,files,allowlist,claim:'source/UI boundary only; runtime scopes and SQL proved separately'}));
