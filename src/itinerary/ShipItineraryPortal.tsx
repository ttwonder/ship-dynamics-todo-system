import { useEffect, useMemo, useRef, useState } from 'react';
import { LocalDemoItineraryBackend, type ItineraryLease } from './itineraryCollaboration';
import { createDemoItineraryDocuments } from './itineraryDemoData';
import { ITINERARY_DEMO_VESSELS } from './itineraryDemoVessels';
import { deleteItineraryDraft, itineraryDraftKey, readItineraryDraft, saveItineraryDraft, type ItineraryPendingOperation } from './itineraryDraftStore';
import { downloadItineraryWorkbook, parseItineraryWorkbook } from './itineraryExcel';
import { formatItinerarySaveConfirmation, formatRelativeUpdatedAt } from './itineraryTime';
import { createEmptyItineraryDocument, createItineraryId, type ItineraryDocument } from './itineraryTypes';
import { validateItineraryDocument } from './itineraryValidation';
import { useShipPortalRollout } from './itineraryRollout';
import { createShipDraft, hasShipDraftBusinessContent, trimTrailingBlankShipRows } from './shipItineraryModel';
import { buildItineraryMailto } from './itineraryEmail';
import { PublicItineraryCloudRepository, type PublicItineraryVessel } from './itineraryCloud';
import { pendingOperationForDocument } from './itineraryOperation';
import { selectLatestItineraryDocument } from './itineraryFreshness';
import ShipItineraryEditor from './ShipItineraryEditor';
import { dashboardVesselDisplayName } from '../vesselDisplay';
import { ItineraryBrowseTable, ItineraryMoreParametersButton } from './ItineraryBrowseTable';

interface EditorState {
  draft: ItineraryDocument;
  baseRevision: number;
  lease: ItineraryLease;
  dirty: boolean;
  readOnly: boolean;
  remoteUpdated: boolean;
  pendingOperation?: ItineraryPendingOperation;
}

type PortalNotice =
  | { kind: 'text'; text: string }
  | { kind: 'saved'; updatedAt: string | null };

function browserId(storage: Storage, key: string, prefix: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const created = createItineraryId(prefix);
  storage.setItem(key, created);
  return created;
}

function saveError(code: string): string {
  if (code === 'revision-conflict') return '雲端已有較新版本，請先同步最新。';
  if (code === 'lease-expired' || code === 'lease-mismatch') return '編輯鎖已失效，草稿已保留。';
  if (code === 'invalid-document') return '欄位未通過檢查，請補齊後再保存。';
  if (code === 'unknown-outcome') return '保存結果仍無法確認；草稿與相同操作識別已保留，可重試相同內容。';
  return '保存未完成，草稿仍保留。';
}

function withPublicVesselName(document: ItineraryDocument, vessel?: PublicItineraryVessel): ItineraryDocument {
  if (!vessel) return document;
  const vesselName = dashboardVesselDisplayName(vessel);
  return document.vesselName === vesselName ? document : { ...document, vesselName };
}

