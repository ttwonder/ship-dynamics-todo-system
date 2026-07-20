import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const dashboard=fs.readFileSync('src/Dashboard.tsx','utf8');
const picker=fs.readFileSync('src/QuickMorningPicker.tsx','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');

assert.match(dashboard,/QuickMorningPicker/,'船舶看板必须装载快速入会下拉');
assert.match(picker,/快速入會/,'下拉入口必须清楚标示快速入会');
assert.match(picker,/全部船舶/,'必须支持全部船舶');
assert.match(picker,/按船舶類型/,'必须支持多选船舶分类');
assert.match(picker,/逐船選擇/,'必须支持多选单船');
assert.match(picker,/清除入會船舶/,'必须提供清除入会船舶操作');
assert.match(picker,/選中船舶入早會/,'必须提供直接进入早会操作');
assert.match(picker,/aria-expanded/,'下拉触发器必须暴露展开状态');
assert.match(picker,/aria-pressed/,'类型和单船选项必须暴露多选状态');
assert.match(app,/onStartMeeting=\{\(requestedIds/,'App 必须接受快速入口显式船舶 ID，避免旧状态覆盖');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const { resolveQuickMorningSelection }=await server.ssrLoadModule('/src/morningSelection.ts');
  const vessels=[
    {id:'v1',shipType:'油轮'},
    {id:'v2',shipType:'散货轮'},
    {id:'v3',shipType:'油轮'},
  ];
  assert.deepEqual(resolveQuickMorningSelection('all',[],[],vessels),['v1','v2','v3'],'全部模式必须选中全部可见船舶');
  assert.deepEqual(resolveQuickMorningSelection('types',['油轮','散货轮'],[],vessels),['v1','v2','v3'],'船型模式必须支持多类别并去重');
  assert.deepEqual(resolveQuickMorningSelection('types',['油轮'],[],vessels),['v1','v3'],'单一船型只选择该类型船舶');
  assert.deepEqual(resolveQuickMorningSelection('vessels',[],['v3','missing','v1','v1'],vessels),['v1','v3'],'逐船模式必须过滤不可见 ID、去重并保持看板顺序');
  assert.deepEqual(resolveQuickMorningSelection('vessels',[],[],vessels),[],'清除后不得残留入会船舶');
} finally { await server.close(); }

console.log('Quick morning meeting selection and dashboard integration contracts passed.');
