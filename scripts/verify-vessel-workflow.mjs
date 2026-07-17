import assert from 'node:assert/strict';
import { createServer } from 'vite';
import fs from 'node:fs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { DEFAULT_ROLE_PERMISSIONS, hasPermission } = await server.ssrLoadModule('/src/permissions.ts');
  const workflow = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const owner = { id:'owner', role:'owner', department:'管理層', managedVesselIds:[] };
  const admin = { id:'admin', role:'admin', department:'管理層', managedVesselIds:[] };
  const operator = { id:'op', role:'operator', department:'海技組', managedVesselIds:['v1'] };
  const vesselAccount = { id:'ship', role:'vessel', department:'船舶帳戶', managedVesselIds:['v1'] };
  const supervisor = { id:'sup', role:'operator', department:'督導', managedVesselIds:['v1'], isActive:true };
  const director = { id:'dir', role:'operator', department:'航運處', managedVesselIds:['v1'], isActive:true };
  const unrelated = { id:'other', role:'operator', department:'督導', managedVesselIds:['v2'], isActive:true };
  const vessel = { id:'v1', assignedUserIds:['sup','dir','op','ship'] };
  const vessel2 = { id:'v2', assignedUserIds:['other'] };

  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS, vesselAccount, 'createTasks'), true, '船舶帳戶可新增本船待辦');
  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS, vesselAccount, 'editBusinessContent'), false, '船舶帳戶不可修改既有內容');
  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS, vesselAccount, 'deleteTasks'), false, '船舶帳戶不可刪除待辦');
  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS, admin, 'deleteTasks'), true, '管理員可刪除待辦');
  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS, operator, 'deleteTasks'), false, '操作員不可刪除待辦');
  assert.equal(workflow.canAccessTab(vesselAccount, 'dashboard'), true);
  assert.equal(workflow.canAccessTab(vesselAccount, 'total'), true);
  for (const tab of ['morning','meeting','closed','reports','stats','management','work']) assert.equal(workflow.canAccessTab(vesselAccount, tab), false, `船舶帳戶不可進入 ${tab}`);
  assert.equal(workflow.canUseVessel(vesselAccount, 'v1'), true);
  assert.equal(workflow.canUseVessel(vesselAccount, 'v2'), false);
  assert.equal(workflow.canDeleteTask(owner), true);
  assert.equal(workflow.canDeleteTask(admin), true);
  assert.equal(workflow.canDeleteTask(operator), false);
  assert.equal(workflow.canDeleteTask(vesselAccount), false);

  const recipients = workflow.getTaskNotificationRecipientIds([supervisor,director,unrelated,operator,vesselAccount], vessel, 'ship');
  assert.deepEqual(recipients.sort(), ['dir','sup'], '只通知本船对应督导与航运处人员');
  const notices = workflow.buildTaskNotifications([supervisor,director,unrelated,operator,vesselAccount], vessel, 'ship', {id:'t1',description:'主機異常',isInternalControl:true}, 'task_created', '船舶帳戶');
  assert.equal(notices.length, 2);
  assert.ok(notices.every(item => item.title.includes('內部管控')));
  const movedNotices = workflow.buildTaskNotificationsForVessels([supervisor,director,unrelated,operator,vesselAccount], [vessel2,vessel], 'op', {id:'t1',description:'移船事項',isInternalControl:false}, 'task_updated', '操作員');
  assert.deepEqual(movedNotices.map(item=>item.userId).sort(), ['dir','other','sup'], '跨船更新需通知新舊兩船並去重');
  assert.equal(workflow.canCancelInternalControl(supervisor, vessel), true);
  assert.equal(workflow.canCancelInternalControl(director, vessel), true);
  assert.equal(workflow.canCancelInternalControl(operator, vessel), true, '任何本船分管人員均可取消內控');
  assert.equal(workflow.canCancelInternalControl(unrelated, vessel), false);
  assert.equal(workflow.canCancelInternalControl(vesselAccount, vessel), false);
  assert.equal(workflow.canCancelInternalControl(admin, vessel), true);
  const reminder = '請務必在FLOW系統中申報異常並處理！避免遺漏處理！';
  assert.equal(workflow.FLOW_INTERNAL_CONTROL_REMINDER, reminder, 'FLOW 提醒文字必須逐字一致');
  const task = { id:'t1', vesselId:'v1', isInternalControl:true, isAbnormal:true };
  assert.throws(() => workflow.validateInternalControlTransition(task, {...task,isInternalControl:false}, unrelated, vessel), /無權/);
  const cancelled = workflow.validateInternalControlTransition(task, {...task,isInternalControl:false}, supervisor, vessel);
  assert.equal(Boolean(cancelled.internalControlCancelledAt), true);
  assert.equal(cancelled.internalControlCancelledBy, 'sup');
  const selected = workflow.validateInternalControlTransition({...task,isInternalControl:false}, {...task,isInternalControl:true,isAbnormal:false}, operator, vessel);
  assert.equal(selected.isAbnormal, true, '内控必然属于异常');

  const legacy = createInitialData();
  delete legacy.notifications;
  delete legacy.tasks[0].isInternalControl;
  const normalized = normalizeAppData(legacy);
  assert.deepEqual(normalized.notifications, [], '旧资料自动补空通知集合');
  assert.equal(normalized.tasks[0].isInternalControl, false, '旧事项自动补非内控');
  assert.equal(normalized.settings.rolePermissions.vessel.createTasks, true, '旧权限矩阵自动补船舶角色');
  assert.equal(normalized.settings.rolePermissions.vessel.enterManagement, false);

  const inconsistent = createInitialData();
  const firstVessel = inconsistent.vessels[0];
  const secondVessel = inconsistent.vessels[1];
  inconsistent.users.push({ id:'legacy-vessel', department:'船舶帳戶', name:'舊船舶帳戶', username:'legacy-vessel', role:'vessel', passwordHash:'hash', isActive:true, managedVesselIds:[firstVessel.id,secondVessel.id], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  firstVessel.assignedUserIds.push('legacy-vessel');
  secondVessel.assignedUserIds.push('legacy-vessel');
  const repaired = normalizeAppData(inconsistent);
  const repairedUser = repaired.users.find(user=>user.id==='legacy-vessel');
  assert.equal(repairedUser.managedVesselIds.length, 1, '舊船舶帳戶多船綁定需收斂為一船');
  assert.equal(repaired.vessels.some(item=>item.assignedUserIds.includes('legacy-vessel')), false, '船舶帳戶不得同時殘留在船舶 assignedUserIds');

  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const modalSource = fs.readFileSync(new URL('../src/EditModals.tsx', import.meta.url), 'utf8');
  assert.ok(appSource.includes('canAccessTab(currentUser, k)'), '导航需套用船舶账户页签白名单');
  assert.ok(appSource.includes('buildTaskNotifications'), '事项保存需建立通知');
  assert.ok(appSource.includes('creating&&!canUseVessel(currentUser,candidate.vesselId)'), '最终建立 handler 需再次检查船舶账户单船范围');
  assert.ok(appSource.includes('buildTaskNotificationsForVessels'), '跨船更新需通知新旧两船');
  assert.ok(appSource.includes('deleteTask'), 'App 需有删除事项 handler');
  assert.ok(modalSource.includes('內部管控'), '事项弹窗需有独立内控选项');
  assert.ok(modalSource.includes('FLOW_INTERNAL_CONTROL_REMINDER'), '取消内控需立即显示 FLOW 提醒');
  assert.equal(/DMP-(?:MF|FM)01|dmpFm01/i.test(appSource + modalSource + fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')), false, '本系统不得显示或保存 DMP-MF01／DMP-FM01');
  assert.ok(modalSource.includes('onDelete'), '事项弹窗需提供授权删除入口');
  assert.equal(modalSource.includes('onDelete(draft)'), false, '删除不得使用尚未保存的 modal draft');

  console.log('Vessel account and internal-control workflow contracts passed.');
} finally { await server.close(); }
