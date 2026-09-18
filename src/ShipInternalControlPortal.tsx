import { useEffect, useRef, useState } from 'react';
import { BatchCreateModal, createInternalControlBatchDraft, type InternalControlBatchDraft } from './InternalControlModals';
import { getSupabaseConfig } from './cloud';
import { vesselDisplayName } from './vesselDisplay';
import {
  ShipInternalControlRepository, prepareShipInternalControlSubmission, readShipInternalControlDraft,
  saveShipInternalControlDraft, shipInternalControlDraftKey, shipInternalControlStoragePrefix, shipInternalControlErrorMessage,
  type ShipInternalControlDraftRecord, type ShipInternalControlVessel,
} from './shipInternalControl';

export default function ShipInternalControlPortal() {
  const [connection] = useState(() => {
    try {
      const config = getSupabaseConfig();
      return config ? { backend: new ShipInternalControlRepository(config), error: '' } : { backend: null, error: '船端服務設定不完整，未讀取或寫入雲端資料。' };
    } catch (error) { return { backend: null, error: shipInternalControlErrorMessage(error) }; }
  });
  const { backend } = connection;
  const [vessels, setVessels] = useState<ShipInternalControlVessel[]>([]);
  const [selected, setSelected] = useState('');
  const [record, setRecord] = useState<ShipInternalControlDraftRecord | null>(null);
  const recordRef = useRef(record);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(connection.error);
  const [saved, setSaved] = useState(false);
  const epoch = useRef(0);
  const durable = useRef(true);
  const setCurrent = (next: ShipInternalControlDraftRecord | null) => { recordRef.current = next; setRecord(next); };
  const store = (next: ShipInternalControlDraftRecord) => {
    if (!backend) throw new Error('船端服務尚未連線。');
    saveShipInternalControlDraft(localStorage, shipInternalControlDraftKey(backend.config, next.vessel.id), next);
    durable.current = true;
  };
  const rememberSelection = (id: string) => {
    if (!backend) return;
    try { localStorage.setItem(`${shipInternalControlStoragePrefix(backend.config)}selected`, id); } catch { /* Actual draft durability is checked before dispatch. */ }
  };
  const selectVessel = async (id: string) => {
    if (!backend || busyRef.current) return;
    if (!durable.current && recordRef.current) {
      setNotice('本機草稿尚未保存，暫不切換船舶；目前輸入仍保留，請先處理瀏覽器儲存空間。');
      return;
    }
    const generation = ++epoch.current;
    setSelected(id); rememberSelection(id); setSaved(false); setNotice(''); setCurrent(null); setOpen(false);
    if (!id) { setLoading(false); return; }
    let cached: ShipInternalControlDraftRecord | null = null;
    try { cached = readShipInternalControlDraft(localStorage, shipInternalControlDraftKey(backend.config, id)); }
    catch (error) { setNotice(shipInternalControlErrorMessage(error)); return; }
    if (cached) {
      setCurrent(cached);
      if (cached.pending) { setOpen(true); setNotice('有一批提交尚待確認；請確認結果或重試相同提交，不會另建重複案件。'); }
    }
    setLoading(true);
    try {
      const result = await backend.catalog(id);
      if (generation !== epoch.current || !result.vessel || !result.catalog) return;
      setVessels(result.vessels);
      // Never replace a live draft or an immutable pending envelope with a late catalog result.
      const retained = recordRef.current?.vessel.id === id ? recordRef.current : cached;
      const next: ShipInternalControlDraftRecord = retained
        ? { ...retained, vessel: result.vessel, catalog: retained.pending ? retained.catalog : result.catalog }
        : { version: 1, vessel: result.vessel, catalog: result.catalog, draft: createInternalControlBatchDraft(id, result.catalog.taskCategories[0] || '設備故障') };
      setCurrent(next);
    } catch (error) { if (generation === epoch.current) setNotice(shipInternalControlErrorMessage(error)); }
    finally { if (generation === epoch.current) setLoading(false); }
  };

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    let remembered = '';
    try { remembered = localStorage.getItem(`${shipInternalControlStoragePrefix(backend.config)}selected`) || ''; } catch { /* Show the normal picker. */ }
    if (remembered) void selectVessel(remembered);
    else {
      setLoading(true);
      void backend.catalog().then(result => { if (alive) setVessels(result.vessels); })
        .catch(error => { if (alive) setNotice(shipInternalControlErrorMessage(error)); })
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; epoch.current += 1; };
  }, [backend]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!durable.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const changeDraft = (draft: InternalControlBatchDraft) => {
    const current = recordRef.current;
    if (!current || current.pending || busyRef.current || draft.vesselId !== current.vessel.id) return;
    const next = { ...current, draft };
    setCurrent(next); setSaved(false);
    try { store(next); setNotice(''); }
    catch (error) { durable.current = false; setNotice(shipInternalControlErrorMessage(error)); }
  };
  const submit = async () => {
    const current = recordRef.current;
    if (!backend || !current || busyRef.current) return false;
    const generation = epoch.current;
    busyRef.current = true; setBusy(true); setSaved(false);
    try {
      const pending = current.pending || prepareShipInternalControlSubmission(current.draft, crypto.randomUUID(), crypto.randomUUID());
      const submitting = { ...current, pending };
      // Persist the COMPLETE immutable envelope before its first network request.
      store(submitting); setCurrent(submitting);
      setNotice('正在確認雲端保存，請稍候…');
      const result = await backend.submit(pending);
      if (generation !== epoch.current || recordRef.current?.pending?.operationId !== pending.operationId) return false;
      if (result.kind === 'committed') {
        const next: ShipInternalControlDraftRecord = {
          version: 1, vessel: submitting.vessel, catalog: submitting.catalog,
          draft: createInternalControlBatchDraft(submitting.vessel.id, submitting.catalog.taskCategories[0] || '設備故障'),
        };
        try { store(next); }
        catch {
          setSaved(true); setNotice(`雲端已確認成功提交 ${result.receipt.item_count} 筆，但本機草稿整理未完成；請重試確認，勿重新建立相同事項。`);
          return false;
        }
        setCurrent(next); setSaved(true); setNotice(`成功提交 ${result.receipt.item_count} 筆｜雲端已確認保存。`);
        return true;
      }
      if (result.kind === 'rejected') {
        const next = { ...submitting, pending: undefined };
        store(next); setCurrent(next);
      }
      setNotice(result.message);
      return false;
    } catch (error) { setNotice(shipInternalControlErrorMessage(error)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const close = () => {
    if (!durable.current && !window.confirm('本機草稿尚未保存，關閉視窗後仍會保留目前畫面資料；請勿離開或刷新此頁。是否關閉輸入視窗？')) return;
    setOpen(false);
  };
  const options = record && !vessels.some(vessel => vessel.id === record.vessel.id) ? [record.vessel, ...vessels] : vessels;
  const hasDraft = record && (record.pending || record.draft.reporterNameAndRole?.trim() || record.draft.rows.some(row => row.description || row.status));
  return <main className="ship-portal-shell ship-internal-portal">
    <header className="ship-portal-header"><div><h1>船端內控/訴求</h1><p>免登入｜選擇船名後新增內控；雲端確認保存才會顯示成功。</p></div>
      <div className="ship-vessel-picker"><label htmlFor="ship-internal-vessel">船名</label><select id="ship-internal-vessel" value={selected} disabled={!backend || loading || busy || open} onChange={event => void selectVessel(event.target.value)}><option value="">請選擇船舶</option>{options.map(vessel => <option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select></div>
    </header>
    <section className="ship-state-card compact ship-internal-guidance" aria-label="填報說明"><h2>內控／訴求填報說明</h2><ul>
      <li>本頁供船舶提報內控事項，以不對外的異常情況、船上提議或訴求為主，例如：暫時無法解決、需要公司協助的高風險事項、物料／備件跟催，或對公司的建議。</li>
      <li>正常情況下，異常情況應依 DMP-FM01 流程報告。已報 DMP-FM01 的事項，不需重複提報內控；提報內控後，不一定需要另報 DMP-FM01，但不代表一律免報。</li>
      <li>不確定應填內控或 DMP-FM01 時，可先在此提報，由督導判斷是否應走正常 DMP-FM01 報告流程。</li>
      <li><strong>提交成功後無法在船端修改；如需更正，請重新提交修正版，多餘項目由辦公室刪除。</strong></li>
    </ul></section>
    {notice && <div className={`ship-notice${saved ? ' ship-internal-success' : ''}`} role="status">{notice}</div>}
    <section className="ship-state-card compact ship-internal-actions"><div><b>{record ? vesselDisplayName(record.vessel) : loading ? '正在載入船舶…' : '先選擇船名'}</b><p>{record ? '可輸入單筆或多筆內控／訴求，由岸端跟進及結案。' : '僅列出目前啟用的船舶。'}</p></div>
      <button type="button" className="btn green" disabled={!record || loading || busy || open} onClick={() => { setSaved(false); if (!record?.pending) setNotice(''); setOpen(true); }}>＋ 增加內控/訴求</button>
      {hasDraft && !open && <small>已有{record.pending ? '待確認提交' : '本機草稿'}，按上方按鈕繼續。</small>}
    </section>
    {open && record && <BatchCreateModal user={{ id: `public-vessel:${record.vessel.id}` }} vessels={[record.vessel]} close={close} save={submit} shipSubmission={{ draft: record.draft, catalog: record.catalog, busy, pending: Boolean(record.pending), message: notice, onDraftChange: changeDraft }} />}
  </main>;
}
