import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual App callbacks with controlled refresh/lease/persistence I/O.
// This proves the frontend version gate; native browser QA proves real SQL/ACK.
const source=fs.readFileSync('src/App.tsx','utf8');
function callback(name){
 const start=source.indexOf(`const ${name} = async`),end=source.indexOf('\n  const ',start+10);
 assert.ok(start>=0&&end>start);
 return ts.transpileModule(source.slice(start,end)+`\nglobalThis.handler=${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const actor={id:'qa-operator',isActive:true,role:'operator',name:'QA'};
const item={id:'qa-case',vesselId:'qa-vessel',description:'before',status:'unchanged',updatedAt:'2026-01-01T00:00:00.000Z',isClosed:false,syncToTask:false};
const base=()=>({revision:4,users:[actor],vessels:[{id:'qa-vessel',isActive:true}],settings:{rolePermissions:{}},internalControlCases:[structuredClone(item)]});
function environment(latest,options={}){
 let current=structuredClone(latest),applied=0;const alerts=[];
 const env={structuredClone,currentUser:actor,uid:p=>p+'-qa',nowIso:()=> '2026-01-02T00:00:00.000Z',clone:structuredClone,richTextToPlainText:x=>x,
  internalControlCreationLockKey:x=>'internal-control-new:'+x,internalControlEditLockKey:x=>'internal-control:'+x,
  claimExclusiveItemLease:async()=>options.lease!==false,releaseExclusiveItemLease:async()=>true,requireMutationLease:()=>options.lease!==false,
  hasPermission:()=>options.permission!==false,canAccessAllVessels:()=>options.access!==false,
  flushSync:fn=>fn(),setData:fn=>{current=fn(current);},alert:x=>alerts.push(x),
  runDurableRelatedMutation:async(_key,_label,apply)=>apply(),
  createInternalControlCases:(draft,items)=>{applied++;draft.internalControlCases.unshift(...structuredClone(items));},
  updateInternalControlCase:(draft,candidate,expected)=>{applied++;assert.equal(draft.internalControlCases.find(x=>x.id===candidate.id).updatedAt,expected);draft.internalControlCases=draft.internalControlCases.map(x=>x.id===candidate.id?structuredClone(candidate):x);},
  rebindReopenedVesselResponsibilities:()=>{},withAudit:x=>x,
 };
 return {env,result:()=>({current,applied,alerts})};
}
async function run(name,latest,args,options){const h=environment(latest,options);vm.createContext(h.env);vm.runInContext(callback(name),h.env);const ok=await h.env.handler(...args);return {ok,...h.result()};}
const saved={...item,description:'shore edit'},newItem={...item,id:'qa-new',description:'shore addition'};
const peer={...item,id:'qa-peer',description:'ship addition'};
const latest=base();latest.revision=5;latest.internalControlCases.unshift(peer);
let r=await run('saveInternalCase',latest,[saved,item.updatedAt,4]);
assert.equal(r.ok,true,'an unrelated ship append must not block the original case save');
assert.equal(r.applied,1);assert.deepEqual(r.current.internalControlCases.find(x=>x.id===peer.id),peer);assert.equal(r.current.internalControlCases.find(x=>x.id===item.id).description,saved.description);
r=await run('createInternalCases',latest,[[newItem],4]);assert.equal(r.ok,true,'fresh append must retain ship rows despite a newer workspace revision');assert.deepEqual(r.current.internalControlCases.map(x=>x.id),[newItem.id,peer.id,item.id]);
const stale=structuredClone(latest);stale.internalControlCases.find(x=>x.id===item.id).updatedAt='2026-01-03T00:00:00.000Z';
r=await run('saveInternalCase',stale,[saved,item.updatedAt,4]);assert.equal(r.ok,false);assert.equal(r.applied,0,'same-case version remains protected');
for(const options of [{lease:false},{permission:false},{access:false}])for(const [name,args] of [['saveInternalCase',[saved,item.updatedAt,4]],['createInternalCases',[[newItem],4]]]){r=await run(name,latest,args,options);assert.equal(r.ok,false);assert.equal(r.applied,0,'lease/current authority not bypassed');}
for(const [name,args] of [['saveInternalCase',[saved,item.updatedAt,6]],['createInternalCases',[[newItem],6]]]){r=await run(name,latest,args);assert.equal(r.ok,false);assert.equal(r.applied,0,'older authoritative snapshot is rejected');}
console.log('PASS actual App version gates: peer append accepted; exact case CAS, lease, permission, vessel scope and backward revision rejection retained (controlled I/O).');
