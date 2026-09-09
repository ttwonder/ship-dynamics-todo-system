import assert from 'node:assert/strict';
export async function reportSaveExpected(before,request,qa,started){
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts'),{upsertDailyMorningReport}=await qa.loadModule('/src/morningHistory.ts'),{applyCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 assert.equal(request.p_actor_user_id,'qa-owner');const ops=request.p_operations;
 const reports=ops.filter(o=>o.kind==='entity'&&o.collection==='agendaReports');assert.equal(reports.length,1);const sent=reports[0].value;
 const bounded=s=>{assert.ok(Date.parse(s)>=started-1000&&Date.parse(s)<=Date.now()+1000);return s;};
 const projection={schemaVersion:2,projectionCapturedAt:bounded(sent.snapshot.projectionCapturedAt),itineraryProjections:{'qa-v1':{source:'itinerary',revision:7,updatedAt:'2026-09-01T01:00:00Z',rowId:'formal-row',values:{previousPortName:'QA FORMAL BUSAN',portDockName:'QA FORMAL KAOHSIUNG',etaUtc:'2026-09-07T00:00:00Z',etaTimeZone:'UTC+8',etaSchedule:'2026-09-07T08:00',etbUtc:null,etbTimeZone:'UTC+8',etbSchedule:'',etdUtc:null,etdTimeZone:'UTC+8',etdSchedule:'',cargoQuantityText:'QA FORMAL CARGO 123 MT'}},'qa-v2':{source:'legacy'}}};
 const result=upsertDailyMorningReport(normalizeAppData(before.payload),{at:bounded(sent.snapshot.capturedAt),actorUserId:'qa-owner',source:'manual',itineraryProjectionSnapshot:projection});
 assert.equal(result.status,'saved');assert.deepEqual(sent,JSON.parse(JSON.stringify(result.report)),'original helper entire snapshot derived BEFORE SQL');
 assert.ok(sent.snapshot.tasks.length&&sent.snapshot.internalControlCases.length&&sent.snapshot.meetings.length,'nonempty full frozen task/case/meeting graph');
 for(const rows of [sent.snapshot.tasks,sent.snapshot.internalControlCases,sent.snapshot.meetings])assert.ok(rows.some(r=>r.statusLogs.length>=5),'complete history beyond summary');assert.ok(sent.snapshot.tasks.some(t=>t.vesselProgress?.some(p=>p.statusLogs.length>=5)),'complete member history');
 const audits=ops.filter(o=>o.kind==='entity'&&o.collection==='auditLogs');assert.equal(audits.length,1);const audit=audits[0].value;
 assert.ok(audit.id.length>10&&!before.payload.auditLogs.some(a=>a.id===audit.id));
 const expectedAudit={id:audit.id,at:bounded(audit.at),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'保存每日早會快照',entityType:'agenda',entityId:sent.id,detail:`${sent.businessDate}｜${sent.vesselIds.length} 艘船｜${sent.taskCount} 件`};assert.deepEqual(audit,expectedAudit);
 for(const op of ops)assert.ok(['agendaReports','auditLogs'].includes(op.collection),'no unrelated business mutation');
 const expected=structuredClone(before.payload);expected.agendaReports=[result.report,...expected.agendaReports.filter(r=>r.id!==result.report.id)];expected.auditLogs=[expectedAudit,...expected.auditLogs].slice(0,500);
 const actualRequest=applyCloudBlockPatch(before.payload,ops);assert.deepEqual(actualRequest,JSON.parse(JSON.stringify(expected)),'complete raw CAS / outgoing graph');
 expectedAudit.ipAddress='192.0.2.30';expectedAudit.ipCountryCode='TW';return JSON.parse(JSON.stringify(expected));
}
export function assertReportSaveResult(before,after,expected,started){
 assert.equal(after.revision,before.revision+1);assert.equal(after.payload.revision,after.revision);assert.ok(Date.parse(after.payload.updatedAt)>=started-1000&&Date.parse(after.payload.updatedAt)<=Date.now()+1000);
 assert.deepEqual(after.payload,{...expected,revision:after.payload.revision,updatedAt:after.payload.updatedAt},'complete SQL graph; only bounded server metadata differs');
}
