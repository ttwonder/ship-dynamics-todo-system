import { useState } from 'react';
import { formatRelativeUpdatedAt } from './itineraryTime';
import type { ItineraryDocument } from './itineraryTypes';
import { ItineraryBrowseTable, ItineraryMoreParametersButton } from './ItineraryBrowseTable';
import ItineraryCopyEmailButton from './ItineraryCopyEmailButton';

interface ItineraryPanelProps {
  document: ItineraryDocument;
  selected: boolean;
  nowMs: number;
  canEdit: boolean;
  onToggleSelected: () => void;
  onNotice: (message: string) => void;
  onEdit?: () => void;
}

export default function ItineraryPanel({ document, selected, nowMs, canEdit, onToggleSelected, onNotice, onEdit }: ItineraryPanelProps) {
  const [expandedRows, setExpandedRows] = useState(false);
  const [showMoreParameters, setShowMoreParameters] = useState(false);
  const visibleRows = expandedRows ? document.rows : document.rows.slice(0, 7);
  const relativeUpdatedAt = formatRelativeUpdatedAt(document.updatedAt, nowMs);
  return <article className={`itinerary-panel ${selected ? 'selected' : ''}`} data-itinerary-vessel-id={document.vesselId}>
    <header className="itinerary-panel-head">
      <label className="itinerary-select"><input type="checkbox" checked={selected} onChange={onToggleSelected}/><span>選取</span></label>
      <div className="itinerary-vessel-heading">
        <h2>{document.vesselName}</h2>
        <p className="itinerary-relative-updated-at">{relativeUpdatedAt}</p>
        {document.updatedActorLabel && <p>更新者｜{document.updatedActorLabel}</p>}
      </div>
      <div className="itinerary-panel-meta">
        <ItineraryCopyEmailButton document={document} onNotice={onNotice} />
        <ItineraryMoreParametersButton expanded={showMoreParameters} onToggle={() => setShowMoreParameters(value => !value)} />
        {canEdit && <button type="button" className="btn small itinerary-edit-button" onClick={onEdit}>手動修改</button>}
      </div>
    </header>
    <ItineraryBrowseTable rows={visibleRows} showMoreParameters={showMoreParameters} ariaLabel={`${document.vesselName} Itinerary`} />
    {document.rows.length > 7 && <footer className="itinerary-panel-foot"><button type="button" className="btn small ghost" onClick={() => setExpandedRows(value => !value)}>{expandedRows ? '收合至 7 列' : `展開全部 ${document.rows.length} 列`}</button></footer>}
  </article>;
}
