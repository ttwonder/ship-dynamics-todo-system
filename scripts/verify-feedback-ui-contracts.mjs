import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const editor = fs.readFileSync('src/EditModals.tsx', 'utf8');
const controlsSource = fs.readFileSync('src/VesselFilterControls.tsx', 'utf8');
const workCenter = fs.readFileSync('src/WorkCenter.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(app.includes('請稍後再嘗試保存。'), '同步未完成提示必須獨立加入稍後重試保存指引');
assert.ok(app.includes('先點擊「同步最新（安全合併）」') && app.includes('同步完成後，再點擊「重新保存」'), '雲端衝突提示必須用白話列出同步後重新保存的順序');
assert.ok(app.includes('直到畫面顯示「已保存到雲端」'), '衝突提示必須要求等待雲端成功確認');
assert.ok(app.includes('請先點擊上方的保存按鈕') && app.includes('看到「已保存到雲端」後再關閉'), '有未保存內容時頁面內必須明確要求先保存、看到成功後才離頁');
assert.ok(!app.includes('多人協作鎖衝突：${error.sectionKey}'), '一般使用者提示不得顯示raw entity key');

assert.match(editor, /!readOnly&&!creating&&canClose&&<button/, '新增要事模式不得顯示標記結案');
assert.ok(editor.includes("creating?'取消並關閉':'取消'"), '新增要事取消按鈕必須標示取消並關閉');
assert.ok(editor.includes("creating?'保存並關閉':'保存變更'"), '新增要事保存按鈕必須標示保存並關閉');

assert.ok(workCenter.includes("className={`work-task-row internal-control-work-row ${canDelete?'':'no-selection-row'}"), '未同步內控待辦必須依真實刪除權限切換有／無勾選框版型');
assert.ok(workCenter.includes('canDelete&&<label className="work-task-select"><input type="checkbox" aria-label={`選取內控'), '具刪除權限者必須能明確勾選未同步內控待辦');
assert.match(styles, /\.work-task-row\.no-selection-row\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/, '無勾選框待辦必須使用正文＋操作兩欄格線');
assert.match(styles, /\.quick-status-bar\{[^}]*grid-template-columns:1fr[^}]*align-items:start/, '加入狀態記錄必須改成上下排列');
assert.match(styles, /\.quick-status-bar \.btn\{[^}]*justify-self:start/, '加入狀態記錄按鈕必須位於輸入框下方靠左');

assert.ok(controlsSource.includes('vessel-supervisor-option-name'), '督導選項必須有姓名文字節點');
assert.match(styles, /\.vessel-supervisor-option-name\{[^}]*color:var\(--ink\)/, '督導姓名必須明確使用可見文字顏色');
assert.match(styles, /\.vessel-supervisor-options input\[type="checkbox"\]\{[^}]*width:18px/, '督導checkbox不得沿用全寬input規則而把姓名欄壓成0px');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { default: VesselFilterControls } = await server.ssrLoadModule('/src/VesselFilterControls.tsx');
  const html = renderToStaticMarkup(React.createElement(VesselFilterControls, {
    filters: { selfManagedOnly:false, shipTypes:[], attentionGroups:[], meetingOnly:false, supervisorIds:[] },
    shipTypes: [],
    supervisors: [{ id:'supervisor-a', name:'王小明', department:'航運督導' }],
    onChange: () => {},
  }));
  assert.match(html, /vessel-supervisor-option-name[^>]*>王小明</, '督導多選展開內容必須實際輸出姓名，而非只有空白checkbox');
} finally {
  await server.close();
}

console.log('Nine-item UI feedback contracts passed.');
