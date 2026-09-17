export function counts<T>(rows: T[], key: (row: T) => string) {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const label = key(row);
    result[label] = (result[label] ?? 0) + 1;
  }
  return result;
}
export function daysSince(value: string | null, now: Date): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? Math.max(0, Math.floor((now.getTime() - time) / 86400000))
    : null;
}
export interface AdmissionRow {
  id: string;
  candidate_name: string;
  status: string;
  regime: string;
  created_at: string;
  status_entered_at: string | null;
}
export function admissionMetrics(
  rows: AdmissionRow[],
  now: Date,
  minDays?: number,
) {
  const mapped = rows.map((r) => ({
    ...r,
    days_in_status: daysSince(r.status_entered_at, now),
    days_since_creation: daysSince(r.created_at, now),
  }));
  const filtered =
    minDays === undefined
      ? mapped
      : mapped.filter(
          (r) => r.days_in_status !== null && r.days_in_status >= minDays,
        );
  return {
    matched: filtered.length,
    unknown_status_entry: mapped.filter((r) => r.days_in_status === null)
      .length,
    by_status: counts(filtered, (r) => r.status),
    rows: filtered.sort(
      (a, b) => (b.days_in_status ?? -1) - (a.days_in_status ?? -1),
    ),
  };
}
export function normalizeEvidence(value: string) {
  return value.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}
export function hasEvidence(summary: string | null, excerpt: string) {
  const normalized = normalizeEvidence(excerpt);
  return (
    normalized.length >= 8 &&
    normalizeEvidence(summary ?? "").includes(normalized)
  );
}
