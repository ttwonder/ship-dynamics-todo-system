import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const styles = fs.readFileSync('src/styles.css', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

assert.ok(meetings.includes('className="meeting-print print-only"'), '臨會 PDF 必須有獨立列印容器');
assert.ok(meetings.includes("printMode==='meetings'") && meetings.includes("printMode==='register'"), '所選會議及總清單必須各自渲染列印內容');
assert.ok(styles.includes('body.printing-meetings .meeting-print{display:block!important}'), '臨會列印模式必須顯示列印容器');
assert.ok(!styles.includes('body.printing-meetings .container>.print-only{display:none!important}'), '不得以更高權重隱藏臨會列印容器，否則 PDF 會空白');
assert.ok(app.includes('className="print-only app-print-header"'), '一般頁面列印抬頭必須有獨立 class，才能在臨會列印時精準隱藏');
assert.ok(styles.includes('body.printing-meetings .app-print-header{display:none!important}'), '臨會列印時只應隱藏一般頁面抬頭');
assert.match(meetings,/>導出本次會議 PDF</,'详情页必须提供当前会议 PDF 导出按钮');
assert.match(meetings,/printMeetingDetail\(selected\.id\)/,'详情按钮必须明确锁定当前会议 ID');
assert.match(meetings,/printMeetingIds/,'打印集合必须与总清单勾选状态分离，避免详情导出混入其他会议');
assert.match(meetings,/meetingPdfVesselSummary\(meeting,/,'会议 PDF 涉船内容必须使用范围摘要 helper');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const { meetingPdfVesselSummary }=await server.ssrLoadModule('/src/meetingPdf.ts');
  const vessels=[
    {id:'v1',name:'甲轮',shipType:'油轮'},
    {id:'v2',name:'乙轮',shipType:'散货轮'},
  ];
  const base={vessels:['v1','v2'],vesselTypeScopes:[]};
  assert.equal(meetingPdfVesselSummary({...base,vesselScopeMode:'all'},vessels),'全部船舶','全部船舶范围不得逐船展开');
  assert.equal(meetingPdfVesselSummary({...base,vesselScopeMode:'types',vesselTypeScopes:['油轮','散货轮']},vessels),'船舶類型：油轮、散货轮','一类或多类船舶必须直接总结类型');
  assert.equal(meetingPdfVesselSummary({...base,vesselScopeMode:'vessels',vessels:['v1','v2']},vessels),'甲轮、乙轮','逐船选择时保留具体船名');
} finally { await server.close(); }

console.log('Meeting PDF detail, scope summary and print visibility contracts passed.');
