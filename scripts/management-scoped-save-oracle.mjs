import assert from 'node:assert/strict';
// Expected business state is constructed and frozen before allowing actual SQL.
export async function managementExpected(before,request,qa,intent,started,concurrentAuditIds=[]){
 const {applyCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {vesselDisplayName}=await qa.loadModule('/src/vesselDisplay.ts');
 assert.equal(request.p_actor_user_id,'qa-owner');
 const ops=request.p_operations,expected=structuredClone(before.payload);
 const bounded=s=>{assert.ok(Date.parse(s)>=started-1000&&Date.parse(s)<=Date.now()+1000,'bounded client time');return s;};
 const entity=(collection,id)=>{const found=ops.filter(o=>o.kind==='entity'&&o.collection===collection&&o.entityId===id);assert.equal(found.length,1,collection+' exact operation');return found[0].value;};
 let action,entityType,entityId,detail;
 if(intent.kind==='person'){
  const user=expected.users.find(u=>u.id===intent.id),sent=entity('users',intent.id);
  user.name=intent.name;user.updatedAt=bounded(sent.updatedAt);
  action='更新人員';entityType='user';entityId=intent.id;detail=intent.name;
 }else if(intent.kind==='vessel-name'){
  const vessel=expected.vessels.find(v=>v.id===intent.id),sent=entity('vessels',intent.id);
  vessel.fullName=intent.name;vessel.updatedAt=bounded(sent.updatedAt);
  action='更新船舶';entityType='vessel';entityId=intent.id;detail=vesselDisplayName(vessel);
 }else{
  const vessel=expected.vessels.find(v=>v.id===intent.id),sent=entity('vessels',intent.id);
  vessel.assignedUserIds=[intent.userId];vessel.delegateManagers=vessel.delegateManagers.filter(d=>d.userId!==intent.userId);vessel.updatedAt=bounded(sent.updatedAt);
  const user=expected.users.find(u=>u.id===intent.userId);user.managedVesselIds=Array.from(new Set([...user.managedVesselIds,intent.id]));
  action='更新船舶';entityType='vessel';entityId=intent.id;detail=vesselDisplayName(vessel);
 }
 const audits=ops.filter(o=>o.kind==='entity'&&o.collection==='auditLogs');assert.equal(audits.length,1);
 const audit=audits[0].value;assert.ok(audit.id.length>10&&!expected.auditLogs.some(a=>a.id===audit.id));
 const expectedAudit={id:audit.id,at:bounded(audit.at),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action,entityType,entityId,detail};
 assert.deepEqual(audit,expectedAudit,'exact independently named audit');
 const concurrent=expected.auditLogs.filter(row=>concurrentAuditIds.includes(row.id));
 const untouched=expected.auditLogs.filter(row=>!concurrentAuditIds.includes(row.id));
 expected.auditLogs=[...[expectedAudit,...concurrent].sort((a,b)=>String(b.at).localeCompare(String(a.at))||a.id.localeCompare(b.id)),...untouched].slice(0,500);
 assert.deepEqual(applyCloudBlockPatch(before.payload,ops),expected,'whole requested graph equals explicit intent BEFORE SQL');
 expectedAudit.ipAddress='192.0.2.30';expectedAudit.ipCountryCode='TW';return expected;
}
export function assertManagementAfter(before,after,expected,started){
 assert.equal(after.revision,before.revision+1);assert.equal(after.payload.revision,after.revision);
 assert.ok(Date.parse(after.payload.updatedAt)>=started-1000&&Date.parse(after.payload.updatedAt)<=Date.now()+1000,'bounded server time');
 assert.deepEqual(after.payload,{...expected,revision:after.revision,updatedAt:after.payload.updatedAt},'complete independent SQL graph');
}
export function managementNegativeProbes(before,after,expected,started,intent){
 const probes={
  'unselected-person':v=>{v.payload.users.find(u=>u.id==='qa-admin').name='TAMPER';},
  'unselected-vessel':v=>{v.payload.vessels.find(x=>x.id==='qa-v1').note.recentDynamics='TAMPER';},
  'unselected-history':v=>{v.payload.tasks[0].statusLogs.at(-1).text='TAMPER';},
  'unselected-snapshot':v=>{v.payload.agendaReports[0].snapshot.qaUnknown='TAMPER';},
  'missing-audit':v=>{v.payload.auditLogs.shift();},
  'wrong-audit':v=>{v.payload.auditLogs[0].action='TAMPER';},
  'settings':v=>{v.payload.settings.departments.push('TAMPER');},
 };
 if(intent.kind==='person')probes['wrong-person-name']=v=>{v.payload.users.find(u=>u.id===intent.id).name='TAMPER';};
 else{probes['missing-reciprocity']=v=>{v.payload.users.find(u=>u.id===intent.userId).managedVesselIds=v.payload.users.find(u=>u.id===intent.userId).managedVesselIds.filter(id=>id!==intent.id);};probes['uncleaned-delegate']=v=>{v.payload.vessels.find(x=>x.id===intent.id).delegateManagers.push({userId:intent.userId,isActive:true});};}
 return Object.entries(probes).map(([name,mutate])=>{const v=structuredClone(after);mutate(v);assert.throws(()=>assertManagementAfter(before,v,expected,started));return {caseId:'MG-ORACLE-'+intent.kind+'-'+name,layer:'negative-oracle-not-product',status:'PASS'};});
}
