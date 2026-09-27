import { useLayoutEffect, useRef, useState } from 'react';
import type { TrackingItem } from './trackingTypes';
import { trackingColumnMinWidth, type TrackingColumn } from './trackingColumns';
import type { TrackingPreferences } from './trackingTablePreferences';
import type { TrackingQuery } from './trackingFilters';

export function TrackingTable({ rows, columns, preferences, onPreferences, sort, onSort, selected, onSelected, onOpenCase }: {
  rows: TrackingItem[]; columns: TrackingColumn[]; preferences: TrackingPreferences; onPreferences: (value: TrackingPreferences) => void;
  sort: TrackingQuery['sort']; onSort: (key: string) => void; selected: string[]; onSelected: (ids: string[]) => void; onOpenCase: (caseId: string) => void;
}) {
  const dragged = useRef(''); const suppressSort = useRef(false);
  const topScroll = useRef<HTMLDivElement>(null), bodyScroll = useRef<HTMLDivElement>(null), table = useRef<HTMLTableElement>(null);
  const [scrollSize, setScrollSize] = useState({ content: 0, viewport: 0 });
  const resizeCleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const body = bodyScroll.current!, node = table.current!;
    const measure = () => {
      const next = { content: body.scrollWidth, viewport: body.clientWidth };
      setScrollSize(previous => previous.content === next.content && previous.viewport === next.viewport ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body); observer.observe(node);
    return () => { observer.disconnect(); resizeCleanup.current?.(); };
  }, []);
  useLayoutEffect(() => { if (topScroll.current && bodyScroll.current) topScroll.current.scrollLeft = bodyScroll.current.scrollLeft; }, [scrollSize]);
  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (target && Math.abs(target.scrollLeft - source.scrollLeft) > 0.5) target.scrollLeft = source.scrollLeft;
  };

  const byKey = new Map(columns.map(column => [column.key, column]));
  const visible = ['referenceNo', ...preferences.order.filter(key => key !== 'referenceNo')].filter(key => !preferences.hidden.includes(key)).map(key => byKey.get(key)).filter((column): column is TrackingColumn => Boolean(column));
  const all = rows.length > 0 && rows.every(row => selected.includes(row.id));
  const changePage = () => onSelected(all ? selected.filter(id => !rows.some(row => row.id === id)) : [...new Set([...selected, ...rows.map(row => row.id)])]);
  const width = (column: TrackingColumn) => preferences.widths[column.key] || column.width;
  const resize = (event: React.PointerEvent, column: TrackingColumn) => {
    event.preventDefault(); event.stopPropagation(); suppressSort.current = true;
    resizeCleanup.current?.();
    const start = event.clientX, initial = width(column), node = event.currentTarget as HTMLElement;
    node.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => onPreferences({ ...preferences, widths: { ...preferences.widths, [column.key]: Math.min(800, Math.max(trackingColumnMinWidth(column.key), initial + e.clientX - start)) } });
    const end = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', end); window.setTimeout(() => { suppressSort.current = false; }, 0); };
    resizeCleanup.current = end;
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end);
  };
  return <div className="tracking-table-wrap">
    <div ref={topScroll} className="tracking-table-scroll-top" style={{ width: scrollSize.viewport || '100%' }} tabIndex={0} role="region" aria-label="跟蹤清單上方橫向捲動條" onScroll={event => syncScroll(event.currentTarget, bodyScroll.current)}><div style={{ width: scrollSize.content, height: 1 }}/></div>
    <div ref={bodyScroll} className="tracking-table-scroll" tabIndex={0} role="region" aria-label="跟蹤清單，可左右捲動" onScroll={event => syncScroll(event.currentTarget, topScroll.current)}><table ref={table} className="tracking-table">
    <thead><tr><th className="tracking-check"><input aria-label="選取本頁" type="checkbox" checked={all} onChange={changePage}/></th>{visible.map(column => <th key={column.key} className={column.key === 'referenceNo' ? 'tracking-reference' : ''} style={{ width: width(column), minWidth: width(column), maxWidth: width(column) }} aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} draggable={column.key !== 'referenceNo'} onDragStart={event => { dragged.current = column.key; suppressSort.current = true; event.dataTransfer.setData('text/plain', column.key); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const source = dragged.current; if (source && source !== column.key && column.key !== 'referenceNo') { const order = preferences.order.filter(key => key !== source); order.splice(order.indexOf(column.key), 0, source); onPreferences({ ...preferences, order }); } dragged.current = ''; }} onDragEnd={() => { dragged.current = ''; window.setTimeout(() => { suppressSort.current = false; }, 0); }}>
      <button type="button" className="tracking-sort" onClick={() => { if (!suppressSort.current) onSort(column.key); }}>{column.label} {sort.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</button>
      <span role="separator" tabIndex={0} aria-label={`調整${column.label}欄寬`} aria-orientation="vertical" className="tracking-resize" onPointerDown={event => resize(event, column)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); onPreferences({ ...preferences, widths: { ...preferences.widths, [column.key]: Math.min(800, Math.max(trackingColumnMinWidth(column.key), width(column) + (event.key === 'ArrowLeft' ? -10 : 10))) } }); } }}/>
    </th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} data-tracking-id={row.id}><td className="tracking-check"><input aria-label={`選取 ${row.referenceNo} ${row.subitemNo || ''}`} type="checkbox" checked={selected.includes(row.id)} onChange={() => onSelected(selected.includes(row.id) ? selected.filter(id => id !== row.id) : [...selected, row.id])}/></td>{visible.map(column => <td key={column.key} className={column.key === 'referenceNo' ? `tracking-reference ${row.urgency === 'urgent' ? 'tracking-urgent' : ''}` : column.type === 'date' ? 'tracking-date-cell' : ''} style={{ width: width(column), minWidth: width(column), maxWidth: width(column) }}>{column.key === 'normal' || column.key === 'urgent' ? <input aria-label={`${row.referenceNo} ${column.label}`} type="checkbox" checked={column.value(row) === '是'} readOnly tabIndex={-1}/> : column.key === 'linkState' && row.linkState === 'active' && row.linkedCaseId ? <button type="button" className="tracking-case-link" aria-label={`查看 ${row.referenceNo} 的內控`} title="查看已同步的內控內容" onClick={() => onOpenCase(row.linkedCaseId!)}>已同步</button> : <span className="tracking-cell-text">{column.value(row) || '—'}{column.key === 'referenceNo' && row.urgency === 'urgent' && <strong>（緊急）</strong>}</span>}</td>)}</tr>)}{!rows.length && <tr><td colSpan={visible.length + 1}>沒有符合條件的項目</td></tr>}</tbody>
  </table></div></div>;
}

