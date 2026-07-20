import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const workflow=await server.ssrLoadModule('/src/taskVesselProgress.ts');
  const task={id:'t',vesselId:'v1',vesselIds:['v1','v2'],sourceType:'temporary',sourceMeetingId:'m1',distributeToVessels:true,status:'总体未开始',isClosed:false,statusLogs:[],vesselProgress:[]};
  const changed=workflow.updateTaskVesselProgress(task,'v1',current=>({...current,status:'A船已完成',isClosed:true,statusLogs:[{id:'l1',at:'2026-07-19T00:00:00Z',by:'督导',text:'A船已完成'}]}),{at:'2026-07-19T00:00:00Z',actorId:'u1'});
  assert.equal(changed.status,'总体未开始','单船更新不得改总体状态');
  assert.equal(changed.isClosed,false,'单船结案不得使总体结案');
  assert.equal(workflow.taskProgressForVessel(changed,'v1').status,'A船已完成');
  assert.equal(workflow.taskProgressForVessel(changed,'v1').isClosed,true);
  assert.equal(workflow.taskProgressForVessel(changed,'v2').status,'','其他船不得被同步更新');
  assert.equal(workflow.taskProgressForVessel(changed,'v2').isClosed,false);
  assert.equal(workflow.taskIsClosedForVessel(changed,'v1'),true);
  assert.equal(workflow.taskIsClosedForVessel(changed,'v2'),false);
  assert.throws(()=>workflow.updateTaskVesselProgress(task,'v3',x=>x,{at:'x',actorId:'u'}),/不在待辦範圍/);
} finally {await server.close();}

const app=fs.readFileSync('src/App.tsx','utf8');
const editor=fs.readFileSync('src/EditModals.tsx','utf8');
const detail=fs.readFileSync('src/VesselDetailPage.tsx','utf8');
const morning=fs.readFileSync('src/MorningWorkspace.tsx','utf8');
assert.ok(app.includes('taskProgressVesselId'),'打开任务必须携带单船进度上下文');
assert.ok(editor.includes('單船進度')&&editor.includes('總體進度'),'会议待办编辑器必须明确区分两种进度');
assert.ok(detail.includes('taskProgressForVessel'),'单船详情必须显示该船自己的进度');
assert.ok(morning.includes("onEditTask(t,scopeIds.length===1&&taskIds.includes(scopeIds[0])?scopeIds[0]:'')"),'早会单船范围必须把当前讨论船传入编辑器');
assert.ok(app.includes("!taskIsClosedForVessel(t,v.id)"),'默认重点船选择必须按该船进度判断未结案');
assert.ok(app.includes('taskProjectedProgressForScope'),'總表必須先把事項投影到目前可見船舶範圍');
assert.ok(app.includes('Number(taskProjectedProgressForScope(a,visibleIds).isClosed)'),'總表排序必須使用投影後結案狀態而非頂層 isClosed');
assert.ok(app.includes('visibleStatuses.join') && app.includes('taskProgressForVessel(task,id).status') && app.includes('尚無單船狀態') && !app.includes("visibleStatuses.join('<br/>')||task.status"), '多船可見範圍狀態必須彙整逐船狀態，不得直接回退頂層 status');
assert.ok(app.includes('const visibleStatusTexts=usesPerVesselProgress(t)&&visibleVessels.length?visibleVessels.map(v=>taskProgressForVessel(t,v.id).status):[t.status]') && app.includes('...visibleStatusTexts.map(richTextToPlainText)'), '總表 keyword 搜尋必須納入可見船舶逐船狀態，而非只搜頂層 status');
assert.ok(app.includes('const projected=taskProjectedProgressForScope(t,visibleScopeIds)') && app.includes('projected.isClosed') && app.includes('projected.status'), '總表列狀態必須顯示投影後狀態而非頂層狀態');
assert.ok(!app.includes("t=>t.isClosed&&taskMatchesFilters(t,closedFilters"),'已結案清單不得用頂層 isClosed 覆蓋單船作用域狀態');
assert.ok(app.includes("taskMatchesFilters(t,closedFilters,vesselMap,currentUser,true"),'已结案清单必须复用统一作用域结案过滤');
assert.ok(app.includes('setFilters({...emptyFilters,closedMode:filters.closedMode})'),'清除筛选必须保留当前清单的 open/closed 模式');
assert.ok(app.includes('const reportTaskStatus=(task:TaskItem)=>taskProjectedProgressForScope(task,reportScopeIds).status'),'PDF 報告預覽狀態必須使用報告範圍投影，不得在多船時直接回退頂層 status');
assert.ok(!app.includes('reportScopeIds.length===1?taskProgressForVessel(task,reportScopeIds[0]).status:task.status'),'PDF 報告預覽不得只在單船投影、多船回退頂層 status');
console.log('Per-vessel meeting task progress contracts passed.');
