import { useEffect } from 'react';

interface ShipItineraryBriefDialogProps {
  onClose: () => void;
}

export default function ShipItineraryBriefDialog({ onClose }: ShipItineraryBriefDialogProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <div className="ship-brief-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ship-brief-dialog" role="dialog" aria-modal="true" aria-labelledby="ship-brief-title">
      <header><div><h2 id="ship-brief-title">Itinerary 簡要說明</h2><p>船端輸入、計算與保存</p></div><button type="button" className="btn ghost small" aria-label="關閉簡要說明" onClick={onClose}>關閉</button></header>
      <div className="ship-brief-body">
        <ol>
          <li>首先選擇“當下時區”，然後點擊“使用現在”，則起算時間確定</li>
          <li>港口後跟隨的時區選擇，是該港口的時區</li>
          <li>所有帶有“手”或者“自”的欄位，均可以進行手動輸入，或者自動計算。</li>
          <li>自動計算的資料需要到“自動計算用變化參數區”中修改</li>
          <li>如果全部手動輸入，可以選擇“全部手動輸入”，則“自動計算用變化參數區”內數據，可以有選擇的輸入</li>
          <li>輸入完後，務必按“保存並同步”！</li>
          <li>瀏覽模式下，具備“一鍵複製”然後可以去郵件粘貼，或，導出excel發送的功能。</li>
        </ol>
        <section className="ship-brief-formulas" aria-labelledby="ship-brief-formula-title">
          <h3 id="ship-brief-formula-title">計算公式</h3>
          <div><b>ETA</b><span>首列 ETA＝起算時間＋DTG÷預估航速</span><span>後續 ETA＝上一港 ETD＋本列 DTG÷本列預估航速</span></div>
          <div><b>ETB</b><span>ETB＝ETA＋預估等待時間（靠泊前）＋預計航道航行時間</span></div>
          <div><b>ETC</b><span>ETC＝ETB＋預估等待／延誤時間（完貨前）＋裝卸貨量÷預計 L/D rate</span></div>
          <div><b>ETD</b><span>ETD＝ETC＋預估等待／延誤時間（完貨後）</span></div>
          <p>公式以 UTC 時點計算；ETA／ETB／ETC／ETD 依各欄所選時區顯示 LT。未填的可選時數按 0 計算。</p>
        </section>
      </div>
    </section>
  </div>;
}
