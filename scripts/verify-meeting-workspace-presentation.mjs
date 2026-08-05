import assert from 'node:assert/strict';
import fs from 'node:fs';

const morning = fs.readFileSync('src/MorningWorkspace.tsx', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(morning.includes('morning-supervisor-filter'), '早會中央控制列必須保留獨立版面 class');
assert.match(styles, /\.vessel-rail-tools \.vessel-filter-pills \.filter-pill\{[^}]*font-size:12px/, '早會左側船型與分類文字必須放大至看板同級 12px');
assert.match(styles, /\.morning-supervisor-filter\{[^}]*grid-template-columns:minmax\(170px,1fr\) minmax\(170px,1fr\) max-content/, '早會桌面中央控制列必須是督導、船舶、新增待辦三欄同列');
assert.match(styles, /\.morning-supervisor-filter>select\{[^}]*grid-column:2[^}]*grid-row:1/, '早會船舶選擇必須位於同列第二欄');
assert.match(styles, /\.morning-supervisor-filter>\.btn\{[^}]*grid-column:3[^}]*grid-row:1/, '新增待辦按鈕必須位於同列第三欄');
assert.match(styles, /\.morning-workspace\{[^}]*height:auto[^}]*min-height:0[^}]*align-items:stretch/, '早會工作區必須由完整船舶清單自然撐高，三欄維持相同高度');
assert.match(styles, /\.temporary-meeting-workspace\{[^}]*height:auto[^}]*min-height:0[^}]*max-height:none[^}]*align-items:start/, '臨會／專題工作區必須使用自然頁面高度');
assert.match(styles, /\.morning-workspace>\.meeting-column,\.temporary-meeting-workspace>\.meeting-column\{[^}]*height:auto[^}]*min-height:0[^}]*max-height:none/, '早會與臨會欄體不得再鎖定viewport高度');
assert.match(styles, /\.morning-workspace \.column-scroll,\.temporary-meeting-workspace \.column-scroll\{[^}]*max-height:none[^}]*overflow:visible/, '早會與臨會主內容不得使用欄內上下滾動條');
assert.doesNotMatch(styles, /\.(?:morning-workspace|temporary-meeting-workspace)\{[^}]*height:calc\(100dvh/, '兩個工作區不得再以動態viewport鎖定高度');
assert.match(styles, /@media\(max-width:900px\)\{[^}]*\.morning-workspace,\.temporary-meeting-workspace\{height:auto;min-height:0/, '窄螢幕工作區必須自然回到自動高度');

assert.ok(meetings.includes('<th className="meeting-register-subject">會議主題</th>'), '總清單會議主題欄必須有專用樣式 class');
assert.ok(meetings.includes('<td className="meeting-register-subject"><b>{meeting.subject}</b>'), '總清單主題與摘要內容必須使用專用內容 class');
assert.match(styles, /\.meeting-register-table th\{[^}]*font-size:13px/, '總清單表頭字級必須放大');
assert.match(styles, /\.meeting-register-table td\{[^}]*font-size:13px[^}]*white-space:normal/, '總清單各欄內容必須放大並允許換行');
assert.match(styles, /\.meeting-register-subject>b\{[^}]*font-size:15px/, '會議主題名稱必須比一般欄位更大');
assert.match(styles, /\.meeting-register-subject \.rich-text-content\{[^}]*font-size:14px/, '會議主題摘要與多行內容必須明顯放大');
assert.doesNotMatch(styles, /\.meeting-register-filters[^}]*font-size:1[34]px/, '本次不得連帶放大上方搜尋篩選列');

console.log('Morning and temporary-meeting natural-height, controls and register typography contracts passed.');
