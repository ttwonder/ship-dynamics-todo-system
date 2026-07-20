type Props = {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  ariaLabel: string;
  compact?: boolean;
};

export default function PaginationControls({ page, pageCount, total, from, to, onPageChange, ariaLabel, compact = false }: Props) {
  if (total <= 0) return null;
  return <nav className={`pagination-controls no-print${compact ? ' compact' : ''}`} aria-label={ariaLabel}>
    <span>第 {from}–{to} 項，共 {total} 項</span>
    <div>
      <button type="button" className="btn small ghost" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="第一頁">«</button>
      <button type="button" className="btn small ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一頁</button>
      <b>第 {page} / {pageCount} 頁</b>
      <button type="button" className="btn small ghost" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>下一頁</button>
      <button type="button" className="btn small ghost" disabled={page >= pageCount} onClick={() => onPageChange(pageCount)} aria-label="最後一頁">»</button>
    </div>
  </nav>;
}
