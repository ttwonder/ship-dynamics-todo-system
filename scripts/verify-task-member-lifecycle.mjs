import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
const results=[];
try{
 const {TaskMemberEditor}=await vite.ssrLoadModule('/src/taskMemberEditor.ts');
 let current=true,calls=[];
 const e=new TaskMemberEditor({supabaseUrl:'http://127.0.0.1:1',workspaceKey:'controlled',supabaseAnonKey:'synthetic'},'actor','Actor','task',()=>current,()=>{});
 e.rpc=async(name)=>{calls.push(name);return {ok:true,lease_version:'old',expires_at:new Date(Date.now()+75000).toISOString()};};
 const lease={section_key:'section',locked_by:'owner',lease_version:'old',expires_at:new Date(Date.now()+75000).toISOString()};
 e.lease=lease;current=false;
 await e.renew(0,lease);assert.deepEqual(calls,[],'stale identity renewal must zero-dispatch BEFORE RPC');results.push('RENEW-STALE-ZERO-DISPATCH');
 current=true;await e.renew(0,lease);assert.equal(calls.length,1);results.push('RENEW-CURRENT-POSITIVE');
 // Execute the original App's actual unmount cleanup against a busy production editor.
 const memberEditor={current:e};e.busy=true;
 const source=fs.readFileSync('src/App.tsx','utf8');
 const cleanup=source.match(/useEffect\(\(\)=>\(\)=>\{([^}]*memberEditor\.current[^}]*)\},\[\]\)/)?.[1];assert.ok(cleanup);
 new Function('memberEditor',cleanup)(memberEditor);await new Promise(r=>setTimeout(r,0));
 assert.equal(e.disposed,true,'App unmount must invalidate busy member before callbacks can publish');
 assert.equal(e.lease,null,'App unmount detaches captured old lease');results.push('APP-BUSY-UNMOUNT');
 const {memberPendingKey}=await vite.ssrLoadModule('/src/taskMemberEditor.ts');
 const config={supabaseUrl:'http://127.0.0.1:1',workspaceKey:'controlled',supabaseAnonKey:'synthetic'};
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};globalThis.alert=()=>{};
 const progress={vesselId:'vessel',status:'original submitted',isClosed:false,statusLogs:[]};
 const params={p_workspace_key:'controlled',p_actor_user_id:'actor',p_task_id:'task',p_vessel_id:'vessel',p_operation_id:'original-op',p_command:{status:'original submitted',mode:'leaf'},p_expected:{member:'OLD-MEMBER-CAS',structure:'OLD-STRUCTURE-CAS',source:[]},p_lock_guards:[{lease_version:'OLD-LEASE'}]};
 const key=memberPendingKey(config,'actor','task','vessel');
 for(const field of ['p_workspace_key','p_actor_user_id','p_task_id','p_vessel_id']){
  const raw=JSON.stringify({params:{...params,[field]:'wrong'},draft:JSON.stringify(progress),unknownEnvelope:{retained:[2,1]}});map.set(key,raw);
  const x=new TaskMemberEditor(config,'actor','Actor','task',()=>true,()=>{});const dispatched=[];x.rpc=async(name)=>{dispatched.push(name);throw new Error('must not dispatch');};
  assert.equal(await x.select('vessel'),null);assert.deepEqual(dispatched,[]);assert.equal(map.get(key),raw);results.push('PENDING-MISMATCH-'+field);
 }
 const raw=JSON.stringify({params,draft:JSON.stringify(progress),unknownEnvelope:{retained:[2,1]}});map.set(key,raw);
 const x=new TaskMemberEditor(config,'actor','Actor','task',()=>true,()=>{});x.scope='vessel';x.contexts.set('vessel',{progress,expected:{member:'NEW-CAS-MUST-NOT-ADOPT'}});
 const wire=[];x.rpc=async(name,args)=>{wire.push([name,structuredClone(args)]);if(name==='save_ship_dynamics_task_member_v1')throw new Error('uncertain network');return {status:'missing'};};
 assert.equal(await x.save({id:'task',vesselProgress:[progress]},'vessel',async()=>{throw new Error('must not publish');}),false);
 assert.equal(wire.length,3);assert.ok(wire.every(([,args])=>JSON.stringify(args)===JSON.stringify(params)));assert.equal(map.get(key),raw);results.push('MISSING-RECEIPT-ORIGINAL-REPLAY-NO-NEW-CAS');
 let identity=true,configCurrent=true;const frozen=new TaskMemberEditor(config,'actor','Actor','task',()=>identity&&configCurrent,()=>{},()=>identity);
 assert.equal(frozen.preservesDraft('task'),true);configCurrent=false;frozen.checkCurrent();assert.equal(frozen.isUsable(),false);assert.equal(frozen.preservesDraft('task'),true);configCurrent=true;assert.equal(frozen.isUsable(),false);assert.equal(frozen.preservesDraft('wrong-task'),false);identity=false;assert.equal(frozen.preservesDraft('task'),false);results.push('EXACT-IDENTITY-VS-CONFIG-CONTINUITY');
 const sourceFile=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let configHandler;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(sourceFile)==='saveCloudConfiguration')configHandler=n.initializer.getText(sourceFile);ts.forEachChild(n,visit);}visit(sourceFile);assert.ok(configHandler);
 const code=ts.transpileModule('const handler='+configHandler+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let durabilityCalls=0,configWrites=0;
 const ctx={memberEditor:{current:{}},vesselLeaseIncidentRef:{current:null},activeEditLockRef:{current:null},batchManagedOpenRef:{current:false},pendingTaskCreationsRef:{current:[]},vesselAttentionSaveQueue:{current:null},alert:()=>{},ensureCloudDurableBeforeLeaseRelease:async()=>{durabilityCalls++;return false;},withPendingTaskCreationStorageLock:async fn=>fn(),readPendingTaskCreations:()=>[],setPendingTaskCreations:()=>{},pendingTaskCreationRunGeneration:{current:0},saveSupabaseConfig:()=>{configWrites++;},window:{localStorage,location:{reload:()=>{}}}};
 const handler=()=>new Function(...Object.keys(ctx),code+'return handler;')(...Object.values(ctx));
 assert.equal(await handler()({}),false);assert.equal(durabilityCalls,0,'config change must reject active member before durability/config dispatch');results.push('CONFIG-ACTIVE-MEMBER-ZERO-DISPATCH');
 ctx.memberEditor.current=null;ctx.ensureCloudDurableBeforeLeaseRelease=async()=>{ctx.memberEditor.current={};return true;};
 assert.equal(await handler()({}),false);assert.equal(configWrites,0,'late member open must fence configuration write inside storage lock');results.push('CONFIG-LATE-MEMBER-ZERO-WRITE');
 console.log(JSON.stringify({layer:'controlled-production-class',status:'PASS',cases:results}));
}finally{await vite.close();}
