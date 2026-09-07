import assert from 'node:assert/strict';

// Deterministic, moderate synthetic volume; no credentials leave the fixture.
export async function prepareRecordPerformanceFixture(initial,vite,size){
 assert.ok(['small','medium'].includes(size));
 const at='2026-09-08T00:00:00.000Z';initial.updatedAt=at;
 for(const v of initial.vessels){v.fullName=v.name;v.shortName=v.name;delete v.nameEn;v.createdAt=at;v.updatedAt=at;}
 if(size==='medium'){
  const template=initial.vessels[0];
  initial.vessels=Array.from({length:12},(_,i)=>({...structuredClone(template),id:`qa-v${i+1}`,name:`QA VESSEL ${i+1}`,fullName:`QA VESSEL ${i+1}`,shortName:`QA VESSEL ${i+1}`}));
  initial.tasks=Array.from({length:80},(_,i)=>({id:`perf-task-${i+1}`,vesselId:'qa-v1',vesselIds:initial.vessels.slice(0,8).map(v=>v.id),vesselScopeMode:'selected',priority:'低',isAware:false,isAbnormal:false,isInternalControl:false,category:'維修',categories:['維修'],description:`QA SYNTHETIC TASK ${i+1}`,status:'QA pending',expectedDate:'',reportDate:at.slice(0,10),departments:['督導'],ownerUserIds:[],isClosed:false,sourceType:'daily',createdBy:'qa-owner',updatedBy:'qa-owner',createdAt:at,updatedAt:at,statusLogs:[],distributeToVessels:true,vesselProgress:initial.vessels.slice(0,8).map((v,j)=>({vesselId:v.id,status:`QA member ${j+1}`,isClosed:false,updatedAt:at,updatedBy:'qa-owner',statusLogs:Array.from({length:6},(_,k)=>({id:`perf-log-${i+1}-${j+1}-${k+1}`,at,by:'QA OWNER',byUserId:'qa-owner',text:`Synthetic history ${k+1} `+'測試內容 '.repeat(16)}))}))}));
 }
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
 const normalized=normalizeAppData(initial);assert.ok(normalized);Object.assign(initial,normalized);
 return {normalizeAppData,...await vite.ssrLoadModule('/src/cloudBlockPatch.ts'),...await vite.ssrLoadModule('/src/utils.ts')};
}

export function fixtureCounts(payload){
 const collections=Object.fromEntries(Object.entries(payload).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,{count:v.length,uniqueIds:new Set(v.map(x=>x.id)).size,jsonBytes:Buffer.byteLength(JSON.stringify(v))}]));
 const progress=payload.tasks.flatMap(t=>Array.isArray(t.vesselProgress)?t.vesselProgress:[]);
 return {collections,memberEntries:progress.length,memberLogs:progress.reduce((n,p)=>n+p.statusLogs.length,0),memberJsonBytes:Buffer.byteLength(JSON.stringify(progress)),appDataJsonBytes:Buffer.byteLength(JSON.stringify(payload))};
}
