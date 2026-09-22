import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const passed = [];
const test = (label, run) => { run(); passed.push(label); };
try {
  const { createAnalyticsFixture } = await server.ssrLoadModule('/scripts/fixtures/internal-control-analytics.ts');
  const { buildInternalControlBreakdowns: breakdowns, buildInternalControlTrend: trend, selectInternalControlTrendCases: selectTrend } = await server.ssrLoadModule('/src/internalControlAnalytics.ts');
  const { filterInternalControlCases, emptyInternalControlFilters } = await server.ssrLoadModule('/src/internalControlWorkflow.ts');
  const { cases, vessels } = createAnalyticsFixture();
  const original = JSON.stringify({ cases, vessels });
  const rows = (items, dimension) => breakdowns(items, vessels).find(d => d.key === dimension).rows;
  test('all eight dimensions use the exact filtered case denominator', () => {
    const all = breakdowns(cases, vessels);
    assert.equal(all.length, 8);
    assert.deepEqual(rows(cases, 'category').map(r => [r.key,r.count,r.share,r.rank]), [['設備故障',6,60,1],['船舶管理',3,30,2],['物料備件',1,10,3]]);
    for (const dimension of all.filter(d=>!d.multiple)) assert.equal(dimension.rows.reduce((sum,r)=>sum+r.count,0), cases.length);
  });
  const equipment = filterInternalControlCases(cases, vessels, { ...emptyInternalControlFilters(), categories: ['設備故障'] });
  test('classification filtering changes subtype shares and all other dimensions', () => {
    assert.equal(equipment.length,6);
    assert.equal(rows(equipment,'category')[0].share,100);
    assert.equal(rows(equipment,'equipment').find(r=>r.key==='动力与推进').share,50);
    assert.equal(rows(equipment,'vessel').find(r=>r.key==='qa-a').share,50);
    assert.equal(rows(equipment,'department').find(r=>r.key==='輪機').share,66.7);
    assert.equal(rows(equipment,'department').find(r=>r.key==='海務').share,50);
  });
  test('multi-department incidence deduplicates one case and keeps missing values', () => {
    const duplicate=structuredClone(equipment); duplicate[0].departments.push('輪機');
    assert.deepEqual(rows(duplicate,'department'),rows(equipment,'department'));
    assert.equal(rows(equipment,'department').find(r=>r.key==='未指定部門').count,1);
    assert.ok(rows(equipment,'department').reduce((n,r)=>n+r.share,0)>100);
    assert.equal(rows(cases,'equipment').find(r=>r.key==='不適用（非設備故障）').count,4);
  });
  test('ranking ties share rank and vessel identity is not merged by label', () => {
    assert.deepEqual(rows(cases,'vessel').map(r=>[r.count,r.rank]),[[4,1],[4,1],[2,3]]);
    const sameName=vessels.map(v=>({...v,name:'same'}));
    assert.equal(breakdowns(cases,sameName).find(d=>d.key==='vessel').rows.length,3);
    assert.equal(breakdowns(cases,vessels,v=>'PDF '+v.fullName).find(d=>d.key==='vessel').rows.find(r=>r.key==='qa-a').label,'PDF QA ALPHA');
  });
  test('monthly trends fill empty months and use separate report/closure dates', () => {
    const result=trend(cases,{interval:'month'});
    assert.deepEqual(result.points.map(p=>[p.key,p.created,p.closed]),[['2026-01-01',4,2],['2026-02-01',0,0],['2026-03-01',3,1],['2026-04-01',0,0],['2026-05-01',3,2]]);
  });
  test('date bounds apply to events within the already filtered cohort', () => {
    const cohort=filterInternalControlCases(cases,vessels,{...emptyInternalControlFilters(),fromDate:'2026-01-01',toDate:'2026-01-31'});
    const result=trend(cohort,{interval:'month',fromDate:'2026-01-01',toDate:'2026-01-31'});
    assert.deepEqual(result.points.map(p=>[p.created,p.closed]),[[4,2]]);
    assert.equal(cohort.filter(c=>c.isClosed).length,3,'one selected January case closed outside the January chart');
  });
  test('rank focus stays within filtered cases and unknown focus never broadens scope', () => {
    const focused=selectTrend(equipment,vessels,'equipment','动力与推进');
    assert.deepEqual(focused.map(c=>c.id),['ic-1','ic-2','ic-5']);
    assert.equal(selectTrend(equipment,vessels,'equipment','unknown').length,0);
    assert.deepEqual(trend(focused,{interval:'month'}).points.map(p=>p.created),[2,0,1,0,0]);
  });
  test('day/week boundaries are timezone-independent and Monday-based', () => {
    const data=[{...cases[0],reportDate:'2025-12-31',isClosed:false,closedDate:undefined},{...cases[1],reportDate:'2026-01-05'}];
    assert.deepEqual(trend(data,{interval:'week'}).points.map(p=>[p.key,p.created]),[['2025-12-29',1],['2026-01-05',1]]);
    const leap=trend([{...cases[0],reportDate:'2024-02-29',closedDate:'2024-03-01'}],{interval:'day'});
    assert.deepEqual(leap.points.map(p=>[p.key,p.created,p.closed]),[['2024-02-29',1,0],['2024-03-01',0,1]]);
  });
  test('invalid/missing dates are disclosed and reopened cases do not count stale closure dates', () => {
    const result=trend([{...cases[0],reportDate:'2026-02-30',closedDate:'invalid'},{...cases[1],isClosed:false,closedDate:'2026-01-20'}],{interval:'month'});
    assert.equal(result.invalidReportDates,1); assert.equal(result.invalidClosedDates,1);
    assert.equal(result.points.reduce((sum,p)=>sum+p.closed,0),0);
  });
  test('empty/invalid/oversized ranges are explicit without truncation or NaN', () => {
    assert.deepEqual(trend([],{interval:'month'}).points,[]);
    assert.ok(trend(cases,{interval:'day',fromDate:'2020-01-01',toDate:'2026-12-31'}).error);
    assert.ok(trend(cases,{interval:'month',fromDate:'2026-06-01',toDate:'2026-01-01'}).error);
    assert.ok(trend(cases,{interval:'month',fromDate:'bad'}).error);
    assert.ok(breakdowns([],vessels).every(d=>d.rows.length===0));
  });
  test('analytics never mutates cases or vessels', () => assert.equal(JSON.stringify({cases,vessels}),original));
  console.log(JSON.stringify({result:'PASS',count:passed.length,cases:passed},null,2));
} finally { await server.close(); }
