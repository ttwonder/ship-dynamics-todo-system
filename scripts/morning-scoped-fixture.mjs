export async function morningFixture(initial,vite){
 const {upsertDailyMorningReport}=await vite.ssrLoadModule('/src/morningHistory.ts');
 const at='2026-09-01T02:00:00.000Z';
 for(const row of [...initial.tasks,...initial.internalControlCases,...initial.meetings]){row.createdAt=at;row.updatedAt=at;row.statusLogs=Array.from({length:5},(_,i)=>({id:row.id+'-log-'+i,at,by:'QA OWNER',byUserId:'qa-owner',text:i===0?row.status:'MW HISTORY '+i}));}
 for(const c of initial.internalControlCases){const t=initial.tasks.find(t=>t.id===c.linkedTaskId);if(t)c.statusLogs=structuredClone(t.statusLogs);}
 const template=initial.tasks.find(t=>!t.isInternalControl);
 for(let i=0;i<36;i++)initial.tasks.push({...structuredClone(template),id:'mw-history-'+i,description:'MW HISTORY TASK '+String(i).padStart(2,'0'),vesselId:i%2?'qa-v2':'qa-v1',vesselIds:[i%2?'qa-v2':'qa-v1'],priority:i%2?'高':'低'});
 const member=initial.tasks.find(t=>t.id==='mw-history-0');member.vesselIds=['qa-v1','qa-v2'];member.distributeToVessels=true;member.vesselProgress=member.vesselIds.map(vesselId=>({vesselId,status:member.status,isClosed:vesselId==='qa-v1',updatedAt:at,updatedBy:'qa-owner',statusLogs:structuredClone(member.statusLogs)}));
 const meeting=initial.meetings[0];meeting.includeInMorning=true;const task=initial.tasks.find(t=>t.id==='mw-history-1');task.sourceMeetingId=meeting.id;task.sourceType='temporary';
 let r=upsertDailyMorningReport(initial,{at:'2026-09-02T02:00:00.000Z',actorUserId:'qa-owner',source:'manual'});initial.agendaReports=r.data.agendaReports;r.report.title='MW OLDER';r.report.snapshot.unrelated='QA_UNLOADED_DETAIL_SENTINEL'.repeat(12000);
 r=upsertDailyMorningReport(initial,{at:'2026-09-03T02:00:00.000Z',actorUserId:'qa-owner',source:'scheduled'});initial.agendaReports=r.data.agendaReports;r.report.snapshot.unrelated='QA_UNLOADED_DETAIL_SENTINEL'.repeat(12000);
 r=upsertDailyMorningReport(initial,{at:'2026-09-04T02:00:00.000Z',actorUserId:'qa-owner',source:'manual'});initial.agendaReports=r.data.agendaReports;r.report.title='MW BASELINE';r.report.createdAt='2026-09-01T02:00:00.000Z';
 const technical=initial.tasks.find(t=>t.id==='mw-history-2');technical.updatedAt='2026-09-05T02:00:00.000Z';technical.statusLogs.forEach(l=>{l.at=technical.updatedAt;l.id+='-technical';});
 const business=initial.tasks.find(t=>t.id==='mw-history-3');business.updatedAt='2026-09-05T02:00:00.000Z';business.statusLogs[4].text='MW REAL HISTORY CHANGE';
 const excludedMeeting={...structuredClone(initial.meetings[0]),id:'mw-excluded-meeting',includeInMorning:false};initial.meetings.push(excludedMeeting);const excluded=initial.tasks.find(t=>t.id==='mw-history-5');excluded.sourceMeetingId=excludedMeeting.id;excluded.sourceType='temporary';
 initial.vessels[0].shipType='MW TYPE A';initial.vessels[1].shipType='MW TYPE B';
}
