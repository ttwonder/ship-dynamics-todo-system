import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root)&&!path.resolve(root).startsWith(path.resolve('.')+path.sep));
fs.mkdirSync(root,{recursive:true});const run=fs.mkdtempSync(path.join(root,'restore-native-'));
const sources=['supabase/schema.sql','supabase/normalized-legacy-cutover.sql','scripts/record-storage-native-qa.mjs','scripts/verify-legacy-restore-provenance-native.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const receipt={kind:'legacy-restore-provenance-real-native-PG',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',inputs:Object.fromEntries(sources.map(f=>[f,sha(fs.readFileSync(f))])),cases:[],limitations:['Synthetic fixtures and native PostgreSQL, not hosted Supabase ACL or a full authority rollback.']};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
let native,failed=false;
try{
 native=await createNativeRecordQa(run,receipt);const {adapter:db,a,observer}=native;
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
 // Fixture-only table privileges let real non-maintenance callers exercise the trigger.
 await db.exec('grant usage on schema public to authenticated,service_role;grant select,update on public.ship_dynamics_app_state to authenticated,service_role;');
 const normalDefinition=(await observer.query("select prosrc from pg_proc where oid='public.stamp_ship_dynamics_audit_network_context()'::regprocedure")).rows[0].prosrc;
 const maintenance=fs.readFileSync('supabase/normalized-legacy-cutover.sql','utf8');await db.exec(maintenance);
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.v;
 const read=w=>q(observer,'select to_jsonb(t) v from public.ship_dynamics_app_state t where workspace_key=$1',[w]);
 const control=w=>q(observer,'select to_jsonb(t) v from public.sd_legacy_write_controls t where workspace_key=$1',[w]);
 const hash=p=>q(observer,'select public.sd_legacy_jsonb_sha256($1::jsonb) v',[JSON.stringify(p)]);
 const ctx=async(role,fn,headers={})=>{await a.query('begin');try{await a.query('set local role '+role);await a.query("select set_config('request.headers',$1,true),set_config('request.jwt.claim.role','service_role',true)",[JSON.stringify(headers)]);const value=await fn(a);await a.query('commit');return value;}catch(e){await a.query('rollback');throw e;}};
 const seed=async(w)=>{const p={schemaVersion:1,auditLogs:[{id:'existing',detail:'historical record',ipAddress:'192.0.2.7',ipCountryCode:'JP'}],vessels:[{id:'v1',assignedUserIds:['old-manager']}],tasks:[],unknownFixture:{keep:true}};await observer.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values($1,$2::jsonb,11)',[w,JSON.stringify(p)]);return p;};
 const freeze=async w=>{const row=await read(w),h=await hash(row.payload);return ctx('service_role',c=>q(c,'select public.freeze_ship_dynamics_legacy_writes($1,$2,$3,$4) v',[w,row.revision,h,`freeze:${w}:${row.revision}:${h}`]));};
 const restore=async(w,p,{role='service_role',badHash=false,badConfirmation=false}={})=>{const h=await hash(p),sent=badHash?'0'.repeat(64):h;return ctx(role,c=>q(c,'select public.restore_ship_dynamics_legacy_backup($1,12,$2::jsonb,$3,$4,$5,$6) v',[w,JSON.stringify(p),sent,'2026-09-01T00:00:00Z','QA RESTORE',badConfirmation?'wrong':`restore:${w}:12:${h}`]));};
 const update=async(w,p,role='authenticated')=>ctx(role,c=>c.query('update public.ship_dynamics_app_state set payload=$2::jsonb where workspace_key=$1',[w,JSON.stringify(p)]),{'x-forwarded-for':'192.0.2.30','cf-ipcountry':'TW'});
 const spoof=p=>({...structuredClone(p),auditLogs:[{id:'new-client',ipAddress:'203.0.113.99',ipCountryCode:'US'},...p.auditLogs.map(x=>({...x,ipAddress:'203.0.113.99',ipCountryCode:'US'}))]});
 const assertNormal=p=>{assert.equal(p.auditLogs[0].ipAddress,'192.0.2.30');assert.equal(p.auditLogs[0].ipCountryCode,'TW');assert.equal(p.auditLogs[1].ipAddress,'192.0.2.7');assert.equal(p.auditLogs[1].ipCountryCode,'JP');};
 const check=async(caseId,fn)=>{try{await fn();receipt.cases.push({caseId,status:'PASS',layer:'native-SQL'});}catch(e){failed=true;receipt.cases.push({caseId,status:'FAIL',layer:'native-SQL',message:String(e.message).split('\n')[0]});}save();};
 await check('RESTORE-normal-client-stamping',async()=>{const w='restore-normal',p=await seed(w);await update(w,spoof(p));assertNormal((await read(w)).payload);});
 await check('RESTORE-service-role-without-context-still-stamps',async()=>{const w='restore-service-normal',p=await seed(w);await update(w,spoof(p),'service_role');assertNormal((await read(w)).payload);});
 await check('RESTORE-private-control-not-client-writable',async()=>{await assert.rejects(()=>ctx('authenticated',c=>c.query("update public.sd_legacy_write_controls set restore_in_progress=true")),e=>e.code==='42501');});
 await check('RESTORE-context-is-workspace-and-role-bound',async()=>{
  const w='restore-active-context',p=await seed(w);await freeze(w);await observer.query('update public.sd_legacy_write_controls set restore_in_progress=true where workspace_key=$1',[w]);
  await update(w,spoof(p),'authenticated');assertNormal((await read(w)).payload);
  const peer='restore-context-peer',pp=await seed(peer);await update(peer,spoof(pp),'service_role');assertNormal((await read(peer)).payload);
  await observer.query('update public.sd_legacy_write_controls set restore_in_progress=false where workspace_key=$1',[w]);
 });
 const w='restore-exact',original=await seed(w);await freeze(w);
 const latest={...structuredClone(original),auditLogs:[{id:'new-server-record',detail:'new records commit',ipAddress:'192.0.2.45',ipCountryCode:'TW'},{...original.auditLogs[0],ipAddress:'192.0.2.46',ipCountryCode:'GB'}],vessels:[{id:'v1',assignedUserIds:['new-manager']}],tasks:[{id:'task-1',vesselResponsibilities:[{vesselId:'v1',primaryUserIds:['new-manager']}]}]};
 await check('RESTORE-role-hash-confirmation-guards',async()=>{const before=await read(w),c=await control(w);for(const options of [{role:'authenticated'},{badHash:true},{badConfirmation:true}]){await assert.rejects(()=>restore(w,latest,options));assert.deepEqual(await read(w),before);assert.deepEqual(await control(w),c);}});
 await check('RESTORE-needs-frozen-target',async()=>{const ww='restore-unfrozen';await seed(ww);const before=await read(ww);await assert.rejects(()=>restore(ww,latest),e=>e.code==='55000');assert.deepEqual(await read(ww),before);});
 await check('RESTORE-preserves-exact-payload-and-audit-provenance',async()=>{const r=await restore(w,latest);assert.equal(r.status,'restored');const actual=await read(w);assert.deepEqual(actual.payload,latest,'trusted restore must preserve every payload field');assert.equal(Number(actual.revision),12);const c=await control(w);assert.equal(c.payload_sha256,await hash(actual.payload));assert.equal(c.restore_in_progress,false);assert.equal(c.writes_frozen,true);});
 await check('RESTORE-success-is-actual-readback-or-atomic-failure',async()=>{
  const ww='restore-corrupt';await seed(ww);await freeze(ww);const before=await read(ww),c=await control(ww);
  await observer.query("create function public.qa_corrupt_restore() returns trigger language plpgsql as $$begin if new.workspace_key='restore-corrupt' then new.payload=jsonb_set(new.payload,'{qaUnexpected}',to_jsonb(true));end if;return new;end;$$;create trigger zzz_qa_corrupt_restore before update on public.ship_dynamics_app_state for each row execute function public.qa_corrupt_restore();");
  try{await assert.rejects(()=>restore(ww,latest),e=>e.message==='restored-payload-mismatch');assert.deepEqual(await read(ww),before);assert.deepEqual(await control(ww),c);}finally{await observer.query('drop trigger zzz_qa_corrupt_restore on public.ship_dynamics_app_state;drop function public.qa_corrupt_restore()');}
 });
 await check('RESTORE-reenable-retains-normal-stamping',async()=>{const row=await read(w),h=await hash(row.payload);await ctx('service_role',c=>q(c,'select public.reenable_ship_dynamics_legacy_writes($1,$2,$3,$4) v',[w,row.revision,h,`reenable:${w}:${row.revision}:${h}`]));const p=spoof(row.payload);await update(w,p);const saved=(await read(w)).payload;assert.equal(saved.auditLogs[0].ipAddress,'192.0.2.30');assert.equal(saved.auditLogs[1].ipAddress,latest.auditLogs[0].ipAddress);});
 await check('RESTORE-reapply-keeps-function-identity-and-normal-body',async()=>{
  const identity=async()=> (await observer.query("select oid,proacl,prosrc from pg_proc where oid in ('public.stamp_ship_dynamics_audit_network_context()'::regprocedure,'public.restore_ship_dynamics_legacy_backup(text,bigint,jsonb,text,timestamp with time zone,text,text)'::regprocedure) order by oid")).rows;
  const first=await identity();await db.exec(maintenance);assert.deepEqual(await identity(),first);
  const stamp=first.find(x=>x.prosrc.includes('jsonb_array_elements'));const nl=normalDefinition.includes('\r\n')?'\r\n':'\n';const start='  -- sd_trusted_legacy_restore_v1'+nl,end='  -- end_sd_trusted_legacy_restore_v1'+nl;assert.equal(stamp.prosrc.split(start).length,2);const from=stamp.prosrc.indexOf(start),to=stamp.prosrc.indexOf(end,from)+end.length;assert.equal(stamp.prosrc.slice(0,from)+stamp.prosrc.slice(to),normalDefinition,'ordinary trigger body is unchanged');
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));await db.exec(maintenance);assert.deepEqual(await identity(),first,'base schema followed by maintenance restores the same definitions and ACLs');
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace(/\r\n/g,'\n'));await db.exec(maintenance.replace(/\r\n/g,'\n'));const lf=await identity();assert.deepEqual(lf.map(x=>({...x,prosrc:x.prosrc.replace(/\r\n/g,'\n')})),first.map(x=>({...x,prosrc:x.prosrc.replace(/\r\n/g,'\n')})),'LF installation has the same logic, OIDs and ACLs');
 });
 receipt.status=failed?'FAIL':'PASS';
}catch(e){failed=true;receipt.status='FAIL';receipt.failure={message:String(e.message).split('\n')[0],code:e.code};}
finally{if(native)try{await native.close();}catch(e){failed=true;receipt.cleanupFailure=String(e.message);receipt.status='FAIL';}receipt.inputsUnchanged=sources.every(f=>sha(fs.readFileSync(f))===receipt.inputs[f]);if(!receipt.inputsUnchanged){failed=true;receipt.status='FAIL';}save();}
console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases,cleanup:{stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved}}));if(failed)process.exitCode=1;
