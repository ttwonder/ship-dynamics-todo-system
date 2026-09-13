import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {managementExpected,assertManagementAfter,managementNegativeProbes} from './management-scoped-save-oracle.mjs';

export async function createAuthorityBOracle({native,qa,legacy,intent,mode,receipt,save}){
 const started=Date.now();let base,expected,peerCommitted=false,dropped=false,attempts=0,peerSnapshot;const concurrentAuditIds=[];
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 async function commitPeer(before){
  const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
  const {assertActorAuthorizedForCloudBlockPatch}=await qa.loadModule('/src/cloudAuthorization.ts');
  const {withAudit}=await qa.loadModule('/src/utils.ts');
  const {applyVesselOperationalDraft,applyItineraryOperationalWriteMask}=await qa.loadModule('/src/vesselOperationalDraft.ts');
  const draft=structuredClone(before.payload),v=draft.vessels.find(v=>v.id==='qa-v1'),edited=structuredClone(v),at=new Date().toISOString();
  edited.note.recentDynamics='PEER-'+randomUUID();edited.note.updatedAt=at;
  applyVesselOperationalDraft(v,applyItineraryOperationalWriteMask(v,edited),at);
  const next=withAudit(draft,draft.users.find(u=>u.id==='qa-owner'),'快速更新船舶','vessel','qa-v1','隔離原生並發控制');
  const operations=buildCloudBlockPatch(before.payload,next);assertActorAuthorizedForCloudBlockPatch(before.payload,operations,'qa-owner');
  const c=await native.connect('authority_disjoint_peer'),owner='native-authority-peer',key='vessel:qa-v1',id='authority-peer-'+randomUUID();
  try{
   const lock=await q(c,'select claim_ship_dynamics_edit_lock($1,$2,$3,$4,120) r',[qa.workspace,key,owner,'QA OWNER']);assert.equal(lock.ok,true);
   const actor=await q(c,'select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(before.payload),'qa-owner']);
   const guard=await q(c,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(before.payload)]);
   await c.query('begin');await c.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-forwarded-for':'192.0.2.30','cf-ipcountry':'TW'})]);
   const ack=await q(c,'select apply_ship_dynamics_block_patch_v2($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',[qa.workspace,id,JSON.stringify(operations),'QA OWNER','qa-owner',JSON.stringify(actor),JSON.stringify(guard),JSON.stringify([{section_key:key,locked_by:owner}])]);
   assert.equal(ack.ok,true,'guarded disjoint native peer must commit');await c.query('commit');
   const after=await legacy(),wanted=structuredClone(next);wanted.auditLogs[0].ipAddress='192.0.2.30';wanted.auditLogs[0].ipCountryCode='TW';
   const expectedPeer={...wanted,revision:ack.revision,updatedAt:new Date(ack.updated_at).toISOString()};
   const differencePaths=(a,b,p='')=>a===b?[]:a&&b&&typeof a==='object'&&typeof b==='object'?[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differencePaths(a[k],b[k],p+'/'+k)):[p];
   receipt.peerOracleDiagnostics={ackKeys:Object.keys(ack),differencePaths:differencePaths(after.payload,expectedPeer)};save();
   assert.deepEqual(after.payload,expectedPeer,'complete peer intent with server metadata');
   receipt.controlledPeer={layer:'controlled-native-peer-not-browser',operationId:id,committed:true,revision:ack.revision,auditOnly:false};save();peerCommitted=true;peerSnapshot=after;concurrentAuditIds.push(next.auditLogs[0].id);
  }catch(e){receipt.peerHarnessFailure={code:e.code,message:String(e.message).split('\n')[0],frames:e.stack?.split('\n').filter(x=>/^\s+at /.test(x)).slice(0,3)};save();await c.query('rollback');throw e;}finally{await q(c,'select release_ship_dynamics_edit_lock($1,$2,$3) r',[qa.workspace,key,owner]);await c.end();}
 }
 return {
  fault:{
   before:async({name,body})=>{
    if(name!=='apply_ship_dynamics_block_patch_v2')return;
    try{
     attempts++;base=await legacy();expected=await managementExpected(base,body,qa,intent,started,concurrentAuditIds);
     if(['target-conflict','target-auth-conflict'].includes(mode)&&!peerCommitted)await commitPeer(base);
    }catch(e){receipt.BOracleFailure={code:e.code,message:String(e.message).split('\n')[0],frames:e.stack?.split('\n').filter(x=>/^\s+at /.test(x)).slice(0,4)};save();throw e;}
   },
   after:async({name,value})=>{
    if(mode==='lost-B-ack'&&name==='apply_ship_dynamics_block_patch_v2'&&value?.ok&&!dropped){dropped=true;return true;}
    return false;
   }
  },
  verify(after){
   if(mode==='target-auth-conflict'){
    assert.ok(peerCommitted);assert.equal(attempts,1);assert.deepEqual(after,peerSnapshot,'rejected B leaves the complete acknowledged peer state untouched');
    receipt.cases.push({caseId:'BA-B08-preserved-authorization-conflict',layer:'original-UI-native-PG',status:'PASS',mode});save();return {attempts,peerCommitted,rejectedWithoutMutation:true};
   }
   assert.ok(expected,'B expectation was frozen BEFORE SQL');assertManagementAfter(base,after,expected,started);
   if(mode==='target-conflict'){assert.ok(peerCommitted);assert.equal(attempts,2,'original client must rebase once, without external replay');}
   if(mode==='lost-B-ack'){assert.equal(dropped,true);assert.equal(attempts,1,'lost B ACK must reconcile without a second mutation');}
   receipt.cases.push({caseId:'BA-B07-complete-business-oracle',layer:'native-readback',status:'PASS',mode});
   if(mode==='direct')receipt.cases.push(...managementNegativeProbes(base,after,expected,started,intent));
   save();return {attempts,peerCommitted,dropped};
  }
 };
}
