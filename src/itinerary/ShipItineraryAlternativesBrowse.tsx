import { useState } from 'react';
import { ItineraryBrowseTable, ItineraryMoreParametersButton } from './ItineraryBrowseTable';
import { instantToWallTime } from './itineraryTime';
import type { ItineraryDocument, ItineraryRow } from './itineraryTypes';

interface ShipItineraryAlternativesBrowseProps {
  document: ItineraryDocument;
}

function formatSharedAnchor(row: ItineraryRow | undefined): string {
  if (!row?.calculationStartUtc || !row.calculationStartTimeZone) return '正式首列 ETA 起算：尚未設定';
  const wall = instantToWallTime(row.calculationStartUtc, row.calculationStartTimeZone);
  return wall.ok
    ? `正式首列 ETA 起算：${wall.date} ${wall.time}（${row.calculationStartTimeZone}）`
    : `正式首列 ETA 起算：${row.calculationStartUtc}（${row.calculationStartTimeZone}）`;
}

export function ShipItineraryAlternativesBrowse({ document }: ShipItineraryAlternativesBrowseProps) {
  const plans = [...(document.alternativePlans ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});
  if (plans.length === 0) return null;

  return <section className="ship-alternative-browse" aria-label="瀏覽備選方案">
    <header className="ship-alternative-browse-head">
      <div>
        <h2>瀏覽備選方案</h2>
        <span>只在船端顯示，不進入正式行事曆、報告或郵件。</span>
      </div>
    </header>
    <div className="ship-alternative-browse-list">
      {plans.map((plan, index) => {
        const expanded = expandedPlans[plan.planId] === true;
        return <article className="ship-alternative-browse-card" key={plan.planId}>
          <header>
            <div>
              <h3>備選方案{index + 1}</h3>
              <span>{formatSharedAnchor(plan.rows[0])}</span>
            </div>
            <ItineraryMoreParametersButton
              expanded={expanded}
              onToggle={() => setExpandedPlans(current => ({ ...current, [plan.planId]: !expanded }))}
            />
          </header>
          <ItineraryBrowseTable
            rows={plan.rows}
            showMoreParameters={expanded}
            ariaLabel={`備選方案${index + 1}航程資料`}
          />
        </article>;
      })}
    </div>
  </section>;
}
