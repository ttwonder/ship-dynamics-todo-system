import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

const header = app.slice(app.indexOf('<header className="topbar no-print">'), app.indexOf('</header>') + '</header>'.length);
const saveStripStart = app.indexOf('<div className={`cloud-strip save-status-strip');
const saveStripEnd = app.indexOf('\n', saveStripStart);
const saveStrip = app.slice(saveStripStart, saveStripEnd);
const recoveryButtons = app.match(/>修復此瀏覽器<\/button>/g) || [];

assert.equal(recoveryButtons.length, 1, '「修復此瀏覽器」只能保留一個可見入口');
assert.doesNotMatch(header, /browser-recovery-entry/, '修復入口不得再擠壓頁首身份區');
assert.ok(saveStrip.includes('browser-recovery-entry'), '修復入口必須移到保存狀態列');
assert.ok(saveStrip.indexOf('browser-recovery-entry') < saveStrip.indexOf('onClick={syncLatest}'), '修復入口必須位於「同步最新」左側');
assert.ok(saveStrip.includes('onClick={()=>openBrowserRecovery()}') && app.includes('setBrowserRecoveryAdvanced(true)') && saveStrip.includes("staleBrowserRecoveryOffered?'開啟瀏覽器修復與完整本機重設'"), '移動後修復入口仍須連接可見的進階修復視窗，並保留 stale 狀態提示');

assert.match(app, /<nav className="nav topbar-primary-nav">/, '主導覽必須使用專用不裁切樣式掛點');
assert.match(styles, /\.topbar-primary-nav\{[^}]*min-width:0[^}]*\}/, '主導覽必須允許在頁首彈性區正確收縮');
assert.match(styles, /@media\(min-width:1421px\)\{[^}]*\.topbar-primary-nav[^}]*scrollbar-width:none/s, '寬桌面不得顯示截斷畫面的導覽捲動條');
assert.match(styles, /@media\(min-width:901px\) and \(max-width:1420px\)\{[^}]*\.topbar-inner\{[^}]*flex-wrap:wrap/s, '較窄桌面必須將導覽移到完整下一列而不是裁切');

assert.ok(dashboard.includes('<input className="dashboard-search"') && dashboard.includes('placeholder="搜尋船名、港口、貨物、動態..."'), '看板搜尋框必須使用專用寬度樣式');
assert.match(styles, /\.dashboard-toolbar\{display:grid;grid-template-columns:minmax\(180px,\.5fr\) minmax\(0,3\.5fr\)/, '桌面搜尋欄必須縮為原本約一半寬度');
assert.match(styles, /@media\(max-width:1050px\)\{\.dashboard-toolbar\{grid-template-columns:1fr\}/, '較窄畫面必須維持單欄搜尋與篩選配置');

console.log('Dashboard shell layout contracts passed.');
