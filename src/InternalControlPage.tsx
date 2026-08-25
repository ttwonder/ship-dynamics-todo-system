import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, InternalControlCase, InternalControlFilters, InternalControlReportSource, TaskPriority, UserAccount, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';
import { richTextToPlainText } from './richText';
import {
  buildInternalControlStats,
  defaultInternalControlVesselSelection,
  filterInternalControlCases,
  managedInternalControlVesselIds,
} from './internalControlWorkflow';
import { downloadInternalControlExcel } from './internalControlExport';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { BatchCreateModal, CaseEditModal } from './InternalControlModals';
import type { InternalControlTaskProjection } from './internalControlData';
import { internalControlTaskSyncWithdrawalEligibility } from './internalControlTaskSyncWithdrawal';
import { internalControlEditLockKey } from './exclusiveItemEditLock';
import { vesselSupervisorOptions } from './vesselDashboardFilters';
import { sanitizeInternalControlSelection } from './batchInternalControlActions';
import VesselListFilter from './VesselListFilter';
import { formatTaipeiDate, formatTaipeiDateTime } from './taipeiTime';
import { selectedListRecords } from './selectedListExport';
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
  requestedCaseId?: string;
  onRequestedCaseHandled?: () => void;
  onCreate: (items: InternalControlCase[], expectedRevision: number, projections: Record<string, InternalControlTaskProjection>) => boolean | Promise<boolean>;
  onUpdate: (item: InternalControlCase, expectedUpdatedAt: string, expectedRevision: number, projection?: InternalControlTaskProjection) => boolean | Promise<boolean>;
  onWithdrawTaskSync: (item: InternalControlCase, expectedTaskUpdatedAt: string, expectedRevision: number) => boolean | Promise<boolean>;
  onDelete: (item: InternalControlCase, expectedRevision: number) => boolean | Promise<boolean>;
  onBatchClose: (caseIds: string[]) => boolean | Promise<boolean>;
  onBatchDelete: (caseIds: string[]) => boolean | Promise<boolean>;
  onOpenTask: (taskId: string) => void;
  claimItemLease?: (sectionKey:string,label:string)=>Promise<AppData|null>;
  requireItemLease?: (sectionKey:string)=>boolean;
  releaseItemLease?: (sectionKey:string)=>Promise<boolean>;
  activeItemLeaseKey?: string;
};

const emptyFilters = (selection: ReturnType<typeof defaultInternalControlVesselSelection>): InternalControlFilters => ({
  keyword: '', ownerMode: selection.mode, vesselIds: selection.vesselIds, shipTypes: [], priorities: [], categories: [], departments: [], reportSources: [], equipmentSubcategories: [], supervisorIds: [], syncMode: 'all', fromDate: '', toDate: '', awareMode: 'all', closureMode: 'all',
});

function MultiFilter({ label, options, selected, onChange }: { label: string; options: MultiOption[]; selected: string[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  return <details className="ic-filter-group"><summary>{label}<span className={`ic-filter-state ${selected.length ? 'active' : 'inactive'}`}>{selected.length ? `已選 ${selected.length}` : '不限'}</span></summary><div className="ic-filter-actions"><button type="button" className="btn small ghost" onClick={() => onChange(options.map(item => item.value))}>全選</button><button type="button" className="btn small ghost" onClick={() => onChange([])}>清除</button></div><div className="ic-filter-options">{options.map(option => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)}/><span>{option.label}</span></label>)}</div></details>;
}

const optionList = (values: string[]): MultiOption[] => values.filter(Boolean).map(value => ({ value, label: value }));
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
const priorityClass = (priority: TaskPriority) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';

