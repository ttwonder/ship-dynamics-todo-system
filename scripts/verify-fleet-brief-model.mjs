// Offline, synthetic model contract; Node 22.15+ strips TS; no Vite/DB/cache/IO writes.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\/[^.]+$/.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
}});
const { buildFleetBriefReport } = await import('../src/fleetBriefModel.ts');
const date = '2030-02-03', capturedAt = '2030-02-03T03:00:00Z';
const vessel = (id, location, nextPort, extra = {}) => ({
  id, isActive: true, name: `測試${id}`, fullName: `TEST ${id}`, shortName: id,
  position: { location, nextPort, lastPort: 'Shanghai', eta: '', etb: '', etd: '', manualRemark: '', navigationStatus: '航行' },
  note: { statusList: [], statusSupplement: '', recentDynamics: '', subsequentDynamics: '' }, ...extra,
});
const build = (overrides = {}) => buildFleetBriefReport({ date, capturedAt, vessels: [], tasks: [], internalControlCases: [], risk: {rowsByVessel: {}, notice: ''}, ...overrides });
const section = (report, keyword) => {
  const result = report.sections.filter(x => x.title.includes(keyword));
  assert.equal(result.length, 1, `expected one section containing ${keyword}`);
  return result[0];
};
const names = (report, keyword) => {
  const {columns, rows} = section(report, keyword);
  return rows.map(row => row[columns.findIndex(x => x.kind === 'vessel')]);
};
test('classifies only current/next location, once per region and active vessel', () => {
  const a = vessel('A', '上海', 'CN NGB'), b = vessel('B', 'Ras Tanura', 'Port Hedland'), c = vessel('C', 'Open sea', 'Singapore');
  c.note.recentDynamics = 'previously Dubai; drydock/repair planned in China';
  const d = vessel('D', 'AUPHE', 'Jebel Ali', {isActive:false});
  const report = build({vessels:[a,b,c,d]});
  assert.deepEqual(report.sections.slice(0,3).map(s=>s.title),['涉及波斯灣及周邊船舶','涉及澳洲船舶','涉及中國船舶']);
  assert.deepEqual(report.sections.map(s=>s.theme),['gulf','australia','china','hrs','dock','control','task']);
  assert.match(report.notice,/富加拉、阿曼及紅海港口/);
  assert.deepEqual(names(report, '中國'), ['測試A TEST A']);
  assert.deepEqual(names(report, '波斯灣'), [], 'current Gulf must not duplicate an Australian destination');
  assert.deepEqual(names(report, '澳洲'), ['測試B TEST B']);
  assert.deepEqual(names(report, '塢修'), []);
  assert.equal(report.date, date);
});
test('operational aliases including Oman, not previous Australia',()=>{
  const locations = [['','HAYPOINT'],['鯨魚圈','麥寮'],['煙台','Singapore'],['At sea','SOHAR'],['Arabian Sea','Muscat, OM'],['At sea','麥寮'],['South China Sea','Singapore'],['Oman','Fujairah'],['Singapore','CNTAO'],['註地','KW'],['','AUPHE']];
  const vessels = locations.map(([here,next],i)=>vessel(String(i),here,next));
  for(const ship of vessels) ship.position.lastPort = 'Port Hedland';
  const report = build({vessels});
  assert.deepEqual(names(report,'澳洲'),['測試0 TEST 0','測試10 TEST 10']);
  assert.deepEqual(names(report,'波斯灣'),['測試3 TEST 3','測試4 TEST 4','測試7 TEST 7','測試9 TEST 9']);
  assert.deepEqual(names(report,'中國'),['測試1 TEST 1','測試2 TEST 2','測試8 TEST 8']);
  assert.match(section(report,'波斯灣').rows[0].join(' '),/正前往/);
  assert.match(section(report,'中國').rows[0].join(' '),/目前在/);
});
test('ambiguous text, origins and offshore seas alone do not imply a current port call',()=>{
  const misleading = ['At sea (from Shanghai)', 'High seas / last port: Brisbane', '高雄（上一港：煙台）', 'Taiwan, Republic of China', 'At sea', 'AUDIO'];
  const vessels = misleading.map((s,i)=>vessel(String(i),s,'Singapore'));
  const report = build({vessels});
  for(const region of ['中國','澳洲','波斯灣']) assert.deepEqual(names(report,region),[]);
});
test('Fujairah, Oman and Red Sea ports count on current or next call, never by ship name',()=>{
  const ports=['富加拉','FUJAIRAH, UAE','AEFJR','Fujayrah','OMAN','阿曼','Muscat','SALALAH','OM DQM','Jeddah','沙烏地吉達','SAJED','Yanbu','蘇丹港','Port Sudan','Ain Sokhna','Aqaba','Eilat','Massawa','Hodeidah','EGSUZ','紅海港口'];
  const ship=(here,next)=>vessel('ORIENT',here,next,{name:'亞善',fullName:'FPMC C ORIENT'});
  for(const port of ports) for(const [here,next] of [['At sea',port],[port,'Singapore']]){
    assert.deepEqual(names(build({vessels:[ship(here,next)]}),'波斯灣'),['亞善 FPMC C ORIENT'],[here,next].join(' → '));
  }
  const v=ship('At sea','Singapore');v.position.lastPort='Fujairah';v.note.recentDynamics='下下航次 Jeddah';
  for(const port of ['Singapore','Alexandria, Egypt','Port Said','Aden, Yemen','At sea (from Fujairah)','Romania']){
    v.position.nextPort=port;assert.deepEqual(names(build({vessels:[v]}),'波斯灣'),[],port);
  }
  const cross=build({vessels:[ship('Fujairah','Shanghai')]});assert.deepEqual(names(cross,'波斯灣'),[]);assert.deepEqual(names(cross,'中國'),['亞善 FPMC C ORIENT']);
});
test('empty or repeated vessel scope stays bounded even with wider captures and tasks',()=>{
  const a=vessel('A','At sea','HAYPOINT');
  const input = {vessels:[a,a], risk, tasks:[task('t','DENIED','急','DENIED')],internalControlCases:[control('c','DENIED','急','DENIED')]};
  const report=build(input);
  assert.deepEqual(names(report,'澳洲'),['測試A TEST A']);
  assert.ok(build({...input,vessels:[]}).sections.every(s=>s.rows.length===0));
  for(const s of report.sections) assert.ok(s.rows.every(r=>r.length===s.columns.length && r.every(x=>typeof x==='string')));
  assert.doesNotMatch(JSON.stringify(report),/DENIED/);
});
const values = (report, keyword, kind) => {
  const {rows,columns} = section(report,keyword), i = columns.findIndex(c=>c.kind===kind);
  assert.notEqual(i,-1,`${keyword}: missing ${kind} column`);
  return rows.map(row => row[i]);
};
const riskRow = risk => ({risk, retrievedAt:'2030-02-02T01:23:45Z'});
const risk = {rowsByVessel:{A:riskRow('HRS'), B:riskRow('SRS'), C:riskRow('LRS'), DENIED:riskRow('HRS')}, queryCompletedAt:'2030-02-02T01:24:46Z', snapshotId:'version-1', notice:'待更新'};
test('shows scoped shared Tokyo grades, per-ship acquisition and last-good notice',()=>{
  const vessels = ['A','B','C','D'].map(id=>vessel(id,'AUPHE','CN TAO'));
  Object.assign(vessels[0].note,{captain:'甲',chiefOfficer:'乙',chiefEngineer:'丙',firstEngineer:'丁',recentDynamics:'最近 PSC：合成記錄\nCII：合成記錄'});
  Object.assign(vessels[0].position,{eta:'2030-02-09T05:06',etb:'2030-02-10T07:08',etd:'2030-02-11T09:10'});
  Object.assign(vessels[1].position,{location:'Dalian',nextPort:'Dalian',navigationStatus:'停泊',etb:'2030-02-12T11:12',etd:'2030-02-13T13:14'});
  vessels[1].note.statusList = ['drydock/repiar'];
  const report = build({vessels, risk});
  const grades = values(report,'中國','note');
  assert.deepEqual(grades.map(x=>x.match(/HRS|SRS|LRS|未知/)?.[0]), ['HRS','LRS','未知']);
  assert.deepEqual(names(report,'澳洲'), []);
  for (const group of ['波斯灣','中國','澳洲','塢修']) assert.ok(!section(report,group).columns.some(c=>c.kind==='risk'));
  const china = section(report,'中國').rows[0].join('\n');
  for(const token of ['船長：甲','大副：乙','輪機長：丙','大管輪：丁','05:06','07:08','09:10','最近 PSC：合成記錄','CII：合成記錄']) assert.ok(china.includes(token),token);
  const dock = section(report,'塢修');
  assert.match(dock.rows[0].join('\n'), /SRS/);
  assert.ok(dock.columns.some(c=>c.label.includes('進塢')) && dock.columns.some(c=>c.label.includes('出塢')));
  assert.match(dock.rows[0].join('\n'), /11:12[\s\S]*13:14/);
  assert.match(JSON.stringify(report.sections), /09:23:45/);
  assert.match(report.notice, /09:24:46/);
  assert.match(report.notice, /待更新/);
  assert.deepEqual(names(report,'HRS'), ['測試A TEST A']);
  assert.deepEqual(names(report,'塢修'), ['測試B TEST B']);
  assert.match(build().notice,/不代表低風險/);
});
const task = (id, vesselId, priority, description, extra = {}) => ({id,vesselId,priority,description,status:'',isClosed:false,sourceType:'manual',...extra});
const control = (id,vesselId,priority,description,extra={})=>({id,vesselId,priority,description,status:'',isClosed:false,...extra});
test('open controls show their own publication time (Taipei); never substitute report/update time',()=>{
  const clocks={reportDate:'2030-03-11',updatedAt:'2030-03-12T10:13:14Z'};
  const r=build({vessels:[vessel('A','','')],internalControlCases:[control('c','A','急','獨立案件',{...clocks,createdAt:'2030-01-02T17:23:00Z',linkedTaskId:'mirror'}),control('old','A','中','缺少時間',clocks)],tasks:[task('t','A','高','任務來源',{...clocks,isInternalControl:true,createdAt:'2030-01-08T06:41:00Z'}),task('mirror','A','高','鏡像',{createdAt:clocks.updatedAt})]});
  const s=section(r,'內控'), i=s.columns.findIndex(c=>c.label.includes('發佈時間'));
  assert.notEqual(i,-1);assert.deepEqual(s.rows.map(row=>row[i]),['2030/01/03 01:23','2030/01/08 14:41','未提供']);
  assert.ok(s.rows.every(row=>row.length===s.columns.length));assert.deepEqual(section(r,'要事').rows,[]);
});
test('open tasks use the control columns and their own publication time, not report/update time',()=>{
  const clocks={reportDate:'2030-03-11',updatedAt:'2030-03-12T10:13:14Z'};
  const r=build({vessels:[vessel('A','','')],tasks:[task('a','A','急','跨日要事',{...clocks,createdAt:'2030-01-13T18:47:00Z'}),task('b','A','高','僅有日期',{...clocks,createdAt:'2030-01-11'}),task('c','A','中','時間不詳',clocks)]});
  const s=section(r,'要事');assert.deepEqual(s.columns,section(r,'內控').columns);
  assert.deepEqual(s.rows.map(row=>row.slice(2)),[['2030/01/14 02:47','跨日要事'],['2030/01/11','僅有日期'],['未提供','時間不詳']]);
});
test('full open case/task text; per-vessel closure and identity-based mirrors only',()=>{
  const vessels = ['A','B'].map(id=>vessel(id,'',''));
  const long = '長文'.repeat(650), desc = `<p>${long}</p><p>完&amp;整</p>`;
  const tasks = [task('mirror','A','高','MIRROR'), task('linked','A','高','MIRROR 2',{internalControlCaseId:'c2'}),
    task('member','A','中',desc,{vesselIds:['A','B','DENIED'],sourceMeetingId:'m',distributeToVessels:true,vesselProgress:[{vesselId:'A',isClosed:true}]}),
    task('same','A','急','內容相同'),task('same2','A','高','內容相同'),task('old','B','急','CLOSED',{isClosed:true}),task('low','A','低','LOW'),task('outside','DENIED','急','DENIED'),
    task('orphan','B','高','授權的內控要事',{isInternalControl:true})];
  const internalControlCases = [control('c1','A','中','正式案件',{linkedTaskId:'mirror'}),control('c2','A','高','另一件'),control('closed','B','高','CLOSED',{isClosed:true}),control('low','A','低','LOW'),control('secret','DENIED','急','DENIED')];
  const report = build({vessels,tasks,internalControlCases,risk});
  assert.doesNotMatch(JSON.stringify(report),/MIRROR|CLOSED|DENIED|LOW/);
  assert.deepEqual(values(report,'內控','content').sort(),['正式案件','另一件','授權的內控要事'].sort());
  const descriptions = values(report,'要事','content');
  assert.deepEqual(descriptions.sort(), ['內容相同','內容相同',`${long}\n完&整`].sort());
  const fullRow = section(report,'要事').rows.find(row=>row.includes(`${long}\n完&整`));
  assert.ok(fullRow.includes('測試B TEST B') && fullRow.includes('中'));
});

