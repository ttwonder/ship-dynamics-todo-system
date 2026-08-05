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

const viewMeetingIndex = meetings.indexOf('const viewMeeting = (meeting: TemporaryMeeting) =>');
const beginEditingIndex = meetings.indexOf('const beginEditing = async (meeting: TemporaryMeeting) =>');
const startNewIndex = meetings.indexOf('const startNew = async () =>');
assert.ok(viewMeetingIndex >= 0 && beginEditingIndex > viewMeetingIndex && startNewIndex > beginEditingIndex, '查看會議與取得編輯權必須是兩個獨立流程');
const viewMeetingSource = meetings.slice(viewMeetingIndex, beginEditingIndex);
const beginEditingSource = meetings.slice(beginEditingIndex, startNewIndex);
assert.doesNotMatch(viewMeetingSource, /claimItemLease/, '點擊會議只可唯讀查看，不得自動取得 lease');
assert.match(beginEditingSource, /claimItemLease\(meetingEditLockKey\(meeting\.id\)/, '只有取得編輯權流程才可申請會議 lease');
assert.match(meetings, /onClick=\{\(\) => viewMeeting\(meeting\)\}>進入詳情/, '總清單進入詳情必須只切換唯讀檢視');
assert.match(meetings, /onClick=\{\(\) => viewMeeting\(meeting\)\}/, '左側會議選取必須只切換唯讀檢視');
assert.match(meetings, /onClick=\{\(\)=>void beginEditing\(selected\)\}>取得編輯權/, '必須由明確的取得編輯權按鈕開始編輯');
assert.doesNotMatch(meetings, /selectMeeting/, '不得再以同一個選取函式同時查看並取得編輯權');

const durableIndex = meetings.indexOf("const durable=await runDurableRelatedMutation(sectionKey,'臨會/專題保存',apply)");
const durableFailureIndex = meetings.indexOf('if(!durable||!applied||!persistedDraft)', durableIndex);
const releaseAfterSaveIndex = meetings.indexOf('const released=await releaseItemLease(sectionKey)', durableFailureIndex);
assert.ok(durableIndex >= 0 && durableFailureIndex > durableIndex && releaseAfterSaveIndex > durableFailureIndex, '只有雲端確認保存成功後才可釋放主項目 lease 並退出');
assert.doesNotMatch(meetings, /if\(wasCreating\)await releaseItemLease\(sectionKey\)/, '修改既有臨會不得因非新增流程而漏掉 lease 釋放');
assert.match(meetings, /if\(applied\)saveReachedLocalStateRef\.current=true/, '雲端未確認但已套用本機資料時必須保留安全旗標與draft');

console.log('Meeting save/exit and list PDF button contracts passed.');
