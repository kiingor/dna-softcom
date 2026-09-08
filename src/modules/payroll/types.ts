// Tipos do módulo Folha (controle, NÃO cálculo CLT).
//
// CLAUDE.md princípio 2: o DNA Softcom não calcula folha.
// Apenas controla lançamentos e exporta organizado pro contador.

import type { Database } from "@/integrations/supabase/types";

export type PayrollPeriod = Database["public"]["Tables"]["payroll_periods"]["Row"];
export type PayrollPeriodInsert =
  Database["public"]["Tables"]["payroll_periods"]["Insert"];

export type PayrollEntry = Database["public"]["Tables"]["payroll_entries"]["Row"];
export type PayrollEntryInsert =
  Database["public"]["Tables"]["payroll_entries"]["Insert"];

export type PayrollAlert = Database["public"]["Tables"]["payroll_alerts"]["Row"];
export type PayrollAlertInsert =
  Database["public"]["Tables"]["payroll_alerts"]["Insert"];

export type PayrollPeriodStatus =
  Database["public"]["Enums"]["payroll_period_status"];
export type PayrollEntryType = Database["public"]["Enums"]["payroll_entry_type"];
export type PayrollAlertKind = Database["public"]["Enums"]["payroll_alert_kind"];
export type PayrollAlertSeverity =
  Database["public"]["Enums"]["payroll_alert_severity"];

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de lançamento ATIVOS no DNA Softcom (decisão Q1 da Fase 4)
// Os outros valores do enum são órfãos legacy meurh; não usar pra novos
// lançamentos. UI mostra só estes.
// ─────────────────────────────────────────────────────────────────────────────

export const ACTIVE_ENTRY_TYPES = [
  "salario_base",
  "hora_extra",
  "falta",
  "atestado",
  "beneficio",
  "adiantamento",
  "bonificacao",
  "gratificacao",
  "carro_agregado",
  "periculosidade",
  "auxilio_vale_transporte",
  "salario_retroativo",
  "desconto",
  "emprestimo",
] as const;