export default function ShipItineraryPortal() {
  const rollout = useShipPortalRollout();
  const [holderId] = useState(() => typeof window === 'undefined' ? 'ship-ssr' : browserId(window.sessionStorage, 'ship-dynamics-itinerary/public/holder-id', 'ship-tab'));
  const [draftActorId] = useState(() => typeof window === 'undefined' ? 'ship-ssr' : browserId(window.localStorage, 'ship-dynamics-itinerary/public/browser-id', 'ship-browser'));
  const localBackend = useMemo(() => rollout.demoMode && typeof window !== 'undefined'
    ? new LocalDemoItineraryBackend({ storage: window.localStorage, workspaceKey: 'local-itinerary-demo' })
    : null, [rollout.demoMode]);
  const cloudBackend = useMemo(() => {
    if (!rollout.enabled || rollout.demoMode || typeof window === 'undefined') return null;
    try { return new PublicItineraryCloudRepository(undefined, undefined, draftActorId); } catch { return null; }
  }, [rollout.enabled, rollout.demoMode, draftActorId]);
  const backend = localBackend || cloudBackend;
  const [cloudVessels, setCloudVessels] = useState<PublicItineraryVessel[]>([]);
  const vessels = rollout.demoMode ? ITINERARY_DEMO_VESSELS : cloudVessels;
  const [selectedVesselId, setSelectedVesselId] = useState('');
  const [latest, setLatest] = useState<ItineraryDocument | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const [notice, setNoticeState] = useState<PortalNotice | null>(null);
  const [noticeNowMs, setNoticeNowMs] = useState(() => Date.now());
  const setNotice = (text: string) => setNoticeState(text ? { kind: 'text', text } : null);
  const [saving, setSaving] = useState(false);
  const [showMoreParameters, setShowMoreParameters] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { editorRef.current = editor; }, [editor]);

  useEffect(() => {
    if (notice?.kind !== 'saved') return;
    setNoticeNowMs(Date.now());
    const timer = window.setInterval(() => setNoticeNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [notice]);

  useEffect(() => {
    if (!localBackend) return;
    const demo = createDemoItineraryDocuments(ITINERARY_DEMO_VESSELS);
    Object.values(demo).forEach(document => localBackend.seedDocument(document));
  }, [localBackend]);

  useEffect(() => {
    if (!cloudBackend) return;
    let current = true;
    void cloudBackend.listVessels().then(values => { if (current) setCloudVessels(values); }).catch(error => { if (current) setNotice(error instanceof Error ? error.message : '船舶清單載入失敗。'); });
    return () => { current = false; };
  }, [cloudBackend]);

  useEffect(() => {
    if (!backend || !selectedVesselId) { setLatest(null); return; }
    let current = true;
    void Promise.resolve(backend.loadDocument(selectedVesselId)).then(document => {
      if (!current) return;
      const vessel = vessels.find(item => item.id === selectedVesselId);
      const loaded = document
        ? withPublicVesselName(document, vessel)
        : createEmptyItineraryDocument({ workspaceKey: cloudBackend?.config.workspaceKey || 'local-itinerary-demo', vesselId: selectedVesselId, vesselName: vessel ? dashboardVesselDisplayName(vessel) : selectedVesselId });
      setLatest(previous => selectLatestItineraryDocument(previous, loaded));
    }).catch(error => { if (current) setNotice(error instanceof Error ? error.message : 'Itinerary 載入失敗。'); });
    return () => { current = false; };
  }, [backend, cloudBackend, selectedVesselId, vessels]);

  useEffect(() => {
    if (!backend || !selectedVesselId || typeof window === 'undefined') return;
    let current = true;
    const publish = (document: ItineraryDocument | null) => {
      if (!current || !document) return;
      const displayed = withPublicVesselName(document, vessels.find(vessel => vessel.id === selectedVesselId));
      setLatest(previous => selectLatestItineraryDocument(previous, displayed));
      setEditor(previous => previous && displayed.revision > previous.baseRevision ? { ...previous, readOnly: true, remoteUpdated: true } : previous);
    };
    const onStorage = (event: StorageEvent) => {
      if (!localBackend || event.key !== localBackend.documentKey(selectedVesselId)) return;
      publish(localBackend.loadDocument(selectedVesselId));
    };
    if (localBackend) window.addEventListener('storage', onStorage);
    const poll = cloudBackend ? window.setInterval(() => { void cloudBackend.loadDocument(selectedVesselId).then(publish).catch(() => undefined); }, 15_000) : null;
    return () => { current = false; if (localBackend) window.removeEventListener('storage', onStorage); if (poll !== null) window.clearInterval(poll); };
  }, [backend, localBackend, cloudBackend, selectedVesselId]);

  useEffect(() => {
    if (!editor?.dirty) return;
    const key = itineraryDraftKey(editor.draft.workspaceKey, editor.draft.vesselId, draftActorId);
    const timer = window.setTimeout(() => {
      void saveItineraryDraft({ key, workspaceKey: editor.draft.workspaceKey, vesselId: editor.draft.vesselId, actorId: draftActorId, baseRevision: editor.baseRevision, savedAt: new Date().toISOString(), document: editor.draft, pendingOperation: editor.pendingOperation });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [editor?.draft, editor?.dirty, editor?.baseRevision, draftActorId]);

  useEffect(() => {
    if (!backend || !editor || editor.readOnly) return;
    const timer = window.setInterval(() => {
      const current = editorRef.current;
      if (!current || current.readOnly) return;
      void Promise.resolve(backend.renewLease(current.lease, 75)).then(renewed => {
        setEditor(previous => {
          if (!previous || previous.lease.leaseId !== current.lease.leaseId) return previous;
          if (renewed.ok) return { ...previous, lease: renewed.lease };
          setNotice('編輯鎖已失效；已凍結畫面並保留草稿。');
          return { ...previous, readOnly: true };
        });
      }).catch(() => { setNotice('編輯鎖更新失敗；已凍結畫面並保留草稿。'); setEditor(previous => previous ? { ...previous, readOnly: true } : previous); });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [backend, editor?.lease.leaseId, editor?.readOnly]);

  useEffect(() => {
    if (!editor?.dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [editor?.dirty]);

  useEffect(() => () => {
    const active = editorRef.current;
    if (active && backend) void backend.releaseLease(active.lease);
  }, [backend]);

  const startEditing = async (mode: 'blank' | 'latest') => {
    if (!backend || !latest) return;
    const vessel = vessels.find(item => item.id === latest.vesselId);
    const claim = localBackend
      ? await localBackend.claimLease(latest.vesselId, { holderId, holderLabel: `船端：${vessel?.name || latest.vesselName}` }, 75)
      : await cloudBackend!.claimLease(latest.vesselId, holderId, 75);
    if (claim.ok === false) {
      setNotice(`目前由「${claim.holderLabel}」編輯中，暫時不能修改。`);
      return;
    }
    let editingBase: ItineraryDocument;
    try {
      const reloaded = await Promise.resolve(backend.loadDocument(latest.vesselId));
      editingBase = withPublicVesselName(selectLatestItineraryDocument(latest, reloaded) || latest, vessels.find(vessel => vessel.id === latest.vesselId));
    } catch (error) {
      await Promise.resolve(backend.releaseLease(claim.lease));
      setNotice(error instanceof Error ? error.message : '取得最新 Itinerary 失敗，未開啟編輯器。');
      return;
    }
    setLatest(previous => selectLatestItineraryDocument(previous, editingBase));
    let draft = createShipDraft(editingBase, mode);
    let pendingOperation: ItineraryPendingOperation | undefined;
    const key = itineraryDraftKey(editingBase.workspaceKey, editingBase.vesselId, draftActorId);
    const saved = await readItineraryDraft(key);
    if (saved && saved.baseRevision === editingBase.revision && window.confirm('找到本機草稿，是否恢復？')) { draft = saved.document; pendingOperation = saved.pendingOperation; }
    setEditor({ draft, baseRevision: editingBase.revision, lease: claim.lease, dirty: Boolean(saved), readOnly: false, remoteUpdated: false, pendingOperation });
    setNotice('');
  };

  const closeEditor = () => {
    if (editor && backend) void backend.releaseLease(editor.lease);
    setEditor(null);
  };

  const discardEditor = async () => {
    if (!editor) return;
    if (editor.dirty && !window.confirm('確定丟棄這份本機草稿？此動作不會改動雲端最新版。')) return;
    await deleteItineraryDraft(itineraryDraftKey(editor.draft.workspaceKey, editor.draft.vesselId, draftActorId));
    closeEditor();
  };

  const saveEditor = async () => {
    if (!editor || !backend || editor.readOnly || editor.remoteUpdated) return;
    if (!hasShipDraftBusinessContent(editor.draft)) { setNotice('請至少填寫一列 Itinerary 資料。'); return; }
    const candidate = trimTrailingBlankShipRows(editor.draft);
    const validation = validateItineraryDocument(candidate);
    if (validation.ok === false) { setNotice(validation.errors.slice(0, 3).map(error => error.message).join('；')); return; }
    setSaving(true);
    const pendingOperation = pendingOperationForDocument(validation.value, editor.pendingOperation);
    setEditor(previous => previous ? { ...previous, pendingOperation } : previous);
    await saveItineraryDraft({ key: itineraryDraftKey(editor.draft.workspaceKey, editor.draft.vesselId, draftActorId), workspaceKey: editor.draft.workspaceKey, vesselId: editor.draft.vesselId, actorId: draftActorId, baseRevision: editor.baseRevision, savedAt: new Date().toISOString(), document: validation.value, pendingOperation });
    const result = await backend.save({ document: validation.value, expectedRevision: editor.baseRevision, operationId: pendingOperation.id, lease: editor.lease, actorLabel: `船端：${editor.draft.vesselName}` });
    setSaving(false);
    if (result.ok === false) {
      setNotice(saveError(result.code));
      setEditor(previous => previous ? { ...previous, pendingOperation: result.code === 'unknown-outcome' ? pendingOperation : undefined, readOnly: result.code === 'unknown-outcome' ? previous.readOnly : result.code === 'revision-conflict' || result.code === 'lease-expired' || result.code === 'lease-mismatch' ? true : previous.readOnly, remoteUpdated: result.code === 'revision-conflict' } : previous);
      if (result.code !== 'unknown-outcome') await saveItineraryDraft({ key: itineraryDraftKey(editor.draft.workspaceKey, editor.draft.vesselId, draftActorId), workspaceKey: editor.draft.workspaceKey, vesselId: editor.draft.vesselId, actorId: draftActorId, baseRevision: editor.baseRevision, savedAt: new Date().toISOString(), document: validation.value });
      return;
    }
    await deleteItineraryDraft(itineraryDraftKey(result.document.workspaceKey, result.document.vesselId, draftActorId));
    void backend.releaseLease(editor.lease);
    setLatest(withPublicVesselName(result.document, vessels.find(vessel => vessel.id === result.document.vesselId)));
    setEditor(null);
    setNoticeState({ kind: 'saved', updatedAt: result.document.updatedAt });
  };

  const exportDocument = async (document: ItineraryDocument, prefix: string): Promise<string | null> => {
    setNotice('正在產生 Excel…');
    try {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const fileName = `${prefix}_${document.vesselName}_${date}.xlsx`;
      await downloadItineraryWorkbook([document], fileName);
      setNotice('Excel 已產生；請查看瀏覽器下載。');
      return fileName;
    } catch (error) {
      setNotice(`Excel 產生失敗：${error instanceof Error ? error.message : '未知錯誤'}`);
      return null;
    }
  };

  const prepareEmailReport = async (document: ItineraryDocument) => {
    const fileName = await exportDocument(document, 'Itinerary');
    if (!fileName) return;
    setNotice(`Excel「${fileName}」已下載；郵件已準備，寄出前請手動加入附件。`);
    window.location.href = buildItineraryMailto({ vesselName: document.vesselName, fileName, revision: document.revision });
  };

  const syncLatest = async () => {
    if (!editor || !backend || !latest) return;
    const claim = localBackend
      ? await localBackend.claimLease(latest.vesselId, { holderId, holderLabel: `船端：${latest.vesselName}` }, 75)
      : await cloudBackend!.claimLease(latest.vesselId, holderId, 75);
    if (claim.ok === false) { setNotice(`最新版本仍由「${claim.holderLabel}」編輯中。`); return; }
    let editingBase: ItineraryDocument;
    try {
      const reloaded = await Promise.resolve(backend.loadDocument(latest.vesselId));
      editingBase = withPublicVesselName(selectLatestItineraryDocument(latest, reloaded) || latest, vessels.find(vessel => vessel.id === latest.vesselId));
    } catch (error) {
      await Promise.resolve(backend.releaseLease(claim.lease));
      setNotice(error instanceof Error ? error.message : '取得最新 Itinerary 失敗，原草稿已保留。');
      return;
    }
    setLatest(previous => selectLatestItineraryDocument(previous, editingBase));
    setEditor({ draft: createShipDraft(editingBase, 'latest'), baseRevision: editingBase.revision, lease: claim.lease, dirty: false, readOnly: false, remoteUpdated: false, pendingOperation: undefined });
    setNotice('已載入最新版本；先前草稿仍保留至下一次修改。');
  };

  const importFile = async (file: File) => {
    if (!editor) return;
    setNotice('正在檢查 Excel…');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('檔案超過 10 MB');
      const parsed = await parseItineraryWorkbook(await file.arrayBuffer());
      if (parsed.sheets.length !== 1) throw new Error('船端一次只接受一艘船、一個資料分頁');
      const sheet = parsed.sheets[0];
      if (sheet.embeddedVesselId && sheet.embeddedVesselId !== editor.draft.vesselId) throw new Error('Excel 內的船舶與目前選擇不一致');
      if (sheet.issues.length) throw new Error(sheet.issues.slice(0, 3).map(issue => issue.message).join('；'));
      setEditor(previous => previous ? { ...previous, draft: { ...previous.draft, rows: sheet.rows }, dirty: true, pendingOperation: undefined } : previous);
      setNotice(`已匯入 ${sheet.rows.length} 列，尚未同步；請確認後點「保存並同步」。`);
    } catch (error) {
      setNotice(`匯入失敗：${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (rollout.loading) return <main className="ship-portal-shell"><div className="ship-state-card">正在確認 Itinerary 開放狀態…</div></main>;
  if (!rollout.enabled) return <main className="ship-portal-shell"><div className="ship-state-card"><h1>Itinerary 尚未開放</h1><p>請稍後再試；此頁目前不會讀取或寫入船舶資料。</p></div></main>;
  if (!backend) return <main className="ship-portal-shell"><div className="ship-state-card"><h1>船端服務設定不完整</h1><p>目前無法建立受限 Itinerary RPC 連線，未讀取或寫入資料。</p></div></main>;

  return <main className="ship-portal-shell">
    <header className="ship-portal-header"><div>{rollout.demoMode && <span className="ship-demo-label">真實 UI＋測試資料</span>}<h1>船端 Itinerary</h1><p>{rollout.demoMode ? '免登入測試頁｜只使用去敏資料與獨立本機 demo namespace' : '免登入｜資料經受限單船 RPC 保存至 Itinerary 雲端'}</p></div><div className="ship-vessel-picker"><label>船名</label><select value={selectedVesselId} disabled={Boolean(editor)} onChange={event => setSelectedVesselId(event.target.value)}><option value="">請選擇船舶</option>{vessels.map(vessel => <option value={vessel.id} key={vessel.id}>{dashboardVesselDisplayName(vessel)}</option>)}</select></div></header>
    {notice && <div className="ship-notice">{notice.kind === 'saved' ? formatItinerarySaveConfirmation(notice.updatedAt, noticeNowMs) : notice.text}</div>}
    {!selectedVesselId && <div className="ship-state-card compact"><b>先選擇船名</b><span>再選擇從空白或最新狀態開始。</span></div>}
    {selectedVesselId && latest && !editor && <section className="ship-latest-card">
      <div className="ship-latest-head">
        <div><h2>{latest.vesselName}</h2><span>{formatRelativeUpdatedAt(latest.updatedAt)}</span></div>
        <div>
          <ItineraryMoreParametersButton expanded={showMoreParameters} onToggle={() => setShowMoreParameters(value => !value)} />
          <button className="btn ghost small" onClick={() => void exportDocument(latest, 'Itinerary')}>匯出最新 Excel</button>
          <button className="btn ghost small" title="下載 Excel 並開啟郵件；附件需手動加入" onClick={() => void prepareEmailReport(latest)}>準備郵件報告</button>
          <button className="btn ghost small" onClick={() => void startEditing('blank')}>從空白開始</button>
          <button className="btn primary small" onClick={() => void startEditing('latest')}>從最新狀態修改</button>
        </div>
      </div>
      <ItineraryBrowseTable rows={latest.rows} showMoreParameters={showMoreParameters} ariaLabel={`${latest.vesselName} Itinerary`} />
    </section>}
    {editor && <><div className="ship-edit-toolbar"><b>{editor.draft.vesselName}</b><span>基準 Revision {editor.baseRevision}</span><button className="btn ghost small" disabled={editor.readOnly} onClick={() => fileInputRef.current?.click()}>匯入單船 Excel</button><button className="btn ghost small" onClick={() => void exportDocument(editor.draft, 'Itinerary_Draft')}>匯出草稿</button><input ref={fileInputRef} className="itinerary-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></div><ShipItineraryEditor document={editor.draft} readOnly={editor.readOnly} canSave={hasShipDraftBusinessContent(editor.draft)} remoteUpdated={editor.remoteUpdated} saving={saving} onChange={draft => setEditor(previous => previous ? { ...previous, draft, dirty: true, pendingOperation: undefined } : previous)} onSave={() => void saveEditor()} onCancel={() => void discardEditor()} onClosePreservingDraft={closeEditor} onDiscardDraft={() => void discardEditor()} onSyncLatest={syncLatest} onExportDraft={() => void exportDocument(editor.draft, 'Itinerary_Conflict_Draft')} /></>}
  </main>;
}
