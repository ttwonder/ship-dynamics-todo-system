import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='377d0045d6077e2936dce884f5c99e73a0229122',path='src/DataManagementPanel.tsx';
const old="只會 DELETE 所勾選的 <code>ship_dynamics_app_revisions</code> 列；不會改動 <code>ship_dynamics_app_state</code>、目前 Revision、任何正式業務資料、Storage object、Lease 或一般操作紀錄。",newCopy="只會清理所勾選的歷史版本；不會改動目前版本、未勾選的歷史版本或正式業務資料。不會改動 Storage object、Lease 或一般操作紀錄。";
const jsx=source=>{const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),values=[];const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){values.push(n.getText(file));return;}ts.forEachChild(n,visit);};visit(file);return values;};
const original=execFileSync('git',['show',base+':'+path],{encoding:'utf8'}),panel=fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
assert.deepEqual(jsx(panel),jsx(original.replace(old,newCopy)),'existing approved Panel JSX unchanged');
const meeting=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
for(const name of ['openDecisionTask','transitionDecisionTask']){const block=meeting.slice(meeting.indexOf('const '+name+' ='),meeting.indexOf('\n  };',meeting.indexOf('const '+name+' =')));assert.ok(block.includes('const saved=await save();if(!saved)return;'),name+' blocks continuation on retained input');}
const branch=meeting.indexOf('if(draftEditVersion.current!==requestedEditVersion)'),stop=meeting.indexOf('return false;',branch),release=meeting.indexOf('const released=await releaseItemLease(sectionKey);',branch);
assert.ok(branch>=0&&stop>branch&&release>stop,'late input terminates before lease release');
console.log(JSON.stringify({layer:'source contracts only',status:'PASS',cases:['data-management exact approved JSX','open-decision continuation fence','transition-decision continuation fence','late-input branch terminates before release']}));
