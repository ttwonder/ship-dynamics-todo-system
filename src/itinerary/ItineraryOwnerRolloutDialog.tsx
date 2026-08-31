import { useRef, useState } from 'react';
import { updateOwnerItineraryRollout } from './itineraryCloud';
import type { ItineraryRollout } from './itineraryRollout';
import './itineraryCompact.css';

interface ItineraryOwnerRolloutDialogProps {
  rollout: ItineraryRollout;
  onUpdated: () => void;
  onClose: () => void;
}

export default function ItineraryOwnerRolloutDialog({ rollout, onUpdated, onClose }: ItineraryOwnerRolloutDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const operationIdRef = useRef<string | null>(null);
  const nextMainEnabled = !rollout.mainEnabled;
  const canSubmit = Number.isSafeInteger(rollout.version) && Number(rollout.version) > 0;

  const apply = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setMessage('');
    try {
      const operationId = operationIdRef.current || crypto.randomUUID();
      operationIdRef.current = operationId;
      const result = await updateOwnerItineraryRollout({
        expectedVersion: Number(rollout.version),
        mainEnabled: nextMainEnabled,
        operationId,
      });
      if (result.mainEnabled !== nextMainEnabled || result.shipPortalEnabled !== false) {
        throw new Error('Itinerary rollout 回應與要求不一致。');
      }
      operationIdRef.current = null;
      onUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Itinerary rollout 更新失敗。');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="itinerary-auth-backdrop no-print" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <div className="itinerary-auth-dialog itinerary-rollout-dialog" role="dialog" aria-modal="true" aria-labelledby="itinerary-rollout-title" aria-describedby="itinerary-rollout-help">
      <div className="itinerary-auth-head">
        <div>
          <h2 id="itinerary-rollout-title">Itinerary Owner 試行設定</h2>
          <p>Rollout version {rollout.version ?? '不可用'}</p>
        </div>
        <button type="button" className="btn small" onClick={onClose} disabled={submitting}>關閉</button>
      </div>
      <p id="itinerary-rollout-help" className="itinerary-auth-help">此設定只控制主站 Owner 試行。船端公開入口會強制保持關閉，Admin／Operator／Vessel 權限不會開放。</p>
      <div className="itinerary-rollout-state">
        <span>主站 Owner 試行</span><b>{rollout.mainEnabled ? '已開啟' : '已關閉'}</b>
        <span>船端公開入口</span><b>保持關閉</b>
      </div>
      {!canSubmit && <div className="itinerary-auth-message" role="alert">伺服器沒有回傳有效 rollout version，已停止操作。</div>}
      {message && <div className="itinerary-auth-message" role="alert">{message}</div>}
      <div className="itinerary-auth-actions">
        <button type="button" className="btn" onClick={onClose} disabled={submitting}>取消</button>
        <button type="button" className="btn primary" onClick={()=>void apply()} disabled={submitting || !canSubmit}>{submitting ? '更新中…' : nextMainEnabled ? '啟用 Owner 試行' : '關閉 Owner 試行'}</button>
      </div>
    </div>
  </div>;
}