const call = (rowId, sortOrder, portDockName, extra={}) => ({rowId,sortOrder,portDockName,portTimeZone:'UTC+8',notesText:'',etaUtc:null,etbUtc:null,etdUtc:null,...extra});
const record = (rows,extra={})=>({status:'ready',checkedAt:capturedAt,document:{vesselId:'A',rows,alternativePlans:[{rows:[call('alt',0,'ALTERNATIVE')]}]},...extra});
const first = call('first',0,'Shanghai',{etbUtc:'2030-02-03T01:30:00Z',etdUtc:'2030-02-03T04:00:00Z',notesText:'現港交接'});
const next = call('next',1,'Port Hedland',{etaUtc:'2030-02-04T02:45:00Z',etbUtc:'2030-02-04T17:55:00Z',notesText:'下一港安排'});
const later = call('later',2,'FUTURE',{notesText:'FUTURE'});
const shipA = vessel('A','Shanghai','Shanghai');
Object.assign(shipA.position,{etb:'2030-02-03T09:30',lastPort:'Ras Tanura',manualRemark:'船卡備註',navigationStatus:'停泊'});
const detail = (report,label)=>{
  const {rows,columns} = section(report,'HRS');
  const index = columns.findIndex(c=>c.label.includes(label));
  assert.notEqual(index,-1,`missing ${label} column`);
  return rows[0][index];
};
test('berthed: current formal ETB, following call/ETA and only relevant notes',()=>{
  const input = {vessels:[shipA],itineraryRecords:{A:record([later,next,first])},risk};
  const before = JSON.stringify(input), report=build(input);
  assert.match(detail(report,'ETB'), /Shanghai[\s\S]*2030-02-03 09:30/);
  assert.match(detail(report,'ETA'), /Port Hedland[\s\S]*2030-02-04 10:45/);
  assert.doesNotMatch(JSON.stringify(report), /FUTURE|ALTERNATIVE|Ras Tanura/);
  assert.doesNotMatch(detail(report,'ETB'), /01:55/);
  assert.match(section(report,'澳洲').rows[0].join(' '), /ETB：2030-02-05 01:55/);
  for(const note of ['現港交接','下一港安排','船卡備註']) assert.ok(detail(report,'備註').includes(note));
  assert.deepEqual(names(report,'澳洲'),['測試A TEST A']);
  assert.equal(JSON.stringify(input),before);
});
test('underway: next port ETB and departed first row never become current facts',()=>{
  const sea=vessel('A','At sea','Port Hedland');
  Object.assign(sea.position,{eta:'2030-02-04T10:45',etb:'2030-02-05T01:55'});
  const report=build({vessels:[sea],itineraryRecords:{A:record([{...first,etdUtc:'2030-02-03T02:59:00Z'},next,later])},risk});
  assert.match(detail(report,'ETB'), /At sea[\s\S]*未提供/);
  assert.match(detail(report,'ETA'), /Port Hedland[\s\S]*10:45/);
  assert.doesNotMatch(detail(report,'ETB'), /01:55/);
  assert.doesNotMatch(JSON.stringify(report), /09:30|現港交接|FUTURE|ALTERNATIVE/);
  assert.deepEqual(names(report,'中國'),[]);
});
test('legacy or mismatched document: retain projected pair; no guessed current ETB',()=>{
  const a=vessel('A','','Ningbo'); Object.assign(a.position,{lastPort:'Dubai',etb:'2030-02-06T23:55',eta:'2030-02-05'});
  for(const records of [undefined, {A:record([first],{status:'stale'})}, {A:record([],{document:{vesselId:'B',rows:[first]}})}]) {
    const report=build({vessels:[a],itineraryRecords:records,risk});
    assert.match(detail(report,'ETB'),/未提供/);
    assert.match(detail(report,'ETA'),/Ningbo[\s\S]*2030-02-05/);
    assert.doesNotMatch(detail(report,'ETB'),/23:55/);
    assert.doesNotMatch(JSON.stringify(report),/Dubai|現港交接/);
  }
});
