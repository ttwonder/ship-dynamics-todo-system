import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppData, InternalControlCase, UserAccount, Vessel } from '../types';
import { BatchCreateModal } from '../InternalControlModals';
import type { InternalControlTaskProjection } from '../internalControlData';
import { uid, nowIso } from '../runtimeUtils';
import { vesselSelectionDisplayName } from '../vesselDisplay';
import { trackingColumnsFor } from './trackingColumns';
import { TRACKING_TABS, filterIsActive, selectTrackingRows, trackingInTab, trackingTabKind, type TrackingFilter, type TrackingQuery, type TrackingTab } from './trackingFilters';
import { defaultTrackingPreferences, readTrackingPreferences, trackingPreferenceKey, writeTrackingPreferences } from './trackingTablePreferences';
import { TrackingPagination, TrackingTable } from './TrackingTable';
import { commandForTrackingDraft, makeTrackingDraft, newTrackingItem, trackingAffectedLabels, TrackingBusinessModal, type TrackingAction, type TrackingDraft } from './TrackingModals';
import { trackingHelp, type TrackingAudience, type TrackingSubmission, type TrackingUiCallbacks } from './trackingUiTypes';
import type { TrackingItem } from './trackingTypes';
import TrackingImportModal from './TrackingImportModal';
import TrackingExports from './TrackingExports';
import './tracking.css';

