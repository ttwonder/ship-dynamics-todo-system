import { useState } from 'react';
import type { VesselFilterState, VesselSupervisorOption } from './vesselDashboardFilters';
import { emptyVesselFilterState, hasActiveVesselFilters, toggleFilterValue } from './vesselDashboardFilters';

interface Props {
  filters: VesselFilterState;
  shipTypes: string[];
  supervisors: VesselSupervisorOption[];
  onChange: (filters: VesselFilterState) => void;
  showPills?: boolean;
  showSupervisors?: boolean;
  showMeeting?: boolean;
}

export default function VesselFilterControls({ filters, shipTypes, supervisors, onChange, showPills = true, showSupervisors = true, showMeeting = true }: Props) {
  const [supervisorQuery, setSupervisorQuery] = useState('');
  const selectedSupervisors = supervisors.filter(option => filters.supervisorIds.includes(option.id));
  const normalizedSupervisorQuery = supervisorQuery.trim().toLocaleLowerCase();
  const visibleSupervisors = normalizedSupervisorQuery
    ? supervisors.filter(option => option.name.toLocaleLowerCase().includes(normalizedSupervisorQuery))
    : supervisors;
  const supervisorSummary = selectedSupervisors.length
    ? selectedSupervisors.map(option => option.name).join('、')
    : '全部督導';
  const allActive = !hasActiveVesselFilters(filters);

  return <div className="vessel-filter-controls">
    {showSupervisors && <details className="vessel-supervisor-picker">
      <summary><span>督導姓名</span><b>{supervisorSummary}</b><i aria-hidden="true">⌄</i></summary>
      <div className="vessel-supervisor-menu">
        <div className="vessel-supervisor-heading"><span>可多選督導</span>{filters.supervisorIds.length > 0 && <button type="button" className="btn small ghost" onClick={() => onChange({ ...filters, supervisorIds: [] })}>清空</button>}</div>
        <input className="vessel-supervisor-search" type="search" value={supervisorQuery} onChange={event => setSupervisorQuery(event.target.value)} placeholder="搜尋督導姓名..." aria-label="搜尋督導姓名"/>
        <div className="vessel-supervisor-options">{visibleSupervisors.length ? visibleSupervisors.map(option => {
          const checked = filters.supervisorIds.includes(option.id);
          return <label key={option.id} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => onChange({ ...filters, supervisorIds: toggleFilterValue(filters.supervisorIds, option.id) })}/><span className="vessel-supervisor-option-name">{option.name}</span></label>;
        }) : <span className="vessel-supervisor-empty">{normalizedSupervisorQuery ? '沒有符合的督導' : '目前沒有督導分管資料'}</span>}</div>
      </div>
    </details>}
    {showPills && <div className="vessel-filter-pills" aria-label="船舶分類多選">
      <button type="button" aria-pressed={allActive} className={`filter-pill ${allActive ? 'active' : ''}`} onClick={() => onChange(emptyVesselFilterState())}>全部</button>
      <button type="button" aria-pressed={filters.selfManagedOnly} className={`filter-pill filter-pill-mine ${filters.selfManagedOnly ? 'active' : ''}`} onClick={() => onChange({ ...filters, selfManagedOnly: !filters.selfManagedOnly })}>自管船舶</button>
      {shipTypes.map(shipType => <button type="button" key={shipType} aria-pressed={filters.shipTypes.includes(shipType)} className={`filter-pill filter-pill-type ${filters.shipTypes.includes(shipType) ? 'active' : ''}`} onClick={() => onChange({ ...filters, shipTypes: toggleFilterValue(filters.shipTypes, shipType) })}>{shipType}</button>)}
      <button type="button" aria-pressed={filters.attentionGroups.includes('urgent-high')} className={`filter-pill filter-pill-high ${filters.attentionGroups.includes('urgent-high') ? 'active' : ''}`} onClick={() => onChange({ ...filters, attentionGroups: toggleFilterValue(filters.attentionGroups, 'urgent-high') })}>急／高關注</button>
      <button type="button" aria-pressed={filters.attentionGroups.includes('medium')} className={`filter-pill filter-pill-medium ${filters.attentionGroups.includes('medium') ? 'active' : ''}`} onClick={() => onChange({ ...filters, attentionGroups: toggleFilterValue(filters.attentionGroups, 'medium') })}>中關注</button>
      {showMeeting && <button type="button" aria-pressed={filters.meetingOnly} className={`filter-pill filter-pill-meeting ${filters.meetingOnly ? 'active' : ''}`} onClick={() => onChange({ ...filters, meetingOnly: !filters.meetingOnly })}>選入會議</button>}
    </div>}
  </div>;
}
