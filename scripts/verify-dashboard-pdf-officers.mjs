import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(dashboard.includes('className="ship-cargo-items"'), '貨名貨量必須使用可在同一行流動並自動換行的容器');
assert.ok(dashboard.includes('<small>狀態補充</small>'), '船舶卡片欄位名稱必須改為「狀態補充」');
assert.ok(dashboard.includes('vessel.note.statusSupplement'), '狀態補充卡片必須顯示自由輸入內容');
assert.ok(styles.includes('.dashboard-view>.metric-grid .metric-card'), '看板統計卡必須有局部緊湊樣式，不得影響全站統計卡');
assert.ok(styles.includes('.dashboard-view>.metric-grid .metric-link'), '三張可點擊統計卡必須有獨立置中樣式');
assert.ok(styles.includes('.ship-cargo-items'), '貨名貨量必須有動態換行樣式');
assert.ok(styles.includes('.ship-summary-content'), '重要摘要內文必須有加大字級樣式');
assert.ok(styles.includes('.weekly-attention button'), '一週作業標籤必須有放大後的按鈕字級');
assert.ok(styles.includes('.morning-supervisor-filter{display:grid;grid-template-columns:minmax(0,1fr) 210px'), '早會中央標題與督導／船舶控制必須使用兩列網格，避免標題被擠窄');

assert.ok(app.includes('function VesselReportNameCell'), 'PDF 必須使用統一船名／船員姓名儲存格，避免有要事與無要事列顯示不一致');
assert.ok(app.includes('className="report-vessel-officers"'), 'PDF 船名下方必須有四位船員姓名區塊');
for (const [label, field] of [['船長', 'captain'], ['大副', 'chiefOfficer'], ['輪機長', 'chiefEngineer'], ['大管輪', 'firstEngineer']]) {
  assert.ok(app.includes(`<b>${label}：</b>`), `PDF 必須顯示${label}標籤`);
  assert.ok(app.includes(`v.note.${field}`), `PDF 必須讀取同船 ${field} 欄位`);
}
assert.ok(styles.includes('.report-vessel-officers'), 'PDF 四位姓名必須有適合 A4 橫向的換行與字級樣式');
assert.ok(app.includes('<table className="vessel-report-table">'), 'PDF 船舶主表必須有專用 class，避免姓名欄寬影響後續表格');
assert.ok(styles.includes('.report-paper>.vessel-report-table>thead th:first-child'), 'PDF 必須只調整船舶主表第一欄寬度，避免姓名擠壓動態資料');

console.log('Dashboard compact layout and PDF officer display contracts passed.');
