import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const merge=await server.ssrLoadModule('/src/cloudConfirmedMerge.ts');
  const rebase=await server.ssrLoadModule('/src/cloudRebase.ts');
  const baseline=createInitialData();
  const actor=baseline.users[0];
  actor.role='owner';
  actor.isActive=true;

  const current=structuredClone(baseline);
  current.vessels[0].position={...current.vessels[0].position,location:'本機同時修改'};
  const confirmed=structuredClone(baseline);
  confirmed.revision=baseline.revision+1;
  confirmed.updatedAt='2026-08-06T05:00:00.000Z';
  confirmed.agendaReports.unshift({
    id:'daily-morning-2026-08-06',title:'2026/08/06 早會內容',vesselIds:confirmed.vessels.map(v=>v.id),
    createdBy:actor.id,createdAt:'2026-08-06T01:00:00.000Z',taskCount:0,kind:'daily-morning',
    businessDate:'2026-08-06',source:'manual',updatedAt:'2026-08-06T01:00:00.000Z',
    snapshot:{capturedAt:'2026-08-06T01:00:00.000Z',vessels:[],tasks:[],meetings:[]},
  });
  const merged=merge.mergeConfirmedCloudSnapshot({baseline,current,confirmed,actorUserId:actor.id,at:'2026-08-06T05:00:01.000Z'});
  assert.equal(merged.vessels[0].position.location,'本機同時修改','concurrent local work must survive cloud confirmation');
  assert.ok(merged.agendaReports.some(report=>report.id==='daily-morning-2026-08-06'),'the complete confirmed cloud result must remain in live state');
  assert.equal(merged.revision,confirmed.revision+1,'rebased local work must remain a pending next revision');

  const overlapping=structuredClone(current);
  const remoteOverlap=structuredClone(confirmed);
  remoteOverlap.vessels[0].position={...remoteOverlap.vessels[0].position,location:'他人同時修改'};
  assert.throws(
    ()=>merge.mergeConfirmedCloudSnapshot({baseline,current:overlapping,confirmed:remoteOverlap,actorUserId:actor.id,at:'2026-08-06T05:00:02.000Z'}),
    error=>error instanceof rebase.CloudRebaseConflictError,
    'overlapping concurrent edits must stay blocked instead of silently choosing a side',
  );
}finally{await server.close();}
const appSource=fs.readFileSync('src/App.tsx','utf8');
assert.equal((appSource.match(/mergeConfirmedCloudSnapshot\(\{baseline,current,confirmed,actorUserId:actor\.id,at:nowIso\(\)\}\)/g)||[]).length,2,'morning and personal-dismissal confirmations must both publish the complete rebased cloud snapshot');
console.log('Cloud-confirmed full-snapshot merge contracts passed.');
