import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Native QA only. The linked graph follows verify-task-member-native.mjs;
// normalized identity/rollout and sd_operations below are synthetic controls,
// not evidence of an original-App normalized writer or hosted authentication.
export function seedQuiescenceLinkedGraph(initial) {
 const T='pause-linked-task',M='pause-source-meeting',I='pause-decision',V=['qa-v1','qa-v2'];
 const at='2026-09-09T03:00:00.000Z';
 initial.tasks.push({id:T,sourceType:'temporary',attentionDimension:'meeting',sourceMeetingId:M,sourceMeetingItemId:I,distributeToVessels:true,vesselId:V[0],vesselIds:V,vesselScopeMode:'vessels',isInternalControl:false,isClosed:false,status:'shared unchanged',statusLogs:[],description:'<p>QA linked decision</p>',ownerUserIds:[],createdAt:at,updatedAt:at,updatedBy:'qa-owner',vesselProgress:V.map(vesselId=>({vesselId,status:'original',isClosed:false,statusLogs:[]}))});
 initial.meetings.push({id:M,subject:'QA source meeting',includeInMorning:false,vessels:V,vesselScopeMode:'vessels',isInternalControl:false,status:'進行中',latestStatus:'original',updatedAt:at,statusLogs:[],taskItems:[{id:I,description:'<p>QA linked decision</p>',distributeToVessels:true,isClosed:false}]});
}
export async function createQuiescenceRemainderQa({observer,b,q,w,wid,check,readRecord}) {
 const T='pause-linked-task',M='pause-source-meeting',V=['qa-v1','qa-v2'];
 const initial=await readRecord();
 const ctx=()=>q(observer,'select read_ship_dynamics_task_member_v1($1,$2,$3,$4) r',[w,T,V[0],'qa-owner']);
 const member=async(text)=>{const c=await ctx();assert.equal(c.ok,true);const lease=await q(observer,'select claim_ship_dynamics_edit_lock($1,$2,$3,$3,300) r',[w,c.section_key,'remainder-member']);assert.equal(lease.ok,true);return [w,randomUUID(),T,V[0],JSON.stringify({status:text,isClosed:false,mode:'leaf'}),JSON.stringify(c.expected),'qa-owner',JSON.stringify(c.actor_guard),JSON.stringify([{section_key:lease.section_key,locked_by:lease.locked_by,lease_version:lease.lease_version}])];};
 const memberCall=(args,fn='save_ship_dynamics_task_member_v1')=>q(b,`select ${fn}($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9::jsonb) r`,args);
 let committedMember,pendingMember,memberResult,memberContext;
 await check('Q21-valid-linked-member-normal',async()=>{
  committedMember=await member('normal member save');memberResult=await memberCall(committedMember);assert.equal(memberResult.ok,true,'valid eligible linked member commits');
  memberContext=await ctx();assert.equal(memberContext.progress.status,'normal member save');
  const full=await readRecord();assert.deepEqual(full.meetings.find(x=>x.id===M),initial.meetings.find(x=>x.id===M));assert.deepEqual(full.tasks.find(x=>x.id===T).vesselProgress.find(x=>x.vesselId===V[1]),initial.tasks.find(x=>x.id===T).vesselProgress[1]);
  pendingMember=await member('resume member save');return {eligibleSourceGraph:true,members:V.length,receiptReadback:true};
 });
 const actor=await q(observer,"select user_id r from sd_memberships where workspace_id=$1 and role='owner' and is_active",[wid]);assert.ok(actor);
 await check('Q22-synthetic-normalized-bootstrap-and-real-owner-rollout',async()=>{
  // Reuse the daily-morning fixture's existing normalized owner identity.
  await observer.query('insert into sd_login_options(workspace_id,user_id,is_active,must_change_password) values($1,$2,true,false)',[wid,actor]);
  await observer.query('insert into sd_itinerary_rollout(workspace_id,main_enabled,ship_portal_enabled) values($1,false,false)',[wid]);
  for(const c of [observer,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const version=await q(observer,'select version r from sd_itinerary_rollout where workspace_id=$1',[wid]);
  assert.equal((await q(observer,"select sd_itinerary_owner_update_rollout($1,$2,$3::uuid,true,true,'{}') r",[w,version,randomUUID()])).ok,true);
  assert.equal(await q(observer,'select count(*)::integer r from sd_itinerary_role_permissions where workspace_id=$1',[wid]),3);
  await observer.query("insert into sd_operations(workspace_id,operation_id,actor_id,command,target_key,request_payload,request_hash,base_versions,lease_provenance,status,result,error_code) values($1,$2,$3,'qa-table-guard-only','synthetic-control','{}',md5('{}'),'{}','{}','committed','{\"ok\":true}',null)",[wid,randomUUID(),actor]);
  return {identity:'synthetic normalized owner; not original-App auth',rollout:'actual sd_itinerary_owner_update_rollout',sd_operations:'synthetic TABLE GUARD ONLY'};
 });
 await observer.query("insert into sd_vessels(workspace_id,id,name,is_active) values($1,'qa-office','QA office',true)",[wid]);
 for(const id of ['qa-v2','qa-office'])await observer.query("insert into sd_itinerary_documents select workspace_id,$2,revision,schema_version,rows_payload,updated_at,updated_actor_kind,updated_actor_id,updated_actor_label,alternative_plans_payload from sd_itinerary_documents where workspace_id=$1 and vessel_id='qa-v1' on conflict(workspace_id,vessel_id) do nothing",[wid,id]);
 const routes=[
  {id:'main',v:'qa-v1',claim:"sd_itinerary_main_claim_lease($1,$2,'quiescence-tab','QA',300,'qa-owner')",save:'sd_itinerary_main_save',status:"sd_itinerary_main_operation_status($1,$2::uuid,'qa-owner')"},
  {id:'public',v:'qa-v2',claim:"sd_itinerary_claim_public_lease($1,$2,'qa-public-actor','qa-public-tab',300)",save:'sd_itinerary_save_public',status:"sd_itinerary_operation_status_public($1,$2::uuid,'qa-public-actor')"},
  {id:'office',v:'qa-office',claim:"sd_itinerary_claim_office_lease($1,$2,'qa-office-tab','QA',300)",save:'sd_itinerary_save_office',status:'sd_itinerary_operation_status_office($1,$2::uuid)'}
 ];
 const make=async route=>{const lease=await q(observer,`select ${route.claim} r`,[w,route.v]);assert.equal(lease.ok,true,route.id+' valid lease');const d=(await observer.query('select * from sd_itinerary_documents where workspace_id=$1 and vessel_id=$2',[wid,route.v])).rows[0];const prefix=[w,route.v,d.revision,randomUUID(),JSON.stringify(d.rows_payload),lease.leaseId];return route.id==='main'?[...prefix,'quiescence-tab',lease.fencingToken,'QA','qa-owner',JSON.stringify(d.alternative_plans_payload)]:route.id==='public'?[...prefix,'qa-public-actor','qa-public-tab',lease.fencingToken,JSON.stringify(d.alternative_plans_payload)]:[...prefix,'qa-office-tab',lease.fencingToken,'QA'];};
 const callRoute=(route,args)=>q(b,`select ${route.save}(${args.map((_,i)=>`$${i+1}${i===2?'::bigint':i===3||i===5?'::uuid':i===4||i===10||(route.id==='public'&&i===9)?'::jsonb':''}`).join(',')}) r`,args);
 for(const route of routes)await check('Q23-'+route.id+'-normal',async()=>{route.committed=await make(route);route.result=await callRoute(route,route.committed);assert.equal(route.result.ok,true,route.id+' real save');assert.deepEqual(await q(b,`select ${route.status} r`,[w,route.committed[3]]),route.result);route.pending=await make(route);return {rpc:route.save,authority:route.id==='office'?'synthetic normalized auth through real RPC':'original RPC'};});
 const manual=id=>q(b,"select sd_save_manual_itinerary_report($1,'qa-owner',$2::uuid) r",[w,id]);
 const reportSet=()=>q(observer,'select sd_itinerary_daily_report_set_token($1) r',[wid]);
 const deletes=[{id:'ids',fn:'delete_sd_itinerary_daily_report_records'},{id:'dates',fn:'delete_sd_itinerary_daily_reports'}];
 const deleteCall=(d,args)=>q(b,`select ${d.fn}($1,$2,$3::uuid,$4,$5::jsonb) r`,args);
 const deleteArgs=async(d,row)=>[w,'qa-owner',randomUUID(),await reportSet(),JSON.stringify([d.id==='ids'?row.report_id:row.business_date])];
 const reportRow=async(id)=>(await observer.query('select report_id::text,business_date::text,snapshot from sd_itinerary_daily_reports where workspace_id=$1 and operation_id=$2',[wid,id])).rows[0];
 let manualId,manualResult,savedReport;
 await check('Q24-legacy-manual-save-normal',async()=>{manualId=randomUUID();manualResult=await manual(manualId);assert.equal(manualResult.ok,true);savedReport=await reportRow(manualId);assert.ok(savedReport);return {frozenSavedReportReadback:true};});
 for(const d of deletes)await check('Q24-legacy-delete-'+d.id+'-normal',async()=>{
  let row;
  if(d.id==='ids'){const id=randomUUID();assert.equal((await manual(id)).ok,true);row=await reportRow(id);}else{await q(observer,"select sd_generate_daily_itinerary_report($1,'2026-08-28','2026-08-28T01:00Z') r",[wid]);row={business_date:'2026-08-28'};}
  d.committed=await deleteArgs(d,row);d.result=await deleteCall(d,d.committed);assert.equal(d.result.ok,true);assert.ok(d.result.deletedCount>0);return {rpc:d.fn,nonemptyDelete:true};
 });
 await q(observer,"select sd_generate_daily_itinerary_report($1,'2026-08-29','2026-08-29T01:00Z') r",[wid]);
 for(const d of deletes)d.pending=await deleteArgs(d,d.id==='ids'?savedReport:{business_date:'2026-08-29'});
 return {
  async paused(reject,status){
   await check('Q25-valid-linked-member-paused-receipts-and-lease',async()=>{
    assert.deepEqual(await memberCall(committedMember,'get_ship_dynamics_task_member_receipt_v1'),{...memberResult,replayed:true});
    assert.deepEqual(await ctx(),memberContext);
    const missing=[...committedMember];missing[1]=randomUUID();assert.equal((await memberCall(missing,'get_ship_dynamics_task_member_receipt_v1')).status,'missing');
    const mismatch=[...committedMember];mismatch[4]=JSON.stringify({status:'mismatch',isClosed:false,mode:'leaf'});assert.equal((await memberCall(mismatch,'get_ship_dynamics_task_member_receipt_v1')).code,'operation-id-mismatch');
    const g=JSON.parse(pendingMember[8])[0];assert.equal((await q(b,'select renew_ship_dynamics_task_member_lock_v1($1,$2,$3,$4,300) r',[w,g.section_key,g.locked_by,g.lease_version])).ok,true);
    await reject(()=>memberCall(pendingMember));assert.equal((await status()).unchanged,true);
    assert.equal(await q(b,'select release_ship_dynamics_task_member_lock_v1($1,$2,$3,$4) r',[w,g.section_key,g.locked_by,g.lease_version]),true);
    pendingMember=await member('resume member save');await reject(()=>memberCall(pendingMember));return {validPending:true,exactCommittedGetter:true,missingAndMismatchNoWrites:true,leaseRenewRelease:true};
   });
   for(const route of routes)await check('Q25-'+route.id+'-paused-valid-save-and-receipts',async()=>{
    await reject(()=>callRoute(route,route.pending));assert.deepEqual(await q(b,`select ${route.status} r`,[w,route.committed[3]]),route.result);
    assert.equal((await q(b,`select ${route.status} r`,[w,randomUUID()])).status,'missing');
    assert.deepEqual(await callRoute(route,route.committed),{...route.result,replayed:true});
    const wrong=[...route.committed];wrong[2]=Number(wrong[2])+1;await assert.rejects(callRoute(route,wrong),e=>e.message==='operation-mismatch');assert.equal((await status()).unchanged,true);
    return {validLeaseAndPayload:true,terminalReplay:true,missingStatus:true,mismatchNoWrites:true};
   });
   await check('Q25-legacy-manual-paused-save-and-frozen-receipt',async()=>{
    await reject(()=>manual(randomUUID()));assert.deepEqual(await manual(manualId),{...manualResult,created:false});assert.deepEqual(await reportRow(manualId),savedReport);
    const foreign=await q(b,'select sd_save_manual_itinerary_report($1,$2,$3::uuid) r',[w,'different-actor',manualId]);assert.equal(foreign.error,'OPERATION_ID_REUSED');assert.equal((await status()).unchanged,true);
   });
   for(const d of deletes)await check('Q25-legacy-delete-'+d.id+'-paused-receipts',async()=>{
    await reject(()=>deleteCall(d,d.pending));assert.deepEqual(await deleteCall(d,d.committed),d.result);
    const wrong=[...d.committed];wrong[3]='0'.repeat(32);assert.equal((await deleteCall(d,wrong)).error,'IDEMPOTENCY_MISMATCH');assert.equal((await status()).unchanged,true);
   });
  },
  async resumed(){
   await check('Q26-linked-member-resumed-same-pending',async()=>{assert.equal((await memberCall(pendingMember)).ok,true);assert.equal((await ctx()).progress.status,'resume member save');});
   for(const route of routes)await check('Q26-'+route.id+'-resumed',async()=>{const args=await make(route),result=await callRoute(route,args);assert.equal(result.ok,true);assert.deepEqual(await q(b,`select ${route.status} r`,[w,args[3]]),result);});
   await check('Q26-legacy-manual-resumed',async()=>{const id=randomUUID();assert.equal((await manual(id)).ok,true);assert.ok(await reportRow(id));});
   for(const d of deletes)await check('Q26-legacy-delete-'+d.id+'-resumed',async()=>{const args=[...d.pending];args[2]=randomUUID();args[3]=await reportSet();const result=await deleteCall(d,args);assert.equal(result.ok,true);assert.ok(result.deletedCount>0);});
  }
 };
}
