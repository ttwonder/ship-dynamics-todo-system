import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const styles = fs.readFileSync('src/styles.css', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

assert.ok(meetings.includes('className="meeting-print print-only"'), '臨會 PDF 必須有獨立列印容器');
assert.ok(meetings.includes('className="meeting-print print-only"'), '臨會 PDF 必須有獨立列印容器');
assert.ok(meetings.includes('printing-meeting-detail') && meetings.includes('printing-meeting-register'), '臨會詳情與臨會總清單列印必須分離 print mode，避免互相影響');
assert.ok(meetings.includes('meeting-print-section card-like') && meetings.includes('meeting-print-status-history'), '臨會詳情 PDF 必須使用接近詳情工作區的卡片式內容區塊與狀態歷程');
assert.ok(styles.includes('body.printing-meetings .meeting-print{display:block!important}'), '臨會列印模式必須顯示列印容器');
assert.ok(styles.includes('@page meeting-detail') && styles.includes('size:A4 portrait'), '臨會詳情 PDF 必須使用 A4 直式頁面');
assert.ok(styles.includes('@page meeting-register') && styles.includes('size:A4 landscape'), '臨會總清單 PDF 必須維持 A4 橫式頁面');
assert.ok(styles.includes('body.printing-meeting-detail .meeting-print-page') && styles.includes('page:meeting-detail'), '臨會詳情列印樣式需只套用於詳情頁');
assert.ok(styles.includes('body.printing-meeting-register .meeting-print-register') && styles.includes('page:meeting-register'), '臨會總清單列印樣式需只套用於總清單');
assert.ok(!styles.includes('body.printing-meetings .container>.print-only{display:none!important}'), '不得以更高權重隱藏臨會列印容器，否則 PDF 會空白');
assert.ok(app.includes('className="print-only app-print-header"'), '一般頁面列印抬頭必須有獨立 class，才能在臨會列印時精準隱藏');
assert.ok(styles.includes('body.printing-meetings .app-print-header{display:none!important}'), '臨會列印時只應隱藏一般頁面抬頭');
assert.ok(styles.includes('body.printing-meetings>:not(#root){display:none!important}'), '臨會列印時必須排除外掛注入到 body 的兄弟節點，避免產生預設橫式空白頁');
assert.match(meetings,/>導出本次會議 PDF</,'详情页必须提供当前会议 PDF 导出按钮');
assert.match(meetings,/printMeetingDetail\(selected\.id\)/,'详情按钮必须明确锁定当前会议 ID');
assert.match(meetings,/printMeetingIds/,'打印集合必须与总清单勾选状态分离，避免详情导出混入其他会议');
assert.match(meetings,/meetingPdfVesselSummary\(meeting,/,'会议 PDF 涉船内容必须使用范围摘要 helper');

const registerPrintStart=meetings.indexOf("{printMode==='register'&&<article");
const registerPrintEnd=meetings.indexOf('</article>}',registerPrintStart);
assert.ok(registerPrintStart>=0&&registerPrintEnd>registerPrintStart,'未完成／已完成清單 PDF 必須有獨立 register print artifact');
const registerPrintMarkup=meetings.slice(registerPrintStart,registerPrintEnd);
assert.ok(registerPrintMarkup.includes('registerPrintMeetings.map')&&!registerPrintMarkup.includes('printableMeetings.map')&&!registerPrintMarkup.includes('meeting-print-page'),'清單 PDF 只能輸出目前未完成／已完成清單列，不得混入逐場會議詳情');
assert.ok(registerPrintMarkup.includes('<th>召開日期</th><th>狀態</th><th>會議主題</th><th>會議範圍</th><th>船舶</th><th>部門</th><th>追蹤窗口／負責人</th><th>待辦</th><th>期限</th>'),'清單 PDF 欄位與順序必須對齊頁面清單');
const orderedPrintColumns=['date','status','subject','scope','vessels','department','people','tasks','deadline'];
const columnPositions=orderedPrintColumns.map(name=>registerPrintMarkup.indexOf(`className="meeting-print-col-${name}"`));
assert.ok(columnPositions.every(position=>position>=0)&&columnPositions.every((position,index)=>index===0||position>columnPositions[index-1]),'清單 PDF 必須依頁面欄位順序宣告語意化 colgroup');
const meetingRegisterWidth=name=>{
  const match=styles.match(new RegExp(`\\.meeting-print-register \\.meeting-print-col-${name}\\{width:(\\d+)%\\}`));
  assert.ok(match,`清單 PDF 必須指定 ${name} 欄寬`);
  return Number(match[1]);
};
const meetingRegisterWidths=Object.fromEntries(orderedPrintColumns.map(name=>[name,meetingRegisterWidth(name)]));
assert.equal(Object.values(meetingRegisterWidths).reduce((sum,width)=>sum+width,0),100,'清單 PDF 欄寬總和必須為 100%');
assert.ok(meetingRegisterWidths.subject>Math.max(...orderedPrintColumns.filter(name=>name!=='subject').map(name=>meetingRegisterWidths[name])),'會議主題必須是清單 PDF 唯一最寬欄位');
assert.ok(meetingRegisterWidths.people>meetingRegisterWidths.vessels&&meetingRegisterWidths.vessels>meetingRegisterWidths.status,'追蹤人員、船舶及短內容欄位必須依資訊量合理分級');
assert.ok(styles.includes('.meeting-print-register table{width:100%;border-collapse:collapse;margin-top:12px;table-layout:fixed}'),'清單 PDF 必須使用固定表格布局落實欄寬比例');
assert.match(styles,/body\.printing-meeting-detail \.meeting-print-section \.rich-text-content\{[^}]*white-space:pre-wrap/,'單場會議 PDF 必須保留會議內文原有的換行與縮排');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const { meetingPdfVesselSummary, meetingPdfDocumentTitle }=await server.ssrLoadModule('/src/meetingPdf.ts');
  assert.equal(meetingPdfDocumentTitle('主機運轉時數檢討','2026-08-20'),'主機運轉時數檢討_2026-08-20','單場會議 PDF 文件名必須直接使用會議主題與召開日期');
  assert.equal(meetingPdfDocumentTitle('每日/週報：格式檢討','2026-08-20'),'每日-週報：格式檢討_2026-08-20','PDF 文件名必須只替換 Windows 不允許的字元');
  assert.match(meetings,/document\.title=meetingPdfDocumentTitle\(/,'單場會議列印前必須把瀏覽器文件名切換為會議主題與日期');
  assert.match(meetings,/document\.title=originalTitle/,'列印結束後必須恢復網站原本標題');
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
