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
  const notifications=[
    {id:'n1',userId:'u1',taskId:'t1',vesselId:'v1'},
    {id:'n2',userId:'u1',taskId:'t1',vesselId:'v2'},
    {id:'n3',userId:'u1',taskId:'t2',vesselId:'v1'},
    {id:'n4',userId:'u2',taskId:'t1',vesselId:'v1'},
  ];
  assert.deepEqual(unreadTaskUpdateCounts(notifications,'u1'),{t1:1,t2:1},'多船同一任务的通知必须合并为一个任务级更新标志');
} finally { await server.close(); }
console.log('Compact work-center update marker contracts passed.');
