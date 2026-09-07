import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

// Current notification slice permits one non-rendering rebase substitution only.
const base='0144453a1b9d35f9f551aff2632953aa101ec197';
const paths=execFileSync('git',['ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html'],{encoding:'utf8'}).trim().split('\n');
const oldLine='    return rebaseDisjointAppData(base,local,remote,at,actorUserId);';
const newLines='    const prepared=rebaseDisjointAppData(base,local,remote,at,actorUserId);\n    return appDataContentEqual(prepared,remote)?clone(remote):prepared;';
let jsxFiles=0;
for(const file of paths){
 const before=execFileSync('git',['show',base+':'+file]);
 const now=fs.readFileSync(file);
 if(before.includes(0)){assert.deepEqual(now,before,file);continue;}
 let expected=before.toString();
 if(file==='src/cloudRebase.ts'){
  assert.equal(expected.split(oldLine).length,2,'one exact rebase return');
  expected=expected.replace(oldLine,newLines);
 }
 assert.equal(now.toString().replace(/\r\n/g,'\n'),expected,file);
 if(file.endsWith('.tsx'))jsxFiles++;
}
console.log(JSON.stringify({gate:'notification read exact source preservation',base,paths:paths.length,jsxFiles,productAllowlist:['src/cloudRebase.ts: converged snapshot return only'],jsxChanges:0,cssChanges:0,sqlChanges:0}));
