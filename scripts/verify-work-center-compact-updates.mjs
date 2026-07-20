import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const source=fs.readFileSync('src/WorkCenter.tsx','utf8');
const styles=fs.readFileSync('src/styles.css','utf8');
assert.ok(!source.includes('<h2>通知 '),'我的待办不得继续渲染独立通知面板');
assert.ok(!source.includes('<h2>變動清單'),'我的待办不得继续渲染大量变动清单');
assert.ok(source.includes('task-update-marker'),'有未读更新的待办必须显示颜色标志');
assert.ok(source.includes('meeting-task-row')&&source.includes('ordinary-task-row'),'会议待办与普通要事必须有不同视觉类别');
assert.ok(source.includes("source-temporary"),'会议来源徽章必须使用独立颜色 class');
assert.ok(source.includes('const visibleVesselIds=new Set(vessels.map')&&source.includes('taskVesselProgressSummary(task,scopedIds)'), '单船结案摘要必须使用 App 已权限过滤的可见船舶，不得仅依赖个人 managedVesselIds');
assert.ok(source.includes('selectUserWorkCenterTasks(data,user,vessels)'), '我的待辦清單必須使用共用歸屬 selector，不得把所有可見船舶未結事項都算作我的待辦');
assert.ok(source.includes('導出 PDF') && source.includes('onPrint') && source.includes('work-print-list'), '我的待辦必須提供導出 PDF 清單功能與 print-only 清單內容');
assert.match(styles,/\.work-print-list\{display:none\}/,'我的待辦 PDF 清單平時必須隱藏');
assert.match(styles,/@media print[\s\S]*\.work-print-list\s*\{display:block!important/,'列印時必須顯示我的待辦 PDF 清單');
assert.ok(source.includes('!multiMeeting&&<label className="work-task-select"'), '多船会议待办不得出现批量操作复选框');
assert.ok(source.includes("multiMeeting?'multi-vessel-task-row':''"),'无复选框的多船会议卡片必须使用专属两栏布局');
assert.match(styles,/\.work-task-main\{display:grid/,'新待办主体容器必须接收原卡片内距与布局');
assert.match(styles,/\.task-link\{display:block[\s\S]*?background:transparent/,'task-link 必须重置按钮默认外观');
assert.match(styles,/\.work-task-actions\{display:flex/,'新操作区必须有 flex 布局与间距');
assert.match(styles,/\.work-task-row\.multi-vessel-task-row\{grid-template-columns:minmax\(0,1fr\) auto\}/,'无复选框多船列必须是两栏而非保留三栏');
assert.ok(!styles.includes('.work-task-select{display:none}'), '手機版不得隱藏普通待辦 checkbox，否則批量操作只能全選無法逐筆選取');
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const {unreadTaskUpdateCounts}=await server.ssrLoadModule('/src/workCenterNotifications.ts');
  const {selectUserWorkCenterTasks}=await server.ssrLoadModule('/src/workCenterScope.ts');
  const notifications=[
    {id:'n1',userId:'u1',taskId:'t1',vesselId:'v1'},
    {id:'n2',userId:'u1',taskId:'t1',vesselId:'v2'},
    {id:'n3',userId:'u1',taskId:'t2',vesselId:'v1'},
    {id:'n4',userId:'u2',taskId:'t1',vesselId:'v1'},
  ];
  assert.deepEqual(unreadTaskUpdateCounts(notifications,'u1'),{t1:1,t2:1},'多船同一任务的通知必须合并为一个任务级更新标志');
  const users={huang:{id:'huang',role:'operator',managedVesselIds:[],name:'黃燕華'},xiao:{id:'xiao',role:'operator',managedVesselIds:[],name:'肖紅林'},hero:{id:'hero-supervisor',role:'operator',managedVesselIds:[],name:'HERO督導'}};
  const vessels=[{id:'hero',assignedUserIds:['hero-supervisor']},{id:'amber',assignedUserIds:['amber-supervisor']}];
  const baseTask={vesselId:'hero',vesselIds:['hero'],vesselScopeMode:'vessels',vesselTypeScopes:[],priority:'中',isAware:false,isAbnormal:false,isInternalControl:false,category:'',categories:[],description:'',status:'',expectedDate:'',departments:[],ownerUserIds:[],isClosed:false,sourceType:'morning',createdBy:'admin',updatedBy:'admin',createdAt:'2026-07-20T00:00:00.000Z',updatedAt:'2026-07-20T00:00:00.000Z',statusLogs:[]};
  const data={meetings:[{id:'m1',participantUserIds:['xiao'],trackingUserIds:['xiao'],responsibleUserIds:[],vessels:['hero','amber'],taskItems:[]}],tasks:[
    {...baseTask,id:'hero-ordinary',description:'HERO分管督導待辦'},
    {...baseTask,id:'huang-owned',vesselId:'amber',vesselIds:['amber'],description:'黃燕華涉及待辦',ownerUserIds:['huang']},
    {...baseTask,id:'xiao-meeting',description:'肖紅林涉及臨會待辦',sourceType:'temporary',sourceMeetingId:'m1',attentionDimension:'meeting'},
    {...baseTask,id:'distributed-hero',description:'已分派HERO單船待辦',sourceType:'temporary',sourceMeetingId:'m2',attentionDimension:'meeting',distributeToVessels:true},
  ]};
  assert.deepEqual(selectUserWorkCenterTasks(data,users.huang,vessels).map(task=>task.id),['huang-owned'],'我的待辦不得因可見/涉船範圍而顯示他船分管督導或他人臨會待辦');
  assert.deepEqual(selectUserWorkCenterTasks(data,users.xiao,vessels).map(task=>task.id),['xiao-meeting'],'臨會追蹤窗口必須看到該臨會待辦');
  assert.deepEqual(selectUserWorkCenterTasks(data,users.hero,vessels).map(task=>task.id),['hero-ordinary','distributed-hero'],'分管督導只看到普通單船要事與已分派到單船跟蹤的會議待辦');
} finally { await server.close(); }
console.log('Compact work-center update marker contracts passed.');
