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
import { internalControlEditLockKey } from './exclusiveItemEditLock';
import { vesselSupervisorOptions } from './vesselDashboardFilters';
import { sanitizeInternalControlSelection } from './batchInternalControlActions';
import VesselListFilter from './VesselListFilter';
import {
  matchesListVesselSelection,
  nextListColumnSort,
  sanitizeListVesselIds,
  sortListRecords,
  type ListColumnSort,
} from './listVesselControls';

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
  onCreate: (items: InternalControlCase[], expectedRevision: number, projections: Record<string, InternalControlTaskProjection>) => boolean | Promise<boolean>;
  onUpdate: (item: InternalControlCase, expectedUpdatedAt: string, expectedRevision: number, projection?: InternalControlTaskProjection) => boolean | Promise<boolean>;
  onDelete: (item: InternalControlCase, expectedRevision: number) => boolean | Promise<boolean>;
  onBatchDelete: (caseIds: string[]) => boolean | Promise<boolean>;
  onOpenTask: (taskId: string) => void;
  claimItemLease?: (sectionKey:string,label:string)=>Promise<AppData|null>;
  requireItemLease?: (sectionKey:string)=>boolean;
  releaseItemLease?: (sectionKey:string)=>Promise<boolean>;
  activeItemLeaseKey?: string;
};

const emptyFilters = (vesselIds: string[]): InternalControlFilters => ({
  keyword: '', ownerMode: 'mine', vesselIds, shipTypes: [], priorities: [], categories: [], departments: [], reportSources: [], equipmentSubcategories: [], supervisorIds: [], syncMode: 'all', fromDate: '', toDate: '', awareMode: 'all', closureMode: 'all',
});

function MultiFilter({ label, options, selected, onChange }: { label: string; options: MultiOption[]; selected: string[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  return <details className="ic-filter-group"><summary>{label}<span>{selected.length ? `已選 ${selected.length}` : '不限'}</span></summary><div className="ic-filter-actions"><button type="button" className="btn small ghost" onClick={() => onChange(options.map(item => item.value))}>全選</button><button type="button" className="btn small ghost" onClick={() => onChange([])}>清除</button></div><div className="ic-filter-options">{options.map(option => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)}/><span>{option.label}</span></label>)}</div></details>;
}

const optionList = (values: string[]): MultiOption[] => values.filter(Boolean).map(value => ({ value, label: value }));
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
const priorityClass = (priority: TaskPriority) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';