const safeRead = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
function HelpAction({ label, help, disabled, onClick }: { label: string; help: string; disabled?: boolean; onClick: () => void }) {
  return <span className="tracking-help-action"><button className="btn small" title={help} disabled={disabled} onClick={onClick}>{label}</button><details><summary aria-label={`${label}說明`}>ⓘ</summary><span role="tooltip">{help}</span></details><span className="tracking-focus-help">{help}</span></span>;
}
function TrackingValueFilter({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  return <details className="tracking-value-filter">
    <summary aria-label={`${label}篩選內容`}>{selected.length ? `已選 ${selected.length} 項` : '不限內容'}</summary>
    <div className="tracking-value-options" role="group" aria-label={`${label}多選`}>
      {selected.length > 0 && <button type="button" className="btn small" onClick={() => onChange([])}>清除此欄選擇</button>}
      {values.length ? values.map(value => <label key={value} title={value}><input type="checkbox" checked={selected.includes(value)} onChange={event => onChange(event.target.checked ? [...selected, value] : selected.filter(item => item !== value))}/><span>{value}</span></label>) : <small>此清單沒有非空白內容</small>}
    </div>
  </details>;
}
interface SavedDraft { draft: TrackingDraft; pending: TrackingSubmission | null }
export default function TrackingPage({ data, vessels, user, workspace, identity, canCreate, canEdit, canClose, canExport = false, audience='shore', callbacks }: {
  data: AppData; vessels: Vessel[]; user: UserAccount; workspace: string; identity: string; canCreate: boolean; canEdit: boolean; canClose: boolean; canExport?: boolean; audience?: TrackingAudience; callbacks: TrackingUiCallbacks;
}) {
  const selectionKey = JSON.stringify(['tracking-vessel', workspace, user.id]);
  const [vesselId, setVesselId] = useState(() => { const last = safeRead<string>(selectionKey); return vessels.some(v => v.id === last) ? last! : vessels[0]?.id || ''; });
  const [tab, setTab] = useState<TrackingTab>('undelivered');
  const [filters, setFilters] = useState<Record<string, TrackingFilter>>({}); const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TrackingQuery['sort']>({ key: 'createdAt', direction: 'desc' });
  const [page, setPage] = useState(1); const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<TrackingDraft | null>(null); const draftRef = useRef(draft); draftRef.current = draft;
  const [pending, setPending] = useState<TrackingSubmission | null>(null); const pendingRef = useRef(pending); pendingRef.current = pending;
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [syncSuccess, setSyncSuccess] = useState<{ id: string; reference: string }[]>([]);
  const [navigation, setNavigation] = useState<null | ((allow: boolean) => void)>(null);
  const [savedAvailable, setSavedAvailable] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importGuard = useRef<null | (() => Promise<boolean>)>(null);
  const requestGeneration = useRef(0); const editGeneration = useRef(0);
  const openingRef=useRef(false);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const currentCallbacks = useRef(callbacks); currentCallbacks.current = callbacks;
  // Page-local drafts are not AppData deltas and may outlive a rejected lease.
  // Feed the existing actor-scoped status channel without changing save/lock rules.
  const draftFeedbackToken = useRef({});
  useEffect(() => { currentCallbacks.current.onPrivateDraftChange?.(draftFeedbackToken.current, Boolean(draft?.dirty || pending)); });
  useEffect(() => () => { currentCallbacks.current.onPrivateDraftChange?.(draftFeedbackToken.current, false); }, []);
  const draftKey = JSON.stringify(['tracking-unsent-v1', workspace, user.id, vesselId]);
  const columns = trackingColumnsFor(trackingTabKind(tab));
  const prefKey = trackingPreferenceKey(workspace, user.id, tab);
  const [preferences, setPreferences] = useState(() => readTrackingPreferences(prefKey, columns));
  const dataRef = useRef(data); dataRef.current = data;
  const rows = selectTrackingRows(data.trackingItems || [], { vesselId, tab, filters, search, sort });
  const saveLocalDraft = (value: TrackingDraft | null, submission = pendingRef.current) => {
    try { if (value) localStorage.setItem(draftKey, JSON.stringify({ draft: value, pending: submission })); else localStorage.removeItem(draftKey); return true; }
    catch { setNotice('本機草稿儲存失敗，請勿關閉頁面。'); return false; }
  };
  const draftWritable=(value:TrackingDraft)=>(audience!=='ship'||!busyRef.current&&!pendingRef.current)&&(value.action==='create'?canCreate:currentCallbacks.current.isWritable(value.rows.map(row=>row.id)));
  const changeDraft = (value: TrackingDraft) => { if(!draftWritable(value))return; editGeneration.current++; const next = { ...value, dirty: true }; draftRef.current = next; setDraft(next); saveLocalDraft(next); };
  const clearSelection = () => { if (selected.length) setNotice('船舶、標籤或條件已切換；已清除原選取。'); setSelected([]); setPage(1); };
  const guard = async (openingOwnsGuard=false): Promise<boolean> => {
    if(openingRef.current&&!openingOwnsGuard){setNotice('正在取得編輯權，請稍候。');return false;}
    if (importGuard.current) { if (!await importGuard.current()) return false; setImportOpen(false); }
    if (busyRef.current) { setNotice('仍在等待雲端確認；草稿已保留，請先完成目前提交。'); return false; }
    if (audience==='ship'&&!draftRef.current) {
      const saved=safeRead<SavedDraft>(draftKey);
      if(saved?.pending){
        if(Array.isArray(saved.draft?.rows)&&saved.draft.rows.every(row=>row.vesselId===vesselId)){
          draftRef.current=saved.draft;setDraft(saved.draft);pendingRef.current=saved.pending;setPending(saved.pending);setSavedAvailable(false);
        }
        setNotice('本船還有原提交未確認，已保留並恢復原輸入；請先確認結果，不能用新操作覆寫。');return false;
      }
    }
    if (!draftRef.current) return true;
    if (pendingRef.current) { setNotice('原提交尚未確認。請先確認結果；不能放棄未知提交或建立另一筆。'); return false; }
    if (!draftRef.current.dirty) { if(!await callbacks.release())return false; setDraft(null); draftRef.current = null; return true; }
    return new Promise(resolve => setNavigation(() => resolve));
  };
  useEffect(() => { currentCallbacks.current.registerNavigationGuard(() => guard()); return () => currentCallbacks.current.registerNavigationGuard(null); });
  useEffect(() => {
    setPreferences(readTrackingPreferences(prefKey, trackingColumnsFor(trackingTabKind(tab))));
  }, [prefKey, tab]);
  useEffect(() => {
    const valid = vessels.some(v => v.id === vesselId && v.isActive);
    if (!valid) { setVesselId(vessels[0]?.id || ''); setSelected([]); setDraft(null); setPending(null); return; }
    const generation = ++requestGeneration.current; let active = true; setLoading(true);
    try { localStorage.setItem(selectionKey, JSON.stringify(vesselId)); } catch { /* Selection is not business data. */ }
    setSavedAvailable(Boolean(safeRead<SavedDraft>(draftKey)));
    void currentCallbacks.current.load(vesselId).then(result => { if (active && requestGeneration.current === generation) { setLoading(false); if (!result) setNotice('未能讀取此船最新跟蹤資料，請重試；不會顯示成功。'); } });
    return () => { active = false; };
  }, [vesselId, identity, vessels.map(v => v.id).join('|')]);
  useEffect(() => { setPage(value => Math.max(1, Math.min(value, Math.ceil(rows.length / 30) || 1))); }, [rows.length]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (draftRef.current?.dirty || pendingRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, []);
  const switchView = async (action: () => void) => { if (await guard()) { clearSelection(); action(); } };
  const updateFilters = (value: Record<string, TrackingFilter>) => { clearSelection(); setFilters(value); };
  const start = async (action: TrackingAction, ids = selected) => {
    if (busyRef.current || openingRef.current || loading || !vesselId) return;
    openingRef.current=true;
    try{
    if (!await guard(true)) return;
    if (action === 'create') { const value = makeTrackingDraft(action, [newTrackingItem(vesselId, trackingTabKind(tab))], data); draftRef.current=value;setDraft(value); return; }
    if (!ids.length) { setNotice('請先勾選項目；沒有選取不會提交。'); return; }
    if (ids.length > 100) { setNotice('每批最多 100 項，請明確分批；不會自動截斷選取。'); return; }
    const owner = identity, generation = ++requestGeneration.current;
    const fresh = await callbacks.claim(vesselId, [...ids]);
    if (!fresh || currentIdentity.current !== owner || generation !== requestGeneration.current) return;
    let picked = ids.map(id => fresh.trackingItems?.find(row => row.id === id && row.vesselId === vesselId));
    if (picked.some(row => !row)) { setNotice('所選資料已變更，未開啟操作。'); return; }
    if (action === 'sync') {
      const linked = picked.filter(row => row!.linkState === 'active');
      const eligible = picked.filter(row => row!.linkState !== 'active' && !row!.isClosed);
      if (!eligible.length) { setNotice('所選項目均已同步或已結案；請使用查看內控。'); return; }
      if ((linked.length || eligible.length !== picked.length) && !confirm(`只同步以下 ${eligible.length} 項未同步來源：\n${eligible.map(row => `${row!.referenceNo} [${row!.id}]`).join('\n')}\n已同步或已結案 ${picked.length - eligible.length} 項不建立。`)) return;
      picked = eligible;
    }
    if ((action === 'close' && picked.some(row => row!.isClosed)) || (['reopen', 'correct-close-date'].includes(action) && picked.some(row => !row!.isClosed))) { setNotice('請先選取相同結案狀態；不會把結案和日期更正混為一個動作。'); return; }
    if (['edit', 'progress', 'completion'].includes(action) && picked.some(row => row!.isClosed)) { setNotice('已結案項目請先重開，未修改任何資料。'); return; }
    if (action==='completion'&&picked.some(row=>row!.kind!=='engineering')) {setNotice('完工只適用工程；未修改任何資料。');return;}
    const value=makeTrackingDraft(action, picked as TrackingItem[], fresh);draftRef.current=value;setDraft(value); setPending(null); setNotice('');
    }finally{openingRef.current=false;if(!draftRef.current&&currentIdentity.current===identity)await callbacks.release();}
  };
  const submit = async (cases?: InternalControlCase[], projections?: Record<string, InternalControlTaskProjection>): Promise<boolean> => {
    const submittedDraft = draftRef.current; if (!submittedDraft || busyRef.current) return false;
    let submission = pendingRef.current;
    try {
      if (!submission) {
        if(!draftWritable(submittedDraft)){setNotice('編輯鎖尚未重新取得；原輸入保留，本次未保存。');return false;}
        const command = commandForTrackingDraft(submittedDraft, cases, projections);
        if (!command) { setNotice('沒有變更的進度列；未提交。'); return false; }
        if(audience==='ship'&&command.type==='sync'&&!submittedDraft.sync?.reporterNameAndRole?.trim()){setNotice('請填寫報告人姓名＋職務；輸入已保留。');return false;}
        submission = { ...(audience==='ship'&&command.type==='sync'?{reporterNameAndRole:submittedDraft.sync!.reporterNameAndRole}:{}), command: structuredClone(command), context: { actorId: user.id, at: nowIso(), operationId: uid('tracking-operation') }, identity };
        if (!saveLocalDraft(submittedDraft, submission)) return false;
        pendingRef.current = submission; setPending(submission);
      }
      if (submission.identity !== identity) { setNotice('此草稿的原提交屬於先前工作階段，已停止寫入。請使用原保存協調器確認結果，勿重新建立。'); return false; }
      const generation = editGeneration.current, owner = identity;
      busyRef.current = true; setBusy(true); setNotice('等待伺服器確認；期間新增的輸入會保留。');
      const ok = await callbacks.submit(submission);
      if (currentIdentity.current !== owner) return false;
      if (!ok) { setNotice('尚未保存；輸入及精確提交已保留。可確認結果／重試相同提交。'); return false; }
      pendingRef.current = null; setPending(null);
      if (submission.command.type === 'sync') setSyncSuccess(submission.command.items.map(value => ({ id: value.item.id, reference: submittedDraft.rows.find(row => row.id === value.id)!.referenceNo })));
      if (editGeneration.current === generation) { if(!await callbacks.release()){setNotice('已保存，編輯鎖尚未完成釋放；請稍後關閉。');return true;} setDraft(null); draftRef.current = null; saveLocalDraft(null, null); setSelected(previous => previous.filter(id => !submittedDraft.rows.some(row => row.id === id))); setNotice('已收到伺服器確認並讀回。'); }
      else {
        const retained = draftRef.current!;
        const latest = dataRef.current.trackingItems || [];
        const rebased = retained.rows.map(row => ({ ...row, updatedAt: latest.find(saved => saved.id === row.id)?.updatedAt || submission!.context.at }));
        const savedCases = retained.action==='sync' ? rebased.map(row=>dataRef.current.internalControlCases.find(item=>item.id===row.linkedCaseId||item.trackingItemId===row.id)!).filter(Boolean) : undefined;
        const next = { ...retained, ...(savedCases?.length===rebased.length?{savedCases}:{}), action: retained.action === 'create' ? 'edit' as const : retained.action, rows: rebased, originals: rebased.map(row => structuredClone(latest.find(saved => saved.id === row.id) || row)), dirty: true };
        setDraft(next); draftRef.current = next; saveLocalDraft(next, null); setNotice('提交版本已保存；等待期間的新輸入仍保留，尚未提交。');
      }
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const reconcileRejected=async()=>{
    const value=draftRef.current,owner=identity;
    if(!value||busyRef.current)return;
    if(!confirm(`重新核對以下來源的最新版本，保留輸入但解除「未提交／已證明拒絕」的提交；未知結果不會解除。\n${value.rows.map(row=>`${row.referenceNo} [${row.id}]`).join('\n')}\n核對後請再按保存，或明確移除衝突列。`))return;
    busyRef.current=true;setBusy(true);setNotice('正在核對最新版本；原輸入保留，請等候讀取完成。');
    try {
      if(pendingRef.current&&(!await callbacks.discardRejected?.()||owner!==currentIdentity.current)){setNotice('尚未證明提交被拒絕，或身份已變更；精確提交仍保留，請確認原結果。');return;}
      pendingRef.current=null;setPending(null);saveLocalDraft(draftRef.current,null);
      const fresh=await callbacks.claim(vesselId,(audience==='ship'&&value.action==='create'?value.rows:value.originals).map(row=>row.id),audience==='ship'&&value.action==='create');
      if(!fresh||owner!==currentIdentity.current)return;
      const retained=draftRef.current;if(!retained)return;
      const originals=retained.originals.map(row=>fresh.trackingItems?.find(item=>item.id===row.id)||row);
      const next={...retained,originals,rows:retained.rows.map(row=>({...row,updatedAt:originals.find(item=>item.id===row.id)?.updatedAt||row.updatedAt})),dirty:true};
      draftRef.current=next;setDraft(next);saveLocalDraft(next,null);setNotice('已核對最新版本；原輸入保留，尚未提交。請核對下列原值、移除衝突列或重新保存。');
    } catch(error) { if(owner===currentIdentity.current)setNotice(`核對未完成；原輸入保留：${error instanceof Error?error.message:String(error)}`); }
    finally { busyRef.current=false;setBusy(false); }
  };
  const resolveNavigation = async (choice: 'keep' | 'save' | 'discard' | 'cancel') => {
    if (!navigation || busyRef.current || pendingRef.current) return;
    let allow = false;
    if (choice === 'discard') {
      const owner=currentIdentity.current, leaving=draftRef.current;
      busyRef.current=true;setBusy(true);
      try {
        if(await callbacks.release()&&owner===currentIdentity.current&&leaving===draftRef.current&&!pendingRef.current&&saveLocalDraft(null,null)) {
          setDraft(null);draftRef.current=null;setSavedAvailable(false);allow=true;
          setNotice('已捨棄本船未送出的草稿，未更動雲端資料。');
        }
      } finally {busyRef.current=false;setBusy(false);}
    }
    if (choice === 'keep') { allow = saveLocalDraft(draftRef.current)&&await callbacks.release(); if (allow) { setDraft(null); draftRef.current = null; setSavedAvailable(true); } }
    if (choice === 'save') { if (draftRef.current?.action === 'sync') setNotice('請先在內控原表單按保存，以執行原必填校驗。'); else allow = await submit() && !draftRef.current; }
    const resolve = navigation; setNavigation(null); resolve(allow);
  };
  const closeModal = async () => { if (await guard()) { if (await callbacks.release()) { setDraft(null); draftRef.current = null; } } };
  const restoreDraft=async()=>{
    if(busyRef.current||openingRef.current)return;
    const saved=safeRead<SavedDraft>(draftKey),owner=identity;
    if(!saved||!saved.draft.rows.every(row=>row.vesselId===vesselId))return;
    openingRef.current=true;
    try{
      if(saved.draft.action!=='create'&&!saved.pending)await callbacks.claim(vesselId,saved.draft.rows.map(row=>row.id));
      if(owner!==currentIdentity.current)return;
      draftRef.current=saved.draft;setDraft(saved.draft);pendingRef.current=saved.pending;setPending(saved.pending);setSavedAvailable(false);
    }finally{openingRef.current=false;}
  };
  const actionButton = (action: TrackingAction, label: string, ids?: string[], disabled = false) => <HelpAction label={label} help={trackingHelp(audience)[action]} disabled={disabled || loading || busy} onClick={() => void start(action, ids)}/>;
  const rowActions = (row: TrackingItem): ReactNode => <>
    {canEdit && !row.isClosed && actionButton('edit', '編輯', [row.id])}
    {canEdit && !row.isClosed && actionButton('progress', '進度', [row.id])}
    {canEdit && row.kind === 'supply' && actionButton('delivery', '送達／更正', [row.id])}
    {canEdit && row.kind === 'engineering' && !row.isClosed && actionButton('completion', '完工／更正', [row.id])}
    {canClose && actionButton(row.isClosed ? 'reopen' : 'close', row.isClosed ? '重開此案' : '結案', [row.id])}
    {row.linkState === 'active' && row.linkedCaseId ? <button className="btn small" onClick={() => callbacks.openCase(row.linkedCaseId!)}>查看內控／已同步</button> : canCreate && !row.isClosed && actionButton('sync', '同步到內控', [row.id])}
  </>;
  let affected: string[] = [];
  if (draft && draft.action !== 'create') { try { affected = audience==='ship' ? draft.originals.map(row=>`${row.referenceNo} [${row.id}]${row.linkState==='active' ? ' → 已同步內控（保存時核對有效關聯）' : '（僅來源）'}`) : trackingAffectedLabels(data, draft.originals); } catch { affected = draft.originals.map(row => `${row.referenceNo} [${row.id}]（關聯已變更，保存將重新驗證）`); } }
  return <section className="tracking-page" aria-label="配件/物料/工程跟蹤">
    <div className="tracking-heading"><h2>配件/物料/工程跟蹤</h2><label>船舶<select aria-label="跟蹤船舶" value={vesselId} onChange={event => { const id = event.target.value; void switchView(() => setVesselId(id)); }}>{vessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vesselSelectionDisplayName(vessel)}</option>)}</select></label>{canCreate && actionButton('create', '＋ 新增／批量新增')}{canCreate && <button className="btn small" disabled={loading||busy||!vesselId} onClick={()=>void guard().then(ok=>{if(ok)setImportOpen(true);})}>導入 Excel</button>}
    {canExport && <TrackingExports query={{vesselId,tab,filters,search,sort}} preferences={preferences} selected={selected} count={rows.length} vesselName={vesselSelectionDisplayName(vessels.find(v=>v.id===vesselId))} identity={identity} workspace={workspace} callbacks={callbacks} blocked={loading||busy||Boolean(draft)||Boolean(pending)||importOpen||!vessels.some(v=>v.id===vesselId&&v.isActive)}/>}
    </div>
    <div className="tracking-tabs" role="tablist" aria-label="跟蹤分類">{TRACKING_TABS.map(value => <button className={`btn ${value.id === tab ? 'primary' : ''}`} role="tab" aria-selected={value.id === tab} key={value.id} onClick={() => void switchView(() => { setTab(value.id); setFilters({}); setSearch(''); })}>{value.label} <span>{(data.trackingItems || []).filter(row => row.vesselId === vesselId && trackingInTab(row, value.id)).length}</span></button>)}</div>
    {trackingTabKind(tab) === 'engineering' && <p>是否完成依實際完工日期判定；結案或重開不會自動填入或清除完工日期。</p>}
    <div className="tracking-search-actions">
      <div className="tracking-search"><input aria-label="搜尋跟蹤" placeholder="搜尋編號、內容及全部欄位…" value={search} onChange={event => { clearSelection(); setSearch(event.target.value); }}/><button className="btn small" onClick={() => { updateFilters({}); setSearch(''); }}>清除條件</button></div>
    <div className="tracking-toolbar" aria-label="跟蹤選取與批量操作"><b>已選 {selected.length} 項</b><button className="btn small" onClick={() => setSelected(rows.map(row => row.id))}>選取全部符合條件 {rows.length} 項</button><button className="btn small" onClick={() => setSelected([])}>清除選取</button>{canEdit && actionButton('edit', '批量更新', undefined, !selected.length)}{canEdit && trackingTabKind(tab) === 'engineering' && actionButton('completion', '批量完工／更正', undefined, !selected.length)}{canEdit && actionButton('progress', '批量更新進度', undefined, !selected.length)}{canEdit && trackingTabKind(tab) === 'supply' && actionButton('delivery', '批量送達／更正', undefined, !selected.length)}{canClose && actionButton('close', '批量結案', undefined, !selected.length)}{canClose && actionButton('correct-close-date', '修改結案日期', undefined, !selected.length)}{canClose && actionButton('reopen', '重開所選', undefined, !selected.length)}{canCreate && actionButton('sync', '同步所選到內控', undefined, !selected.length)}</div>
    </div>
    <div className="tracking-options">
      <details className="tracking-all-filters"><summary>全部欄位篩選</summary><div className="tracking-option-panel"><div className="tracking-filter-grid">{columns.map(column => { const filter = filters[column.key] || {}; const set = (patch: TrackingFilter) => updateFilters({ ...filters, [column.key]: { ...filter, ...patch } }); return <fieldset key={column.key}><legend>{column.label}{preferences.hidden.includes(column.key) ? '（隱藏欄）' : ''}</legend><select aria-label={`${column.label}空白條件`} value={filter.mode || ''} onChange={event => set({ mode: event.target.value as TrackingFilter['mode'] })}><option value="">不限</option><option value="blank">空白</option><option value="nonblank">非空白</option></select><TrackingValueFilter label={column.label} values={[...new Set((data.trackingItems || []).filter(row => row.vesselId === vesselId && trackingInTab(row, tab)).map(column.value))].filter(Boolean).sort()} selected={filter.values || []} onChange={values => set({ values })}/></fieldset>; })}</div></div></details>
    <details className="tracking-preferences"><summary>欄位設定</summary><div className="tracking-option-panel"><p>表頭可拖曳欄序，邊界拖曳或方向鍵調欄寬；勾選及編號固定。只保存在本人本機，不影響草稿。</p><button className="btn small" onClick={() => { const value = defaultTrackingPreferences(columns); setPreferences(value); writeTrackingPreferences(prefKey, value); }}>重設欄位配置</button><div>{preferences.order.map((key, index) => { const column = columns.find(c => c.key === key); if (!column) return null; return <span key={key}><label><input type="checkbox" disabled={key === 'referenceNo'} checked={!preferences.hidden.includes(key)} onChange={event => { const value = { ...preferences, hidden: event.target.checked ? preferences.hidden.filter(k => k !== key) : [...preferences.hidden, key] }; setPreferences(value); writeTrackingPreferences(prefKey, value); }}/>{column.label}</label><button className="btn small" aria-label={`將${column.label}前移`} disabled={index < 2 || key === 'referenceNo'} onClick={() => { const order = [...preferences.order]; [order[index - 1], order[index]] = [order[index], order[index - 1]]; const value = { ...preferences, order }; setPreferences(value); writeTrackingPreferences(prefKey, value); }}>←</button></span>; })}</div></div></details>
    </div>
    <div className="tracking-active-filters" aria-label="有效篩選">{Object.entries(filters).filter(([, value]) => filterIsActive(value)).map(([key, value]) => <button className="btn small" key={key} onClick={() => { const next = { ...filters }; delete next[key]; updateFilters(next); }}>{columns.find(c => c.key === key)?.label || key}{preferences.hidden.includes(key) ? '（隱藏欄）' : ''}：{[value.mode === 'blank' ? '空白' : value.mode === 'nonblank' ? '非空白' : '', value.text, value.from && `自 ${value.from}`, value.to && `至 ${value.to}`, value.values?.join('／')].filter(Boolean).join(' ')} ×</button>)}</div>


    {(notice || loading) && <p role="status" className="tracking-notice">{loading ? '讀取此船最新資料…' : notice}</p>}
    {savedAvailable && !draft && <button className="btn" onClick={()=>void restoreDraft()}>恢復本船未送出草稿</button>}
    {syncSuccess.length > 0 && <aside className="tracking-sync-success" role="status"><strong>已在這邊輸入項目，不要再在內控重複輸入！</strong>{syncSuccess.map(value => <button className="btn small" key={value.id} onClick={() => callbacks.openCase(value.id)}>{value.reference}｜查看內控</button>)}<button className="btn small" onClick={() => setSyncSuccess([])}>關閉提醒</button></aside>}
    <TrackingTable rows={rows.slice((page - 1) * 30, page * 30)} columns={columns} preferences={preferences} onPreferences={value => { setPreferences(value); writeTrackingPreferences(prefKey, value); }} sort={sort} onSort={key => setSort(value => ({ key, direction: value.key === key && value.direction === 'asc' ? 'desc' : 'asc' }))} selected={selected} onSelected={setSelected} actions={rowActions}/>
    <TrackingPagination count={rows.length} page={page} onPage={setPage}/>
    {importOpen && <TrackingImportModal key={`${workspace}:${identity}:${vesselId}`} vesselId={vesselId} vesselName={vesselSelectionDisplayName(vessels.find(v=>v.id===vesselId))} workspace={workspace} actorId={user.id} identity={identity} canCreate={canCreate} canClose={canClose} data={data} callbacks={callbacks} onClose={()=>setImportOpen(false)} registerGuard={value=>{importGuard.current=value;}}/>}
    {draft && draft.action === 'sync' && draft.sync ? <div className="tracking-sync-form"><BatchCreateModal data={data} user={user} vessels={vessels.filter(v => v.id === vesselId)} close={() => void closeModal()} shipSubmission={audience==='ship'?{draft:draft.sync,onDraftChange:value=>changeDraft({...draft,sync:value}),busy,pending:Boolean(pending),message:'',catalog:{taskCategories:data.settings.taskCategories,priorities:data.settings.priorities,equipmentFailureSubcategories:data.settings.equipmentFailureSubcategories,departments:data.settings.departments}}:undefined} sourceForm={{ draft: draft.sync, readOnly:!draftWritable(draft), onReconcile:()=>void reconcileRejected(),lockedTaskIds:draft.savedCases?.filter(item=>item.linkedTaskId).map(item=>item.id), onDraftChange: value => changeDraft({ ...draft, sync: value }), busy, pending: Boolean(pending), message: [...draft.warnings, draft.savedCases?'提交版本已建立內控；本次只更正同一批已建立案件，不會重複新增。':'', notice].filter(Boolean).join('\n') }} save={async (cases, projections) => { await submit(cases, projections); return false; }}/></div> : draft && <TrackingBusinessModal audience={audience} readOnly={!draftWritable(draft)} vesselName={vesselSelectionDisplayName(vessels.find(vessel=>vessel.id===vesselId))} draft={draft} busy={busy} pending={Boolean(pending)} message={notice} affected={affected} onChange={changeDraft} onSave={() => void submit()} onReconcile={() => void reconcileRejected()} onClose={() => void closeModal()}/>}
    {navigation && <div className="modal-backdrop tracking-navigation"><div className="modal" role="dialog" aria-modal="true" aria-label="尚未保存的跟蹤草稿"><h3>尚有實際修改未保存</h3><p>保存須等雲端確認；保留草稿只存於此工作區、本人、本船的瀏覽器。</p><button className="btn primary" onClick={() => void resolveNavigation('save')}>保存後繼續</button><button className="btn" onClick={() => void resolveNavigation('keep')}>保留草稿並繼續</button><button className="btn danger" disabled={busy||Boolean(pending)} onClick={() => void resolveNavigation('discard')}>捨棄草稿並關閉</button><button className="btn ghost" onClick={() => void resolveNavigation('cancel')}>取消切換</button></div></div>}
  </section>;
}
