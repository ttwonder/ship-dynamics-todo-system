import { useId } from 'react';
import type { Vessel } from './types';
import { sanitizeListVesselIds, type VesselListFilterMode, type VesselListSelection } from './listVesselControls';
import { vesselDisplayName } from './vesselDisplay';

type Props = {
  vessels: Vessel[];
  mode: VesselListFilterMode;
  selectedVesselIds: string[];
  onChange: (selection: VesselListSelection) => void;
  ariaLabel: string;
};

export default function VesselListFilter({ vessels, mode, selectedVesselIds, onChange, ariaLabel }: Props) {
  const radioName = useId();
  const availableVessels = [...vessels]
    .filter(vessel => vessel.isActive !== false)
    .sort((left, right) => vesselDisplayName(left).localeCompare(vesselDisplayName(right), 'zh-TW'));
  const sanitizedIds = sanitizeListVesselIds(selectedVesselIds, availableVessels);
  const selectedSet = new Set(sanitizedIds);
  const summary = mode === 'all' ? '全部' : mode === 'mine' ? '只看我的經管' : `已選 ${sanitizedIds.length} 艘`;
  const setMode = (nextMode: Exclude<VesselListFilterMode, 'custom'>) => onChange({ mode: nextMode, vesselIds: [] });
  const toggleVessel = (vesselId: string) => {
    const current = mode === 'custom' ? sanitizedIds : [];
    const next = sanitizeListVesselIds(
      current.includes(vesselId) ? current.filter(id => id !== vesselId) : [...current, vesselId],
      availableVessels,
    );
    onChange(next.length ? { mode: 'custom', vesselIds: next } : { mode: 'all', vesselIds: [] });
  };

  return <details className="vessel-list-filter">
    <summary aria-label={ariaLabel}><span>選擇船舶</span><b>{summary}</b></summary>
    <div className="vessel-list-filter-panel">
      <div className="vessel-list-filter-modes">
        <label className={mode === 'all' ? 'selected' : ''}><input type="radio" name={radioName} checked={mode === 'all'} onChange={() => setMode('all')}/><span>全部</span></label>
        <label className={mode === 'mine' ? 'selected' : ''}><input type="radio" name={radioName} checked={mode === 'mine'} onChange={() => setMode('mine')}/><span>只看我的經管船舶/事項</span></label>
      </div>
      <div className="vessel-list-filter-heading"><b>指定船舶（可複選）</b><span>{mode === 'custom' ? `已選 ${sanitizedIds.length}` : '未指定'}</span></div>
      <div className="vessel-list-filter-options">
        {availableVessels.map(vessel => <label key={vessel.id} className={mode === 'custom' && selectedSet.has(vessel.id) ? 'selected' : ''}>
          <input type="checkbox" checked={mode === 'custom' && selectedSet.has(vessel.id)} onChange={() => toggleVessel(vessel.id)}/>
          <span>{vesselDisplayName(vessel)}</span>
        </label>)}
        {!availableVessels.length && <p>目前沒有可選船舶</p>}
      </div>
    </div>
  </details>;
}
