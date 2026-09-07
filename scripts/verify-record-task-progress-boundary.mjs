import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='ece55206dde4aa851eb8a1a0c8680c6b9fa7e9c7';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const permitted=new Set(['20260906_appdata_record_store.sql','20260906_appdata_record_delta.sql','20260906_appdata_record_data_management.sql','20260906_record_daily_morning_scheduler.sql'].map(n=>'supabase/development/'+n));
const paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html','package.json','package-lock.json','vite.config.ts').trim().split('\n');
let jsxFiles=0,jsxRoots=0;
for(const file of paths){
 const old=execFileSync('git',['show',`${base}:${file}`]),now=fs.readFileSync(file);
 if(permitted.has(file))continue;
 if(old.includes(0)){assert.deepEqual(now,old,file);continue;}
 const text=now.toString('utf8').replace(/\r\n/g,'\n');assert.equal(text,old.toString('utf8'),file);
 if(/\.(tsx|jsx)$/.test(file)){
  jsxFiles++;const parsed=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n)){jsxRoots++;return;}ts.forEachChild(n,visit);};visit(parsed);
 }
}
assert.match(fs.readFileSync('src/main.tsx','utf8'),/import App from ['"]\.\/App/);
const store='supabase/development/20260906_appdata_record_store.sql';
const previous=git('show',`${base}:${store}`),current=fs.readFileSync(store,'utf8').replace(/\r\n/g,'\n');
const fn=(text,name)=>text.slice(text.indexOf('create or replace function public.'+name),text.indexOf('\n$$;',text.indexOf('create or replace function public.'+name))+4);
const oldCas='select value into current_value from public.ship_dynamics_records where workspace_key=p_workspace_key and collection=name and ship_dynamics_records.entity_id=target_id for update;';
const newCas='select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into current_value\n        from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=target_id for update;';
assert.equal(fn(current,'apply_ship_dynamics_record_patch_v1'),fn(previous,'apply_ship_dynamics_record_patch_v1').replace(oldCas,newCas),'entire original actor/authorization/CAS/lock/replay command changes ONLY current-value hydration');
assert.equal(fn(current,'get_ship_dynamics_record_receipt_v1'),fn(previous,'get_ship_dynamics_record_receipt_v1'),'exact receipt signature/result/replay contract');
console.log(JSON.stringify({sourceBoundary:'PASS',base,paths:paths.length,unchangedPaths:paths.length-permitted.size,jsxFiles,jsxRoots,allowedSql:[...permitted],entry:'src/main.tsx -> original App',commandGuardDelta:'only complete-task CAS hydration',lineEndings:'CRLF checkout normalized; Git blob identity checked at staging'}));