export type ActiveEntryType = (typeof ACTIVE_ENTRY_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Lançamentos avulsos (manuais) na folha — UI de criação no NewEntryDialog.
// Filtra os tipos por natureza (crédito/débito) e exclui os que vêm de
// outros fluxos (salário base e benefício vêm do auto-populate da sync;
// ferias vem do fluxo próprio; INSS/IRPF/FGTS são calculados; legacy
// custo/despesa não usar pra novos).
// ─────────────────────────────────────────────────────────────────────────────

/** Lançamentos manuais a CRÉDITO (provento, soma no líquido). */
export const MANUAL_CREDIT_TYPES = [
  "hora_extra",
  "bonificacao",
  "gratificacao",
  "carro_agregado",
  "periculosidade",
  "atestado",
  "auxilio_vale_transporte",
  "salario_retroativo",
] as const;

/** Lançamentos manuais a DÉBITO (desconto, sai do líquido). */
export const MANUAL_DEBIT_TYPES = [
  "falta",
  "adiantamento",
  "desconto",
  "emprestimo",
] as const;

export type ManualEntryNature = "credit" | "debit";

/** Natureza de um tipo de lançamento (pra o toggle Crédito/Débito). */
export function entryTypeNature(type: ActiveEntryType): ManualEntryNature | null {
  if ((MANUAL_CREDIT_TYPES as readonly string[]).includes(type)) return "credit";
  if ((MANUAL_DEBIT_TYPES as readonly string[]).includes(type)) return "debit";
  return null; // salario_base, beneficio — não são lançamentos manuais
}

// Cores sutis por tipo pro tag/badge na folha. A ideia é só diferenciar
// visualmente, sem competir com os valores numéricos.
export const ENTRY_TYPE_COLORS: Record<string, string> = {
  salario_base:
    "bg-info/5 text-info border-info/25 dark:bg-info/15 dark:text-info dark:border-info/25",
  salario_retroativo:
    "bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-950/40 dark:text-lime-300 dark:border-lime-900/60",
  hora_extra:
    "bg-warning/5 text-warning border-warning/25 dark:bg-warning/15 dark:text-warning dark:border-warning/25",
  beneficio:
    "bg-success/5 text-success border-success/25 dark:bg-success/15 dark:text-success dark:border-success/25",
  bonificacao:
    "bg-info/5 text-info border-info/25 dark:bg-info/15 dark:text-info dark:border-info/25",
  gratificacao:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/60",
  carro_agregado:
    "bg-info/5 text-info border-info/25 dark:bg-info/15 dark:text-info dark:border-info/25",
  periculosidade:
    "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-900/60",
  auxilio_vale_transporte:
    "bg-success/5 text-success border-success/25 dark:bg-success/15 dark:text-success dark:border-success/25",
  atestado:
    "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700",
  adiantamento:
    "bg-primary/5 text-primary border-primary/25 dark:bg-primary/15 dark:text-primary dark:border-primary/25",
  falta:
    "bg-destructive/5 text-destructive border-destructive/25 dark:bg-destructive/15 dark:text-destructive dark:border-destructive/25",
  desconto:
    "bg-destructive/5 text-destructive border-destructive/25 dark:bg-destructive/15 dark:text-destructive dark:border-destructive/25",
  emprestimo:
    "bg-destructive/5 text-destructive border-destructive/25 dark:bg-destructive/15 dark:text-destructive dark:border-destructive/25",
  ferias:
    "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900/60",
  salario_familia:
    "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-900/60",
  inss: "bg-destructive/5 text-destructive border-destructive/25 dark:bg-destructive/15 dark:text-destructive dark:border-destructive/25",
  irpf: "bg-destructive/5 text-destructive border-destructive/25 dark:bg-destructive/15 dark:text-destructive dark:border-destructive/25",
  fgts: "bg-destructive/5 text-destructive border-destructive/25 dark:bg-destructive/15 dark:text-destructive dark:border-destructive/25",
};

export const ENTRY_TYPE_LABELS: Record<string, string> = {
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
  auxilio_vale_transporte: "Auxílio Vale Transporte",
  desconto: "Desconto",
  emprestimo: "Empréstimo",
  ferias: "Férias",
  salario_familia: "Salário-Família",
  // Legacy (orphans)
  custo: "Custo (legacy)",
  despesa: "Despesa (legacy)",
  inss: "INSS",
  fgts: "FGTS",
  irpf: "IRPF",
};

// Categoria pra UI (proventos vs descontos)
export const EARNINGS_TYPES = [
  "salario_base",
  "salario_retroativo",
  "hora_extra",
  "beneficio",
  "bonificacao",
  "gratificacao",
  "carro_agregado",
  "periculosidade",
  "atestado",
  "auxilio_vale_transporte",
  "ferias",
  "salario_familia",
] as const;

export const DEDUCTION_TYPES = [
  "falta",
  "adiantamento",
  "desconto",
  "emprestimo",
  "inss",
  "irpf",
  "custo",
  "despesa",
] as const;

// Encargos do empregador: aparecem na folha como informação (custo da empresa),
// mas NÃO são descontados do líquido do colaborador. FGTS é 8% sobre o bruto e
// é depositado pela empresa — nunca sai do salário de quem recebe.
export const EMPLOYER_COST_TYPES = ["fgts"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// IRPF — base de cálculo
//
// O IRPF incide sobre TODOS os rendimentos tributáveis do mês (salário base +
// estes proventos), menos INSS e dedução por dependente.
//
// INSS/FGTS: incidem sobre o salário base + os proventos HABITUAIS que integram
// a remuneração (hora extra e periculosidade — ver INSS_TAXABLE_EARNING_TYPES).
// gratificação (espontânea = liberalidade), carro agregado e atestado entram SÓ
// no IRPF, não no INSS/FGTS — confere com a folha da contabilidade. Falta REDUZ
// as três bases.
//
// Ferias têm IRRF próprio no recibo (external_id 'ferias-%') e são excluídas.
// Isentos de tudo: salário-família, benefícios, bonificação (custo de setor).
// ─────────────────────────────────────────────────────────────────────────────
export const IRPF_TAXABLE_EARNING_TYPES = [
  "gratificacao",
  "hora_extra",
  "carro_agregado",
  "periculosidade",
  "atestado",
] as const;

// Proventos HABITUAIS que integram a base do INSS e do FGTS (além do salário
// base). SUBCONJUNTO de IRPF_TAXABLE_EARNING_TYPES — os demais (gratificação
// espontânea, carro agregado, atestado) são tributáveis no IRPF mas NÃO
// integram INSS/FGTS. Bate com a folha da contabilidade (gratificação
// espontânea = liberalidade, isenta de INSS/FGTS pela CLT).
export const INSS_TAXABLE_EARNING_TYPES = [
  "hora_extra",
  "periculosidade",
] as const;

// Único débito que REDUZ a base de INSS/FGTS/IRPF (falta = menos salário de
// contribuição). adiantamento, desconto e emprestimo NÃO mexem na base — só no
// líquido.
export const FALTA_BASE_DEBIT_TYPES = ["falta"] as const;

export function isEarning(type: string): boolean {
  return (EARNINGS_TYPES as readonly string[]).includes(type);
}

export function isDeduction(type: string): boolean {
  return (DEDUCTION_TYPES as readonly string[]).includes(type);
}

export function isEmployerCost(type: string): boolean {
  return (EMPLOYER_COST_TYPES as readonly string[]).includes(type);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status de período
// ─────────────────────────────────────────────────────────────────────────────

export const PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  open: "Rascunho",
  aprovado_rh: "Aprovado RH",
  aprovado_diretoria: "Aprovado Diretoria",
  closed: "Fechado",
  exported: "Exportado",
};

export const PERIOD_STATUS_COLORS: Record<PayrollPeriodStatus, string> = {
  open: "bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300",
  aprovado_rh:
    "bg-info/10 text-info dark:bg-info/15 dark:text-info",
  aprovado_diretoria:
    "bg-success/10 text-success dark:bg-success/15 dark:text-success",
  closed:
    "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
  exported:
    "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary",
};

// ─────────────────────────────────────────────────────────────────────────────
// Trava da folha — espelho EXATO de public.payroll_period_is_locked() (migration
// 20260727120100). Regra de produto: a folha só congela quando a DIRETORIA
// aprova; em 'open' e 'aprovado_rh' o RH continua editando.
//
// Enumeramos os EDITÁVEIS (lista curta e fechada), nunca os travados: assim um
// status novo nasce travado por padrão em vez de furar a regra em silêncio.
// ─────────────────────────────────────────────────────────────────────────────
export const PERIOD_EDITABLE_STATUSES = ["open", "aprovado_rh"] as const;

export function isPeriodEditable(
  status: PayrollPeriodStatus | null | undefined,
): boolean {
  if (!status) return false;
  return (PERIOD_EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** Mensagem pro usuário quando a edição é recusada por causa do status. */
export function periodLockedMessage(
  status: PayrollPeriodStatus | null | undefined,
): string {
  if (status === "aprovado_diretoria") {
    return "A diretoria já aprovou essa folha. Peça a devolução pra rascunho antes de alterar.";
  }
  if (status === "exported") {
    return "Folha já exportada pra contabilidade. Reabra antes de alterar.";
  }
  return "Período fechado. Pra alterar, reabre o fechamento ou cria estorno.";
}

// Transições válidas do fluxo — espelho de public.payroll_period_transition_action.
// `role` diz quem pode disparar: 'rh' = quem edita a folha, 'diretoria' = só
// diretoria/admin_gc. `needsReason` marca as devoluções (motivo obrigatório).
export interface PeriodTransition {
  to: PayrollPeriodStatus;
  label: string;
  role: "rh" | "diretoria";
  needsReason?: boolean;
  destructive?: boolean;
}

export const PERIOD_TRANSITIONS: Partial<
  Record<PayrollPeriodStatus, PeriodTransition[]>
> = {
  open: [
    { to: "aprovado_rh", label: "Aprovar (RH)", role: "rh" },
  ],
  aprovado_rh: [
    { to: "aprovado_diretoria", label: "Aprovar (Diretoria)", role: "diretoria" },
    {
      to: "open",
      label: "Devolver pra rascunho",
      role: "rh",
      needsReason: true,
      destructive: true,
    },
  ],
  aprovado_diretoria: [
    {
      to: "aprovado_rh",
      label: "Devolver pro RH",
      role: "diretoria",
      needsReason: true,
      destructive: true,
    },
    { to: "closed", label: "Fechar período", role: "rh" },
  ],
  closed: [{ to: "exported", label: "Marcar como exportado", role: "rh" }],
};

// ─────────────────────────────────────────────────────────────────────────────
// Alertas
// ─────────────────────────────────────────────────────────────────────────────

export const ALERT_KIND_LABELS: Record<PayrollAlertKind, string> = {
  collaborator_no_entry: "Colaborador sem lançamento",
  value_divergence: "Valor fora do esperado",
  absence_no_attestation: "Falta sem atestado",
  admission_pending: "Admissão pendente",
  termination_pending: "Desligamento pendente",
  other: "Outro",
};

export const ALERT_SEVERITY_COLORS: Record<PayrollAlertSeverity, string> = {
  info: "bg-info/10 text-info dark:bg-info/15 dark:text-info",
  warning:
    "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
  critical:
    "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
};

export const ALERT_SEVERITY_LABELS: Record<PayrollAlertSeverity, string> = {
  info: "Aviso",
  warning: "Atenção",
  critical: "Crítico",
};

// ─────────────────────────────────────────────────────────────────────────────
// Joined types
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollEntryWithCollaborator extends PayrollEntry {
  collaborator?: {
    id: string;
    name: string;
    cpf: string;
    regime: string | null;
    status: string;
    pix_key?: string | null;
    softcom_surname?: string | null;
    store_id?: string | null;
    team_id?: string | null;
  } | null;
}

export interface PayrollAlertWithCollaborator extends PayrollAlert {
  collaborator?: { id: string; name: string } | null;
}

export interface PayrollPeriodWithStats extends PayrollPeriod {
  entries_count?: number;
  total_value?: number;
  alerts_count?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de mês de referência
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function formatPeriodLabel(referenceMonth: string): string {
  // referenceMonth é date no formato YYYY-MM-01
  const d = new Date(referenceMonth + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function periodToMonthYear(referenceMonth: string): {
  month: number;
  year: number;
} {
  const d = new Date(referenceMonth + "T00:00:00");
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}
