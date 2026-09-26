import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import './taskListColumns.css';

// The unchanged columns retain their existing compact-table width baselines.
export const taskListColumns = [
  { key: 'vessel', label: '船舶', width: 80, min: 64 },
  { key: 'type', label: '船種', width: 80, min: 64 },
  { key: 'attention', label: '關注維度／等級', width: 76, min: 76 },
  { key: 'source', label: '來源', width: 81, min: 81 },
  { key: 'item', label: '分類/事項', width: 300, min: 140 },
  { key: 'department', label: '部門', width: 170, min: 76 },
  { key: 'owners', label: '追蹤窗口', width: 90, min: 76 },
  { key: 'created', label: '發佈日期', width: 86, min: 86 },
  { key: 'deadline', label: '期限', width: 86, min: 86 },
  { key: 'status', label: '狀態', width: 112, min: 88 },
  { key: 'actions', label: '操作', width: 56, min: 56 },
] as const;
type ColumnKey = typeof taskListColumns[number]['key'];
const maximumWidth = 1200;
const storagePrefix = 'ship-task-list-widths-v1:';
const clamp = (value: number, min: number) => Math.min(maximumWidth, Math.max(min, Math.round(value)));

export function readTaskListWidths(key: string): number[] | null {
  if (!key) return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storagePrefix + key) || 'null');
    if (!Array.isArray(value) || value.length !== taskListColumns.length || !value.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
    return value.map((n, i) => clamp(n, taskListColumns[i].min));
  } catch { return null; }
}

export function useTaskListColumns(preferenceKey = '') {
  const initial = useMemo(() => readTaskListWidths(preferenceKey), [preferenceKey]);
  const [state, setState] = useState<{key: string; widths: number[] | null}>({ key: preferenceKey, widths: initial });
  const widths = state.key === preferenceKey ? state.widths : initial;
  const liveKey = useRef(preferenceKey);
  const gesture = useRef<{key: string; pointerId: number; x: number; index: number; start: number[]; previous: number[] | null; next: number[]} | null>(null);
  // Drop an in-progress layout gesture at every actor/workspace/list transition, including A→B→A.
  if (liveKey.current !== preferenceKey) {
    liveKey.current = preferenceKey;
    gesture.current = null;
    setState({ key: preferenceKey, widths: initial });
  }
  useEffect(() => () => { gesture.current = null; }, []);
  const publish = (key: string, next: number[] | null, persist: boolean) => {
    if (liveKey.current !== key) return;
    setState({ key, widths: next });
    if (persist && key) {
      try {
        if (next) localStorage.setItem(storagePrefix + key, JSON.stringify(next));
        else localStorage.removeItem(storagePrefix + key);
      } catch { /* Unavailable/quota-limited storage must not block local resizing. */ }
    }
  };
  const measured = (node: HTMLElement) => Array.from(node.closest('table')!.querySelectorAll<HTMLTableCellElement>('thead th')).slice(1).map(n => n.getBoundingClientRect().width);
  const resizeHandle = (key: ColumnKey) => {
    const index = taskListColumns.findIndex(c => c.key === key), column = taskListColumns[index];
    const move = (event: PointerEvent<HTMLSpanElement>) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId || current.key !== liveKey.current) return;
      const next = [...current.start];
      next[current.index] = clamp(current.start[current.index] + event.clientX - current.x, taskListColumns[current.index].min);
      current.next = next;
      publish(current.key, next, false);
    };
    const cancel = () => {
      const current = gesture.current;
      gesture.current = null;
      if (current) publish(current.key, current.previous, false);
    };
    return <span role="separator" tabIndex={0} aria-label={`調整${column.label}欄寬`} aria-orientation="vertical" aria-valuemin={column.min} aria-valuemax={maximumWidth} aria-valuenow={Math.round(widths?.[index] ?? column.width)} className="task-list-column-resize" title="拖曳調整欄寬；方向鍵左右微調" onClick={event => event.stopPropagation()}
      onPointerDown={event => {
        if (event.button !== 0 || gesture.current) return;
        event.preventDefault(); event.stopPropagation();
        const start = measured(event.currentTarget);
        gesture.current = { key: preferenceKey, pointerId: event.pointerId, x: event.clientX, index, start, previous: widths, next: start };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={move} onPointerUp={event => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        move(event); gesture.current = null;
        publish(current.key, current.next, true);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        const next = measured(event.currentTarget);
        next[index] = clamp(next[index] + (event.key === 'ArrowLeft' ? -10 : 10), column.min);
        publish(preferenceKey, next, true);
      }}/>
  };
  const rendered = widths ?? taskListColumns.map(c => c.width);
  const total = 42 + rendered.reduce((sum, value) => sum + value, 0);
  return {
    tableStyle: { width: widths ? total : '100%', minWidth: total },
    colgroup: <colgroup><col style={{width:42}}/>{taskListColumns.map((c, i) => <col key={c.key} style={{width:rendered[i]}}/>)}</colgroup>,
    resizeHandle,
    reset: () => { gesture.current = null; publish(preferenceKey, null, true); },
  };
}
