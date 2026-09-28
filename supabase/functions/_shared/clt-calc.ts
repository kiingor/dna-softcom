// Cálculo de INSS/IRPF/FGTS pelas tabelas oficiais 2026 — versão Deno.
//
// MIRROR de src/lib/payroll/cltCalc.ts. Esse arquivo existe porque Edge
// Functions (Deno) não conseguem importar do src/ (Vite). Mantém em sync
// manualmente: se uma tabela mudar (atualização anual), atualizar AMBOS:
//   - src/lib/payroll/cltCalc.ts  (UI / período / "Recalcular encargos")
//   - supabase/functions/_shared/clt-calc.ts  (sync de colaborador)
//
// Fora do escopo: rescisão, 13º com encargos completos, eSocial, FAP/RAT,
// contribuição patronal — tudo isso continua sendo controle manual.

// ─────────────────────────────────────────────────────────────────────────────
// Tabelas 2026
// ─────────────────────────────────────────────────────────────────────────────

export const INSS_TABLE_2026 = [
  { max: 1621.0, rate: 0.075, deduction: 0 },
  { max: 2902.84, rate: 0.09, deduction: 24.32 },
  { max: 4354.27, rate: 0.12, deduction: 111.4 },
  { max: 8475.55, rate: 0.14, deduction: 198.49 },
] as const;

export const INSS_CEILING_2026 = 988.09;
export const INSS_CEILING_SALARY_2026 = 8475.55;

export const IRPF_TABLE_2026 = [
  { max: 2428.8, rate: 0, deduction: 0 },
  { max: 2826.65, rate: 0.075, deduction: 182.16 },
  { max: 3751.05, rate: 0.15, deduction: 394.16 },
  { max: 4664.68, rate: 0.225, deduction: 675.49 },
  { max: Infinity, rate: 0.275, deduction: 908.73 },
] as const;

export const DEPENDENT_DEDUCTION_2026 = 189.59;
// Receita Federal: dedução mensal mais favorável, sem somar os dois regimes.
// https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026
export const IRPF_SIMPLIFIED_DEDUCTION_2026 = 607.20;
// Lei 9.430/1996, art. 67: dispensa de retenção na renda sujeita ao ajuste anual.
export const IRPF_MONTHLY_WITHHOLDING_EXEMPTION = 10;
export const IRPF_FULL_EXEMPTION_LIMIT_2026 = 5000;
export const IRPF_REDUCER_LIMIT_2026 = 7350;
export const IRPF_REDUCER_BASE_2026 = 978.62;
export const IRPF_REDUCER_RATE_2026 = 0.133145;

export const FGTS_RATE = 0.08;

// ─────────────────────────────────────────────────────────────────────────────
// Funções
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** INSS progressivo via parcela a deduzir. Acima do teto, valor fixo. */
export function calcINSS(grossSalary: number): number {
  if (grossSalary <= 0) return 0;
  if (grossSalary >= INSS_CEILING_SALARY_2026) return INSS_CEILING_2026;
  for (const b of INSS_TABLE_2026) {
    if (grossSalary <= b.max) {
      return round2(grossSalary * b.rate - b.deduction);
    }
  }
  return INSS_CEILING_2026;
}

/**
 * Retenção mensal: dedução legal ou simplificada mais favorável, redução da
 * Lei 15.270/2025 e dispensa de retenção até R$ 10 (Lei 9.430/1996, art. 67).
 * Os fluxos separados que já usam applyRedutor=false mantêm seu tratamento;
 * applyMonthlyRules permite configurar as regras mensais independentemente.
 */
export function calcIRPF(args: {
  grossSalary: number;
  inss: number;
  dependents: number;
  applyRedutor?: boolean;
  applyMonthlyRules?: boolean;
}): number {
  const {
    grossSalary, inss, dependents, applyRedutor = true,
    applyMonthlyRules = applyRedutor,
  } = args;
  if (grossSalary <= 0) return 0;
  if (applyRedutor && grossSalary <= IRPF_FULL_EXEMPTION_LIMIT_2026) return 0;

  const legalDeductions = inss + DEPENDENT_DEDUCTION_2026 * Math.max(0, dependents);
  const deduction = applyMonthlyRules
    ? Math.max(legalDeductions, IRPF_SIMPLIFIED_DEDUCTION_2026)
    : legalDeductions;
  const base = grossSalary - deduction;
  if (base <= 0) return 0;

  let imposto = 0;
  for (const b of IRPF_TABLE_2026) {
    if (base <= b.max) {
      imposto = base * b.rate - b.deduction;
      break;
    }
  }
  if (imposto < 0) imposto = 0;

  if (applyRedutor && grossSalary <= IRPF_REDUCER_LIMIT_2026) {
    const redutor = Math.max(
      0,
      IRPF_REDUCER_BASE_2026 - IRPF_REDUCER_RATE_2026 * grossSalary,
    );
    imposto = Math.max(0, imposto - redutor);
  }

  const withholding = round2(imposto);
  return applyMonthlyRules && withholding <= IRPF_MONTHLY_WITHHOLDING_EXEMPTION
    ? 0
    : withholding;
}

/** FGTS é encargo do empregador (8% do bruto). Não desconta do colaborador. */
export function calcFGTS(grossSalary: number): number {
  if (grossSalary <= 0) return 0;
  return round2(grossSalary * FGTS_RATE);
}

/** Helper: calcula os 3 de uma vez. */
export function calcAllTaxes(args: {
  grossSalary: number;
  dependents: number;
}): { inss: number; irpf: number; fgts: number } {
  const inss = calcINSS(args.grossSalary);
  const irpf = calcIRPF({
    grossSalary: args.grossSalary,
    inss,
    dependents: args.dependents,
  });
  const fgts = calcFGTS(args.grossSalary);
  return { inss, irpf, fgts };
}
