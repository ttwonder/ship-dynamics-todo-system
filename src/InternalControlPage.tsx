import { useEffect, useMemo, useState } from 'react';
import type { AppData, InternalControlCase, InternalControlFilters, InternalControlReportSource, TaskPriority, UserAccount, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';
import { richTextToPlainText } from './richText';
import {
  buildInternalControlStats,
  defaultInternalControlVesselIds,
  filterInternalControlCases,
  managedInternalControlVesselIds,
} from './internalControlWorkflow';
import { downloadInternalControlExcel } from './internalControlExport';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { BatchCreateModal, CaseEditModal } from './InternalControlModals';
import type { InternalControlTaskProjection } from './internalControlData';

const REPORT_SOURCES: InternalControlReportSource[] = ['日常', '訪船', '隨船', '外部'];
type Subpage = 'open' | 'closed' | 'stats';
type MultiOption = { value: string; label: string };

type Props = {
  data: AppData;
  user: UserAccount;
  vessels: Vessel[];
  canCreate: boolean;
  canEdit: boolean;
  canClose: boolean;
  canDelete: boolean;
  canExport: boolean;
  authorizationEpoch: string;
  onCreate: (items: InternalControlCase[], expectedRevision: number, projections: Record<string, InternalControlTaskProjection>) => boolean;
  onUpdate: (item: InternalControlCase, expectedUpdatedAt: string, expectedRevision: number, projection?: InternalControlTaskProjection) => boolean;
  onDelete: (item: InternalControlCase, expectedRevision: number) => boolean;
  onOpenTask: (taskId: string) => void;
};

const emptyFilters = (vesselIds: string[]): InternalControlFilters => ({
  keyword: '', vesselIds, shipTypes: [], priorities: [], categories: [], departments: [], reportSources: [], equipmentSubcategories: [], fromDate: '', toDate: '', awareMode: 'all', closureMode: 'all',
});

function MultiFilter({ label, options, selected, onChange }: { label: string; options: MultiOption[]; selected: string[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  return <details className="ic-filter-group"><summary>{label}<span>{selected.length ? `已選 ${selected.length}` : '不限'}</span></summary><div className="ic-filter-actions"><button type="button" className="btn small ghost" onClick={() => onChange(options.map(item => item.value))}>全選</button><button type="button" className="btn small ghost" onClick={() => onChange([])}>清除</button></div><div className="ic-filter-options">{options.map(option => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)}/><span>{option.label}</span></label>)}</div></details>;
}

const optionList = (values: string[]): MultiOption[] => values.filter(Boolean).map(value => ({ value, label: value }));
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
const priorityClass = (priority: TaskPriority) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';

export default function InternalControlPage({ data, user, vessels, canCreate, canEdit, canClose, canDelete, canExport, authorizationEpoch, onCreate, onUpdate, onDelete, onOpenTask }: Props) {
  const [subpage, setSubpage] = useState<Subpage>('open');
  const [filters, setFilters] = useState<InternalControlFilters>(() => emptyFilters(defaultInternalControlVesselIds(user, vessels)));
  const [batchOpen, setBatchOpen] = useState(false);
  const [editing, setEditing] = useState<InternalControlCase | null>(null);
  const [editorAuthorizationEpoch,setEditorAuthorizationEpoch]=useState('');
  const [batchAuthorizationEpoch,setBatchAuthorizationEpoch]=useState('');
  const [page, setPage] = useState(1);
  const visibleVesselIds = useMemo(() => new Set(vessels.map(vessel => vessel.id)), [vessels]);
  const scopedCases = data.internalControlCases.filter(item => visibleVesselIds.has(item.vesselId));
  const activeClosure: InternalControlFilters['closureMode'] = subpage === 'open' ? 'open' : subpage === 'closed' ? 'closed' : 'all';
  const effectiveFilters = { ...filters, closureMode: activeClosure };
  const filtered = filterInternalControlCases(scopedCases, vessels, effectiveFilters);
  const paged = paginateItems(filtered, page, 30);
  const stats = buildInternalControlStats(filtered, vessels);
  const visibleEditing=Boolean(editing&&editorAuthorizationEpoch===authorizationEpoch&&scopedCases.some(item=>item.id===editing.id));
  const visibleBatch=Boolean(batchOpen&&batchAuthorizationEpoch===authorizationEpoch&&canCreate&&vessels.length);

  useEffect(() => setPage(1), [subpage, JSON.stringify(filters)]);
  useEffect(()=>{setEditing(null);setBatchOpen(false);setEditorAuthorizationEpoch('');setBatchAuthorizationEpoch('');},[authorizationEpoch]);
  useEffect(() => {
    setFilters(previous => {
      const allowed = previous.vesselIds.filter(id => visibleVesselIds.has(id));
      if (allowed.length || previous.vesselIds.length === 0) return previous;
      return { ...previous, vesselIds: defaultInternalControlVesselIds(user, vessels) };
    });
  }, [user.id, data.revision, vessels]);

  const shipTypes = unique(vessels.map(vessel => vessel.shipType));
  const categories = unique([...data.settings.taskCategories, ...scopedCases.map(item => item.category), '設備故障']);
  const departments = unique([...data.settings.departments, ...scopedCases.flatMap(item => item.departments)]);
  const vesselOptions = vessels.map(vessel => ({ value: vessel.id, label: vesselDisplayName(vessel) }));
  const setFilter = <K extends keyof InternalControlFilters>(key: K, value: InternalControlFilters[K]) => setFilters(previous => ({ ...previous, [key]: value }));
  const reset = () => setFilters(emptyFilters(defaultInternalControlVesselIds(user, vessels)));
  const selfManaged = () => setFilter('vesselIds', managedInternalControlVesselIds(user, vessels));
  const selectedVesselNames = filters.vesselIds.map(id => vessels.find(vessel => vessel.id === id)).filter((vessel): vessel is Vessel => Boolean(vessel)).map(vesselDisplayName);
  const summary = `船舶 ${selectedVesselNames.length ? selectedVesselNames.join('、') : '全部'}；日期 ${filters.fromDate || '不限'}～${filters.toDate || '不限'}；${subpage === 'open' ? '未完' : subpage === 'closed' ? '已結案' : '全部案件'}`;
  const print = () => {
    if (!canExport) return;
    document.body.classList.add('printing-internal-control');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-internal-control'), { once: true });
    window.setTimeout(() => window.print(), 80);
  };

  return <section className="internal-control-page">
    <div className="page-heading"><div><h1>內控異常</h1><p>督導日常、訪船、隨船及外部發現事項的獨立登記、跟進、結案與統計。</p></div><div className="heading-actions no-print">{canCreate && <button className="btn green" onClick={() => {setBatchAuthorizationEpoch(authorizationEpoch);setBatchOpen(true);}}>＋ 批量新增</button>}{canExport && <button className="btn ghost" disabled={!filtered.length} onClick={() => downloadInternalControlExcel(filtered, vessels, summary)}>導出 Excel</button>}{canExport && <button className="btn primary" disabled={!filtered.length} onClick={print}>導出 PDF</button>}</div></div>
    <div className="ic-tabs no-print" role="tablist"><button className={subpage === 'open' ? 'active' : ''} onClick={() => setSubpage('open')}>內控未完清單 <b>{scopedCases.filter(item => !item.isClosed).length}</b></button><button className={subpage === 'closed' ? 'active' : ''} onClick={() => setSubpage('closed')}>內控結案清單 <b>{scopedCases.filter(item => item.isClosed).length}</b></button><button className={subpage === 'stats' ? 'active' : ''} onClick={() => setSubpage('stats')}>數據統計</button></div>

    <section className="panel ic-filter-panel no-print">
      <div className="panel-title"><h2>篩選條件 <span className="muted">目前 {filtered.length} 件</span></h2><div><button className="btn small ghost" onClick={selfManaged}>經管船舶</button><button className="btn small ghost" onClick={reset}>重設（全部經管船）</button></div></div>
      <div className="ic-filter-primary"><input aria-label="內控異常關鍵字" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value)} placeholder="搜尋事項、狀態、船舶、分類、部門…"/><label>報告日期起<input type="date" value={filters.fromDate} onChange={event => setFilter('fromDate', event.target.value)}/></label><label>報告日期迄<input type="date" value={filters.toDate} onChange={event => setFilter('toDate', event.target.value)}/></label><label>知曉事項<select value={filters.awareMode} onChange={event => setFilter('awareMode', event.target.value as InternalControlFilters['awareMode'])}><option value="all">不限</option><option value="aware">是</option><option value="not-aware">否</option></select></label></div>
      <div className="ic-filter-grid"><MultiFilter label="船舶名稱" options={vesselOptions} selected={filters.vesselIds} onChange={value => setFilter('vesselIds', value)}/><MultiFilter label="船舶類型" options={optionList(shipTypes)} selected={filters.shipTypes} onChange={value => setFilter('shipTypes', value)}/><MultiFilter label="重要程度" options={optionList(data.settings.priorities)} selected={filters.priorities} onChange={value => setFilter('priorities', value as TaskPriority[])}/><MultiFilter label="事項分類" options={optionList(categories)} selected={filters.categories} onChange={value => setFilter('categories', value)}/><MultiFilter label="涉及部門" options={optionList(departments)} selected={filters.departments} onChange={value => setFilter('departments', value)}/><MultiFilter label="報告來源" options={optionList(REPORT_SOURCES)} selected={filters.reportSources} onChange={value => setFilter('reportSources', value as InternalControlReportSource[])}/><MultiFilter label="設備故障細項" options={optionList(data.settings.equipmentFailureSubcategories)} selected={filters.equipmentSubcategories} onChange={value => setFilter('equipmentSubcategories', value)}/></div>
    </section>

    {subpage !== 'stats' ? <section className="panel ic-list-panel"><div className="table-wrap"><table className="compact ic-table"><thead><tr><th>船舶／日期</th><th>來源</th><th>關注</th><th>事項內容</th><th>分類／部門</th><th>最新狀態</th><th>{subpage === 'closed' ? '結案' : '同步'}</th><th className="no-print">操作</th></tr></thead><tbody>{paged.items.map(item => { const vessel = vessels.find(entry => entry.id === item.vesselId); return <tr key={item.id}><td><b>{vessel ? vesselDisplayName(vessel) : item.vesselId}</b><small>{vessel?.shipType || '未填船型'}｜{item.reportDate}</small></td><td>{item.reportSource}{item.isAware && <small>知曉事項</small>}</td><td><span className={`priority-pill ${priorityClass(item.priority)}`}>{item.priority}</span></td><td><b>{richTextToPlainText(item.description)}</b></td><td>{item.category}{item.equipmentSubcategory && <small>{item.equipmentSubcategory}</small>}<small>{item.departments.join('、') || '未指定部門'}</small></td><td>{richTextToPlainText(item.status) || '尚未更新'}<small>更新 {item.updatedAt.slice(0, 10)}</small></td><td>{item.isClosed ? <><b>已結案</b><small>{item.closedDate || '-'}</small></> : item.linkedTaskId ? <><b>已同步要事</b><small>{item.linkedTaskId}</small></> : '僅內控'}</td><td className="no-print"><div className="table-actions"><button className="btn small primary" onClick={() => {setEditorAuthorizationEpoch(authorizationEpoch);setEditing(structuredClone(item));}}>{canEdit ? '更新' : '查看'}</button>{item.linkedTaskId && <button className="btn small ghost" onClick={() => onOpenTask(item.linkedTaskId!)}>要事</button>}</div></td></tr>; })}</tbody></table></div>{!filtered.length && <div className="empty-state">目前篩選條件沒有案件</div>}<PaginationControls page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} onPageChange={setPage} ariaLabel="內控異常分頁"/></section> : <InternalControlStatsView stats={stats}/>}

    <section className="internal-control-print print-only"><h1>內控異常{ subpage === 'open' ? '未完清單' : subpage === 'closed' ? '結案清單' : '統計報告'}</h1><p>{summary}｜共 {filtered.length} 件｜匯出人 {user.name}｜{new Date().toLocaleString('zh-TW')}</p>{subpage === 'stats' ? <InternalControlStatsView stats={stats}/> : <table><thead><tr><th>船舶</th><th>報告日期／來源</th><th>關注</th><th>事項</th><th>分類／細項</th><th>部門</th><th>狀態</th><th>結案</th></tr></thead><tbody>{filtered.map(item => { const vessel = vessels.find(entry => entry.id === item.vesselId); return <tr key={item.id}><td>{vessel ? vesselDisplayName(vessel) : item.vesselId}</td><td>{item.reportDate}｜{item.reportSource}</td><td>{item.priority}</td><td>{richTextToPlainText(item.description)}</td><td>{item.category}{item.equipmentSubcategory ? `｜${item.equipmentSubcategory}` : ''}</td><td>{item.departments.join('、')}</td><td>{richTextToPlainText(item.status)}</td><td>{item.closedDate || '未結'}</td></tr>; })}</tbody></table>}</section>

    {visibleBatch && <BatchCreateModal data={data} user={user} vessels={vessels} close={() => setBatchOpen(false)} save={(items, projections) => { if (onCreate(items, data.revision, projections)) { setBatchOpen(false); return true; } return false; }}/>}
    {visibleEditing && editing && <CaseEditModal item={editing} data={data} vessels={vessels} canEdit={canEdit} canClose={canClose} canDelete={canDelete} close={() => setEditing(null)} save={(candidate, projection) => { if (onUpdate(candidate, editing.updatedAt, data.revision, projection)) { setEditing(null); return true; } return false; }} onDelete={candidate => { if (onDelete(candidate, data.revision)) { setEditing(null); return true; } return false; }}/>}
  </section>;
}

