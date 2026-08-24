import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const dashboard = read('src/Dashboard.tsx');
const morning = read('src/MorningWorkspace.tsx');
const summary = fs.existsSync('src/VesselImportantSummary.tsx') ? read('src/VesselImportantSummary.tsx') : '';
const styles = read('src/styles.css');
const app = read('src/App.tsx');
const detail = read('src/VesselDetailPage.tsx');
const edit = read('src/EditModals.tsx');
const batch = read('src/BatchManagedVesselModal.tsx');
const normalized = read('src/NormalizedApp.tsx');
const types = read('src/types.ts');
const compactSummary = summary.slice(summary.indexOf('if (compact)'), summary.indexOf('return <div className="ship-summary"'));

assert.match(dashboard, /<VesselImportantSummary/, '船舶看板須使用共用重要摘要元件');
assert.match(morning, /<VesselImportantSummary[^>]*compact/, '早會左欄須使用同一摘要元件的緊湊模式');
assert.match(summary, /className="ship-summary-title"/, '摘要標題須有可直排的獨立樣式');
assert.match(summary, /manual-remark-summary/, '人工備註須有獨立高對比樣式');
assert.doesNotMatch(compactSummary, /<RichTextContent/, '早會左欄整卡為 button，compact 摘要不得在其中渲染 div 富文字內容');
assert.match(compactSummary, /richTextToPlainText\(task\.description\)/, 'compact 摘要須以已消毒純文字 span 呈現要事內容');
assert.match(styles, /\.ship-cargo\{[^}]*height:32px;[^}]*min-height:32px;[^}]*max-height:32px;[^}]*overflow-y:auto/, '貨名貨量須固定 32px 並垂直捲動');
assert.match(styles, /\.ship-summary\{[^}]*height:160px;[^}]*min-height:160px/, '桌面重要摘要須固定 160px');
assert.match(styles, /\.ship-summary-title\{[^}]*writing-mode:vertical-rl/, '重要摘要標題須直向排列');
assert.match(styles, /\.manual-remark-summary\{[^}]*font-size:14px;[^}]*font-weight:900;[^}]*color:#111/, '人工備註須與其他摘要正文統一為14px，並保留粗黑強調');
assert.match(styles, /\.ship-card>\.ship-summary\{[^}]*margin-top:auto/, '船卡剩餘高度必須留在摘要上方，使各卡摘要下緣對齊');
assert.match(styles, /\.ship-card-foot\{[^}]*margin-top:0/, '摘要與卡片底部操作列之間不得吸收不定高度空白');
assert.match(styles, /\.ship-summary\.morning-vessel-summary\{[^}]*flex-basis:112px;[^}]*height:112px;[^}]*min-height:112px;[^}]*overflow:clip/, '早會左欄摘要須放大為112px，外框裁切且不得建立第二條滾動條');
assert.equal((styles.match(/\.ship-summary\.morning-vessel-summary\{/g) || []).length, 1, '早會摘要外框只能有一個權威樣式規則，避免互相覆寫後重現雙滾動');
assert.match(styles, /\.morning-vessel-summary \.ship-summary-content\{[^}]*height:100%;[^}]*max-height:none;[^}]*font-size:14px;[^}]*overflow-y:auto;[^}]*scrollbar-gutter:auto/, '早會摘要只允許正文層單一捲動，並統一使用14px正文');
assert.match(styles, /\.mini-ship-head\{[^}]*justify-content:flex-start/, '早會左欄船名列必須從左側開始排列');
assert.match(styles, /\.mini-ship-head>b\{[^}]*flex:1[^}]*text-align:left/, '勾選框後的船名必須左對齊，狀態徽章才留在右側');

for (const [name, source] of [['Dashboard',dashboard],['MorningWorkspace',morning],['VesselDetailPage',detail],['EditModals',edit],['BatchManagedVesselModal',batch],['NormalizedApp',normalized]]) {
  assert.doesNotMatch(source, /(?:速度|航速)[^<\n]{0,30}<input/, `${name} 不得再呈現人工船速輸入`);
}
assert.doesNotMatch(dashboard, /speedKnots|\bkn\b/, '船舶看板不得顯示船速');
assert.doesNotMatch(morning, /speedKnots|\bkn\b/, '早會工作台不得顯示船速');
assert.doesNotMatch(detail, /speedKnots|\bkn\b/, '單船詳情不得顯示船速');
assert.doesNotMatch(app.match(/function vesselReportNavigation[\s\S]*?function VesselReportNameCell/)?.[0] || '', /speedKnots|\bkn\b/, '正式早會 PDF 不得顯示船速');
assert.match(edit, /船速資料接口保留，待 AIS 接入後再啟用/, '快速更新須清楚說明船速僅保留資料接口，避免誤稱目前仍可手動輸入');
assert.doesNotMatch(edit, /位置、速度／航行狀態[\s\S]{0,80}目前欄位同時支援手動修改/, '隱藏船速後不得仍宣稱速度欄位可手動修改');
assert.match(types, /speedKnots:\s*number/, '船速資料模型必須保留供日後 AIS 使用');

console.log('Shared vessel summary, compact cargo, scroll layout and hidden-speed contracts passed.');
