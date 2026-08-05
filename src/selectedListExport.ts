export function selectedListRecords<T extends { id: string }>(records: T[], selectedIds: string[]): T[] {
  const selected = new Set(selectedIds);
  if (!selected.size) return [];
  return records.filter(record => selected.has(record.id));
}