function InternalControlStatsView({ stats }: { stats: ReturnType<typeof buildInternalControlStats> }) {
  const dimensions: Array<[string, Array<{ label: string; count: number }>]> = [['船舶', stats.byVessel], ['船型', stats.byShipType], ['關注程度', stats.byPriority], ['分類', stats.byCategory], ['涉及部門', stats.byDepartment], ['報告來源', stats.bySource]];
  return <section className="ic-stats"><div className="metric-grid"><div className="metric-card blue"><small>案件總數</small><b>{stats.total}</b><span>件</span></div><div className="metric-card pink"><small>內控未完</small><b>{stats.open}</b><span>件</span></div><div className="metric-card mint"><small>已結案</small><b>{stats.closed}</b><span>件</span></div><div className="metric-card purple"><small>急／高關注</small><b>{stats.highAttention}</b><span>件</span></div><div className="metric-card yellow"><small>結案率</small><b>{stats.closureRate}</b><span>%</span></div></div><div className="ic-stat-grid">{dimensions.map(([label, rows]) => <div className="panel" key={label}><h2>{label}分布</h2>{rows.length ? rows.slice(0, 12).map(row => <div className="ic-stat-row" key={row.label}><span>{row.label}</span><i style={{ width: `${Math.max(4, stats.total ? row.count / stats.total * 100 : 0)}%` }}/><b>{row.count}</b></div>) : <p className="muted">沒有資料</p>}</div>)}<div className="panel ic-trend-panel"><h2>月度趨勢</h2><table className="compact"><thead><tr><th>月份</th><th>新增</th><th>結案</th></tr></thead><tbody>{stats.monthlyTrend.map(row => <tr key={row.month}><td>{row.month}</td><td>{row.created}</td><td>{row.closed}</td></tr>)}</tbody></table></div></div></section>;
}
