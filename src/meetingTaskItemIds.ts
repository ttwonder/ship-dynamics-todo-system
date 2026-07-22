export function canonicalizeMeetingTaskItemIds<T extends { id: string }>(items: T[], fallbackPrefix: string): T[] {
  const rawIds = items.map((item,index) => item.id.trim() || `${fallbackPrefix}-${index + 1}`);
  const reservedRawIds = new Set(rawIds);
  const used = new Set<string>();
  return items.map((item,index) => {
    const rawId = rawIds[index];
    if (!used.has(rawId)) {
      used.add(rawId);
      return { ...item, id: rawId };
    }
    let suffix = index + 1;
    let candidate = `${rawId}-duplicate-${suffix}`;
    while (used.has(candidate) || reservedRawIds.has(candidate)) {
      suffix += 1;
      candidate = `${rawId}-duplicate-${suffix}`;
    }
    used.add(candidate);
    return { ...item, id: candidate };
  });
}
