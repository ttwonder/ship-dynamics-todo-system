import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const base='2f64c708886069098ed85070e407c5053adb5676';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024});
const original=git('show',base+':src/App.tsx');
const changes=[
 ['const refreshAfterItemLease=async(sectionKey:string):','const refreshAfterItemLease=async(sectionKey:string,vesselFreshness=false):'],
 ["if(!confirmed)throw new Error('沒有可驗證的已保存雲端基線');\n      const token=configIoCoordinator.current.begin(leaseConfig);\n      const remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);","if(!confirmed)throw new Error('沒有可驗證的已保存雲端基線');\n      const token=configIoCoordinator.current.begin(leaseConfig);\n      const remote=await configIoCoordinator.current.run(token,getSupabaseConfig,vesselFreshness?(config,signal)=>fetchCloudData(config,signal,confirmed):fetchCloudData);"],
 ['const snapshot=await refreshAfterItemLease(sectionKey);\n    if(snapshot?.vessels.some(item=>item.id===id))setEditingVesselId(id);','const snapshot=await refreshAfterItemLease(sectionKey,true);\n    if(snapshot?.vessels.some(item=>item.id===id))setEditingVesselId(id);'],
];
let expected=original;for(const [old,value]of changes){assert.equal(expected.split(old).length,2);expected=expected.replace(old,value);}
assert.equal(fs.readFileSync('src/App.tsx','utf8').replace(/\r\n/g,'\n'),expected,'exactly three invisible substitutions; all JSX, text, handlers and checks otherwise identical');
const allowed=new Set(['src/App.tsx','src/cloud.ts','src/cloudDelta.ts']);
const protectedPath=p=>!p.startsWith('docs/')&&!p.startsWith('scripts/');
const protectedPaths=git('ls-tree','-r','--name-only',base).trim().split('\n').filter(protectedPath);
const current=git('ls-files','--cached','--others','--exclude-standard').trim().split('\n').filter(protectedPath);
assert.deepEqual(current.toSorted(),protectedPaths.toSorted(),'complete protected path set');
const frozenQa=['scripts/verify-record-performance-browser.mjs','scripts/record-performance-fixture.mjs','scripts/record-storage-local-qa.mjs'];
let protectedCount=0;for(const p of [...protectedPaths,...frozenQa]){if(allowed.has(p))continue;assert.equal(git('hash-object','--path='+p,p).trim(),git('rev-parse',base+':'+p).trim(),'clean-filtered exact bytes: '+p);protectedCount++;}
assert.equal(git('rev-parse','main','baseline/pre-normalized-storage').trim().split('\n').every(x=>x==='edd95e984b29818b705e25a7485fd91bf04f8ace'),true);
console.log(JSON.stringify({base,protectedCount,appExactSubstitutions:changes.length,pass:true,old251Gate:'inapplicable: approved product edits; not globally relaxed'}));
