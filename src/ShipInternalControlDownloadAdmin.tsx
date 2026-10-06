import { useEffect, useState } from 'react';
import type { UserAccount, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';
import { formatTaipeiDateTime } from './taipeiTime';
import {
  internalControlAdminSessionStatus, listInternalControlDownloads,
  resetInternalControlDownloadPassword, type DownloadManagerList,
} from './shipInternalControlDownload';

type Props = { currentUser: UserAccount; vessels: Vessel[] };
export default function ShipInternalControlDownloadAdmin({ currentUser, vessels }: Props) {
  const [snapshot, setSnapshot] = useState<DownloadManagerList | null>(null);
  const [selectedId, setSelectedId] = useState(vessels.find(item => item.isActive)?.id || '');
  const [secret, setSecret] = useState<{ vesselId: string; password: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionRevision, setSessionRevision] = useState(0);
  useEffect(() => {
    const update = () => setSessionRevision(value => value + 1);
    window.addEventListener('ship-internal-download-admin-session', update);
    return () => window.removeEventListener('ship-internal-download-admin-session', update);
  }, []);
  const canManage = currentUser.isActive && (currentUser.role === 'owner' || currentUser.role === 'admin');
  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    setLoading(true);
    void listInternalControlDownloads(currentUser.id)
      .then(result => { if (alive) { setSnapshot(result); setNotice(''); } })
      .catch(error => { if (alive) setNotice(error instanceof Error ? error.message : '雲端紀錄無法讀取。'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [canManage, currentUser.id, sessionRevision]);
  if (!canManage) return null;
  const listed = snapshot?.vessels || [];
  const available = vessels.filter(item => item.isActive && listed.some(entry => entry.vessel_id === item.id));
  const activeSelected = available.find(item => item.id === selectedId) || available[0];
  const selectedLogs = (snapshot?.logs || []).filter(item => item.vessel_id === activeSelected?.id);
  const reset = async () => {
    if (busy || !activeSelected || !internalControlAdminSessionStatus(currentUser.id).authorized) return;
    if (!window.confirm(`確定產生「${vesselDisplayName(activeSelected)}」的新下載密碼？舊密碼立即失效；請安全交付該船。`)) return;
    setBusy(true); setSecret(null); setNotice('正在雲端產生並核對新密碼…');
    try {
      const password = await resetInternalControlDownloadPassword(currentUser.id, activeSelected.id);
      setSecret({ vesselId: activeSelected.id, password });
      const fresh = await listInternalControlDownloads(currentUser.id);
      setSnapshot(fresh);
      setNotice(fresh.vessels.some(item => item.vessel_id === activeSelected.id && item.configured)
        ? '雲端已核對該船下載密碼已設定；密碼只在此顯示一次，請現在安全交付船上。'
        : '雲端未能確認設定狀態，請勿宣稱成功；請聯絡系統管理員。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '雲端未確認重設結果。'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="management-master"><div className="management-master-heading"><div><h2>船端內控下載 <small>{available.length}</small></h2><small>各船獨立密碼；點選船名查看下載紀錄</small></div></div><div className="management-list">{available.map(item => <button type="button" key={item.id} className={`management-list-item ${activeSelected?.id === item.id ? 'active' : ''}`} onClick={() => { setSelectedId(item.id); setSecret(null); }}><span className="management-avatar vessel">🚢</span><span><b>{vesselDisplayName(item)}</b><small>{listed.find(entry => entry.vessel_id === item.id)?.configured ? '已設定下載密碼' : '尚未設定下載密碼'}</small></span></button>)}</div></div>
    <div className="management-detail"><div className="management-editor"><div className="management-editor-heading"><div><h2>{activeSelected ? vesselDisplayName(activeSelected) : '船端內控下載'}</h2><p>僅新增船端下載管理；不變更既有主站資料讀取權限。</p></div><div className="management-editor-actions"><button type="button" className="btn small ghost" disabled={busy || loading} onClick={() => { setLoading(true); void listInternalControlDownloads(currentUser.id).then(result => { setSnapshot(result); setNotice('雲端紀錄已更新。'); }).catch(error => setNotice(error instanceof Error ? error.message : '雲端紀錄無法讀取。')).finally(() => setLoading(false)); }}>刷新紀錄</button><button type="button" className="btn small primary" disabled={!activeSelected || busy || loading || !internalControlAdminSessionStatus(currentUser.id).authorized} onClick={() => void reset()}>{busy ? '設定中…' : listed.find(item => item.vessel_id === activeSelected?.id)?.configured ? '重設此船密碼' : '產生此船密碼'}</button></div></div>
      {!internalControlAdminSessionStatus(currentUser.id).authorized && <p className="warn" role="alert">{internalControlAdminSessionStatus(currentUser.id).message}</p>}
      {notice && <p className="ship-notice" role="status">{notice}</p>}
      {secret && secret.vesselId === activeSelected?.id && <section className="management-editor-section"><h3>本次新密碼（只顯示一次）</h3><div className="management-editor-section-body"><textarea aria-label="此船一次性顯示的新下載密碼" readOnly value={secret.password} rows={2} onFocus={event => event.target.select()} style={{ width: '100%', resize: 'none' }}/><p className="muted">舊密碼已失效；請安全交付此船。切換船舶或離開分頁後即不再顯示。</p></div></section>}
      <section className="management-editor-section"><h3>雲端下載紀錄</h3><div className="management-editor-section-body"><p className="muted">成功代表雲端已提供清單供列印，不代表瀏覽器已實際另存 PDF。IP 由雲端請求讀取。</p><div className="table-wrap"><table className="compact"><thead><tr><th>時間</th><th>結果</th><th>IP</th><th>案件數</th><th>下載編號</th></tr></thead><tbody>{selectedLogs.map(log => <tr key={log.receipt_id}><td>{formatTaipeiDateTime(log.created_at)}</td><td>{log.result === 'success' ? '已提供清單' : log.result === 'reset' ? '密碼重設' : '遭拒'}</td><td>{log.ip_address || '未取得'}</td><td>{log.case_count}</td><td>{log.receipt_id}</td></tr>)}</tbody></table></div>{loading ? <p>正在讀取雲端紀錄…</p> : !selectedLogs.length && <p>尚無此船紀錄。</p>}</div></section>
    </div></div>
  </>;
}
