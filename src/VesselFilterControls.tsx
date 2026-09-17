import { useState } from 'react';
import './supervisorOrder.css';
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
  supervisorOrder?: string[];
  onSaveSupervisorOrder?: (ids: string[], expected: string[] | undefined) => Promise<boolean>;
}

export default function VesselFilterControls({ filters, shipTypes, supervisors, onChange, showPills = true, showSupervisors = true, showMeeting = true, supervisorOrder, onSaveSupervisorOrder }: Props) {
  const [supervisorQuery, setSupervisorQuery] = useState('');
  const [orderDraft, setOrderDraft] = useState<{ options: VesselSupervisorOption[]; expected: string[] | undefined; saving: boolean; error: string } | null>(null);
  const moveSupervisor = (index: number, delta: number) => setOrderDraft(previous => {
    if (!previous || previous.saving || index + delta < 0 || index + delta >= previous.options.length) return previous;
    const options = [...previous.options];
    [options[index], options[index + delta]] = [options[index + delta], options[index]];
    return { ...previous, options, error: '' };
  });
  const saveOrder = async () => {
    if (!orderDraft || orderDraft.saving || !onSaveSupervisorOrder) return;
    const pending = { ...orderDraft, saving: true, error: '' };
    setOrderDraft(pending);
    const visibleIds = pending.options.map(option => option.id);
    const ids = Array.from(new Set([...visibleIds, ...(pending.expected || []).filter(id => !visibleIds.includes(id))]));
    try {
      const saved = await onSaveSupervisorOrder(ids, pending.expected);
      setOrderDraft(current => current !== pending ? current : saved ? null : { ...pending, saving: false, error: '尚未確認保存，排序草稿已保留。' });
    } catch (error) {
      setOrderDraft(current => current !== pending ? current : { ...pending, saving: false, error: error instanceof Error ? error.message : '排序未保存，請稍後再試。' });
    }
  };
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
        <div className="vessel-supervisor-heading"><span>可多選督導</span>{onSaveSupervisorOrder && <button type="button" className="btn small ghost" disabled={Boolean(orderDraft)} onClick={() => setOrderDraft({ options: [...supervisors], expected: supervisorOrder?.slice(), saving: false, error: '' })}>排序</button>}{filters.supervisorIds.length > 0 && <button type="button" className="btn small ghost" onClick={() => onChange({ ...filters, supervisorIds: [] })}>清空</button>}</div>
        {orderDraft && onSaveSupervisorOrder && <section className="supervisor-order-editor" role="dialog" aria-label="督導排序">
          <b>督導選單排序</b><small>以箭頭調整；保存後所有人共用。</small>
          <ol>{orderDraft.options.map((option, index) => <li key={option.id}><span>{option.name}</span><button type="button" className="btn small ghost" aria-label={`上移 ${option.name}`} disabled={orderDraft.saving || index === 0} onClick={() => moveSupervisor(index, -1)}>↑</button><button type="button" className="btn small ghost" aria-label={`下移 ${option.name}`} disabled={orderDraft.saving || index === orderDraft.options.length - 1} onClick={() => moveSupervisor(index, 1)}>↓</button></li>)}</ol>
          {orderDraft.error && <p role="alert">{orderDraft.error}</p>}
          <div className="supervisor-order-actions"><button type="button" className="btn small ghost" disabled={orderDraft.saving} onClick={() => setOrderDraft(null)}>取消排序</button><button type="button" className="btn small primary" disabled={orderDraft.saving} onClick={() => void saveOrder()}>{orderDraft.saving ? '保存中…' : '保存排序'}</button></div>
        </section>}
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
