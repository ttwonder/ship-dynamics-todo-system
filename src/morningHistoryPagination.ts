export const MORNING_HISTORY_PAGE_SIZE = 30;

export function paginateMorningHistory<T>(items: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / MORNING_HISTORY_PAGE_SIZE));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const currentPage = Math.min(Math.max(normalizedPage, 1), pageCount);
  const startIndex = items.length ? (currentPage - 1) * MORNING_HISTORY_PAGE_SIZE : 0;
  return {
    items: items.slice(startIndex, startIndex + MORNING_HISTORY_PAGE_SIZE),
    currentPage,
    pageCount,
    totalItems: items.length,
    startIndex,
  };
}
