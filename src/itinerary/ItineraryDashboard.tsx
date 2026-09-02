import { useEffect, useMemo, useRef, useState } from 'react';
import type { UserAccount, Vessel } from '../types';
import { createDemoItineraryDocuments } from './itineraryDemoData';
import { createEmptyItineraryDocument, createItineraryId, createItineraryOperationId, type ItineraryDocument } from './itineraryTypes';
import { LocalDemoItineraryBackend, type ItineraryLease } from './itineraryCollaboration';
import { deleteItineraryDraft, itineraryDraftKey, readItineraryDraft, type ItineraryPendingOperation } from './itineraryDraftStore';
import ItineraryPanel from './ItineraryPanel';
import ItineraryEditor from './ItineraryEditor';
import ItineraryImportPreview, { type ItineraryImportApplyItem, type ItineraryImportApplyResult } from './ItineraryImportPreview';
import ItineraryCalendar from './ItineraryCalendar';
import { OfficeItineraryCloudRepository, type ItineraryMainActor } from './itineraryCloud';
import type { ParsedItineraryWorkbook } from './itineraryExcel';
import { itineraryVesselDisplayName, projectItineraryDocumentsForDisplay, resolveItineraryEditorDocument, withItineraryVesselDisplayName } from './itineraryVesselDisplay';
import { mergeLatestItineraryDocuments, selectLatestItineraryDocument } from './itineraryFreshness';
import './itinerary.css';
import './itineraryCompact.css';

interface ItineraryDashboardProps {
  user: UserAccount;
  actor: ItineraryMainActor;
  vessels: Vessel[];
  selectedVesselIds: string[];
  setSelectedVesselIds: (ids: string[]) => void;
}

const UNRESTRICTED_ITINERARY_PERMISSIONS = {
  view: true,
  edit: true,
  import: true,
  export: true,
  calendar: true,
} as const;

function localDemoModeRequested() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return (host === 'localhost' || host === '127.0.0.1')
    && new URLSearchParams(window.location.search).get('itineraryDemo') === '1';
}

interface OpenEditorState {
  document: ItineraryDocument;
  initialDocument?: ItineraryDocument;
  initialPendingOperation?: ItineraryPendingOperation;
  lease: ItineraryLease;
}

function browserHolderId(): string {
  const key = 'ship-dynamics-itinerary/demo/holder-id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = createItineraryId('browser');
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return createItineraryId('browser');
  }
}

