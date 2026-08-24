import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const dashboardSource = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const detailSource = fs.readFileSync('src/VesselDetailPage.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.equal((detailSource.match(/onClick=\{onBack\}>← 回到船隊看板<\/button>/g) || []).length, 2, '單船詳情頂部與最底部必須各有一個共用 onBack 的返回按鈕');
assert.ok(detailSource.includes('className="vessel-detail-bottom no-print"') && detailSource.includes('vessel-detail-back-bottom'), '底部返回按鈕必須有獨立且可驗證的頁尾容器');
assert.ok(dashboardSource.includes("import { dashboardVesselCardId } from './dashboardVesselReturn';"), '船隊看板必須共用穩定的船卡目標 ID helper');
assert.ok(dashboardSource.includes('id={dashboardVesselCardId(vessel.id)}') && dashboardSource.includes('data-dashboard-vessel-id={vessel.id}'), '每張船卡必須以原始 vessel.id 建立可返回定位的唯一目標');
assert.ok(appSource.includes("import { scrollToDashboardVesselCard } from './dashboardVesselReturn';"), 'App 返回流程必須共用已測試的船卡定位 helper');
assert.ok(appSource.includes("const dashboardReturnVesselIdRef=useRef('');"), '返回流程必須在詳情卸載前保留原始 vessel.id');
assert.match(appSource, /dashboardReturnVesselIdRef\.current=selectedVesselDetailId;[\s\S]{0,120}setSelectedVesselDetailId\(''\)/, '返回時必須先保存船卡目標，再切回船隊看板');
assert.match(appSource, /if\(tab!=='dashboard'\|\|selectedVesselDetailId\)return;[\s\S]{0,260}scrollToDashboardVesselCard\(vesselId\);[\s\S]{0,100}dashboardReturnVesselIdRef\.current='';/, '看板 DOM 掛載後的 effect 必須立即定位並清除單次返回目標');
assert.doesNotMatch(appSource, /if\(tab!=='dashboard'\|\|selectedVesselDetailId\)return;[\s\S]{0,260}requestAnimationFrame/, '返回定位不得依賴背景分頁可能暫停的 requestAnimationFrame');
assert.match(styles, /\.vessel-detail-bottom\{[^}]*display:flex[^}]*justify-content:flex-start/, '底部返回按鈕必須形成清楚的獨立操作列');
assert.ok(styles.includes('scroll-margin-top:88px'), '返回定位必須預留固定頁首高度，避免船卡標題被遮住');
assert.ok(fs.existsSync('src/dashboardVesselReturn.ts'), '缺少船隊看板返回定位 helper');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { default: VesselDetailPage } = await server.ssrLoadModule('/src/VesselDetailPage.tsx');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const returnModule = await server.ssrLoadModule('/src/dashboardVesselReturn.ts');
  const data = createInitialData();
  const vessel = data.vessels[0];
  const currentUser = data.users[0];
  const noop = () => undefined;
  const markup = renderToStaticMarkup(React.createElement(VesselDetailPage, {
    vessel,
    data: { ...data, tasks: [], internalControlCases: [] },
    currentUser,
    onBack: noop,
    onEditVessel: noop,
    onAddTask: noop,
    onEditTask: noop,
    onOpenInternalControl: noop,
    canEditVessel: false,
    canCreateTasks: false,
    canEditTasks: false,
    canViewInternalControl: false,
  }));
  assert.equal((markup.match(/回到船隊看板/g) || []).length, 2, '正式單船詳情輸出必須同時渲染頂部與底部返回按鈕');

  const calls = [];
  const target = { scrollIntoView: options => calls.push(options) };
  const vesselId = 'vessel:#測試/1';
  const expectedId = returnModule.dashboardVesselCardId(vesselId);
  const fakeDocument = { getElementById: id => id === expectedId ? target : null };
  assert.equal(returnModule.scrollToDashboardVesselCard(vesselId, fakeDocument), true, '存在目標船卡時必須完成定位');
  assert.deepEqual(calls, [{ behavior: 'auto', block: 'start', inline: 'nearest' }], '返回定位必須把船卡頂部放到可繼續操作的位置');
  assert.equal(returnModule.scrollToDashboardVesselCard('missing', fakeDocument), false, '船卡已不可見時必須安全返回看板，不得拋錯');
} finally {
  await server.close();
}

console.log('PASS vessel detail return-to-card navigation contract');