export function TrackingPagination({ count, page, onPage }: { count: number; page: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / 30));
  return <div className="tracking-pagination"><span>第 {count ? (page - 1) * 30 + 1 : 0}–{Math.min(page * 30, count)} 項／共 {count} 項</span><button className="btn small" disabled={page === 1} onClick={() => onPage(1)}>首頁</button><button className="btn small" disabled={page === 1} onClick={() => onPage(page - 1)}>上一頁</button>{Array.from({ length: pages }, (_, index) => index + 1).filter(value => value === 1 || value === pages || Math.abs(value - page) <= 2).map(value => <button className={`btn small ${value === page ? 'primary' : ''}`} aria-current={page === value ? 'page' : undefined} key={value} onClick={() => onPage(value)}>{value}</button>)}<button className="btn small" disabled={page === pages} onClick={() => onPage(page + 1)}>下一頁</button><button className="btn small" disabled={page === pages} onClick={() => onPage(pages)}>末頁</button><form onSubmit={event => { event.preventDefault(); const value = Number(new FormData(event.currentTarget).get('page')); if (Number.isInteger(value)) onPage(Math.max(1, Math.min(pages, value))); }}><label>跳到 <input name="page" aria-label="跳到頁碼" type="number" min={1} max={pages} defaultValue={page} key={page}/> 頁</label><button className="btn small">跳頁</button></form></div>;
}
