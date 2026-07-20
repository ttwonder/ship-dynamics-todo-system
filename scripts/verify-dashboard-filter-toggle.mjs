import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const dashboard=fs.readFileSync('src/Dashboard.tsx','utf8');

const server=await createServer({ root:process.cwd(), server:{ middlewareMode:true }, appType:'custom', logLevel:'silent' });
try {
  const module=await server.ssrLoadModule('/src/dashboardFilters.ts');
  const toggle=module.toggleDashboardFilter;
  assert.equal(toggle('bulk','bulk'),'all','再次点击散货必须取消选中');
  assert.equal(toggle('tanker','tanker'),'all','再次点击油轮必须取消选中');
  assert.equal(toggle('mine','mine'),'all','再次点击自管船舶必须取消选中');
  assert.equal(toggle('high','high'),'all','再次点击急／高关注必须取消选中');
  assert.equal(toggle('selected','selected'),'all','再次点击选入会议必须取消选中');
  assert.equal(toggle('bulk','high'),'high','点击其他筛选必须切换到该筛选');
  assert.equal(toggle('all','all'),'all','全部是清除筛选状态，不可切成空白结果');
  assert.match(dashboard,/toggleDashboardFilter\(current, key\)/,'看板按钮必须调用统一切换逻辑');
  assert.match(dashboard,/aria-pressed=\{fleetFilter === key\}/,'按钮必须暴露选中语义');
  console.log('Dashboard filter toggle contracts passed.');
} finally { await server.close(); }
