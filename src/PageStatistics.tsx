import { useEffect, useId, useRef, useState } from 'react';
import type { AppData, TaskItem, TemporaryMeeting, Vessel } from './types';
import { statisticsMetrics, taskStatisticsCases, meetingStatisticsCases, meetingDecisionStatisticsCases, emptyStatisticsFilters, filterStatisticsCases, statisticsDimensions, statisticsGroups, statisticsPercent } from './pageStatisticsModel';
import { analysisDateError } from './dataAnalysisModel';
import type { AnalysisInterval } from './dataAnalysisModel';
import type { StatisticsDimension, StatisticsFilters, StatisticsSort } from './pageStatisticsModel';
import { vesselDisplayName } from './vesselDisplay';
import { PageStatisticsTrend } from './PageStatisticsTrend';
import type { StatisticsCase } from './pageStatisticsModel';
import './dataAnalysis.css';
import './pageStatistics.css';

export function statisticsNames(data: AppData, vessels: Vessel[]) { return Object.fromEntries([...data.users.map(user => [`person:${user.id}`, `${user.name}｜${user.department}`]), ...vessels.map(vessel => [`vessel:${vessel.id}`, vesselDisplayName(vessel)])]); }
export interface StatisticsDataset { id: string; label: string; current: StatisticsCase[]; all: StatisticsCase[] }
export function TaskStatisticsEntry({ title, tasks, allTasks, data, vessels, contextKey }: { title: string; tasks: TaskItem[]; allTasks: TaskItem[]; data: AppData; vessels: Vessel[]; contextKey: string }) {
  return <PageStatisticsEntry title={title} names={statisticsNames(data,vessels)} contextKey={contextKey} datasets={[{ id: 'tasks', label: '案件', current: taskStatisticsCases(tasks, data, vessels), all: taskStatisticsCases(allTasks, data, vessels) }]} note="沿用清單全部篩選結果（不是本頁或勾選項目）；原日期條件為最後更新日期。切換全部狀態只移除結案狀態，其他條件含僅逾期均保留。"/>;
}
export function MeetingStatisticsEntry({ meetings, allMeetings, data, vessels, contextKey }: { meetings: TemporaryMeeting[]; allMeetings: TemporaryMeeting[]; data: AppData; vessels: Vessel[]; contextKey: string }) {
  const current = meetingDecisionStatisticsCases(meetings,data,vessels);
  const all = meetingDecisionStatisticsCases(allMeetings,data,vessels);
  return <PageStatisticsEntry title="臨會/專題" names={statisticsNames(data,vessels)} contextKey={contextKey} datasets={[
    { id:'meetings',label:'會議／專題（整場）',current:meetingStatisticsCases(meetings,data,vessels),all:meetingStatisticsCases(allMeetings,data,vessels) },
    { id:'decisions',label:'會議待辦／決議',current:current.records,all:all.records },
  ]} note={`沿用會議清單關鍵字、船型、範圍與權限；全部狀態只移除會議狀態及未完成／已完成清單限制。會議是否完成與待辦是否完成分開計算。待辦包含可見派生案件及無涉船獨立決議。${all.unavailable?` 同條件範圍有 ${all.unavailable} 項決議缺少可判定的可見關聯，不推算其待辦績效。`:''}`}/>;
}
export function PageStatisticsEntry({ title, datasets, contextKey, note, names = {} }: { title: string; datasets: StatisticsDataset[]; contextKey: string; note: string; names?: Record<string,string> }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => { dialog.current?.close(); setOpen(false); }, [contextKey]);
  return <><button type="button" className="btn small ghost statistics-entry" onClick={() => setOpen(true)}>數據統計</button>
    <dialog ref={dialog} className="page-statistics-dialog no-print" aria-labelledby={labelId} onClose={() => setOpen(false)}>
      {open && <><header className="page-statistics-header"><div><h2 id={labelId}>{title}｜數據統計</h2><small>唯讀分析，不修改案件、不保存或離開原頁</small></div><button type="button" className="btn small ghost" onClick={() => dialog.current?.close()}>關閉統計</button></header><PageStatisticsView datasets={datasets} note={note} names={names}/></>}
    </dialog></>;
}
function PageStatisticsView({ datasets, note, names }: { datasets: StatisticsDataset[]; note: string; names: Record<string,string> }) {
  const [datasetId, setDatasetId] = useState(datasets[0]?.id || '');
  const [cohort, setCohort] = useState('current');
  const [filters, setFilters] = useState<StatisticsFilters>(emptyStatisticsFilters);
  const [dimension, setDimension] = useState<StatisticsDimension>('department');
  const [sort, setSort] = useState<StatisticsSort>('total');
  const [focus, setFocus] = useState('');
  const [interval, setInterval] = useState<AnalysisInterval>('month');
  const dataset = datasets.find(item => item.id === datasetId) || datasets[0];
  const base = dataset ? (cohort === 'current' ? dataset.current : dataset.all) : [];
  const records = filterStatisticsCases(base,filters);
  const metrics = statisticsMetrics(records);
  const rows = statisticsGroups(records,dimension,sort);
  const focused = rows.find(row => row.id === focus);
  const nameOf = (kind: string,id: string) => names[`${kind}:${id}`] || id;
  const update = (patch: Partial<StatisticsFilters>) => { setFilters(current => ({...current,...patch})); setFocus(''); };
  const chooseDimension = (value: StatisticsDimension) => { setDimension(value); setFocus(''); };
  const filterDimensions = ['department','person','vessel','source','priority'] as const;
  const pct = (value: number|null) => value === null ? '—' : `${value}%`;
  return <section className="data-analysis-view page-statistics-view">
    <div className="panel analysis-filters"><label><span>統計對象</span><select aria-label="統計對象" value={datasetId} onChange={event => { setDatasetId(event.target.value);setFilters(emptyStatisticsFilters);setFocus(''); }}>{datasets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>案件範圍</span><select aria-label="統計案件範圍" value={cohort} onChange={event => {setCohort(event.target.value);setFocus('');}}><option value="current">目前清單（{dataset?.current.length || 0}）</option><option value="all">同條件全部狀態（{dataset?.all.length || 0}）</option></select></label>
      {filterDimensions.map(kind => <label key={kind}><span>{statisticsDimensions[kind]}</span><select aria-label={`統計${statisticsDimensions[kind]}`} value={filters[kind]} onChange={event => update({[kind]:event.target.value})}><option value="">全部</option>{statisticsGroups(base,kind).filter(row => kind !== 'person' || row.id !== '未指定人員').filter(row => kind !== 'vessel' || row.id !== '無可見涉船').filter(row => kind !== 'department' || row.id !== '未指定部門').map(row => <option key={row.id} value={row.id}>{nameOf(kind,row.id)}</option>)}</select></label>)}
      <label><span>統計日期依據</span><select aria-label="統計日期依據" value={filters.dateBasis} onChange={event => update({dateBasis:event.target.value as StatisticsFilters['dateBasis']})}><option value="created">建立日期</option><option value="closed">完成日期</option></select></label>
      <label><span>日期起</span><input type="date" aria-label="統計日期起" value={filters.fromDate} onChange={event => update({fromDate:event.target.value})}/></label><label><span>日期迄</span><input type="date" aria-label="統計日期迄" value={filters.toDate} onChange={event => update({toDate:event.target.value})}/></label>
      <button type="button" className="btn da-reset" onClick={() => {setFilters(emptyStatisticsFilters);setFocus('');}}>重設統計條件</button><strong className="analysis-scope-note">{dataset?.label} · {metrics.total} 件</strong>
    </div>
    <p className="da-note">{note}</p>
    {analysisDateError(filters) && <p role="alert" className="da-error">{analysisDateError(filters)}</p>}
    <div className="metric-grid analysis-metric-grid">
      <StatCard label="案件總數" value={metrics.total} detail={`未完成 ${metrics.open} 件`}/><StatCard label="已完成" value={metrics.closed} detail="件"/>
      <StatCard label="完成率" value={metrics.completionRate} unit="%" detail={`${metrics.closed}／${metrics.total} 件`}/><StatCard label="未結逾期率" value={metrics.overdueRate} unit="%" detail={`${metrics.overdue}／${metrics.total} 件；佔未結 ${pct(metrics.openOverdueRate)}`}/>
      <StatCard label="按期完成率" value={metrics.onTimeRate} unit="%" detail={`${metrics.onTime}／${metrics.onTimeBase} 件可判定`}/><StatCard label="逾期結案" value={metrics.lateClosed} detail={`結案時效不明 ${metrics.unknownClosedTiming} 件`}/>
      <StatCard label="平均結案天數" value={metrics.averageDays} detail={`${metrics.durationBase} 件日期完整`}/><StatCard label="未設有效期限" value={metrics.noDueDate} detail="不當作逾期或按期完成"/>
    </div>
    <p className="da-note">只看未完成或已完成時，完成率自然為 0% 或 100%；比較部門／個人時可切換「同條件全部狀態」。</p>
    <div className="ps-distributions">{(['source','priority','status','category','flags','age'] as const).map(kind => {
      const groups=statisticsGroups(records,kind); const baseCount=kind==='age'?metrics.open:metrics.total;
      return <div className="panel analysis-panel category-ratio-panel" key={kind} data-stat-distribution={kind}><div className="panel-title"><h3>{statisticsDimensions[kind]}</h3><button className="da-text-button" type="button" onClick={()=>chooseDimension(kind)}>查看排名</button></div>{groups.length?groups.slice(0,3).map(row=><div className="ps-distribution-row" key={row.id}><span>{row.id}</span><b>{row.metrics.total} 件 · {pct(statisticsPercent(row.metrics.total,baseCount))}</b></div>):<p className="empty-text">沒有符合條件的案件</p>}{groups.length>3&&<small className="da-note">顯示前 3 項；排名可查看全部 {groups.length} 項</small>}</div>;
    })}</div>
    <div className="ps-analysis-grid"><div className="panel analysis-panel ps-rank-panel">
      <div className="panel-title"><h3>佔比與績效排名</h3><small>{rows.length} 項</small></div>
      <div className="da-rank-controls"><label>分析面向 <select aria-label="統計分析面向" value={dimension} onChange={event => chooseDimension(event.target.value as StatisticsDimension)}>{Object.entries(statisticsDimensions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>排名依據 <select aria-label="統計排名依據" value={sort} onChange={event => setSort(event.target.value as StatisticsSort)}><option value="total">案件件數</option><option value="completionRate">完成率</option><option value="overdueRate">未結逾期率</option><option value="overdue">未結逾期件數</option><option value="lateClosed">逾期結案件數</option><option value="onTimeRate">按期完成率</option></select></label></div>
      <div className="table-wrap ps-rank-table" tabIndex={0} role="region" aria-label="統計排名明細"><table><thead><tr><th>名次／名稱</th><th>件數／佔比</th><th>完成／未結</th><th>完成率</th><th>未結逾期</th><th>逾期率</th><th>按期完成率</th><th>逾期結案</th><th>平均天數</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} data-stat-rank-id={row.id} data-rank={row.rank} data-total={row.metrics.total}><td><button type="button" className="da-text-button" aria-label={`查看 ${nameOf(dimension,row.id)} 趨勢`} aria-pressed={focused?.id===row.id} onClick={()=>setFocus(current=>current===row.id?'':row.id)}>{row.rank} · {nameOf(dimension,row.id)}</button></td><td>{row.metrics.total} · {pct(statisticsPercent(row.metrics.total,dimension==='age'?metrics.open:metrics.total))}</td><td>{row.metrics.closed}／{row.metrics.open}</td><td>{pct(row.metrics.completionRate)}</td><td>{row.metrics.overdue}</td><td>{pct(row.metrics.overdueRate)}</td><td title={`${row.metrics.onTime}／${row.metrics.onTimeBase} 件可判定`}>{pct(row.metrics.onTimeRate)}</td><td>{row.metrics.lateClosed}</td><td>{row.metrics.averageDays??'—'}</td></tr>)}</tbody></table>{!rows.length&&<p className="empty-text">沒有符合條件的案件</p>}</div>
      <small className="da-note">點名稱查看趨勢；同值並列，無可計算分母顯示「—」。多部門／人員／船舶／多選分類重疊，佔比合計可超過 100%。</small>
    </div><PageStatisticsTrend records={focused?.records||records} fromDate={filters.fromDate} toDate={filters.toDate} interval={interval} onInterval={setInterval} focusKey={focused?`${dimension}:${focused.id}`:''} focusLabel={focused?nameOf(dimension,focused.id):''} onReset={()=>setFocus('')}/></div>
    <details className="panel analysis-panel da-method"><summary>統計口徑與分母說明</summary><ul className="analysis-method"><li>完成率＝已完成 ÷ 本範圍全部案件；未結逾期率＝尚未完成且期限早於今天 ÷ 同一分母。期限為今天不算逾期。</li><li>按期完成率只計完成日期及期限均有效的已完成案件；完成日不晚於期限為按期，晚於期限另計「逾期結案」。缺日期不推算、不當作準時。</li><li>平均結案天數＝完成日減建立日的日曆天數；缺日期或完成早於建立的案件不納入。案齡只計未完成案件。</li><li>人員責任包含追蹤窗口及有效船舶分管／代理；部門另含案件所列部門。會議使用追蹤窗口／負責人及有效涉船分管，單純與會者不算責任人。歷史歸屬無完整資料時不推造過往績效。</li><li>案件完成判定沿用原清單的可見船舶範圍；部門／人員比較是責任案件完成率，不是個人操作次數。船舶排名單獨採用該船進度及完成日期，不用整案日期覆蓋。</li><li>新增／完成趨勢僅追蹤目前篩選案件的兩種事件，各按自己的日期；不是當時庫存或完整歷史結案／重開流水。日期不明事件另行提示；日／週／月區間補零。</li><li>分類按來源分開；未指定分類、部門、人員及未設有效期限都保留顯示。重設統計條件不清除原頁篩選。</li></ul></details>
  </section>;
}
function StatCard({ label, value, unit = '', detail }: { label: string; value: number | null; unit?: string; detail: string }) {
  return <div className="metric-card"><small>{label}</small><b>{value === null ? '—' : `${value}${unit}`}</b><span>{detail}</span></div>;
}
