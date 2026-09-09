import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
const base='5dc6d9c8aad3db39db7e2edf662ed1c81bc30f85',old=p=>execFileSync('git',['show',base+':'+p],{encoding:'utf8'}).replaceAll('\r\n','\n'),now=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const strip=text=>{const sf=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),spans=[];const visit=n=>{if(ts.isVariableDeclaration(n)&&['openVesselDetail','closeVesselDetail'].includes(n.name.getText(sf)))spans.push([n.initializer.getStart(sf),n.initializer.end]);ts.forEachChild(n,visit);};visit(sf);assert.equal(spans.length,2);for(const [a,b]of spans.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a)+'EXACT_INTERNAL_HANDLER'+text.slice(b);return text;};
assert.equal(strip(now('src/App.tsx')),strip(old('src/App.tsx')),'only the two named internal detail handlers differ; all JSX and other operations unchanged');
for(const p of ['src/main.tsx','src/VesselDetailPage.tsx','src/Dashboard.tsx','src/EditModals.tsx','src/styles.css','src/NormalizedApp.tsx','src/cloud.ts','src/cloudRecordScopes.ts','src/taskMemberEditor.ts','supabase/development/20260908_appdata_record_scoped_read.sql','supabase/development/20260909_task_member_protocol.sql'])assert.equal(now(p),old(p),p+' frozen to base');
console.log(JSON.stringify({layer:'readonly-source-boundary',status:'PASS',caseId:'VD-SOURCE-BOUNDARY',base,onlyHandlers:['openVesselDetail','closeVesselDetail'],visibleUiUnchanged:true,readerSqlUnchanged:true,writerMemberUnchanged:true}));
