import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const controls = fs.readFileSync('src/VesselFilterControls.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

const dashboardMetricRule = styles.match(/\.dashboard-view>\.metric-grid \.metric-card\{([^}]*)\}/)?.[1] || '';
assert.match(dashboardMetricRule, /justify-content:center/, '船隊看板六張統計卡的內容必須全部水平置中');
assert.match(dashboardMetricRule, /text-align:center/, '船隊看板六張統計卡的文字必須全部置中');
assert.doesNotMatch(dashboardMetricRule, /justify-content:start|text-align:left/, '統計卡不得再保留靠左特例');

const typeActiveRule = styles.match(/\.filter-pill-type\.active\{([^}]*)\}/)?.[1] || '';
assert.match(typeActiveRule, /background:#e8f2ff/, '普通船型選中狀態必須使用與自管綠色不同的藍色底');
assert.match(typeActiveRule, /border-color:#4f86d9/, '普通船型選中狀態必須有清楚的藍色邊框');

assert.ok(controls.includes("supervisors.filter(option => option.name.toLocaleLowerCase().includes(normalizedSupervisorQuery))"), '督導搜尋只能依姓名搜尋');
assert.ok(controls.includes('placeholder="搜尋督導姓名..."'), '督導搜尋提示只能提到姓名');
assert.ok(!controls.includes("<small>{option.department || '未指定部門'}</small>"), '督導候選項不得重複顯示「督導」部門文字');
assert.match(controls, /<span className="vessel-supervisor-option-name">\{option\.name\}<\/span>/, '督導候選項必須以單一橫向姓名呈現');
assert.match(styles, /\.vessel-supervisor-options\{[^}]*overflow-x:hidden/, '督導候選清單不得產生水平捲動條');
assert.match(styles, /\.vessel-supervisor-options label\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/, '督導 checkbox 與姓名必須使用穩定的兩欄列排版');

assert.ok(dashboard.includes('className="ship-type-supervisor"'), '每張船卡必須有船型與有效經管人員的共同資訊列');
assert.ok(dashboard.includes('effectiveVesselManagerNames(vessel, users)'), '船卡姓名必須使用全部有效直接經管與已激活代管人員，不得再限制為督導部門');
assert.ok(!dashboard.includes('supervisors.filter(option => assignedSupervisorIds.has(option.id))'), '船卡不得再借用只含督導部門的篩選候選清單');
assert.ok(dashboard.includes("managerNames.join('、') || '-'"), '船卡必須顯示全部有效經管人員姓名，未分管時顯示半形 -');
assert.match(styles, /\.ship-type-supervisor\{[^}]*font-size:13px/, '船型與有效經管人員姓名必須使用一致且放大後的 13px 字級');

console.log('Dashboard metrics, filters, supervisor picker and card metadata presentation contracts passed.');
