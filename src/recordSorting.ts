export interface CreatedRecord {
  id: string;
  createdAt?: string | null;
}

function createdTimestamp(value: string | null | undefined): number | null {
  if (!value || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareStableId(left: CreatedRecord, right: CreatedRecord): number {
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function compareCreatedNewestFirst(left: CreatedRecord, right: CreatedRecord): number {
  const leftCreated = createdTimestamp(left.createdAt);
  const rightCreated = createdTimestamp(right.createdAt);
  if (leftCreated !== null && rightCreated !== null) {
    return rightCreated - leftCreated || compareStableId(left, right);
  }
  if (leftCreated !== null) return -1;
  if (rightCreated !== null) return 1;
  return compareStableId(left, right);
}

export function sortRecordsNewestCreated<T extends CreatedRecord>(records: readonly T[]): T[] {
  return [...records].sort(compareCreatedNewestFirst);
}
