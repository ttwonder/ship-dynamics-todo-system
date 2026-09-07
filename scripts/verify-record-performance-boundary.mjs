import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base='8becb4a4a521604ed35096e11963b510657a1965';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const all=git('ls-tree','-r','--name-only',base).trim().split('\n');
const protectedPath=p=>!p.startsWith('docs/')&&!p.startsWith('scripts/');
const paths=all.filter(protectedPath);
const current=git('ls-files','--cached','--others','--exclude-standard').trim().split('\n').filter(protectedPath);
assert.deepEqual(current.toSorted(),paths.toSorted(),'complete protected path set');
const hashes=[];
for(const file of paths){
 const expected=git('rev-parse',`${base}:${file}`).trim();
 const actual=git('hash-object',`--path=${file}`,file).trim();
 assert.equal(actual,expected,'Git clean-filtered source/build-input boundary '+file);
 hashes.push({file,blob:actual,workingSha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}
assert.match(fs.readFileSync('src/main.tsx','utf8'),/import App from ['"]\.\/App/);
assert.match(fs.readFileSync('scripts/record-storage-local-qa.mjs','utf8'),/performanceTrace=false,preparePerformanceFixture=null/);
assert.equal(git('rev-parse','main','baseline/pre-normalized-storage').trim().split('\n').every(x=>x==='edd95e984b29818b705e25a7485fd91bf04f8ace'),true);
const result={pass:true,base,protectedPaths:paths.length,entry:'src/main.tsx -> original App',productAndSqlAndBuildInputsUnchanged:true,mainAndBaselineUnchanged:true,hashes};
if(process.env.QA_EVIDENCE_ROOT)fs.writeFileSync(process.env.QA_EVIDENCE_ROOT+'/source-boundary.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,hashes:undefined}));
