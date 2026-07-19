import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync('src/styles.css', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

assert.ok(meetings.includes('className="meeting-print print-only"'), '臨會 PDF 必須有獨立列印容器');
assert.ok(meetings.includes("printMode==='meetings'") && meetings.includes("printMode==='register'"), '所選會議及總清單必須各自渲染列印內容');
assert.ok(styles.includes('body.printing-meetings .meeting-print{display:block!important}'), '臨會列印模式必須顯示列印容器');
assert.ok(!styles.includes('body.printing-meetings .container>.print-only{display:none!important}'), '不得以更高權重隱藏臨會列印容器，否則 PDF 會空白');
assert.ok(app.includes('className="print-only app-print-header"'), '一般頁面列印抬頭必須有獨立 class，才能在臨會列印時精準隱藏');
assert.ok(styles.includes('body.printing-meetings .app-print-header{display:none!important}'), '臨會列印時只應隱藏一般頁面抬頭');

console.log('Meeting PDF print visibility contracts passed.');
