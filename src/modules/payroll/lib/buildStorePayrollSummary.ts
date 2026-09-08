import { ENTRY_TYPE_LABELS, isDeduction, isEarning, isEmployerCost } from "../types";

export const PAYROLL_REPORT_TYPE_LABELS: Record<string, string> = {
  ...ENTRY_TYPE_LABELS,
  carro_agregado: "Agregado",
  bonificacao: "Custo setor",
};

const PRIMARY_TYPES = ["salario_base", "fgts", "carro_agregado", "bonificacao", "gratificacao"];

interface ReportEntryValue {
  type: string;
  value: number;
}

interface StoreReportEntry extends ReportEntryValue {
  store_id?: string | null;
  collaborator?: { store_id?: string | null } | null;
}

export interface PayrollReportTotals {
  valuesByType: Record<string, number>;
  earnings: number;
  deductions: number;
  fgts: number;
  net: number;
  companyCost: number;
}

export interface StorePayrollSummary {
  columns: { type: string; label: string }[];
  rows: (PayrollReportTotals & { storeId: string | null; storeName: string })[];
  totals: PayrollReportTotals;
}

// O PDV do lançamento preserva a competência quando o colaborador é transferido.
export function getPayrollReportStoreId(entry: StoreReportEntry): string | null {
  return entry.store_id ?? entry.collaborator?.store_id ?? null;
}

export function calculatePayrollReportTotals(entries: readonly ReportEntryValue[]): PayrollReportTotals {
  const centsByType: Record<string, number> = {};
  for (const entry of entries) {
    const cents = Math.round(Number(entry.value) * 100);
    centsByType[entry.type] = (centsByType[entry.type] ?? 0) + cents;
  }

  let earnings = 0;
  let deductions = 0;
  let fgts = 0;
  for (const [type, cents] of Object.entries(centsByType)) {
    if (isEmployerCost(type)) fgts += cents;
    else if (isEarning(type)) earnings += cents;
    else if (isDeduction(type)) deductions += cents;
  }

  return {
    valuesByType: Object.fromEntries(Object.entries(centsByType).map(([type, cents]) => [type, cents / 100])),
    earnings: earnings / 100,
    deductions: deductions / 100,
    fgts: fgts / 100,
    net: (earnings - deductions) / 100,
    // Mesma regra da aprovação: bonificação já está nos proventos; FGTS é custo da empresa.
    companyCost: (earnings + fgts) / 100,
  };
}

export function buildStorePayrollSummary(
  entries: readonly StoreReportEntry[],
  stores: readonly { id: string; store_name: string }[],
): StorePayrollSummary {
  const storeNames = new Map(stores.map((store) => [store.id, store.store_name]));
  const byStore = new Map<string | null, StoreReportEntry[]>();
  for (const entry of entries) {
    const storeId = getPayrollReportStoreId(entry);
    const storeEntries = byStore.get(storeId) ?? [];
    storeEntries.push(entry);
    byStore.set(storeId, storeEntries);
  }

  const additionalTypes = [...new Set(entries.map((entry) => entry.type))]
    .filter((type) => !PRIMARY_TYPES.includes(type))
    .sort((a, b) => Number(isDeduction(a)) - Number(isDeduction(b)) ||
      (PAYROLL_REPORT_TYPE_LABELS[a] ?? a).localeCompare(PAYROLL_REPORT_TYPE_LABELS[b] ?? b, "pt-BR"));

  return {
    columns: [...PRIMARY_TYPES, ...additionalTypes].map((type) => ({
      type,
      label: PAYROLL_REPORT_TYPE_LABELS[type] ?? type,
    })),
    rows: Array.from(byStore, ([storeId, storeEntries]) => ({
      storeId,
      storeName: storeId === null ? "Sem PDV" : storeNames.get(storeId) ?? "PDV não encontrado",
      ...calculatePayrollReportTotals(storeEntries),
    })).sort((a, b) => {
      if (a.storeId === null) return 1;
      if (b.storeId === null) return -1;
      return a.storeName.localeCompare(b.storeName, "pt-BR");
    }),
    totals: calculatePayrollReportTotals(entries),
  };
}

/** Valor da coluna com o sinal da sua natureza, inclusive em estornos. */
export function getPayrollReportTypeValue(totals: PayrollReportTotals, type: string): number {
  const value = totals.valuesByType[type] ?? 0;
  return isDeduction(type) && value !== 0 ? -value : value;
}