export default function InternalControlPage({ data, user, vessels, canCreate, canEdit, canClose, canDelete, canExport, authorizationEpoch, onCreate, onUpdate, onDelete, onBatchDelete, onOpenTask, claimItemLease, requireItemLease, releaseItemLease, activeItemLeaseKey }: Props) {
  const [subpage, setSubpage] = useState<Subpage>('open');
  const [filters, setFilters] = useState<InternalControlFilters>(() => emptyFilters(defaultInternalControlVesselIds(user, vessels)));
  const [batchOpen, setBatchOpen] = useState(false);
  const [editing, setEditing] = useState<InternalControlCase | null>(null);
  const [editorAuthorizationEpoch,setEditorAuthorizationEpoch]=useState('');
  const [batchAuthorizationEpoch,setBatchAuthorizationEpoch]=useState('');
  const [page, setPage] = useState(1);
  const [columnSort,setColumnSort]=useState<ListColumnSort>('created-desc');
  const [selectedCaseIds,setSelectedCaseIds]=useState<string[]>([]);
  const [batchDeleting,setBatchDeleting]=useState(false);
  const visibleVesselIds = useMemo(() => new Set(vessels.map(vessel => vessel.id)), [vessels]);
  const scopedCases = data.internalControlCases.filter(item => visibleVesselIds.has(item.vesselId));
  const managedVesselIds=managedInternalControlVesselIds(user,vessels);
  const vesselSelection={mode:filters.ownerMode,vesselIds:filters.vesselIds};
  const vesselFilteredCases=scopedCases.filter(item=>matchesListVesselSelection([item.vesselId],vesselSelection,managedVesselIds,user.id));
  const activeClosure: InternalControlFilters['closureMode'] = subpage === 'open' ? 'open' : subpage === 'closed' ? 'closed' : 'all';
  const effectiveFilters = { ...filters, closureMode: activeClosure };
  const filtered = sortListRecords(
    filterInternalControlCases(vesselFilteredCases, vessels, effectiveFilters, data.users),
    columnSort,
    item=>vesselDisplayName(vessels.find(vessel=>vessel.id===item.vesselId)),
    item=>item.reportDate,
    item=>item.closedDate,
  );
  const paged = paginateItems(filtered, page, 30);
  const stats = buildInternalControlStats(filtered, vessels);
  const selectableCases=canDelete?filtered:[];
  const selectedSet=new Set(selectedCaseIds);
  const selectedCases=selectableCases.filter(item=>selectedSet.has(item.id));
  const allSelected=selectableCases.length>0&&selectableCases.every(item=>selectedSet.has(item.id));
  const visibleEditing=Boolean(editing&&editorAuthorizationEpoch===authorizationEpoch&&scopedCases.some(item=>item.id===editing.id));
  const visibleBatch=Boolean(batchOpen&&batchAuthorizationEpoch===authorizationEpoch&&canCreate&&vessels.length);
  const canMutateItem=canEdit||canClose||canDelete;
  const itemLeaseEnforced=activeItemLeaseKey!==undefined;
  const editorWritable=!canMutateItem||!itemLeaseEnforced||Boolean(editing&&activeItemLeaseKey===internalControlEditLockKey(editing.id));

  useEffect(() => setPage(1), [subpage, JSON.stringify(filters),columnSort]);
  useEffect(()=>{
    setSelectedCaseIds(previous=>{
      const next=sanitizeInternalControlSelection(previous,selectableCases);
      return next.length===previous.length&&next.every((id,index)=>id===previous[index])?previous:next;
    });
  },[data.internalControlCases,subpage,JSON.stringify(filters),canDelete,user.id,vessels]);
  useEffect(()=>{setEditing(null);setBatchOpen(false);setEditorAuthorizationEpoch('');setBatchAuthorizationEpoch('');},[authorizationEpoch]);
  useEffect(() => {
    setFilters(previous => {
      const vesselIds=previous.ownerMode==='mine'
        ? defaultInternalControlVesselIds(user,vessels)
        : previous.ownerMode==='all'
          ? []
          : sanitizeListVesselIds(previous.vesselIds,vessels);
      if(vesselIds.length===previous.vesselIds.length&&vesselIds.every((id,index)=>id===previous.vesselIds[index]))return previous;
      return {...previous,vesselIds};
    });
  }, [user.id, data.revision, vessels]);

  const shipTypes = unique(vessels.map(vessel => vessel.shipType));
  const categories = unique([...data.settings.taskCategories, ...scopedCases.map(item => item.category), '設備故障']);
  const departments = unique([...data.settings.departments, ...scopedCases.flatMap(item => item.departments)]);
  const supervisorOptions = vesselSupervisorOptions(vessels, data.users).map(option => ({ value: option.id, label: option.name }));
  const setFilter = <K extends keyof InternalControlFilters>(key: K, value: InternalControlFilters[K]) => setFilters(previous => ({ ...previous, [key]: value }));
  const reset = () => {setFilters(emptyFilters(defaultInternalControlVesselIds(user, vessels)));setColumnSort('created-desc');};
  const selectedVesselNames = filters.vesselIds.map(id => vessels.find(vessel => vessel.id === id)).filter((vessel): vessel is Vessel => Boolean(vessel)).map(vesselDisplayName);
  const vesselSummary=filters.ownerMode==='all'?'全部':filters.ownerMode==='mine'?'只看我的經管':selectedVesselNames.length?selectedVesselNames.join('、'):'未選船舶';
  const summary = `船舶 ${vesselSummary}；日期 ${filters.fromDate || '不限'}～${filters.toDate || '不限'}；${subpage === 'open' ? '未完' : subpage === 'closed' ? '已結案' : '全部案件'}`;
  const print = () => {
    if (!canExport) return;
    document.body.classList.add('printing-internal-control');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-internal-control'), { once: true });
    window.setTimeout(() => window.print(), 80);
  };
  const openCase=async(item:InternalControlCase)=>{
    let fresh=item;
    if(canMutateItem){
      const snapshot=claimItemLease?await claimItemLease(internalControlEditLockKey(item.id),`內控異常｜${richTextToPlainText(item.description)||item.id}`):data;
      if(!snapshot)return;
      const latest=snapshot.internalControlCases.find(candidate=>candidate.id===item.id);
      if(!latest){if(releaseItemLease)await releaseItemLease(internalControlEditLockKey(item.id));return;}
      fresh=latest;
    }
    setEditorAuthorizationEpoch(authorizationEpoch);
    setEditing(structuredClone(fresh));
  };
  const closeEditor=async()=>{
    if(editing&&canMutateItem&&activeItemLeaseKey===internalControlEditLockKey(editing.id)&&releaseItemLease&&!await releaseItemLease(internalControlEditLockKey(editing.id)))return;
    setEditing(null);
  };
  const toggleAllCases=()=>setSelectedCaseIds(allSelected?[]:selectableCases.map(item=>item.id));
  const toggleCase=(id:string)=>setSelectedCaseIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const deleteSelectedCases=async()=>{
    if(batchDeleting||!selectedCases.length)return;
    setBatchDeleting(true);
    try{if(await onBatchDelete(selectedCases.map(item=>item.id)))setSelectedCaseIds([]);}
    finally{setBatchDeleting(false);}
  };
  const changeSubpage=(next:Subpage)=>{
    setSubpage(next);
    if(next!=='closed'&&(columnSort==='closed-date-asc'||columnSort==='closed-date-desc'))setColumnSort('created-desc');
  };

  return <section className="internal-control-page">
    <div className="page-heading"><div><h1>內控異常</h1><p>督導日常、訪船、隨船及外部發現事項的獨立登記、跟進、結案與統計。</p></div><div className="heading-actions no-print">{canCreate && <button className="btn green" onClick={() => {setBatchAuthorizationEpoch(authorizationEpoch);setBatchOpen(true);}}>＋ 批量新增</button>}{canExport && <button className="btn ghost" disabled={!filtered.length} onClick={() => downloadInternalControlExcel(filtered, vessels, summary)}>導出 Excel</button>}{canExport && <button className="btn primary" disabled={!filtered.length} onClick={print}>導出 PDF</button>}</div></div>
    <div className="ic-tabs no-print" role="tablist"><button className={subpage === 'open' ? 'active' : ''} onClick={() => changeSubpage('open')}>內控未完清單 <b>{scopedCases.filter(item => !item.isClosed).length}</b></button><button className={subpage === 'closed' ? 'active' : ''} onClick={() => changeSubpage('closed')}>內控結案清單 <b>{scopedCases.filter(item => item.isClosed).length}</b></button><button className={subpage === 'stats' ? 'active' : ''} onClick={() => changeSubpage('stats')}>數據統計</button></div>

    <section className="panel ic-filter-panel no-print">
      <div className="panel-title"><h2>篩選條件 <span className="muted">目前 {filtered.length} 件</span></h2><div><button className="btn small ghost" onClick={reset}>重設（我的經管）</button></div></div>
      <div className="ic-filter-primary"><input aria-label="內控異常關鍵字" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value)} placeholder="搜尋事項、狀態、船舶、分類、部門…"/><label>報告日期起<input type="date" value={filters.fromDate} onChange={event => setFilter('fromDate', event.target.value)}/></label><label>報告日期迄<input type="date" value={filters.toDate} onChange={event => setFilter('toDate', event.target.value)}/></label><label>知曉事項<select value={filters.awareMode} onChange={event => setFilter('awareMode', event.target.value as InternalControlFilters['awareMode'])}><option value="all">不限</option><option value="aware">是</option><option value="not-aware">否</option></select></label></div>
      <div className="ic-filter-grid"><VesselListFilter vessels={vessels} mode={filters.ownerMode} selectedVesselIds={filters.vesselIds} onChange={selection=>setFilters(previous=>({...previous,ownerMode:selection.mode,vesselIds:selection.vesselIds}))} ariaLabel="內控清單船舶篩選"/><MultiFilter label="船舶類型" options={optionList(shipTypes)} selected={filters.shipTypes} onChange={value => setFilter('shipTypes', value)}/><MultiFilter label="重要程度" options={optionList(data.settings.priorities)} selected={filters.priorities} onChange={value => setFilter('priorities', value as TaskPriority[])}/><MultiFilter label="事項分類" options={optionList(categories)} selected={filters.categories} onChange={value => setFilter('categories', value)}/><MultiFilter label="涉及部門" options={optionList(departments)} selected={filters.departments} onChange={value => setFilter('departments', value)}/><MultiFilter label="報告來源" options={optionList(REPORT_SOURCES)} selected={filters.reportSources} onChange={value => setFilter('reportSources', value as InternalControlReportSource[])}/><MultiFilter label="設備故障細項" options={optionList(data.settings.equipmentFailureSubcategories)} selected={filters.equipmentSubcategories} onChange={value => setFilter('equipmentSubcategories', value)}/><MultiFilter label="經管督導" options={supervisorOptions} selected={filters.supervisorIds} onChange={value => setFilter('supervisorIds', value)}/><label className="ic-filter-group ic-filter-select"><span>是否和要事同步</span><select aria-label="是否和要事同步" value={filters.syncMode} onChange={event => setFilter('syncMode', event.target.value as InternalControlFilters['syncMode'])}><option value="all">不限</option><option value="synced">已同步要事</option><option value="not-synced">未同步要事</option></select></label></div>
    </section>

    {subpage !== 'stats' ? <section className="panel ic-list-panel">
      <div className="panel-title ic-batch-toolbar no-print"><h2>{subpage==='open'?'內控未完清單':'內控結案清單'} <span className="muted">目前 {filtered.length} 件</span></h2>{canDelete&&<div className="heading-actions"><button type="button" className="btn small ghost" onClick={toggleAllCases} disabled={batchDeleting||!selectableCases.length}>{allSelected?'取消全選':'全選目前結果'}</button><span className="batch-selection-count">已選 {selectedCases.length}</span><button type="button" className="btn small red" onClick={()=>void deleteSelectedCases()} disabled={batchDeleting||!selectedCases.length}>{batchDeleting?'刪除中…':<>批量刪除（{selectedCases.length}）</>}</button></div>}</div>
      <div className="table-wrap"><table className="compact ic-table"><thead><tr>
        {canDelete&&<th className="no-print ic-select-column"><input type="checkbox" aria-label="選取目前全部內控案件" checked={allSelected} onChange={toggleAllCases} disabled={batchDeleting||!selectableCases.length}/></th>}<th className="ic-vessel-date-column"><span className="table-sort-pair"><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'vessel'))}>船舶 <span>{columnSort==='vessel-asc'?'↑':columnSort==='vessel-desc'?'↓':'↕'}</span></button><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'date'))}>報告日期 <span>{columnSort==='date-asc'?'↑':columnSort==='date-desc'?'↓':'↕'}</span></button></span></th><th>來源</th><th>關注</th><th className="ic-description-column">事項內容</th><th>分類／部門</th><th className="ic-status-column">最新狀態</th>{subpage === 'closed' ? <th className="ic-closure-column"><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'closed-date'))}>結案日期 <span>{columnSort==='closed-date-asc'?'↑':columnSort==='closed-date-desc'?'↓':'↕'}</span></button></th> : <th className="ic-sync-column">同步</th>}<th className="no-print">操作</th>
      </tr></thead><tbody>{paged.items.map(item => {
        const vessel = vessels.find(entry => entry.id === item.vesselId);
        return <tr key={item.id} className={selectedSet.has(item.id)?'batch-selected-row':''}>
          {canDelete&&<td className="no-print ic-select-column"><input type="checkbox" aria-label={`選取內控案件 ${richTextToPlainText(item.description)||item.id}`} checked={selectedSet.has(item.id)} onChange={()=>toggleCase(item.id)} disabled={batchDeleting}/></td>}
          <td><b>{vessel ? vesselDisplayName(vessel) : item.vesselId}</b><small>{vessel?.shipType || '未填船型'}｜{item.reportDate}</small></td>
          <td>{item.reportSource}{item.isAware && <small>知曉事項</small>}</td>
          <td><span className={`priority-pill ${priorityClass(item.priority)}`}>{item.priority}</span></td>
          <td className="ic-description-column"><b>{richTextToPlainText(item.description)}</b></td>
          <td>{item.category}{item.equipmentSubcategory && <small>{item.equipmentSubcategory}</small>}<small>{item.departments.join('、') || '未指定部門'}</small></td>
          <td className="ic-status-column">{richTextToPlainText(item.status) || '尚未更新'}<small>更新 {item.updatedAt.slice(0, 10)}</small></td>
          {subpage === 'closed' ? <td className="ic-closure-column"><b>已結案</b><small>{item.closedDate || '-'}</small></td> : <td className="ic-sync-column"><b>{item.linkedTaskId ? '已同步要事' : '未同步要事'}</b></td>}
          <td className="no-print"><div className="table-actions"><button className="btn small primary" onClick={() => void openCase(item)}>{canEdit ? '更新' : '查看'}</button>{item.linkedTaskId && <button className="btn small ghost" onClick={() => onOpenTask(item.linkedTaskId!)}>要事</button>}</div></td>
        </tr>;
      })}</tbody></table></div>
      {!filtered.length && <div className="empty-state">目前篩選條件沒有案件</div>}<PaginationControls page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} onPageChange={setPage} ariaLabel="內控異常分頁"/>
    </section> : <InternalControlStatsView stats={stats}/>}

    <section className="internal-control-print print-only"><h1>內控異常{ subpage === 'open' ? '未完清單' : subpage === 'closed' ? '結案清單' : '統計報告'}</h1><p>{summary}｜共 {filtered.length} 件｜匯出人 {user.name}｜{new Date().toLocaleString('zh-TW')}</p>{subpage === 'stats' ? <InternalControlStatsView stats={stats}/> : <table><thead><tr><th>船舶</th><th>報告日期／來源</th><th>關注</th><th>事項</th><th>分類／細項</th><th>部門</th><th>狀態</th><th>結案</th></tr></thead><tbody>{filtered.map(item => { const vessel = vessels.find(entry => entry.id === item.vesselId); return <tr key={item.id}><td>{vessel ? vesselDisplayName(vessel) : item.vesselId}</td><td>{item.reportDate}｜{item.reportSource}</td><td>{item.priority}</td><td>{richTextToPlainText(item.description)}</td><td>{item.category}{item.equipmentSubcategory ? `｜${item.equipmentSubcategory}` : ''}</td><td>{item.departments.join('、')}</td><td>{richTextToPlainText(item.status)}</td><td>{item.closedDate || '未結'}</td></tr>; })}</tbody></table>}</section>

    {visibleBatch && <BatchCreateModal data={data} user={user} vessels={vessels} close={() => setBatchOpen(false)} save={async (items, projections) => { if (await onCreate(items, data.revision, projections)) { setBatchOpen(false); return true; } return false; }}/>}
    {visibleEditing && editing && <CaseEditModal
      item={editing} data={data} vessels={vessels}
      canEdit={canEdit&&editorWritable} canClose={canClose&&editorWritable} canDelete={canDelete&&editorWritable}
      close={() => void closeEditor()}
      save={async (candidate, projection) => {
        if(requireItemLease&&!requireItemLease(internalControlEditLockKey(editing.id)))return false;
        if (await onUpdate(candidate, editing.updatedAt, data.revision, projection)) {
          if(!releaseItemLease||await releaseItemLease(internalControlEditLockKey(editing.id)))setEditing(null);
          return true;
        }
        return false;
      }}
      onDelete={async candidate => {
        if(requireItemLease&&!requireItemLease(internalControlEditLockKey(editing.id)))return false;
        if (await onDelete(candidate, data.revision)) {
          if(!releaseItemLease||await releaseItemLease(internalControlEditLockKey(editing.id)))setEditing(null);
          return true;
        }
        return false;
      }}
    />}
  </section>;
}

