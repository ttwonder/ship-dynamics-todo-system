import { useEffect, useMemo, useRef, useState } from 'react';
import type { Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';
import { resolveQuickMorningSelection } from './morningSelection';
import type { QuickMorningMode } from './morningSelection';

type Props = {
  vessels: Vessel[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onEnter: (ids: string[]) => void;
};

export default function QuickMorningPicker({ vessels, selectedIds, onChange, onEnter }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickMorningMode>(() => selectedIds.length > 0 && selectedIds.length === vessels.length ? 'all' : 'vessels');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedVessels, setSelectedVessels] = useState<string[]>(selectedIds);
  const rootRef = useRef<HTMLDivElement>(null);
  const shipTypes = useMemo(() => Array.from(new Set(vessels.map(vessel => vessel.shipType.trim()).filter(Boolean))).sort((a,b) => a.localeCompare(b,'zh-TW')), [vessels]);
  const resolvedIds = resolveQuickMorningSelection(mode, selectedTypes, selectedVessels, vessels);

  useEffect(() => {
    setSelectedVessels(selectedIds.filter(id => vessels.some(vessel => vessel.id === id)));
  }, [selectedIds.join('|'), vessels]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  const apply = (nextMode: QuickMorningMode, nextTypes = selectedTypes, nextVessels = selectedVessels) => {
    setMode(nextMode);
    onChange(resolveQuickMorningSelection(nextMode, nextTypes, nextVessels, vessels));
  };
  const toggleType = (shipType: string) => {
    const next = selectedTypes.includes(shipType) ? selectedTypes.filter(value => value !== shipType) : [...selectedTypes, shipType];
    setSelectedTypes(next);
    apply('types', next, selectedVessels);
  };
  const toggleVessel = (id: string) => {
    const next = selectedVessels.includes(id) ? selectedVessels.filter(value => value !== id) : [...selectedVessels, id];
    setSelectedVessels(next);
    apply('vessels', selectedTypes, next);
  };
  const clear = () => {
    setMode('vessels');
    setSelectedTypes([]);
    setSelectedVessels([]);
    onChange([]);
  };

  return <div className="quick-morning-picker" ref={rootRef}>
    <button type="button" className={`btn pink quick-morning-trigger ${open ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="quick-morning-panel" onClick={() => setOpen(value => !value)}>
      快速入會 <span>{selectedIds.length} 艘</span><i aria-hidden="true">⌄</i>
    </button>
    {open && <div id="quick-morning-panel" className="quick-morning-panel" role="dialog" aria-label="快速入會船舶選擇">
      <div className="quick-morning-panel-head"><div><b>快速入會</b><small>选择范围后，可直接进入今日早会</small></div><button type="button" className="btn small ghost" aria-label="关闭快速入会" onClick={() => setOpen(false)}>×</button></div>
      <div className="quick-morning-modes" role="group" aria-label="入会船舶范围">
        <button type="button" className={mode === 'all' ? 'active' : ''} aria-pressed={mode === 'all'} onClick={() => apply('all')}><b>全部船舶</b><small>{vessels.length} 艘</small></button>
        <button type="button" className={mode === 'types' ? 'active' : ''} aria-pressed={mode === 'types'} onClick={() => apply('types')}><b>按船舶類型</b><small>可多选分类</small></button>
        <button type="button" className={mode === 'vessels' ? 'active' : ''} aria-pressed={mode === 'vessels'} onClick={() => apply('vessels')}><b>逐船選擇</b><small>可多选单船</small></button>
      </div>
      {mode === 'all' && <div className="quick-morning-result"><b>全部船舶已选入</b><span>共 {vessels.length} 艘船舶</span></div>}
      {mode === 'types' && <div className="quick-morning-options"><div className="quick-morning-options-title"><b>多选船舶分类</b><span>已选 {selectedTypes.length} 类</span></div><div className="quick-morning-chip-grid">{shipTypes.map(shipType => { const active=selectedTypes.includes(shipType); const count=vessels.filter(vessel=>vessel.shipType===shipType).length; return <button type="button" key={shipType} className={active?'active':''} aria-pressed={active} onClick={()=>toggleType(shipType)}><span>{active?'✓':''}</span><b>{shipType}</b><small>{count} 艘</small></button>; })}</div></div>}
      {mode === 'vessels' && <div className="quick-morning-options"><div className="quick-morning-options-title"><b>多选单船</b><span>已选 {resolvedIds.length} 艘</span></div><div className="quick-morning-chip-grid vessels">{vessels.map(vessel => { const active=selectedVessels.includes(vessel.id); return <button type="button" key={vessel.id} className={active?'active':''} aria-pressed={active} onClick={()=>toggleVessel(vessel.id)}><span>{active?'✓':''}</span><b>{vesselDisplayName(vessel)}</b><small>{vessel.shipType}</small></button>; })}</div></div>}
      <div className="quick-morning-summary">当前选中 <b>{resolvedIds.length}</b> 艘船舶</div>
      <div className="quick-morning-actions"><button type="button" className="btn ghost" onClick={clear}>清除入會船舶</button><button type="button" className="btn pink" disabled={!resolvedIds.length} onClick={()=>{onEnter(resolvedIds);setOpen(false);}}>選中船舶入早會</button></div>
    </div>}
  </div>;
}
