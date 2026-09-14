import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},logLevel:'silent'});let count=0;
try{
 const m=await server.ssrLoadModule('/src/itineraryDailyReports.ts');
 const config={supabaseUrl:'http://127.0.0.1:9',supabaseAnonKey:'',workspaceKey:'w',tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
 const old=m.createPendingManualItineraryReportSave({operationId:'11111111-1111-4111-8111-111111111111',actorUserId:'a'},config);
 const binding={workspace:'w',managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true};const bound={...old,sourceAuthority:binding};
 const report={reportId:'1',businessDate:'2026-09-13',timezone:'Asia/Taipei',generatedAt:'2026-09-13T01:00:00Z',generatedBy:'manual',generatedByActorId:'a',vesselCount:2,rowCount:1,sourceMaxRevision:7,logicalBytes:100};
 let calls=[],response={ok:true,created:true,operationId:old.operationId,report};const client={rpc:async(name,params)=>{calls.push({name,params});return {data:response,error:null};}};
 await m.saveManualItineraryDailyReport(bound,config,client);assert.equal(calls.pop().name,'sd_save_manual_itinerary_report');count++;
 await m.saveManualItineraryDailyReport(old,config,client);assert.equal(calls.pop().name,'sd_itinerary_record_report_save_manual_v1');count++;
 const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 for(const p of [old,bound]){m.writePendingManualItineraryReportSave(p,config,storage);assert.deepEqual(m.readPendingManualItineraryReportSave(config,'a',storage),p);assert.equal(m.readPendingManualItineraryReportSave(config,'b',storage),null);count++;}
 for(const sourceAuthority of [null,{}, {...binding,workspace:'other'},{...binding,source:'unknown'},{...binding,epoch:1.5},{...binding,admitted:false}]){await assert.rejects(()=>m.saveManualItineraryDailyReport({...old,sourceAuthority},config,client));count++;}assert.equal(calls.length,0);
 for(const cfg of [{...config,workspaceKey:'other'},{...config,storageMode:'legacy'},{...config,supabaseUrl:'http://127.0.0.1:10'}]){await assert.rejects(()=>m.saveManualItineraryDailyReport(bound,cfg,client));count++;}assert.equal(calls.length,0);
 for(const delta of [{operationId:'22222222-2222-4222-8222-222222222222'},{report:{...report,generatedByActorId:'b'}}]){response={ok:true,created:true,operationId:old.operationId,report,...delta};await assert.rejects(()=>m.saveManualItineraryDailyReport(bound,config,client),e=>e.code==='INVALID_RESPONSE'&&!e.definitive);count++;}
 console.log(JSON.stringify({status:'PASS',layer:'controlled-client-module',cases:count,persistedV1Preserved:true,noImplicitOldOperationRetarget:true}));
}finally{await server.close();}
