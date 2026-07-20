export const PAGE_SIZE = 50;

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
};

export function paginateItems<T>(items: T[], requestedPage: number, pageSize = PAGE_SIZE): PaginatedResult<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * safePageSize;
  const pagedItems = items.slice(start, start + safePageSize);
  return {
    items: pagedItems,
    page,
    pageCount,
    total: items.length,
    from: pagedItems.length ? start + 1 : 0,
    to: start + pagedItems.length,
  };
}
