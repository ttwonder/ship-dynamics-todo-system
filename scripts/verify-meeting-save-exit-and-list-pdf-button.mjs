import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const normalizedApp = fs.readFileSync('src/NormalizedApp.tsx', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');

assert.match(
  app,
  /className="btn small primary"[^>]*onClick=\{onPrint\}[^>]*>導出 PDF/,
  '待辦總表與已結案共用的導出 PDF 按鈕尺寸必須與前方 small 按鈕一致',
);
assert.match(
  normalizedApp,
  /className="btn small primary"[^>]*onClick=\{\(\)=>window\.print\(\)\}[^>]*>導出 PDF/,
  'normalized 待辦／已結案導出 PDF 按鈕也必須維持相同尺寸',
);

assert.match(meetings, /const editBaselineRef = useRef<MeetingDraft \| null>\(null\)/, '進入臨會編輯時必須保存可還原的原始 draft');
assert.match(meetings, /const saveReachedLocalStateRef = useRef\(false\)/, '必須追蹤失敗保存是否已進入本機待同步資料');
assert.match(meetings, /const cancelEditing = async \(\) =>/, '臨會需提供真正的取消編輯流程');
assert.match(meetings, /取消修改退出編輯/, '臨會編輯器需顯示指定的取消按鈕文字');
assert.match(meetings, /保存並退出編輯/, '既有臨會保存按鈕需明確標示保存後退出編輯');
assert.match(meetings, /建立並退出編輯/, '新增臨會保存按鈕需明確標示建立後退出編輯');
assert.match(meetings, /setDraft\(structuredClone\(baseline\)\)/, '取消既有臨會修改時必須還原進入編輯前的 draft');
assert.match(meetings, /saveReachedLocalStateRef\.current[\s\S]*為避免誤刪/, '已進入本機待同步的保存不得被取消流程直接丟棄');

const durableIndex = meetings.indexOf("const durable=await runDurableRelatedMutation(sectionKey,'臨會/專題保存',apply)");
const durableFailureIndex = meetings.indexOf('if(!durable||!applied||!persistedDraft)', durableIndex);
const releaseAfterSaveIndex = meetings.indexOf('const released=await releaseItemLease(sectionKey)', durableFailureIndex);
assert.ok(durableIndex >= 0 && durableFailureIndex > durableIndex && releaseAfterSaveIndex > durableFailureIndex, '只有雲端確認保存成功後才可釋放主項目 lease 並退出');
assert.doesNotMatch(meetings, /if\(wasCreating\)await releaseItemLease\(sectionKey\)/, '修改既有臨會不得因非新增流程而漏掉 lease 釋放');
assert.match(meetings, /if\(applied\)saveReachedLocalStateRef\.current=true/, '雲端未確認但已套用本機資料時必須保留安全旗標與draft');

console.log('Meeting save/exit and list PDF button contracts passed.');
