export type DashboardFleetFilter = 'all' | 'mine' | 'tanker' | 'bulk' | 'high' | 'selected';

export function toggleDashboardFilter(current: string, next: string): string {
  if (next === 'all' || current === next) return 'all';
  return next;
}
