import type { Message, TaskContext } from "./contracts.ts";

export interface HistoryRow {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

// Recebe linhas mais recentes primeiro, como retornadas pelo banco.
// Mantém turnos recentes completos e descarta apenas o contexto mais antigo.
export function buildHistory(
  rows: HistoryRow[],
  currentMessageId: string,
  maxChars = 32000,
): Message[] {
  const selected: HistoryRow[] = [];
  let size = 0;
  for (const row of rows) {
    if (
      row.id === currentMessageId ||
      !["user", "assistant"].includes(row.role)
    )
      continue;
    if (size + row.content.length > maxChars) break;
    selected.push(row);
    size += row.content.length;
  }
  selected.reverse();
  while (selected.length && selected[0].role !== "user") selected.shift();
  return selected.map((row) => ({
    role: row.role as Message["role"],
    content: row.content,
  }));
}

export function readContext(value: unknown): TaskContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const ctx = value as TaskContext;
  const safeText = (text: unknown, size: number) =>
    typeof text === "string" ? text.slice(0, size) : "";
  const safeList = (list: unknown) =>
    Array.isArray(list)
      ? list
          .filter((text): text is string => typeof text === "string")
          .slice(0, 6)
          .map((text) => text.slice(0, 500))
      : [];
  const selection = Array.isArray(ctx.selection)
    ? ctx.selection
        .filter((s) => s && typeof s.id === "string")
        .slice(0, 10)
        .map((s) => ({
          id: s.id.slice(0, 36),
          reason: safeText(s.reason, 500),
          evidence: safeList(s.evidence),
          gaps: safeList(s.gaps),
        }))
    : [];
  const analysis =
    ctx.analysis &&
    [
      "query_admissions",
      "query_recruitment",
      "query_workforce",
      "query_journey",
    ].includes(ctx.analysis.tool) &&
    ctx.analysis.filters &&
    typeof ctx.analysis.filters === "object" &&
    !Array.isArray(ctx.analysis.filters) &&
    JSON.stringify(ctx.analysis.filters).length <= 2000
      ? ctx.analysis
      : undefined;
  return {
    brief: safeText(ctx.brief, 2000) || undefined,
    jobId: safeText(ctx.jobId, 36) || undefined,
    selection,
    analysis,
  };
}
