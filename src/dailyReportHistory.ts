export const DAILY_REPORT_HISTORY_PAGE_SIZE = 30;

export interface DailyReportDated {
  businessDate: string;
}

export interface DailyReportHistoryPage<T extends DailyReportDated> {
  items: T[];
  page: number;
  pageCount: number;
  pageStart: number;
  total: number;
}

export function sortDailyReportHistory<T extends DailyReportDated>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    right.businessDate.localeCompare(left.businessDate),
  );
}

export function paginateDailyReportHistory<T extends DailyReportDated>(
  items: readonly T[],
  requestedPage: number,
): DailyReportHistoryPage<T> {
  const ordered = sortDailyReportHistory(items);
  const pageCount = Math.max(1, Math.ceil(ordered.length / DAILY_REPORT_HISTORY_PAGE_SIZE));
  const safeRequestedPage = Number.isSafeInteger(requestedPage) ? requestedPage : 1;
  const page = Math.min(pageCount, Math.max(1, safeRequestedPage));
  const pageStart = (page - 1) * DAILY_REPORT_HISTORY_PAGE_SIZE;
  return {
    items: ordered.slice(pageStart, pageStart + DAILY_REPORT_HISTORY_PAGE_SIZE),
    page,
    pageCount,
    pageStart,
    total: ordered.length,
  };
}

export function locateDailyReportDate<T extends DailyReportDated>(
  items: readonly T[],
  businessDate: string,
): { index: number; page: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return null;
  const ordered = sortDailyReportHistory(items);
  const index = ordered.findIndex(item => item.businessDate === businessDate);
  if (index < 0) return null;
  return {
    index,
    page: Math.floor(index / DAILY_REPORT_HISTORY_PAGE_SIZE) + 1,
  };
}
