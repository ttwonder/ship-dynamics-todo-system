import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const dashboard = read('../src/Dashboard.tsx');
const dashboardRuntime = `${app}\n${dashboard}`;
const management = read('../src/Management.tsx');
const types = read('../src/types.ts');
const seed = read('../src/data/seed.ts');
const html = read('../index.html');
const editorUrl = new URL('../src/EditModals.tsx', import.meta.url);
const editors = existsSync(editorUrl) ? readFileSync(editorUrl, 'utf8') : '';

const chineseTitle = '船舶動態與會議管理系統';
const englishTitle = 'Fleet Activities & Office Meeting Manage System';
assert.ok(app.includes(chineseTitle) && seed.includes(chineseTitle) && html.includes(chineseTitle), '中英文系統標題中的中文名稱必須完整更新');
assert.ok(app.includes(englishTitle), '頁首必須顯示新的英文系統名稱');
assert.ok(!app.includes('已選早會'), '正式 App 不可再顯示「已選早會」');
assert.ok(app.includes('涉會船舶'), '看板、篩選與底部狀態必須使用「涉會船舶」');

assert.ok(app.includes('jumpToTaskList'), '看板指標卡必須共用跳轉到待辦總表的處理器');
assert.ok(dashboardRuntime.includes("onTaskMetric('open')") && dashboardRuntime.includes("onTaskMetric('high')") && dashboardRuntime.includes("onTaskMetric('overdue')"), '未結、急／高關注、已逾期三卡都必須有跳轉入口');
assert.ok(app.includes("priorities: mode === 'high' ? ['急','高'] : []") && app.includes("overdueOnly: mode === 'overdue'"), '三卡跳轉必須套用正確的待辦篩選');
assert.ok(types.includes('overdueOnly: boolean'), '待辦篩選模型必須支援只看逾期');

assert.ok(app.includes('<VesselEditModal') && app.includes('<TaskEditModal'), '正式快速更新與事項編輯必須切到安全的新元件');
assert.ok(editors.includes('function CheckboxMultiPicker'), '必須以 checkbox 多選器取代原生多選清單');
assert.ok(editors.includes('船舶狀態') && editors.includes('涉及部門') && editors.includes('經管／負責人'), '三個多選欄位都必須使用新元件');
assert.ok(!editors.includes('selectedOptions') && !/<select\s+multiple/.test(editors), '正式編輯元件不可再跨 commit 讀 selectedOptions 或使用原生 multiple select');

assert.ok(management.includes('departmentFilter') && management.includes('人員部門篩選'), '人員總清單必須有部門下拉篩選');
console.log('Requested regression contracts passed.');
