import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer,transformWithOxc} from 'vite';
import os from 'node:os';

// Offline only: real source/updater/rebase; deterministic in-memory RPC and queue.
const root=process.cwd();
const scratch=process.env.TMPDIR||os.tmpdir();
globalThis.fetch=()=>{throw new Error('NETWORK FORBIDDEN');};
const vite=await createServer({root,configFile:false,cacheDir:`${scratch}/ic-probe-vite-cache`,server:{middlewareMode:true,watch:null},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
try {
  const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
  const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
  const {createInternalControlCases,updateInternalControlCase}=await vite.ssrLoadModule('/src/internalControlData.ts');
  const {rebaseDisjointAppData,appDataContentEqual,CloudRebaseConflictError}=await vite.ssrLoadModule('/src/cloudRebase.ts');
  const {withAudit}=await vite.ssrLoadModule('/src/utils.ts');
  const source=await fs.readFile(`${root}/src/App.tsx`,'utf8');
  const start=source.indexOf('  const runDurableRelatedMutation=');
  const end=source.indexOf('  const createInternalCases =',start);
  assert(start>=0&&end>start);
  const {code}=await transformWithOxc(source.slice(start,end),'durable-slice.ts');
  const actor={id:'qa-owner',name:'QA OWNER',role:'owner'};
  const at='2026-09-23T00:00:00.000Z';
  const data=createInitialData();
  data.users=[{...data.users[0],...actor,isActive:true}];
  Object.assign(data,{internalControlCases:[],tasks:[],auditLogs:[],notifications:[],meetings:[],agendaReports:[],taskDismissals:[]});
  createInternalControlCases(data,[{id:'qa-save-case',vesselId:data.vessels[0].id,reportDate:'2026-09-23',reportSource:'日常',priority:'低',category:'其他',description:'QA case',isAware:false,status:'QA initial',departments:[],syncToTask:false,origin:'internal-control',isClosed:false,createdBy:actor.id,updatedBy:actor.id,createdAt:at,updatedAt:at,statusLogs:[]}],actor,at);
  const base=normalizeAppData(data);
  const candidate=structuredClone(base.internalControlCases[0]);
  candidate.status='QA updated';
  candidate.statusLogs.unshift({id:'client-entry',at:'',by:'',text:candidate.status});

  function prepare(before,atValue) {
    const next=structuredClone(before);
    updateInternalControlCase(next,candidate,candidate.updatedAt,actor,atValue);
    return withAudit(next,actor,'更新內控異常','internal-control',candidate.id,'QA');
  }
  const local=prepare(base,'2026-09-23T00:01:00.000Z');
  const remote=normalizeAppData(JSON.parse(JSON.stringify(local)));
  assert.doesNotThrow(()=>rebaseDisjointAppData(base,local,base,at,actor.id));
  assert.doesNotThrow(()=>rebaseDisjointAppData(base,local,remote,at,actor.id));
  console.log('PASS: single update and byte-equivalent duplicate roundtrip do NOT conflict');

  async function scenario(doubleSubmit,failFirstRead=false) {
    let committed=structuredClone(base), tail=Promise.resolve(), writes=0, fetches=0, applies=0, seq=0;
    const messages=[], queueErrors=[], trace=[];
    const lease={status:'owned',sectionKey:'internal-control:qa-save-case',leaseOwnerId:'qa-lease',generation:1};
    const config={test:'offline'};
    const confirmed={current:structuredClone(base)},live={current:structuredClone(base)};
    const handoff={current:null};
    const env={
      requireMutationLease:()=>true,getSupabaseConfig:()=>config,
      relatedMutationHandoffInFlight:handoff,
      relatedMutationAdmissionInFlight:{current:false},
      relatedMutationHandoffMatchesCurrent:()=>Boolean(handoff.current&&!handoff.current.confirmed),
      activeEditLockRef:{current:lease},identitySessionGeneration:{current:1},currentUser:actor,
      authorizationEpoch:'qa',liveAuthorizationEpoch:{current:'qa'},liveCurrentUserId:{current:actor.id},
      sameCloudConfig:()=>true,relatedMutationLeaseMatches:()=>true,lockCoordinator:{current:{isCurrent:()=>true}},
      leaseCloudConfigs:{current:new Map([['qa-lease',{sectionKey:lease.sectionKey,config}]])},
      mutationLeaseIsOwned:()=>true,ensureCloudDurableBeforeLeaseRelease:async()=>true,
      confirmedCloudData:confirmed,liveData:live,lastCloudRevision:{current:base.revision},
      confirmCloudSnapshot:(_identity,snapshot)=>{confirmed.current=snapshot;},
      fetchCloudData:async()=>{fetches++;if(failFirstRead&&fetches===1)throw new Error('QA planning read failed');trace.push(`fetch-${fetches}:revision-${committed.revision}`);return structuredClone(committed);},
      assertRemoteExtendsDurableHistory:()=>{},cloudIdentity:()=> 'offline',
      itemLeaseExistsInSnapshot:()=>true,itemLeaseIsAuthorizedInSnapshot:()=>true,
      relatedEntityLockKeysForSection:()=>[lease.sectionKey],uid:()=>`qa-${++seq}`,
      acquireEditLockBundle:async()=>({status:'owned',leases:[]}),
      runCloudSaveQueueRpc:async(_label,fn)=>fn(new AbortController().signal),
      releaseEditLock:async()=>({ok:true}),claimEditLock:async()=>({ok:true}),renewEditLock:async()=>({ok:true}),
      transientCloudBlockLockGuards:{current:new Map()},
      window:{setInterval:()=>1,clearInterval:()=>{},clearTimeout:()=>{},setTimeout:()=>1},
      saveTimer:{current:null},flushSync:fn=>fn(),setData:value=>{live.current=value;},
      createDurableRelatedMutationHandoff:()=>({pending:true,confirmed:false,finish(_released,durable){this.pending=false;this.confirmed=durable;}}),
      enqueueCloudSave:snapshot=>{
        // Same per-entry baseline capture and candidate selection as App.tsx 831/926-928.
        const b=structuredClone(confirmed.current),l=structuredClone(snapshot);
        trace.push(`enqueue:statusLog-${l.internalControlCases[0].statusLogs[0].id}`);
        const promise=tail.then(()=>{
          const r=structuredClone(committed);
          let prepared;
          try {prepared=appDataContentEqual(b,r)?structuredClone(l):rebaseDisjointAppData(b,l,r,at,actor.id);}
          catch(error){queueErrors.push({name:error.name,conflicts:error.conflicts});throw error;}
          committed=normalizeAppData(JSON.parse(JSON.stringify(prepared)));
          committed.revision=r.revision+1; writes++;
          confirmed.current=committed;
          if(appDataContentEqual(live.current,l))live.current=committed;
          trace.push(`committed-${writes}`);
        });
        tail=promise.catch(()=>{});
        return promise;
      },
      setCloudStatus:()=>{},cloudErrorMessage:error=>error.message,
      relatedMutationFailureMessage:({label,message})=>`${label}未完成：${message}`,
      alert:message=>messages.push(message),setRelatedMutationHandoffVersion:()=>{},setCloudWriteBlocked:()=>{},
      CloudRebaseConflictError,appDataContentEqual,
      StaleAsyncConfigError:class StaleAsyncConfigError extends Error{},
      CloudBlockPatchRejectedError:class CloudBlockPatchRejectedError extends Error{},
      CloudBlockPatchConfirmedRefreshError:class CloudBlockPatchConfirmedRefreshError extends Error{},
      CloudBlockPatchConflictError:class CloudBlockPatchConflictError extends Error{},
      CloudConflictError:class CloudConflictError extends Error{},
    };
    // Only the trusted local repository function is compiled here; no user or network text is executed.
    const original=new Function('env',`with(env){${code};return runDurableRelatedMutation;}`)(env);
    const run=original;
    const apply=()=>{
      applies++;
      live.current=prepare(live.current,`2026-09-23T00:0${applies}:00.000Z`);
      trace.push(`apply-${applies}`);
      return true;
    };
    const args=[lease.sectionKey,'內控案件保存',apply];
    if(failFirstRead){assert.equal(await run(...args),false);assert.equal(env.relatedMutationAdmissionInFlight.current,false,'failed preparation must release admission for a later manual retry');}
    const first=run(...args);
    const second=doubleSubmit?run(...args):null;
    const results=await Promise.all(second?[first,second]:[first]);
    await tail;
    assert.equal(env.relatedMutationAdmissionInFlight.current,false,'admission ends on every completed attempt');
    const summary={doubleSubmit,results,fetches,applies,writes,history:committed.internalControlCases[0].statusLogs.length,audits:committed.auditLogs.length,queueErrors,messages,trace};
    console.log(JSON.stringify(summary,null,2));
    return summary;
  }
  const single=await scenario(false);
  assert.equal(single.applies,1);assert.equal(single.writes,1);assert.deepEqual(single.results,[true]);
  const racing=await scenario(true);
  assert.equal(racing.applies,1,'overlapping calls must be admitted once BEFORE the first await');
  assert.equal(racing.writes,1);assert.equal(racing.history,2);assert.equal(racing.audits,1);
  assert.deepEqual(racing.results,[true,false]);assert.equal(racing.queueErrors.length,0);
  const retried=await scenario(false,true);assert.equal(retried.applies,1);assert.equal(retried.writes,1);assert.deepEqual(retried.results,[true]);
  console.log('PASS: actual App entry rejects overlap before apply, without weakening rebase');
} finally { await vite.close(); }
