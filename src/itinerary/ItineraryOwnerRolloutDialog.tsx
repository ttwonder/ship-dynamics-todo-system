import { useRef, useState } from 'react';
import { updateOwnerItineraryRollout } from './itineraryCloud';
import type { ItineraryRollout } from './itineraryRollout';
import './itineraryCompact.css';

interface ItineraryOwnerRolloutDialogProps {
  rollout: ItineraryRollout;
  onUpdated: () => void;
  onClose: () => void;
}

interface PendingRolloutIntent {
  key: string;
  operationId: string;
}

export default function ItineraryOwnerRolloutDialog({ rollout, onUpdated, onClose }: ItineraryOwnerRolloutDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const operationRef = useRef<PendingRolloutIntent | null>(null);
  const nextMainEnabled = !rollout.mainEnabled;
  const nextShipPortalEnabled = !rollout.shipPortalEnabled;
  const canSubmit = Number.isSafeInteger(rollout.version) && Number(rollout.version) > 0;

  const apply = async (mainEnabled: boolean, shipPortalEnabled: boolean) => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setMessage('');
    const intentKey = `${mainEnabled}:${shipPortalEnabled}`;
    if (!operationRef.current || operationRef.current.key !== intentKey) {
      operationRef.current = { key: intentKey, operationId: crypto.randomUUID() };
    }
    try {
      const result = await updateOwnerItineraryRollout({
        expectedVersion: Number(rollout.version),
        mainEnabled,
        shipPortalEnabled,
        operationId: operationRef.current.operationId,
      });
      if (result.mainEnabled !== mainEnabled || result.shipPortalEnabled !== shipPortalEnabled) {
        throw new Error('Itinerary 開放設定回應與要求不一致。');
      }
      operationRef.current = null;
      onUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Itinerary 開放設定更新失敗。');
    } finally {
      setSubmitting(false);
    }
  };

  const changeShipPortal = () => {
    const prompt = nextShipPortalEnabled
      ? '開啟後，持有船端網址的人可免登入選擇有效船舶並讀寫 Itinerary。確定開啟嗎？'
      : '關閉後，船端頁面將停止讀取與保存 Itinerary。確定關閉嗎？';
    if (!window.confirm(prompt)) return;
    void apply(rollout.mainEnabled, nextShipPortalEnabled);
  };

  return <div className="itinerary-auth-backdrop no-print" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <div className="itinerary-auth-dialog itinerary-rollout-dialog" role="dialog" aria-modal="true" aria-labelledby="itinerary-rollout-title" aria-describedby="itinerary-rollout-help">
      <div className="itinerary-auth-head">
        <div>
          <h2 id="itinerary-rollout-title">Itinerary 開放設定</h2>
          <p>設定版本 {rollout.version ?? '不可用'}</p>
        </div>
        <button type="button" className="btn small" onClick={onClose} disabled={submitting}>關閉</button>
      </div>
      <p id="itinerary-rollout-help" className="itinerary-auth-help">主站辦公室 Itinerary 與船端公開入口可分別控制；主站開啟時 Owner／Admin／Operator 可完整操作，Vessel 主頁始終不開放。</p>
      <div className="itinerary-rollout-state">
        <span>主站辦公室 Itinerary</span><b>{rollout.mainEnabled ? '已開啟' : '已關閉'}</b>
        <span>船端公開入口</span><b>{rollout.shipPortalEnabled ? '已開啟' : '已關閉'}</b>
      </div>
      {!canSubmit && <div className="itinerary-auth-message" role="alert">伺服器沒有回傳有效設定版本，已停止操作。</div>}
      {message && <div className="itinerary-auth-message" role="alert">{message}</div>}
      <div className="itinerary-auth-actions">
        <button type="button" className="btn" onClick={onClose} disabled={submitting}>取消</button>
        <button type="button" className="btn" onClick={()=>void apply(nextMainEnabled, rollout.shipPortalEnabled)} disabled={submitting || !canSubmit}>{submitting ? '更新中…' : nextMainEnabled ? '啟用辦公室 Itinerary' : '關閉辦公室 Itinerary'}</button>
        <button type="button" className="btn primary" onClick={changeShipPortal} disabled={submitting || !canSubmit}>{submitting ? '更新中…' : nextShipPortalEnabled ? '開啟船端入口' : '關閉船端入口'}</button>
      </div>
    </div>
  </div>;
}
