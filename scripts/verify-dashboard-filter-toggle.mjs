import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const dashboard=fs.readFileSync('src/Dashboard.tsx','utf8');
const controls=fs.readFileSync('src/VesselFilterControls.tsx','utf8');

const server=await createServer({ root:process.cwd(), server:{ middlewareMode:true }, appType:'custom', logLevel:'silent' });
try {
  const module=await server.ssrLoadModule('/src/vesselDashboardFilters.ts');
  const toggle=module.toggleFilterValue;
  assert.deepEqual(toggle([], '超油'), ['超油'], '第一次點擊船型必須選中');
  assert.deepEqual(toggle(['兩岸油化','超油'], '超油'), ['兩岸油化'], '再次點擊已選船型必須取消');
  assert.deepEqual(toggle(['兩岸油化'], '超油'), ['兩岸油化','超油'], '點擊其他同類船型必須保留原選項並加入多選');
  assert.match(dashboard,/VesselFilterControls/,'看板必須使用共同多選篩選控制');
  assert.match(controls,/aria-pressed=\{filters\.selfManagedOnly\}/,'自管船舶按鈕必須暴露選中語義');
  assert.match(controls,/aria-pressed=\{filters\.shipTypes\.includes\(shipType\)\}/,'船型按鈕必須暴露各自選中語義');
  assert.match(controls,/onClick=\{\(\) => onChange\(emptyVesselFilterState\(\)\)\}/,'全部必須清除所有分組篩選');
  console.log('Dashboard multi-filter toggle contracts passed.');
} finally { await server.close(); }