export default function ItineraryDashboard({ user, actor, vessels, selectedVesselIds, setSelectedVesselIds }: ItineraryDashboardProps) {
  const permissions = UNRESTRICTED_ITINERARY_PERMISSIONS;
  const demoMode = localDemoModeRequested();
  const [clockOrigin] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(clockOrigin);
  const [documents, setDocuments] = useState<Record<string, ItineraryDocument>>({});
  const [editor, setEditor] = useState<OpenEditorState | null>(null);
  const [notice, setNotice] = useState('');
  const [excelBusy, setExcelBusy] = useState<'' | 'export' | 'import'>('');
  const [importPreview, setImportPreview] = useState<{ fileName: string; parsed: ParsedItineraryWorkbook } | null>(null);
  const [displayMode, setDisplayMode] = useState<'table' | 'calendar'>('table');
  const [holderId] = useState(browserHolderId);
  const editorRef = useRef(editor);
  const fileInputRef = useRef<HTMLInputElement>(null);
  editorRef.current = editor;
  const localBackend = useMemo(() => demoMode && typeof window !== 'undefined'
    ? new LocalDemoItineraryBackend({ storage: window.localStorage, workspaceKey: 'local-itinerary-demo' })
    : null, [demoMode]);
  const cloudBackend = useMemo(() => {
    if (demoMode || typeof window === 'undefined') return null;
    try { return new OfficeItineraryCloudRepository(actor); } catch { return null; }
  }, [demoMode, actor.userId]);
  const backend = localBackend || cloudBackend;
  const displayDocuments = useMemo(() => projectItineraryDocumentsForDisplay(documents, vessels), [documents, vessels]);
  const visibleIds = vessels.map(vessel => vessel.id);
  const everyVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedVesselIds.includes(id));
  const selectedDocuments = selectedVesselIds.map(id => displayDocuments[id]).filter((document): document is ItineraryDocument => Boolean(document));

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!backend) return;
    let current = true;
    const load = async () => {
      try {
        let loaded: Record<string, ItineraryDocument | null> = {};
        if (localBackend) {
          const seeds = createDemoItineraryDocuments(vessels, clockOrigin);
          for (const document of Object.values(seeds)) localBackend.seedDocument(document);
          loaded = Object.fromEntries(vessels.map(vessel => [vessel.id, localBackend.loadDocument(vessel.id) || seeds[vessel.id]]));
        } else if (cloudBackend) loaded = await cloudBackend.loadMany(vessels.map(vessel => vessel.id));
        if (!current) return;
        const materialized = Object.fromEntries(vessels.map(vessel => [vessel.id, loaded[vessel.id] || createEmptyItineraryDocument({ workspaceKey: cloudBackend?.config.workspaceKey || 'local-itinerary-demo', vesselId: vessel.id, vesselName: itineraryVesselDisplayName(vessel) })]));
        setDocuments(previous => mergeLatestItineraryDocuments(previous, materialized));
      } catch (error) {
        if (current) setNotice(error instanceof Error ? error.message : 'Itinerary 雲端載入失敗。');
      }
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      if (!localBackend) return;
      const vessel = vessels.find(item => event.key === localBackend.documentKey(item.id));
      if (!vessel) return;
      const updated = localBackend.loadDocument(vessel.id);
      if (updated) setDocuments(previous => mergeLatestItineraryDocuments(previous, { [vessel.id]: updated }));
    };
    if (localBackend) window.addEventListener('storage', onStorage);
    const poll = cloudBackend ? window.setInterval(() => void load(), 15_000) : null;
    return () => { current = false; if (localBackend) window.removeEventListener('storage', onStorage); if (poll !== null) window.clearInterval(poll); };
  }, [backend, localBackend, cloudBackend, vessels, clockOrigin]);

  useEffect(() => () => {
    const current = editorRef.current;
    if (current && backend) void backend.releaseLease(current.lease);
  }, [backend]);

  const toggleVessel = (id: string) => setSelectedVesselIds(
    selectedVesselIds.includes(id) ? selectedVesselIds.filter(item => item !== id) : [...selectedVesselIds, id],
  );
  const toggleVisible = () => {
    if (everyVisibleSelected) return setSelectedVesselIds(selectedVesselIds.filter(id => !visibleIds.includes(id)));
    setSelectedVesselIds([...new Set([...selectedVesselIds, ...visibleIds])]);
  };

  const openEditor = async (vesselId: string) => {
    if (!backend || !permissions.edit) return;
    const vessel = vessels.find(item => item.id === vesselId);
    if (!vessel) return;
    if (!window.confirm('請盡量以船端修改為主，確定要修改嗎？')) return;
    setNotice('');
    const claim = await backend.claimLease(vesselId, { holderId, holderLabel: user.name }, 75);
    if (claim.ok === false) {
      setNotice(`此船 Itinerary 正由 ${claim.holderLabel} 編輯，將於鎖定到期或對方保存／取消後可再開啟。`);
      return;
    }
    const loaded = await backend.loadDocument(vesselId);
    const latest = resolveItineraryEditorDocument(loaded, displayDocuments[vesselId], vessel);
    if (!latest) {
      void backend.releaseLease(claim.lease);
      setNotice('找不到此船的 Itinerary，未開啟編輯器。');
      return;
    }
    const key = itineraryDraftKey(latest.workspaceKey, latest.vesselId, user.id);
    const savedDraft = await readItineraryDraft(key);
    let initialDocument: ItineraryDocument | undefined;
    let initialPendingOperation: ItineraryPendingOperation | undefined;
    if (savedDraft && savedDraft.baseRevision === latest.revision) {
      if (window.confirm(`找到 ${savedDraft.savedAt.slice(0,16).replace('T',' ')} 保存的本機草稿，是否恢復？`)) { initialDocument = withItineraryVesselDisplayName(savedDraft.document, vessel); initialPendingOperation = savedDraft.pendingOperation; }
      else await deleteItineraryDraft(key);
    } else if (savedDraft) {
      setNotice('此瀏覽器有較舊 revision 的草稿；為避免覆蓋較新內容，本次未自動載入，草稿仍保留。');
    }
    setEditor({ document: latest, initialDocument, initialPendingOperation, lease: claim.lease });
  };

  const closeAfterSave = (saved: ItineraryDocument) => {
    if (editor && backend) void backend.releaseLease(editor.lease);
    setDocuments(previous => mergeLatestItineraryDocuments(previous, { [saved.vesselId]: saved }));
    setEditor(null);
    const vessel = vessels.find(item => item.id === saved.vesselId);
    setNotice(`已保存 ${vessel ? itineraryVesselDisplayName(vessel) : saved.vesselName} Itinerary，Revision ${saved.revision}。`);
  };

  const exportSelected = async () => {
    const selectedDocuments = selectedVesselIds.map(id => displayDocuments[id]).filter((document): document is ItineraryDocument => Boolean(document));
    if (!selectedDocuments.length || excelBusy) return;
    setExcelBusy('export');
    setNotice('正在產生 Excel…');
    try {
      const { downloadItineraryWorkbook } = await import('./itineraryExcel');
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      await downloadItineraryWorkbook(selectedDocuments, `Itinerary_${date}_${selectedDocuments.length}ships.xlsx`);
      setNotice(`已產生 ${selectedDocuments.length} 艘船的 Excel；每艘一個分頁。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Excel 匯出失敗。');
    } finally {
      setExcelBusy('');
    }
  };

  const readImportFile = async (file: File) => {
    if (excelBusy) return;
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) return setNotice('只接受 .xlsx Itinerary 檔案。');
    if (file.size > 10 * 1024 * 1024) return setNotice('Excel 檔案超過 10 MB，已停止匯入。');
    setExcelBusy('import');
    setNotice('正在檢查 Excel 工作表、欄位與時區…');
    try {
      const { parseItineraryWorkbook } = await import('./itineraryExcel');
      const parsed = await parseItineraryWorkbook(await file.arrayBuffer());
      if (!parsed.sheets.length) throw new Error('Excel 中沒有可匯入的 Itinerary 工作表。');
      setImportPreview({ fileName: file.name, parsed });
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Excel 匯入檢查失敗。');
    } finally {
      setExcelBusy('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const applyImports = async (items: ItineraryImportApplyItem[]): Promise<ItineraryImportApplyResult[]> => {
    const results: ItineraryImportApplyResult[] = [];
    const savedDocuments: Record<string, ItineraryDocument> = {};
    if (!backend || !permissions.import) return items.map(item => ({ sheetName: item.sheet.sheetName, vesselName: displayDocuments[item.vesselId]?.vesselName || item.vesselId, ok: false, message: '目前身份沒有匯入權限。' }));
    for (const item of items) {
      const displayedCurrent = displayDocuments[item.vesselId];
      if (!displayedCurrent) {
        results.push({ sheetName: item.sheet.sheetName, vesselName: item.vesselId, ok: false, message: '找不到目前船舶資料。' });
        continue;
      }
      const claim = await backend.claimLease(item.vesselId, { holderId, holderLabel: user.name }, 75);
      if (claim.ok === false) {
        results.push({ sheetName: item.sheet.sheetName, vesselName: displayedCurrent.vesselName, ok: false, message: `正由 ${claim.holderLabel} 編輯，未覆蓋。` });
        continue;
      }
      let current: ItineraryDocument;
      try {
        const loaded = await backend.loadDocument(item.vesselId);
        const latest = selectLatestItineraryDocument(displayedCurrent, loaded) || displayedCurrent;
        const vessel = vessels.find(candidate => candidate.id === item.vesselId);
        current = vessel ? withItineraryVesselDisplayName(latest, vessel) : latest;
      } catch (error) {
        await backend.releaseLease(claim.lease);
        results.push({ sheetName: item.sheet.sheetName, vesselName: displayedCurrent.vesselName, ok: false, message: error instanceof Error ? `取得雲端最新版失敗：${error.message}` : '取得雲端最新版失敗，未覆蓋。' });
        continue;
      }
      const candidate: ItineraryDocument = { ...current, rows: item.sheet.rows.map(row => ({ ...row })) };
      const result = await backend.save({ document: candidate, expectedRevision: current.revision, operationId: createItineraryOperationId(), lease: claim.lease, actorLabel: user.name });
      void backend.releaseLease(claim.lease);
      if (result.ok === true) {
        savedDocuments[result.document.vesselId] = result.document;
        results.push({ sheetName: item.sheet.sheetName, vesselName: current.vesselName, ok: true, message: `已覆蓋，Revision ${result.document.revision}` });
      } else {
        results.push({ sheetName: item.sheet.sheetName, vesselName: current.vesselName, ok: false, message: result.code === 'revision-conflict' ? `Revision 衝突，目前為 ${result.currentRevision ?? '未知'}` : result.message || '未覆蓋' });
      }
    }
    if (Object.keys(savedDocuments).length) setDocuments(previous => mergeLatestItineraryDocuments(previous, savedDocuments));
    return results;
  };

  return <section className="itinerary-dashboard" aria-label="船舶 Itinerary 看板">
    <div className="itinerary-toolbar no-print">
      <div><b>Itinerary 看板</b><span>已選 {selectedVesselIds.length}／目前可見 {vessels.length}</span></div>
      <div className="itinerary-toolbar-actions">
        <button type="button" className="btn small ghost" onClick={toggleVisible} disabled={!visibleIds.length}>{everyVisibleSelected?'取消選取目前可見':'選取目前可見'}</button>
        <button type="button" className="btn small ghost" onClick={()=>setSelectedVesselIds([])} disabled={!selectedVesselIds.length}>清除選取</button>
        <button type="button" className="btn small itinerary-view-toggle" onClick={()=>setDisplayMode(mode=>mode==='table'?'calendar':'table')}>{displayMode==='table'?'切換行事曆':'返回 Itinerary'}</button>
        {permissions.export&&<button type="button" className="btn small ghost" onClick={()=>void exportSelected()} disabled={!selectedVesselIds.some(id=>documents[id])||Boolean(excelBusy)}>{excelBusy==='export'?'產生中…':`匯出 Excel（${selectedVesselIds.filter(id=>documents[id]).length}）`}</button>}
        {permissions.import&&<><button type="button" className="btn small ghost" onClick={()=>fileInputRef.current?.click()} disabled={Boolean(excelBusy)}>{excelBusy==='import'?'檢查中…':'匯入 Excel'}</button><input ref={fileInputRef} className="itinerary-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event=>{const file=event.target.files?.[0];if(file)void readImportFile(file);}}/></>}
      </div>
    </div>
    {demoMode&&<div className="itinerary-demo-banner" role="status"><b>真實 UI＋測試資料</b><span>目前只在本機 Itinerary demo 模式顯示；沒有讀寫正式 Supabase 或現有 AppData。</span></div>}
    {notice&&<div className="itinerary-notice" role="status">{notice}</div>}
    {!backend&&<div className="itinerary-empty"><b>Itinerary 雲端連線不可用</b><span>為避免讀到不完整資料，目前採 fail-closed。</span></div>}
    {backend&&displayMode==='calendar'&&<ItineraryCalendar documents={selectedDocuments}/>}
    {backend&&displayMode==='table'&&<div className="itinerary-panel-list">{vessels.map(vessel=>{
      const document=displayDocuments[vessel.id];
      return document?<ItineraryPanel key={vessel.id} document={document} selected={selectedVesselIds.includes(vessel.id)} nowMs={nowMs} canEdit={permissions.edit} onToggleSelected={()=>toggleVessel(vessel.id)} onNotice={setNotice} onEdit={()=>void openEditor(vessel.id)}/>:null;
    })}</div>}
    {backend&&!vessels.length&&<div className="empty-state">沒有符合目前篩選條件的船舶 Itinerary</div>}
    {editor&&backend&&<ItineraryEditor
      document={editor.document}
      initialDocument={editor.initialDocument}
      initialPendingOperation={editor.initialPendingOperation}
      lease={editor.lease}
      actorId={user.id}
      onRenewLease={async lease=>backend.renewLease(lease,75)}
      onSave={async (candidate,lease,operationId)=>backend.save({document:candidate,expectedRevision:editor.document.revision,operationId,lease,actorLabel:user.name})}
      onCancel={async lease=>{await backend.releaseLease(lease);setEditor(null);}}
      onSaved={closeAfterSave}
    />}
    {importPreview&&<ItineraryImportPreview fileName={importPreview.fileName} parsed={importPreview.parsed} documents={Object.values(displayDocuments)} selectedVesselIds={selectedVesselIds} onApply={applyImports} onClose={()=>setImportPreview(null)}/>}
  </section>;
}
