import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync('src/MorningWorkspace.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

assert.match(workspace, /liveMorningWindow\(data\.agendaReports\)/, '工作台必須從最後一次人工成功保存切點建立即時區間');
assert.match(workspace, /下一場早會議題（累積中）/, '同日首次成功保存後的新增／修改內容不得繼續標成今日早會');
assert.match(workspace, /classifyMorningAgenda\(/,'工作台要事與內控必須共用區間分類器');
assert.match(workspace, /morningBaselineSnapshot\(data\.agendaReports, morningWindow\)/, '工作台必須讀取上一人工切點快照作實質內容比較');
assert.match(workspace, /baselineTasks: morningBaseline\?\.tasks/, '工作台分類器必須收到上一切點要事 baseline');
assert.doesNotMatch(workspace, /taskReportDate\(task\) === todayKey/,'今日早會不得再按曆日 reportDate 分類');
assert.match(workspace, /todayInternalControlCases/,'今日區間必須顯示內控案件');
assert.match(workspace, /historyInternalControlCases/,'歷史未結必須顯示未結內控案件');
assert.match(workspace, /本期已結/,'區間內結案的要事或內控必須保留並標示');
assert.match(workspace, /onOpenInternalControl/,'內控議題必須可以直接打開 canonical 內控案件');
assert.match(app, /onOpenInternalControl=\{caseId=>\{if\(caseId\)setRequestedInternalControlCaseId\(caseId\);navigateToTab\('internalControl'\);\}\}/,'正式 App 必須把早會內控卡接到既有協作鎖編輯入口');
assert.match(app, /internalControlCases:reportPreviewInternalControlCases/,'歷史早會預覽必須使用授權後的凍結內控快照');
assert.doesNotMatch(app, /reportPreviewSnapshot\?[\s\S]{0,600}internalControlCases:\[\]/,'歷史快照授權不得把 canonical 內控關係硬編為空');

console.log('Morning workspace cutoff UI and frozen internal-control wiring contracts passed.');
