import { formatCurrency } from "@/lib/formatters";
import { isMaskedColumn } from "./audit-labels";

// Valores monetários por nome de coluna (heurística — qualquer coluna com
// 'salary', 'value', 'amount' etc. tenta formatar como BRL).
const MONEY_COLUMN_PATTERNS = [
  /^salary$/i,
  /salary_/i,
  /^value$/i,
  /^amount$/i,
  /custom_value/i,
  /^net$/i,
  /_total$/i,
];

const DATE_COLUMN_PATTERNS = [
  /_at$/i,
  /_date$/i,
  /^date$/i,
  /^birth_date$/i,
];

const BOOL_COLUMN_PATTERNS = [
  /^is_/i,
  /^has_/i,
  /^can_/i,
  /^required$/i,
];

// Tradução de enums conhecidos. Estende quando precisar.
const ENUM_LABELS: Record<string, Record<string, string>> = {
  // payroll
  status_payroll: {
    open: "Aberto",
    closed: "Fechado",
    exported: "Exportado",
  },
  regime: {
    clt: "CLT",
    pj: "PJ",
    estagiario: "Estagiário",
  },
  payroll_entry_type: {
    salario_base: "Salário base",
    salario_retroativo: "Salário Retroativo",
    hora_extra: "Hora extra",
    falta: "Falta",
    atestado: "Atestado",
    beneficio: "Benefício",
    adiantamento: "Adiantamento",
    bonificacao: "Bonificação",
    gratificacao: "Gratificação",
    carro_agregado: "Veículo",
    periculosidade: "Periculosidade",
    salario_familia: "Salário-Família",
    desconto: "Desconto",
    emprestimo: "Empréstimo",
    inss: "INSS",
    fgts: "FGTS",
    irpf: "IRPF",
  },
  job_status: {
    draft: "Rascunho",
    open: "Aberta",
    paused: "Pausada",
    filled: "Preenchida",
    cancelled: "Cancelada",
  },
  admission_status: {
    created: "Criada",
    docs_pending: "Aguardando docs",
    docs_in_review: "Em revisão",
    docs_needs_adjustment: "Pedindo ajuste",
    docs_approved: "Docs aprovados",
    exam_scheduled: "Exame agendado",
    exam_done: "Exame feito",
    contract_signed: "Contrato assinado",
    admitted: "Admitido",
    cancelled: "Cancelada",
  },
};

function isMoney(column: string): boolean {
  return MONEY_COLUMN_PATTERNS.some((re) => re.test(column));
}

function isDate(column: string): boolean {
  return DATE_COLUMN_PATTERNS.some((re) => re.test(column));
}

function isBool(column: string): boolean {
  return BOOL_COLUMN_PATTERNS.some((re) => re.test(column));
}

function lookupEnum(column: string, value: string): string | null {
  // Tenta dictionaries em ordem; o primeiro match vence
  if (column === "regime" && ENUM_LABELS.regime[value]) {
    return ENUM_LABELS.regime[value];
  }
  if (column === "type" && ENUM_LABELS.payroll_entry_type[value]) {
    return ENUM_LABELS.payroll_entry_type[value];
  }
  if (column === "status") {
    return (
      ENUM_LABELS.status_payroll[value] ??
      ENUM_LABELS.job_status[value] ??
      ENUM_LABELS.admission_status[value] ??
      null
    );
  }
  return null;
}

export function formatValue(column: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (isMaskedColumn(column)) return "***";

  if (typeof value === "boolean" || isBool(column)) {
    if (value === true || value === "true") return "Sim";
    if (value === false || value === "false") return "Não";
  }

  if (typeof value === "number" && isMoney(column)) {
    return formatCurrency(value);
  }
  if (typeof value === "string" && isMoney(column)) {
    const num = Number(value);
    if (Number.isFinite(num)) return formatCurrency(num);
  }

  if (typeof value === "string" && isDate(column)) {
    // Tenta parsear; se não for ISO válida, devolve string
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      // Datetime se o nome for *_at, só data caso contrário
      if (/_at$/.test(column)) {
        return (
          d.toLocaleDateString("pt-BR") +
          " " +
          d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        );
      }
      return d.toLocaleDateString("pt-BR");
    }
  }

  if (typeof value === "string") {
    const enumLabel = lookupEnum(column, value);
    if (enumLabel) return enumLabel;
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "(vazio)";
    return value.map((v) => formatValue(column, v)).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export const ACTION_LABELS: Record<string, string> = {
  insert: "Criou",
  update: "Editou",
  delete: "Excluiu",
};

export const ACTION_COLORS: Record<string, string> = {
  insert: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
  update: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
  delete: "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
};

// Lista de colunas que mudaram entre `before` e `after`. Filtra ruído
// (timestamps auto-gerenciados etc.) e respeita máscaras.
export interface ChangedField {
  column: string;
  before: unknown;
  after: unknown;
}

export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  noiseColumns: Set<string>,
): ChangedField[] {
  if (!before && !after) return [];

  const allKeys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  const result: ChangedField[] = [];
  for (const col of allKeys) {
    if (noiseColumns.has(col)) continue;
    const a = before?.[col] ?? null;
    const b = after?.[col] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    result.push({ column: col, before: a, after: b });
  }
  return result.sort((a, b) => a.column.localeCompare(b.column));
}
