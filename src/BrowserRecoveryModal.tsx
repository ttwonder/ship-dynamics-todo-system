export type BrowserRecoveryPhase='idle'|'repairing'|'resetting';

type Props={
  advanced:boolean;
  phase:BrowserRecoveryPhase;
  message:string;
  onClose:()=>void;
  onToggleAdvanced:()=>void;
  onSafeRepair:()=>void;
  onFullReset:()=>void;
};

export default function BrowserRecoveryModal({advanced,phase,message,onClose,onToggleAdvanced,onSafeRepair,onFullReset}:Props){
  const busy=phase!=='idle';
  return <div className="modal-backdrop browser-recovery-backdrop"><div className="modal browser-recovery-modal" role="dialog" aria-modal="true" aria-labelledby="browser-recovery-title" data-browser-recovery-dialog="true">
    <div className="modal-header"><div><h2 id="browser-recovery-title">修復此瀏覽器</h2><p>只處理Ship Dynamics可明確識別的本機資源。</p></div><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>關閉</button></div>
    <section className="browser-recovery-section safe">
      <span className="browser-recovery-step">建議先執行</span>
      <h3>安全重新載入最新版</h3>
      <p>清理本App具名緩存與專屬Service Worker，再以新版入口重新載入；不會刪除登入、業務資料或其他專案資料，但尚未保存的畫面變更仍可能遺失。</p>
      <button type="button" className="btn primary" disabled={busy} onClick={onSafeRepair}>{phase==='repairing'?'正在安全修復…':'安全重新載入最新版'}</button>
    </section>
    <button type="button" className="browser-recovery-advanced-toggle" disabled={busy} aria-expanded={advanced} onClick={onToggleAdvanced}>{advanced?'收起完整重設':'進階：完整重設本機資料'}</button>
    {advanced&&<section className="browser-recovery-section advanced">
      <span className="browser-recovery-step danger">破壞性最後手段</span>
      <h3>完整重設Ship Dynamics本機資料</h3>
      <p className="warn"><b>執行後無法復原。</b>這是使用者主動選擇的完整本機重設，不會先檢查草稿、pending、編輯鎖或雲端同步狀態。</p>
      <div className="browser-recovery-impact"><div><b>會刪除</b><span>AppData、登入、進站狀態、草稿與pending資料，以及本App具名緩存。</span></div><div><b>不會刪除</b><span>Supabase雲端資料、GitHub程式及同網域其他專案。</span></div></div>
      <button type="button" className="btn red" disabled={busy} onClick={onFullReset}>{phase==='resetting'?'正在完整重設…':'確認完整重設'}</button>
    </section>}
    {message&&<p className={`browser-recovery-status ${phase==='idle'?'error':''}`} role="status">{message}</p>}
  </div></div>;
}
