import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createServer } from 'vite';

// Execute the production App closures, including the missing-item React effect.
// Only cloud I/O and React's render scheduling are replaced at this seam.
const source=fs.readFileSync('src/App.tsx','utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');
const declaration=name=>app.body.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name.getText(ast)===name))?.getText(ast);
const missingEffect=app.body.statements.find(node=>ts.isExpressionStatement(node)&&node.getText(ast).includes('!authorizedEditLockKeys.has(activeEditLock.sectionKey)'))?.getText(ast);
assert.ok(missingEffect,'the real missing-item cleanup effect must be tested');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=async()=>{for(let n=0;n<30;n+=1)await Promise.resolve();};
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const runtime=await server.ssrLoadModule('/src/App.tsx');
  const creation=await server.ssrLoadModule('/src/durableCreationHandoff.ts');
  const handoff=fs.existsSync('src/durableRelatedMutation.ts')?await server.ssrLoadModule('/src/durableRelatedMutation.ts'):{};
  const receipt=await server.ssrLoadModule('/src/cloudBlockReceipt.ts');
  const rpc=await server.ssrLoadModule('/src/cloud.ts');
  const cloud=await server.ssrLoadModule('/src/cloud.ts');
  const rebase=await server.ssrLoadModule('/src/cloudRebase.ts');
  const block=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const errors=await server.ssrLoadModule('/src/cloudSyncError.ts');
  const locks=await server.ssrLoadModule('/src/editLockCoordinator.ts');
  let scenarioCount=0;
  const runScenario=async({failSave=false,failRelease=false,changeIdentity=false,wrongSuccessor=false,saveError,invalidate,explicitRelease=false,deleteItem=true}={})=>{
    scenarioCount+=1;
    let config={supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'fixture',workspaceKey:'qa',tableName:'state'};
    const initial={revision:1,tasks:[{id:'test-task'}],auditLogs:[]};
    const gate=deferred();const events=[];const alerts=[];
    let remote=structuredClone(initial),generation=1;
    const lock={sectionKey:'task:test-task',leaseOwnerId:'lease-A',ownerUserId:'owner',ownerUserName:'Owner',authorizationEpoch:'auth',generation:1,status:'owned',validatedUntilMs:Date.now()+75000};
    const env={...runtime,...creation,...handoff,...receipt,...rpc,...cloud,...rebase,...block,...errors,...locks,
      console,Promise,Date,Boolean,Map,Set,Error,JSON,structuredClone,
      currentUser:{id:'owner',name:'Owner'},authorizationEpoch:'auth',
      identitySessionGeneration:{current:1},liveCurrentUserId:{current:'owner'},liveAuthorizationEpoch:{current:'auth'},
      activeEditLock:lock,activeEditLockRef:{current:lock},creationHandoffInFlight:{current:null},relatedMutationHandoffInFlight:{current:null},
      confirmedCloudData:{current:structuredClone(initial)},liveData:{current:structuredClone(initial)},lastCloudRevision:{current:1},
      leaseCloudConfigs:{current:new Map([['lease-A',{sectionKey:lock.sectionKey,config}]])},
      saveTimer:{current:null},transientCloudBlockLockGuards:{current:new Map()},authorizedEditLockKeys:new Set([lock.sectionKey]),authorizedEditLockKey:lock.sectionKey,relatedMutationHandoffVersion:0,
      getSupabaseConfig:()=>config,sameCloudConfig:(a,b)=>a===b,cloudIdentity:()=> 'fixture',
      requireMutationLease:()=>true,ensureCloudDurableBeforeLeaseRelease:async()=>true,
      fetchCloudData:async()=>structuredClone(remote),assertRemoteExtendsDurableHistory:()=>{},
      itemLeaseExistsInSnapshot:(key,value)=>value.tasks.some(task=>key==='task:'+task.id),itemLeaseIsAuthorizedInSnapshot:()=>true,
      relatedEntityLockKeysForSection:()=>[lock.sectionKey],acquireEditLockBundle:async()=>({status:'owned',leases:[]}),
      runCloudSaveQueueRpc:(_label,io)=>io(),claimEditLock:async()=>({ok:true}),renewEditLock:async()=>({ok:true}),
      releaseEditLock:async()=>{events.push('release');if(failRelease)throw new Error('cleanup transport failure');},
      lockCoordinator:{current:{isCurrent:value=>generation===value,invalidate:()=>{events.push('invalidate');generation+=1;},run:io=>io()}},

      isTaskCreationLockKey:()=>false,quarantineCreationDraftForLock:()=>{},
      setActiveEditLock:updater=>{env.activeEditLock=updater(env.activeEditLock);env.activeEditLockRef.current=env.activeEditLock;},
      setCloudStatus:message=>events.push('status:'+message),setSensitiveCloudStatus:message=>events.push('status:'+message),
      showSaveToast:(_kind,title)=>events.push('toast:'+title),
      setRelatedMutationHandoffVersion:()=>queueMicrotask(()=>env.missingEffect()),
      alert:message=>alerts.push(message),flushSync:fn=>fn(),uid:()=> 'related-lease',
      window:{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{}},
      useEffect:callback=>callback(),
      confirmCloudSnapshot:(_identity,value)=>{env.confirmedCloudData.current=value;},
      appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    };
    env.setData=value=>{
      env.liveData.current=typeof value==='function'?value(env.liveData.current):value;
      env.authorizedEditLockKeys=new Set(env.liveData.current.tasks.map(task=>'task:'+task.id));
      env.missingEffect();
    };
    env.enqueueCloudSave=async(snapshot,isCurrent)=>{
      events.push('save-start');
      await gate.promise;
      if(failSave)throw saveError||new Error('transport outcome unknown');
      if(!isCurrent())throw new runtime.StaleAsyncConfigError();
      remote=structuredClone(snapshot);env.confirmedCloudData.current=structuredClone(snapshot);events.push('cloud-confirmed');
      if(!isCurrent())throw new runtime.StaleAsyncConfigError();
    };
    vm.createContext(env);
    const names=['relatedMutationHandoffMatchesCurrent','releaseCurrentEditLock','mutationLeaseIsOwned','runDurableRelatedMutation'];
    const js=ts.transpileModule(names.map(declaration).filter(Boolean).join('\n')+'\nglobalThis.run=runDurableRelatedMutation;globalThis.release=releaseCurrentEditLock;globalThis.missingEffect=()=>{'+missingEffect+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
    vm.runInContext(js,env);
    const result=env.run(lock.sectionKey,deleteItem?'刪除要事':'保存要事',()=>{env.setData({...env.liveData.current,tasks:deleteItem?[]:[{id:'test-task',description:'edited'}],auditLogs:[{action:deleteItem?'delete':'edit',entityId:'test-task'}]});return true;});
    await tick();
    assert.equal(events.includes('invalidate'),false,'BUG: removing the task must not invalidate its own lease before cloud acknowledgement; '+JSON.stringify({events,alerts}));
    assert.ok(events.includes('save-start'),'deletion must enter its cloud save; '+JSON.stringify({events,alerts}));
    assert.equal(events.includes('release'),false,'BUG: removing the task must not release its own lease before cloud acknowledgement');
    if(changeIdentity){env.liveCurrentUserId.current='other';env.identitySessionGeneration.current+=1;}
    if(invalidate==='same-user-ABA')env.identitySessionGeneration.current+=2;
    if(invalidate==='authorization')env.liveAuthorizationEpoch.current='revoked';
    if(invalidate==='config')config={...config,workspaceKey:'other'};
    if(invalidate==='expiry')lock.validatedUntilMs=Date.now()-1;
    const pendingRelease=explicitRelease?env.release():null;
    if(pendingRelease){await tick();assert.equal(events.includes('release'),false,'explicit close must await the same durable mutation');}
    let successor;
    if(wrongSuccessor){
      const releasing=env.release();
      successor={...lock,sectionKey:'task:other',leaseOwnerId:'lease-B',generation:2};
      env.authorizedEditLockKeys=new Set([successor.sectionKey]);
      env.activeEditLock=successor;env.activeEditLockRef.current=successor;generation=2;
      gate.resolve();await result;await releasing;
      assert.equal(env.activeEditLockRef.current,successor,'late release must not clear a successor lease');
      return{events,alerts};
    }
    gate.resolve();
    const outcome=await result;await tick();
    if(pendingRelease)await pendingRelease;
    if(failSave||changeIdentity||invalidate){
      assert.equal(outcome,false,'unconfirmed or stale context cannot be reported as success');
      assert.equal(events.includes('cloud-confirmed'),false);
      assert.equal(alerts.length,1);
      if(saveError instanceof receipt.CloudBlockPatchConfirmedRefreshError){
        assert.match(alerts[0],/已.*雲端確認|已由雲端確認/);
        assert.doesNotMatch(alerts[0],/刪除要事未完成/);
      }else if(saveError instanceof rpc.CloudBlockPatchRejectedError)assert.match(alerts[0],/刪除要事未完成/);
      else assert.match(alerts[0],/結果尚未確認/);
      if(failSave)assert.equal(events.includes('release'),false,'unconfirmed mutation must retain its still-valid main lease until expiry');
    }else{
      assert.equal(outcome,true,'durably confirmed deletion must return success');
      assert.deepEqual(remote.tasks,deleteItem?[]:[{id:'test-task',description:'edited'}]);
      assert.equal(alerts.length,0,'confirmed deletion must not show a failure alert');
      if(deleteItem||explicitRelease)assert.ok(events.indexOf('cloud-confirmed')<events.indexOf('release'),'release must follow cloud acknowledgement');
      else assert.equal(events.includes('release'),false,'ordinary save must not auto-close or release an existing item');
      if(failRelease)assert.ok(events.some(event=>event.includes('刪除要事已完成，收尾延遲')),'cleanup failure must preserve the confirmed-delete result');
    }
    return{events,alerts};
  };
  await runScenario();
  await runScenario({failRelease:true});
  await runScenario({failSave:true});
  await runScenario({changeIdentity:true});
  for(const invalidate of ['same-user-ABA','authorization','config','expiry'])await runScenario({invalidate});
  await runScenario({wrongSuccessor:true});
  await runScenario({explicitRelease:true});
  await runScenario({deleteItem:false});
  await runScenario({failSave:true,saveError:new rpc.CloudBlockPatchRejectedError('FORBIDDEN')});
  await runScenario({failSave:true,saveError:new receipt.CloudBlockPatchConfirmedRefreshError({ok:true,status:'committed',operationId:'same-operation',revision:2,updatedAt:'2026-09-05T00:00:00Z',replayed:false})});
  const exact={sectionKey:'task:one',leaseOwnerId:'lease-one',ownerUserId:'owner',authorizationEpoch:'auth',generation:1};
  assert.equal(handoff.relatedMutationLeaseMatches(exact,{...exact}),true);
  for(const field of Object.keys(exact))assert.equal(handoff.relatedMutationLeaseMatches(exact,{...exact,[field]:field==='generation'?2:'other'}),false,`different ${field} must not inherit the barrier`);
  const pending=handoff.createDurableRelatedMutationHandoff(exact,()=>true,'刪除要事');
  assert.equal(Object.isFrozen(pending.lease),true);
  pending.finish(false);pending.finish(true,true);
  assert.equal(await pending.promise,false,'a settled unknown result cannot be relabelled confirmed');
  assert.equal(pending.confirmed,false);
  console.log(`Task-delete durability: ${scenarioCount} production-closure scenarios plus exact-lease matching and single-settlement checks passed (mocked I/O, no production access).`);
}finally{await server.close();}