export default function InternalControlPage({ data, user, vessels, canCreate, canEdit, canClose, canDelete, canExport, authorizationEpoch, requestedCaseId, onRequestedCaseHandled, onCreate, onUpdate, onWithdrawTaskSync, onDelete, onBatchClose, onBatchDelete, onOpenTask, claimItemLease, requireItemLease, releaseItemLease, activeItemLeaseKey }: Props) {
  const [subpage, setSubpage] = useState<Subpage>('open');
  const [filters, setFilters] = useState<InternalControlFilters>(() => emptyFilters(defaultInternalControlVesselSelection(user, vessels)));
  const [batchOpen, setBatchOpen] = useState(false);
  const [editing, setEditing] = useState<InternalControlCase | null>(null);
  const [editingTaskSyncVersion,setEditingTaskSyncVersion]=useState<{taskId:string;updatedAt:string}|null>(null);
  const [editorAuthorizationEpoch,setEditorAuthorizationEpoch]=useState('');
  const [batchAuthorizationEpoch,setBatchAuthorizationEpoch]=useState('');
  const [page, setPage] = useState(1);
  const [columnSort,setColumnSort]=useState<ListColumnSort>('created-desc');
  const [selectedCaseIds,setSelectedCaseIds]=useState<string[]>([]);
  const [batchClosing,setBatchClosing]=useState(false);
  const [batchDeleting,setBatchDeleting]=useState(false);
  const handledRequestedCaseId=useRef('');
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
  const canSelectCases=subpage!=='stats'&&((subpage==='open'&&canClose)||canDelete||canExport);
  const selectableCases=canSelectCases?filtered:[];
  const selectableCaseIdsKey=selectableCases.map(item=>item.id).join('\u0000');
  const selectedSet=new Set(selectedCaseIds);
  const selectedCases=selectedListRecords(selectableCases,selectedCaseIds);
  const printCases=subpage==='stats'?filtered:selectedCases;
  const allSelected=selectableCases.length>0&&selectableCases.every(item=>selectedSet.has(item.id));
  const visibleEditing=Boolean(editing&&editorAuthorizationEpoch===authorizationEpoch&&scopedCases.some(item=>item.id===editing.id));
  const visibleBatch=Boolean(batchOpen&&batchAuthorizationEpoch===authorizationEpoch&&canCreate&&vessels.length);
  const canMutateItem=canEdit||canClose||canDelete;
  const itemLeaseEnforced=activeItemLeaseKey!==undefined;
  const editorWritable=!canMutateItem||!itemLeaseEnforced||Boolean(editing&&activeItemLeaseKey===internalControlEditLockKey(editing.id));
  const liveWithdrawalEligibility=editing?internalControlTaskSyncWithdrawalEligibility(data,editing.id):null;
  const liveWithdrawalTask=liveWithdrawalEligibility?.eligible?data.tasks.find(task=>task.id===liveWithdrawalEligibility.taskId):undefined;
  const canWithdrawSync=Boolean(canEdit
    &&editorWritable
    &&editingTaskSyncVersion
    &&liveWithdrawalEligibility?.eligible
    &&liveWithdrawalEligibility.taskId===editingTaskSyncVersion.taskId
    &&liveWithdrawalTask?.updatedAt===editingTaskSyncVersion.updatedAt);
  const withdrawSyncReason=!editorWritable
    ?'目前未持有此案件的編輯鎖'
    :liveWithdrawalEligibility&&'reason' in liveWithdrawalEligibility
      ?liveWithdrawalEligibility.reason
      :editingTaskSyncVersion&&liveWithdrawalTask?.updatedAt!==editingTaskSyncVersion.updatedAt
        ?'關聯要事已更新，請關閉後重新開啟'
        :'';

  useEffect(() => setPage(1), [subpage, JSON.stringify(filters),columnSort]);
  useEffect(()=>{
    setSelectedCaseIds(previous=>{
      const next=sanitizeInternalControlSelection(previous,selectableCases);
      return next.length===previous.length&&next.every((id,index)=>id===previous[index])?previous:next;
    });
  },[selectableCaseIdsKey]);
  useEffect(()=>{setEditing(null);setEditingTaskSyncVersion(null);setBatchOpen(false);setEditorAuthorizationEpoch('');setBatchAuthorizationEpoch('');},[authorizationEpoch]);
  useEffect(() => {
    setFilters(previous => {
      const defaultSelection=defaultInternalControlVesselSelection(user,vessels);
      if(previous.ownerMode==='mine'&&defaultSelection.mode==='all')return {...previous,...defaultSelection};
      const vesselIds=previous.ownerMode==='mine'
        ? defaultSelection.vesselIds
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
  const resetSelection=defaultInternalControlVesselSelection(user,vessels);
  const reset = () => {setFilters(emptyFilters(resetSelection));setColumnSort('created-desc');};
  const selectedVesselNames = filters.vesselIds.map(id => vessels.find(vessel => vessel.id === id)).filter((vessel): vessel is Vessel => Boolean(vessel)).map(vesselDisplayName);
  const vesselSummary=filters.ownerMode==='all'?'全部':filters.ownerMode==='mine'?'只看我的經管':selectedVesselNames.length?selectedVesselNames.join('、'):'未選船舶';
  const summary = `船舶 ${vesselSummary}；日期 ${filters.fromDate || '不限'}～${filters.toDate || '不限'}；${subpage === 'open' ? '未完' : subpage === 'closed' ? '已結案' : '全部案件'}`;
  const print = () => {
    if (!canExport||(subpage!=='stats'&&!selectedCases.length)) return;
    document.body.classList.add('printing-internal-control');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-internal-control'), { once: true });
    window.setTimeout(() => window.print(), 80);
  };
  const openCase=async(item:InternalControlCase)=>{
    let fresh=item;
    let freshData=data;
    if(canMutateItem){
      const snapshot=claimItemLease?await claimItemLease(internalControlEditLockKey(item.id),`內控異常｜${richTextToPlainText(item.description)||item.id}`):data;
      if(!snapshot)return;
      const latest=snapshot.internalControlCases.find(candidate=>candidate.id===item.id);
      if(!latest){if(releaseItemLease)await releaseItemLease(internalControlEditLockKey(item.id));return;}
      fresh=latest;
      freshData=snapshot;
    }
    const withdrawalEligibility=internalControlTaskSyncWithdrawalEligibility(freshData,fresh.id);
    const linkedTask=withdrawalEligibility.eligible?freshData.tasks.find(task=>task.id===withdrawalEligibility.taskId):undefined;
    setEditingTaskSyncVersion(withdrawalEligibility.eligible&&linkedTask?{taskId:withdrawalEligibility.taskId,updatedAt:linkedTask.updatedAt}:null);
    setEditorAuthorizationEpoch(authorizationEpoch);
    setEditing(structuredClone(fresh));
  };
  useEffect(()=>{
    if(!requestedCaseId){handledRequestedCaseId.current='';return;}
    if(handledRequestedCaseId.current===requestedCaseId)return;
    handledRequestedCaseId.current=requestedCaseId;
    const item=scopedCases.find(candidate=>candidate.id===requestedCaseId);
    onRequestedCaseHandled?.();
    if(!item){alert('這筆內控異常已不存在或目前帳號無權查看');return;}
    void openCase(item);
  },[requestedCaseId]);
  const closeEditor=async()=>{
    if(editing&&canMutateItem&&activeItemLeaseKey===internalControlEditLockKey(editing.id)&&releaseItemLease&&!await releaseItemLease(internalControlEditLockKey(editing.id)))return;
    setEditing(null);
    setEditingTaskSyncVersion(null);
  };
  const toggleAllCases=()=>setSelectedCaseIds(allSelected?[]:selectableCases.map(item=>item.id));
  const toggleCase=(id:string)=>setSelectedCaseIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const closeSelectedCases=async()=>{
    if(batchClosing||batchDeleting||subpage!=='open'||!selectedCases.length)return;
    setBatchClosing(true);
    try{if(await onBatchClose(selectedCases.map(item=>item.id)))setSelectedCaseIds([]);}
    finally{setBatchClosing(false);}
  };
  const deleteSelectedCases=async()=>{
    if(batchClosing||batchDeleting||!selectedCases.length)return;
    setBatchDeleting(true);
    try{if(await onBatchDelete(selectedCases.map(item=>item.id)))setSelectedCaseIds([]);}
    finally{setBatchDeleting(false);}
  };
  const changeSubpage=(next:Subpage)=>{
    setSubpage(next);
    if(next!=='closed'&&(columnSort==='closed-date-asc'||columnSort==='closed-date-desc'))setColumnSort('created-desc');
  };

  return <section className="internal-control-page">
    <div className="page-heading"><div><h1>內控異常</h1><p>督導日常、訪船、隨船及外部發現事項的獨立登記、跟進、結案與統計。</p></div><div className="heading-actions no-print">{canCreate && <button className="btn green" onClick={() => {setBatchAuthorizationEpoch(authorizationEpoch);setBatchOpen(true);}}>＋ 批量新增</button>}{canExport && <button className="btn ghost" disabled={!filtered.length} onClick={() => downloadInternalControlExcel(filtered, vessels, summary)}>導出 Excel</button>}{canExport && <button className="btn primary" disabled={subpage==='stats'?!filtered.length:!selectedCases.length} onClick={print}>{subpage==='stats'?'導出 PDF':`導出所選 PDF（${selectedCases.length}）`}</button>}</div></div>
    <div className="ic-tabs no-print" role="tablist"><button className={subpage === 'open' ? 'active' : ''} onClick={() => changeSubpage('open')}>內控未完清單 <b>{scopedCases.filter(item => !item.isClosed).length}</b></button><button className={subpage === 'closed' ? 'active' : ''} onClick={() => changeSubpage('closed')}>內控結案清單 <b>{scopedCases.filter(item => item.isClosed).length}</b></button><button className={subpage === 'stats' ? 'active' : ''} onClick={() => changeSubpage('stats')}>數據統計</button></div>

    <section className="panel ic-filter-panel no-print">
      <div className="panel-title"><h2>篩選條件 <span className="muted">目前 {filtered.length} 件</span></h2><div><button className="btn small ghost" onClick={reset}>重設（{resetSelection.mode==='mine'?'我的經管':'所有船舶'}）</button></div></div>
      <div className="ic-filter-primary"><input aria-label="內控異常關鍵字" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value)} placeholder="搜尋事項、狀態、船舶、分類、部門…"/><label>報告日期起<input type="date" value={filters.fromDate} onChange={event => setFilter('fromDate', event.target.value)}/></label><label>報告日期迄<input type="date" value={filters.toDate} onChange={event => setFilter('toDate', event.target.value)}/></label><label>知曉事項<select value={filters.awareMode} onChange={event => setFilter('awareMode', event.target.value as InternalControlFilters['awareMode'])}><option value="all">不限</option><option value="aware">是</option><option value="not-aware">否</option></select></label></div>
      <div className="ic-filter-grid"><VesselListFilter vessels={vessels} mode={filters.ownerMode} selectedVesselIds={filters.vesselIds} onChange={selection=>setFilters(previous=>({...previous,ownerMode:selection.mode,vesselIds:selection.vesselIds}))} ariaLabel="內控清單船舶篩選"/><MultiFilter label="船舶類型" options={optionList(shipTypes)} selected={filters.shipTypes} onChange={value => setFilter('shipTypes', value)}/><MultiFilter label="重要程度" options={optionList(data.settings.priorities)} selected={filters.priorities} onChange={value => setFilter('priorities', value as TaskPriority[])}/><MultiFilter label="事項分類" options={optionList(categories)} selected={filters.categories} onChange={value => setFilter('categories', value)}/><MultiFilter label="涉及部門" options={optionList(departments)} selected={filters.departments} onChange={value => setFilter('departments', value)}/><MultiFilter label="報告來源" options={optionList(REPORT_SOURCES)} selected={filters.reportSources} onChange={value => setFilter('reportSources', value as InternalControlReportSource[])}/><MultiFilter label="設備故障細項" options={optionList(data.settings.equipmentFailureSubcategories)} selected={filters.equipmentSubcategories} onChange={value => setFilter('equipmentSubcategories', value)}/><MultiFilter label="經管督導" options={supervisorOptions} selected={filters.supervisorIds} onChange={value => setFilter('supervisorIds', value)}/><label className="ic-filter-group ic-filter-select"><span><span>是否同時被選中為要事</span><b className={`ic-filter-state ${filters.syncMode==='all'?'inactive':'active'}`}>{filters.syncMode==='all'?'不限':filters.syncMode==='synced'?'已同步':'未同步'}</b></span><select aria-label="是否同時被選中為要事" value={filters.syncMode} onChange={event => setFilter('syncMode', event.target.value as InternalControlFilters['syncMode'])}><option value="all">不限</option><option value="synced">已同步要事</option><option value="not-synced">未同步要事</option></select></label></div>
    </section>

    {subpage !== 'stats' ? <section className="panel ic-list-panel">
      <div className="panel-title ic-batch-toolbar no-print"><h2>{subpage==='open'?'內控未完清單':'內控結案清單'} <span className="muted">目前 {filtered.length} 件</span></h2>{canSelectCases&&<div className="heading-actions"><button type="button" className="btn small ghost" onClick={toggleAllCases} disabled={batchClosing||batchDeleting||!selectableCases.length}>{allSelected?'取消全選':'全選目前結果'}</button><span className="batch-selection-count">已選 {selectedCases.length}</span>{subpage==='open'&&canClose&&<button type="button" className="btn small green" onClick={()=>void closeSelectedCases()} disabled={batchClosing||batchDeleting||!selectedCases.length}>{batchClosing?'結案中…':<>批量結案（{selectedCases.length}）</>}</button>}{canDelete&&<button type="button" className="btn small red" onClick={()=>void deleteSelectedCases()} disabled={batchClosing||batchDeleting||!selectedCases.length}>{batchDeleting?'刪除中…':<>批量刪除（{selectedCases.length}）</>}</button>}</div>}</div>
      <div className="table-wrap"><table className="compact ic-table"><thead><tr>
        {canSelectCases&&<th className="no-print ic-select-column"><input type="checkbox" aria-label="選取目前全部內控案件" checked={allSelected} onChange={toggleAllCases} disabled={batchClosing||batchDeleting||!selectableCases.length}/></th>}<th className="ic-vessel-date-column"><span className="table-sort-pair"><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'vessel'))}>船舶 <span>{columnSort==='vessel-asc'?'↑':columnSort==='vessel-desc'?'↓':'↕'}</span></button><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'date'))}>報告日期 <span>{columnSort==='date-asc'?'↑':columnSort==='date-desc'?'↓':'↕'}</span></button></span></th><th>來源</th><th>關注</th><th className="ic-description-column">事項內容</th><th>分類／部門</th><th className="ic-status-column">最新狀態</th>{subpage === 'closed' ? <th className="ic-closure-column"><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'closed-date'))}>結案日期 <span>{columnSort==='closed-date-asc'?'↑':columnSort==='closed-date-desc'?'↓':'↕'}</span></button></th> : <th className="ic-sync-column">同步</th>}<th className="no-print">操作</th>
      </tr></thead><tbody>{paged.items.map(item => {
        const vessel = vessels.find(entry => entry.id === item.vesselId);
        return <tr key={item.id} className={selectedSet.has(item.id)?'batch-selected-row':''}>
          {canSelectCases&&<td className="no-print ic-select-column"><input type="checkbox" aria-label={`選取內控案件 ${richTextToPlainText(item.description)||item.id}`} checked={selectedSet.has(item.id)} onChange={()=>toggleCase(item.id)} disabled={batchClosing||batchDeleting}/></td>}
          <td><b>{vessel ? vesselDisplayName(vessel) : item.vesselId}</b><small>{vessel?.shipType || '未填船型'}｜{item.reportDate}</small></td>
          <td>{item.reportSource}{item.isAware && <small>知曉事項</small>}</td>
          <td><span className={`priority-pill ${priorityClass(item.priority)}`}>{item.priority}</span></td>
          <td className="ic-description-column"><b>{richTextToPlainText(item.description)}</b></td>
          <td>{item.category}{item.equipmentSubcategory && <small>{item.equipmentSubcategory}</small>}<small>{item.departments.join('、') || '未指定部門'}</small></td>
          <td className="ic-status-column">{richTextToPlainText(item.status) || '尚未更新'}<small>更新 {formatTaipeiDate(item.updatedAt)}</small></td>
          {subpage === 'closed' ? <td className="ic-closure-column"><b>已結案</b><small>{item.closedDate || '-'}</small></td> : <td className="ic-sync-column"><b>{item.linkedTaskId ? '已同步要事' : '未同步要事'}</b></td>}
          <td className="no-print"><div className="table-actions"><button className="btn small primary" onClick={() => void openCase(item)}>{canEdit ? '更新' : '查看'}</button>{item.linkedTaskId && <button className="btn small ghost" onClick={() => onOpenTask(item.linkedTaskId!)}>要事</button>}</div></td>
        </tr>;
      })}</tbody></table></div>
      {!filtered.length && <div className="empty-state">目前篩選條件沒有案件</div>}<PaginationControls page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} onPageChange={setPage} ariaLabel="內控異常分頁"/>
    </section> : <InternalControlStatsView stats={stats}/>}

    <section className="internal-control-print print-only"><h1>內控異常{ subpage === 'open' ? '未完清單（所選項目）' : subpage === 'closed' ? '結案清單（所選項目）' : '統計報告'}</h1><p>{summary}｜共 {printCases.length} 件｜匯出人 {user.name}｜{formatTaipeiDateTime(new Date())}</p>{subpage === 'stats' ? <InternalControlStatsView stats={stats}/> : <table><thead><tr><th>船舶</th><th>報告日期／來源</th><th>關注</th><th>事項</th><th>分類／細項</th><th>部門</th><th>狀態</th><th>結案</th></tr></thead><tbody>{printCases.map(item => { const vessel = vessels.find(entry => entry.id === item.vesselId); return <tr key={item.id}><td>{vessel ? vesselDisplayName(vessel) : item.vesselId}</td><td>{item.reportDate}｜{item.reportSource}</td><td>{item.priority}</td><td>{richTextToPlainText(item.description)}</td><td>{item.category}{item.equipmentSubcategory ? `｜${item.equipmentSubcategory}` : ''}</td><td>{item.departments.join('、')}</td><td>{richTextToPlainText(item.status)}</td><td>{item.closedDate || '未結'}</td></tr>; })}</tbody></table>}</section>

    {visibleBatch && <BatchCreateModal data={data} user={user} vessels={vessels} close={() => setBatchOpen(false)} save={async (items, projections) => { if (await onCreate(items, data.revision, projections)) { setBatchOpen(false); return true; } return false; }}/>}
    {visibleEditing && editing && <CaseEditModal
      item={editing} data={data} vessels={vessels}
      canEdit={canEdit&&editorWritable} canClose={canClose&&editorWritable} canDelete={canDelete&&editorWritable}
      showWithdrawSync={Boolean(canEdit&&editingTaskSyncVersion)} canWithdrawSync={canWithdrawSync} withdrawSyncReason={withdrawSyncReason}
      close={() => void closeEditor()}
      save={async (candidate, projection) => {
        if(requireItemLease&&!requireItemLease(internalControlEditLockKey(editing.id)))return false;
        if (await onUpdate(candidate, editing.updatedAt, data.revision, projection)) {
          if(!releaseItemLease||await releaseItemLease(internalControlEditLockKey(editing.id)))setEditing(null);
          return true;
        }
        return false;
      }}
      onWithdrawSync={async candidate => {
        if(!editingTaskSyncVersion)return false;
        if(requireItemLease&&!requireItemLease(internalControlEditLockKey(editing.id)))return false;
        return onWithdrawTaskSync(candidate,editingTaskSyncVersion.updatedAt,data.revision);
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
