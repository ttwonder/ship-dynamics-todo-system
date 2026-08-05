import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('src/App.tsx','utf8');
const workCenter=fs.readFileSync('src/WorkCenter.tsx','utf8');
const internalPage=fs.readFileSync('src/InternalControlPage.tsx','utf8');
const styles=fs.readFileSync('src/styles.css','utf8');

assert.ok(app.includes("['dashboard','work','internalControl'].includes(k)"),'三個指定導覽需有獨立的未選中漸層判斷');
assert.match(app,/tab!==k&&\['dashboard','work','internalControl'\]\.includes\(k\)\?'gradient-nav-label'/,'漸層class只能套在三個指定導覽的未選中狀態');
assert.match(styles,/\.nav button\.gradient-nav-label:not\(\.active\)\{[^}]*linear-gradient[^}]*background-clip:text[^}]*-webkit-text-fill-color:transparent/,'指定導覽需使用藍綠漸層文字');
assert.ok(workCenter.includes("onOpenInternalControl(item.id)"),'我的待辦內控更新需傳遞案件ID');
assert.match(workCenter,/onClick=\{\(\)=>onOpenInternalControl\(item\.id\)\}>更新<\/button>/,'內控列按鈕需顯示更新');
assert.ok(internalPage.includes('requestedCaseId')&&internalPage.includes('void openCase(item)'),'直接更新必須沿用內控頁既有openCase鎖定流程');

console.log('Navigation gradient and direct internal-control editing contracts passed.');
