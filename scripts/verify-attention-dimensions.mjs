import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const dashboardSource=fs.readFileSync('src/Dashboard.tsx','utf8');
const detailSource=fs.readFileSync('src/VesselDetailPage.tsx','utf8');
const analysisSource=fs.readFileSync('src/DataAnalysis.tsx','utf8');
const editorSource=fs.readFileSync('src/EditModals.tsx','utf8');
const appSource=fs.readFileSync('src/App.tsx','utf8');

const server=await createServer({root:process.cwd(),server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const attention=await server.ssrLoadModule('/src/taskAttention.ts');
  const vesselAttention=await server.ssrLoadModule('/src/vesselAttention.ts');
  const workflow=await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const normalizer=await server.ssrLoadModule('/src/normalize.ts');
  const seed=await server.ssrLoadModule('/src/data/seed.ts');

  const baseTask={vesselId:'v1',vesselIds:['v1'],vesselScopeMode:'vessels',vesselTypeScopes:[],isAware:false,isAbnormal:false,isInternalControl:false,category:'',categories:[],description:'测试',status:'',expectedDate:'',departments:[],ownerUserIds:[],isClosed:false,createdBy:'u1',updatedBy:'u1',createdAt:'2026-07-19T00:00:00.000Z',updatedAt:'2026-07-19T00:00:00.000Z',statusLogs:[]};
  const ordinary={...baseTask,id:'ordinary',sourceType:'morning',attentionDimension:'task',priority:'低'};
  const meetingTask={...baseTask,id:'meeting-task',sourceType:'temporary',sourceMeetingId:'m1',attentionDimension:'meeting',priority:'急'};
  const distributedMeetingTask={...meetingTask,id:'distributed-meeting-task',distributeToVessels:true};
  const vessel={id:'v1',weeklyAttention:[],manualAttentionLevel:''};

  assert.equal(attention.isMeetingAttentionTask(meetingTask),true);
  assert.equal(attention.contributesToVesselAttention(meetingTask),false);
  assert.equal(attention.appearsInSingleVesselTasks(meetingTask),false,'未分派會議待辦不得進入單船待辦');
  assert.equal(attention.appearsInSingleVesselTasks(distributedMeetingTask),true,'已勾選分派的會議待辦必須進入單船待辦');
  assert.equal(attention.contributesToVesselAttention(distributedMeetingTask),false,'分派會議待辦仍不得抬高船舶關注度');
  assert.deepEqual(attention.vesselAttentionTasks([ordinary,meetingTask]).map(item=>item.id),['ordinary']);
  assert.equal(vesselAttention.deriveVesselAttention(vessel,[ordinary,meetingTask]).automatic,'低','会议急关注不得抬高船舶关注');
  assert.equal(vesselAttention.vesselAttentionLabel(vesselAttention.deriveVesselAttention(vessel,[ordinary,meetingTask]),[ordinary,meetingTask]),'低關注 1','看板标签只计普通要事');
  assert.equal(vesselAttention.deriveVesselAttention(vessel,[{...ordinary,priority:'急'}]).automatic,'急','普通添加要事仍须影响船舶关注');

  const tasks=[];
  workflow.reconcileMeetingTasks({tasks,meetingId:'m1',vesselIds:['v1'],followUps:[{id:'f1',description:'会议待办'}],priority:'高',expectedDate:'2026-07-31',departments:[],ownerUserIds:[],initialStatus:'待执行',actorId:'u1',actorName:'用户',at:'2026-07-19T00:00:00.000Z'});
  assert.equal(tasks[0].attentionDimension,'meeting','会议派生待办必须写入会议维度');
  assert.equal(tasks[0].priority,'高','会议派生待办必须继承会议关注程度');
  workflow.reconcileMeetingTasks({tasks,meetingId:'m1',vesselIds:['v1'],followUps:[{id:'f1',description:'会议待办'}],priority:'急',expectedDate:'2026-07-31',departments:[],ownerUserIds:[],initialStatus:'待执行',actorId:'u1',actorName:'用户',at:'2026-07-20T00:00:00.000Z'});
  assert.equal(tasks[0].priority,'急','修改会议关注程度必须同步派生待办');

  const guarded=attention.canonicalTaskAttentionForSave({...meetingTask,priority:'低'},meetingTask,'高');
  assert.equal(guarded.attentionDimension,'meeting');
  assert.equal(guarded.priority,'高','通用事项保存不得覆盖会议关注程度');
  const normalSaved=attention.canonicalTaskAttentionForSave({...ordinary,priority:'高'},ordinary);
  assert.equal(normalSaved.attentionDimension,'task');
  assert.equal(normalSaved.priority,'高');

  const raw=seed.createInitialData();
  raw.tasks=[
    Object.fromEntries(Object.entries(meetingTask).filter(([key])=>key!=='attentionDimension')),
    Object.fromEntries(Object.entries(ordinary).filter(([key])=>key!=='attentionDimension')),
  ];
  const normalized=normalizer.normalizeAppData(raw);
  assert.equal(normalized.tasks[0].attentionDimension,'meeting','旧会议关联待办须迁移为会议维度');
  assert.equal(normalized.tasks[1].attentionDimension,'task','旧普通要事须迁移为要事维度');

  assert.match(dashboardSource,/vesselAttentionTasks\(/,'船舶看板计数和聚合须先排除会议维度');
  assert.match(detailSource,/單船待辦只顯示普通單船要事，以及已勾選/,'单船详情须说明未分派会议决议不混入单船待办');
  assert.match(analysisSource,/vesselAttentionTasks\(/,'船舶分析关注须排除会议维度');
  assert.ok(editorSource.includes('會議議題關注程度')&&editorSource.includes('範圍與關注程度由臨會／專題同步'),'会议待办编辑器须明确显示独立维度与同步来源');
  assert.match(editorSource,/disabled=\{globalReadOnly\|\|hasMeetingScope\}/,'会议派生待办的关注程度不可独立修改');
  assert.match(appSource,/canonicalTaskAttentionForSave\(/,'保存层须再次强制会议维度与会议关注程度');
  assert.ok(dashboardSource.includes('const summaryTasks = vesselTasks.filter(appearsInSingleVesselTasks)') && dashboardSource.includes('[...summaryTasks].sort'), '船舶摘要只能列普通單船要事與明確分派到船舶的會議待辦');
  assert.ok(dashboardSource.includes('appearsInSingleVesselTasks(task)') && dashboardSource.includes('const attentionTasks = vesselAttentionTasks(vesselTasks)'), '船隊看板 KPI 可計分派到單船的待辦，但船舶關注度仍須排除會議維度');
  assert.ok(appSource.includes('!isVesselDelegatedMeetingTask(task)') && appSource.includes('公司層決議案') && appSource.includes('ordinaryReportTasks=tasks.filter(appearsInSingleVesselTasks)'), '報告/PDF 必須把未分派公司層決議與單船/已分派要事分區列示');

console.log('Task and meeting attention dimensions are isolated.');
}finally{await server.close();}