function InternalControlStatsView({ stats }: { stats: ReturnType<typeof buildInternalControlStats> }) {
  const dimensions: Array<[string, Array<{ label: string; count: number }>]> = [['船舶', stats.byVessel], ['船型', stats.byShipType], ['關注程度', stats.byPriority], ['分類', stats.byCategory], ['涉及部門', stats.byDepartment], ['報告來源', stats.bySource]];
  return <section className="ic-stats"><div className="metric-grid"><div className="metric-card blue"><small>案件總數</small><b>{stats.total}</b><span>件</span></div><div className="metric-card pink"><small>內控未完</small><b>{stats.open}</b><span>件</span></div><div className="metric-card mint"><small>已結案</small><b>{stats.closed}</b><span>件</span></div><div className="metric-card purple"><small>急／高關注</small><b>{stats.highAttention}</b><span>件</span></div><div className="metric-card yellow"><small>結案率</small><b>{stats.closureRate}</b><span>%</span></div></div><div className="ic-stat-grid">{dimensions.map(([label, rows]) => <div className="panel" key={label}><h2>{label}分布</h2>{rows.length ? rows.slice(0, 12).map(row => <div className="ic-stat-row" key={row.label}><span>{row.label}</span><i style={{ width: `${Math.max(4, stats.total ? row.count / stats.total * 100 : 0)}%` }}/><b>{row.count}</b></div>) : <p className="muted">沒有資料</p>}</div>)}<div className="panel ic-trend-panel"><h2>月度趨勢</h2><table className="compact"><thead><tr><th>月份</th><th>新增</th><th>結案</th></tr></thead><tbody>{stats.monthlyTrend.map(row => <tr key={row.month}><td>{row.month}</td><td>{row.created}</td><td>{row.closed}</td></tr>)}</tbody></table></div></div></section>;
}
