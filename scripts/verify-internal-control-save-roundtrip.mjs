import assert from 'node:assert/strict';
import {createServer} from 'vite';

// Synthetic data only. A duplicate accepted save must compare semantically with
// the database-normalized response, while real concurrent edits remain blocked.
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
  const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
  const {createInternalControlCases,updateInternalControlCase}=await vite.ssrLoadModule('/src/internalControlData.ts');
  const {rebaseDisjointAppData}=await vite.ssrLoadModule('/src/cloudRebase.ts');
  const data=createInitialData(),actor={id:'qa-owner',name:'QA OWNER',role:'owner'};
  const at='2026-09-23T00:00:00.000Z';
  data.internalControlCases=[];data.tasks=[];data.auditLogs=[];
  createInternalControlCases(data,[{id:'qa-save-case',vesselId:data.vessels[0].id,reportDate:'2026-09-23',reportSource:'日常',priority:'低',category:'其他',description:'QA case',isAware:false,status:'QA initial',departments:[],syncToTask:false,origin:'internal-control',isClosed:false,createdBy:actor.id,updatedBy:actor.id,createdAt:at,updatedAt:at,statusLogs:[]}],actor,at);
  const base=normalizeAppData(data),local=structuredClone(base);
  const candidate=structuredClone(base.internalControlCases[0]);
  candidate.status='QA updated';candidate.statusLogs.unshift({id:'client-entry',at:'',by:'',text:candidate.status});
  updateInternalControlCase(local,candidate,candidate.updatedAt,actor,'2026-09-23T00:01:00.000Z');
  const remote=normalizeAppData(JSON.parse(JSON.stringify(local)));
  remote.revision=local.revision+1;
  const b=base.internalControlCases[0],l=local.internalControlCases[0],r=remote.internalControlCases[0];
  console.log(JSON.stringify({normalizedRoundtripDifferences:Object.keys({...l,...r}).filter(k=>JSON.stringify(l[k])!==JSON.stringify(r[k])),localChanged:Object.keys(l).filter(k=>JSON.stringify(l[k])!==JSON.stringify(b[k])),remoteChanged:Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(b[k]))}));
  const rebased=rebaseDisjointAppData(base,local,remote,'2026-09-23T00:02:00.000Z',actor.id);
  assert.deepEqual(JSON.parse(JSON.stringify(rebased.internalControlCases)),JSON.parse(JSON.stringify(remote.internalControlCases)),'an already committed identical case update must not conflict with itself');
  const peer=structuredClone(base);peer.internalControlCases[0].description='QA peer edit';
  assert.throws(()=>rebaseDisjointAppData(base,local,peer,'2026-09-23T00:02:00.000Z',actor.id),e=>e.conflicts?.includes('dependency:internal-control-status:qa-save-case'),'real overlapping business changes still fail closed');
  console.log('PASS: duplicate case save survives normalized readback; real overlap remains blocked');
} finally {await vite.close();}
