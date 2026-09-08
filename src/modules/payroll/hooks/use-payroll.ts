import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";
import type {
  PayrollPeriod,
  PayrollEntry,
  PayrollEntryWithCollaborator,
  PayrollAlertWithCollaborator,
  PayrollPeriodWithStats,
} from "../types";
import {
  periodToMonthYear,
  formatPeriodLabel,
  IRPF_TAXABLE_EARNING_TYPES,
  INSS_TAXABLE_EARNING_TYPES,
  FALTA_BASE_DEBIT_TYPES,
  isPeriodEditable,
  periodLockedMessage,
} from "../types";
import type {
  OpenPeriodValues,
  NewEntryValues,
  ReverseEntryValues,
} from "../schemas/payroll.schema";
import { calculateMonthlyBenefitValue, type DayAbbrev } from "@/lib/workingDays";
import {
  calcAllTaxes,
  calcINSS,
  calcIRPF,
  calcFGTS,
  calcSalarioFamilia,
  computeCollaboratorTaxes,
  eligibleChildrenForSalarioFamilia,
  SALARIO_FAMILIA_LIMITE_2026,
} from "@/lib/payroll/cltCalc";
import { getCollabsToSkipNextMonth } from "@/lib/payroll/vacationSkipRules";
import { postScheduledVacations } from "../services/vacation-payroll.service";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { AGENDA_SYNC_DISABLED } from "@/lib/agenda-sync";
import {
  calcVtDiscount,
  vtDiscountExternalId,
  isTransportCategory,
  VT_BENEFIT_CATEGORY,
  VT_DISCOUNT_DESCRIPTION,
} from "@/lib/payroll/vtDiscount";

// ─────────────────────────────────────────────────────────────────────────────
// Salário do colaborador pra folha.
//
// Prioriza `current_salary` (salário REAL da pessoa, sincronizado da agenda)
// e cai pro salário do CARGO (position.salary) só como fallback. Antes a folha
// usava só o salário do cargo — colaborador cujo cargo está sem salário (mas a
// pessoa tem salário próprio) sumia da folha com "0 lançamentos", mesmo
// aparecendo certo no cadastro. Agora folha e cadastro batem na mesma fonte.
// ─────────────────────────────────────────────────────────────────────────────
function resolvePayrollSalary(c: {
  current_salary?: number | null;
  position?: { salary?: number } | null;
}): number {
  const personal = Number(c.current_salary ?? 0);
  if (personal > 0) return personal;
  return Number((c.position as { salary?: number } | null)?.salary ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Desconto Vale Transporte (VT): colaborador com benefício de categoria
// 'transport' desconta 6% do salário base. Idempotente por external_id
// 'vt-<collab>-<YYYY-MM>' (preservado no delete seletivo de período; apagado e
// recriado no recalc). Reaproveitado por openPeriod e repopulatePeriod.
// Ver [src/lib/payroll/vtDiscount.ts].
// ─────────────────────────────────────────────────────────────────────────────
async function insertVtDiscounts(params: {
  companyId: string;
  month: number;
  year: number;
  transportCollabIds: Set<string>;
  salaryByCollab: Map<string, number>;
  storeByCollab: Map<string, string | null>;
  skip: Set<string>;
}): Promise<number> {
  const { companyId, month, year, transportCollabIds, salaryByCollab, storeByCollab, skip } =
    params;
  if (transportCollabIds.size === 0) return 0;

  // Anti-dup: pega os descontos VT já lançados neste mês.
  const externalIds = Array.from(transportCollabIds).map((id) =>
    vtDiscountExternalId(id, year, month),
  );
  const { data: existing } = await supabase
    .from("payroll_entries")
    .select("external_id")
    .eq("company_id", companyId)
    .eq("month", month)
    .eq("year", year)
    .in("external_id", externalIds);
  const existingSet = new Set(
    (existing ?? []).map((e) => (e as { external_id: string }).external_id),
  );

  const rows: PayrollEntry[] = [];
  for (const collabId of transportCollabIds) {
    if (skip.has(collabId)) continue; // recibo de férias cobre o mês → sem VT
    const value = calcVtDiscount(salaryByCollab.get(collabId) ?? 0);
    if (value <= 0) continue; // sem salário válido (respeita CHECK value > 0)
    const externalId = vtDiscountExternalId(collabId, year, month);
    if (existingSet.has(externalId)) continue;
    rows.push({
      company_id: companyId,
      collaborator_id: collabId,
      store_id: storeByCollab.get(collabId) ?? null,
      external_id: externalId,
      type: "desconto" as const,
      description: VT_DISCOUNT_DESCRIPTION,
      value,
      is_fixed: true,
      is_payable: true,
      month,
      year,
    } as PayrollEntry);
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("payroll_entries").insert(rows);
    if (error) throw new Error("Falha ao lançar desconto VT: " + error.message);
  }
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ficha fixa (collaborator_fixed_entries) → materialização na folha.
//
// Itens fixos recorrentes (Carro Agregado, descontos fixos, etc.) moram no
// cadastro do colaborador, não na competência. A folha os materializa em
// payroll_entries sob demanda (openPeriod/repopulatePeriod), idempotente por
// external_id 'fixed-<id>-<YYYY-MM>' — mesmo esquema de VT e salário-família.
//
// Tipos manuais que a ficha fixa governa (os mesmos migrados pela migration
// 20260618120000). Exclui salário base, encargos, benefício, férias e legados,
// que vêm de outras fontes do cadastro.
// ─────────────────────────────────────────────────────────────────────────────
const FIXED_MANUAL_TYPES = [
  "carro_agregado",
  "desconto",
  "bonificacao",
  "gratificacao",
  "hora_extra",
  "atestado",
  "falta",
  "adiantamento",
] as const;

function fixedEntryExternalId(fixedId: string, year: number, month: number): string {
  return `fixed-${fixedId}-${year}-${String(month).padStart(2, "0")}`;
}

interface FixedEntryRow {
  id: string;
  collaborator_id: string;
  type: string;
  description: string | null;
  value: number;
}

// Materializa a ficha fixa de um mês:
//   1. Apaga os lançamentos fixos SOLTOS legados desse mês (is_fixed=true,
//      external_id NULL, tipos manuais) — consolida duplicatas pré-feature e
//      remove itens cuja ficha foi desativada/excluída.
//   2. Upsert de 1 payroll_entry por item ATIVO da ficha (external_id próprio),
//      atualizando valor/descrição se já existir (reflete edição ao repopular).
// Escopo: só o (month, year) passado — quem chama garante que é período aberto.
async function materializeFixedEntries(params: {
  companyId: string;
  month: number;
  year: number;
  activeCollabIds: Set<string>;
  storeByCollab: Map<string, string | null>;
}): Promise<number> {
  const { companyId, month, year, activeCollabIds, storeByCollab } = params;
  if (activeCollabIds.size === 0) return 0;

  // 1. Limpa lançamentos fixos soltos legados deste mês (consolida duplicatas).
  //    Não toca avulsos (is_fixed=false), sincronizados (external_id NOT NULL),
  //    nem salário/encargo/benefício (fora de FIXED_MANUAL_TYPES).
  const { error: delErr } = await supabase
    .from("payroll_entries")
    .delete()
    .eq("company_id", companyId)
    .eq("month", month)
    .eq("year", year)
    .eq("is_fixed", true)
    .is("external_id", null)
    .in("type", FIXED_MANUAL_TYPES as unknown as string[]);
  if (delErr) throw new Error("Falha ao limpar lançamentos fixos antigos: " + delErr.message);

  // 2. Carrega ficha fixa ativa dos colaboradores ativos.
  const fixedRows = await fetchAllRows<FixedEntryRow>(() =>
    supabase
      .from("collaborator_fixed_entries")
      .select("id, collaborator_id, type, description, value")
      .eq("company_id", companyId)
      .eq("is_active", true),
  );

  const rows: PayrollEntry[] = [];
  for (const f of fixedRows ?? []) {
    if (!activeCollabIds.has(f.collaborator_id)) continue; // inativo/desligado → pula
    const value = Number(f.value);
    if (!(value > 0)) continue; // respeita CHECK value > 0
    rows.push({
      company_id: companyId,
      collaborator_id: f.collaborator_id,
      store_id: storeByCollab.get(f.collaborator_id) ?? null,
      external_id: fixedEntryExternalId(f.id, year, month),
      type: f.type as PayrollEntry["type"],
      description: f.description,
      value,
      is_fixed: true,
      is_payable: true,
      month,
      year,
    } as PayrollEntry);
  }

  if (rows.length > 0) {
    // Upsert por (collaborator_id, external_id): atualiza valor/descrição se a
    // ficha mudou desde o último repopular.
    const { error: upErr } = await supabase
      .from("payroll_entries")
      .upsert(rows, {
        onConflict: "collaborator_id,external_id",
        ignoreDuplicates: false,
      });
    if (upErr) throw new Error("Falha ao materializar lançamentos fixos: " + upErr.message);
  }
  return rows.length;
}

const BASE_PAYROLL_TYPES = ["salario_base", "inss", "irpf", "fgts"] as const;
type BasePayrollType = (typeof BASE_PAYROLL_TYPES)[number];

async function loadBasePayrollCoverage(
  companyId: string,
  month: number,
  year: number,
): Promise<Map<string, Set<BasePayrollType>>> {
  const data = await fetchAllRows<{
    collaborator_id: string;
    type: BasePayrollType;
  }>(() =>
    supabase
      .from("payroll_entries")
      .select("collaborator_id, type")
      .eq("company_id", companyId)
      .eq("month", month)
      .eq("year", year)
      .in("type", Array.from(BASE_PAYROLL_TYPES)),
  );

  const coveredByCollab = new Map<string, Set<BasePayrollType>>();
  for (const e of data ?? []) {
    const cid = (e as { collaborator_id: string }).collaborator_id;
    const type = (e as { type: BasePayrollType }).type;
    const set = coveredByCollab.get(cid) ?? new Set<BasePayrollType>();
    set.add(type);
    coveredByCollab.set(cid, set);
  }
  return coveredByCollab;
}

async function loadVacationSalarySkip(
  companyId: string,
  month: number,
  year: number,
): Promise<Set<string>> {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const { data, error } = await supabase
    .from("vacation_requests")
    .select("collaborator_id, payroll_month, payroll_year")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .eq("payroll_month", prevMonth)
    .eq("payroll_year", prevYear);

  if (error) throw error;

  return getCollabsToSkipNextMonth(
    (data ?? []) as Array<{
      collaborator_id: string;
      payroll_month: number | null;
      payroll_year: number | null;
    }>,
    month,
    year,
  );
}

// Tipos de lançamento que MUDAM a base de encargos (INSS/FGTS/IRPF): proventos
// tributáveis (hora extra, gratificação, periculosidade, carro agregado,
// atestado) + falta. Criar/excluir um desses dispara o recálculo dirigido.
const BASE_AFFECTING_TYPES = new Set<string>([
  ...IRPF_TAXABLE_EARNING_TYPES,
  ...FALTA_BASE_DEBIT_TYPES,
]);

export function entryTypeAffectsTaxBase(type: string): boolean {
  return BASE_AFFECTING_TYPES.has(type);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recálculo DIRIGIDO de encargos de UM colaborador no mês.
//
// Reflete os proventos avulsos na base: INSS/FGTS = salário + (hora extra,
// periculosidade) − faltas; IRPF = salário + (esses + gratificação, carro
// agregado, atestado) − faltas. Usa computeCollaboratorTaxes (fonte única,
// mesma do "Recalcular" do período inteiro). Só período aberto (o chamador
// garante). Recibo de férias ('ferias-%') nunca é tocado nem somado.
// Exportado: o cadastro (CollaboratorModal) chama após editar o salário.
// ─────────────────────────────────────────────────────────────────────────────
export async function recalcCollaboratorTaxes(params: {
  companyId: string;
  collaboratorId: string;
  month: number;
  year: number;
}): Promise<void> {
  const { companyId, collaboratorId, month, year } = params;

  // Apaga os encargos atuais do colaborador no mês (auto-popular sem external_id
  // OU sync inss-base/irpf-base/fgts-base) + VT, pra recriar do zero. NÃO toca no
  // IRRF/INSS do recibo de férias ('ferias-%').
  const deleteTaxes = async () => {
    const { error: delTaxErr } = await supabase
      .from("payroll_entries")
      .delete()
      .eq("company_id", companyId)
      .eq("collaborator_id", collaboratorId)
      .eq("month", month)
      .eq("year", year)
      .in("type", ["inss", "irpf", "fgts"])
      .or("external_id.is.null,external_id.in.(inss-base,irpf-base,fgts-base)");
    if (delTaxErr) throw new Error("Falha ao limpar encargos: " + delTaxErr.message);
    const { error: delVtErr } = await supabase
      .from("payroll_entries")
      .delete()
      .eq("company_id", companyId)
      .eq("collaborator_id", collaboratorId)
      .eq("month", month)
      .eq("year", year)
      .eq("type", "desconto")
      .like("external_id", "vt-%");
    if (delVtErr) throw new Error("Falha ao limpar VT: " + delVtErr.message);
  };

  // Colaborador (salário/dependentes/loja).
  const { data: collab } = await supabase
    .from("collaborators")
    .select("id, store_id, dependents_count, current_salary, status, regime, position:positions(salary)")
    .eq("id", collaboratorId)
    .maybeSingle();
  if (!collab) return;

  const salary = resolvePayrollSalary(
    collab as { current_salary?: number | null; position?: { salary?: number } | null },
  );

  // Só CLT tem encargos (INSS/IRPF/FGTS). PJ/estagiário: remove os encargos (se
  // existirem) e sai, sem tocar em VT/avulsos.
  if ((collab as { regime?: string }).regime !== "clt") {
    const { error: delNonClt } = await supabase
      .from("payroll_entries")
      .delete()
      .eq("company_id", companyId)
      .eq("collaborator_id", collaboratorId)
      .eq("month", month)
      .eq("year", year)
      .in("type", ["inss", "irpf", "fgts"])
      .or("external_id.is.null,external_id.in.(inss-base,irpf-base,fgts-base)");
    if (delNonClt) throw new Error("Falha ao limpar encargos (não-CLT): " + delNonClt.message);
    return;
  }

  // Sem salário OU inativo → zera encargos (taxes + VT) e sai.
  if (!(salary > 0) || (collab as { status?: string }).status !== "ativo") {
    await deleteTaxes();
    return;
  }

  // Recibo de férias do mês anterior cobre este mês → sem salário/encargos.
  const skipSalaryNext = await loadVacationSalarySkip(companyId, month, year);
  if (skipSalaryNext.has(collaboratorId)) {
    await deleteTaxes();
    return;
  }

  // Soma proventos (INSS-tributáveis + IRPF-tributáveis) e faltas do mês,
  // excluindo recibo de férias. value é sempre > 0 (CHECK).
  const provRows = await fetchAllRows<{
    type: string;
    value: number;
    external_id: string | null;
  }>(() =>
    supabase
      .from("payroll_entries")
      .select("type, value, external_id")
      .eq("company_id", companyId)
      .eq("collaborator_id", collaboratorId)
      .eq("month", month)
      .eq("year", year)
      .in("type", [...IRPF_TAXABLE_EARNING_TYPES, ...FALTA_BASE_DEBIT_TYPES]),
  );
  const inssTaxSet = new Set<string>(INSS_TAXABLE_EARNING_TYPES);
  const irpfTaxSet = new Set<string>(IRPF_TAXABLE_EARNING_TYPES);
  const faltaSet = new Set<string>(FALTA_BASE_DEBIT_TYPES);
  let inssProventos = 0;
  let irpfProventos = 0;
  let faltaTotal = 0;
  for (const e of provRows ?? []) {
    if (typeof e.external_id === "string" && e.external_id.startsWith("ferias-")) continue;
    const v = Number(e.value) || 0;
    if (inssTaxSet.has(e.type)) inssProventos += v;
    if (irpfTaxSet.has(e.type)) irpfProventos += v;
    if (faltaSet.has(e.type)) faltaTotal += v;
  }

  const deps = (collab as { dependents_count?: number }).dependents_count ?? 0;
  const taxes = computeCollaboratorTaxes({
    salary,
    inssProventos,
    irpfProventos,
    faltaTotal,
    dependents: deps,
  });

  await deleteTaxes();

  const storeId = (collab as { store_id?: string | null }).store_id ?? null;
  const baseRow = {
    company_id: companyId,
    collaborator_id: collaboratorId,
    store_id: storeId,
    is_fixed: true,
    is_payable: true,
    month,
    year,
  };
  const rows: PayrollEntry[] = [];
  if (taxes.inss > 0) {
    rows.push({ ...baseRow, type: "inss" as const, description: "INSS (tabela 2026)", value: taxes.inss } as PayrollEntry);
  }
  if (taxes.fgts > 0) {
    rows.push({ ...baseRow, type: "fgts" as const, description: "FGTS (8%)", value: taxes.fgts } as PayrollEntry);
  }
  if (taxes.irpf > 0) {
    rows.push({
      ...baseRow,
      type: "irpf" as const,
      description: deps > 0 ? `IRPF (tabela 2026, ${deps} dep.)` : "IRPF (tabela 2026)",
      value: taxes.irpf,
    } as PayrollEntry);
  }

  // VT: 6% do salário base (não da base de encargos), se tiver benefício transporte.
  const { data: vtAssign } = await supabase
    .from("benefits_assignments")
    .select("collaborator_id, benefit:benefits!inner(category)")
    .eq("benefit.category", VT_BENEFIT_CATEGORY)
    .eq("collaborator_id", collaboratorId);
  if ((vtAssign ?? []).length > 0) {
    const vt = calcVtDiscount(salary);
    if (vt > 0) {
      rows.push({
        ...baseRow,
        external_id: vtDiscountExternalId(collaboratorId, year, month),
        type: "desconto" as const,
        description: VT_DISCOUNT_DESCRIPTION,
        value: vt,
      } as PayrollEntry);
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("payroll_entries").insert(rows);
    if (insErr) throw new Error("Falha ao recriar encargos: " + insErr.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista de períodos da empresa atual (dashboard mensal)
// ─────────────────────────────────────────────────────────────────────────────

export function usePayrollPeriods() {
  const { currentCompany } = useDashboard();
  const queryClient = useQueryClient();
  const companyId = currentCompany?.id;

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ["payroll-periods", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("payroll_periods")
        .select("*")
        .eq("company_id", companyId)
        .order("reference_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PayrollPeriodWithStats[];
    },
    enabled: !!companyId,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Abre novo período (decisão Q3 manual)
  // Decisão Q2 auto-popula: se auto_populate=true, busca collaborators ativos
  // e cria 1 entry de salario_base (do position) + entries de benefícios
  // assigned (do benefits_assignments).
  // ─────────────────────────────────────────────────────────────────────────
  const openPeriod = useMutation({
    mutationFn: async (values: OpenPeriodValues) => {
      if (!companyId) throw new Error("Empresa não encontrada");

      // 1. Verifica se já existe período pra esse mês
      const { data: existing } = await supabase
        .from("payroll_periods")
        .select("id")
        .eq("company_id", companyId)
        .eq("reference_month", values.reference_month)
        .maybeSingle();

      if (existing) {
        throw new Error(
          `Já existe um período pra ${formatPeriodLabel(values.reference_month)}.`
        );
      }

      // 2. Cria o período
      const { data: period, error: periodError } = await supabase
        .from("payroll_periods")
        .insert({
          company_id: companyId,
          reference_month: values.reference_month,
          status: "open",
          notes: values.notes || null,
        })
        .select()
        .single();

      if (periodError) throw periodError;
      if (!period) throw new Error("Falha ao criar período");

      // 3. Auto-popula salário base + benefícios (decisão Q2)
      if (values.auto_populate) {
        const { month, year } = periodToMonthYear(values.reference_month);

        // 3a. Salário base + encargos (IRPF/INSS/FGTS via tabela 2026)
        const { data: collaborators } = await supabase
          .from("collaborators")
          .select(
            "id, position_id, store_id, dependents_count, current_salary, regime, position:positions(salary)",
          )
          .eq("company_id", companyId)
          .eq("status", "ativo");

        // Decisão de produto: recibo de férias cai no mês do gozo, JUNTO
        // com o salário normal. Por isso NÃO proratamos salário aqui — o
        // recibo é tratado como adicional, não como substituição.
        // (Se quiser voltar pra CLT estrito, ver vacationDaysInMonth helper.)

        // Anti-duplicação: a sync (apply-financials) cria salário/INSS/IRPF/
        // FGTS com external_id 'salario-base'/'inss-base'/'irpf-base'/'fgts-base'
        // e month/year do mês corrente da sync. Se o auto-populate roda no
        // mesmo mês, geraria entries duplicadas (sem external_id). Antes de
        // inserir, montamos um Map<collab_id, Set<type>> do que JÁ existe
        // neste mês, e pulamos esses tipos por colab.
        const coveredByCollab = await loadBasePayrollCoverage(
          companyId,
          month,
          year,
        );

        // Regra de produto: recibo de férias (lançado no mês do gozo) cobre
        // também o salário do MÊS SEGUINTE. Lista colabs cujo RECIBO foi
        // lançado no mês anterior → pula salário+encargos deste mês.
        //
        // Filtra por payroll_month/year (mês do LANÇAMENTO do recibo) e não
        // por end_date — assim cobre o caso de "Adiantar Férias" também
        // (gozo em Set, adianta o recibo pra Ago → ao abrir folha de Set,
        // queremos pular o colab mesmo que end_date continue em Set).
        const skipSalaryNext = await loadVacationSalarySkip(
          companyId,
          month,
          year,
        );

        const autoEntries: PayrollEntry[] = [];
        // Quem ficou de fora não pode sumir em silêncio — vira payroll_alert.
        const skippedNoSalary: string[] = [];
        const skippedVacation: string[] = [];
        for (const c of collaborators ?? []) {
          const fullSalary = resolvePayrollSalary(
            c as { current_salary?: number | null; position?: { salary?: number } | null },
          );
          if (fullSalary <= 0) {
            skippedNoSalary.push(c.id);
            continue;
          }
          // Pula colab que teve gozo no mês anterior (recibo já cobriu)
          if (skipSalaryNext.has(c.id)) {
            skippedVacation.push(c.id);
            continue;
          }
          const deps = (c as { dependents_count?: number }).dependents_count ?? 0;
          const covered = coveredByCollab.get(c.id) ?? new Set<string>();
          // Só CLT tem encargos (INSS/IRPF/FGTS). PJ/estagiário: só salário base.
          const isClt = (c as { regime?: string }).regime === "clt";

          const salary = fullSalary;
          const taxes = calcAllTaxes({ grossSalary: salary, dependents: deps });
          const salaryDesc = "Salário base";

          if (!covered.has("salario_base")) {
            autoEntries.push({
              company_id: companyId,
              collaborator_id: c.id,
              store_id: c.store_id,
              type: "salario_base" as const,
              description: salaryDesc,
              value: salary,
              is_fixed: true,
              is_payable: true,
              month,
              year,
            } as PayrollEntry);
          }

          if (isClt && taxes.inss > 0 && !covered.has("inss")) {
            autoEntries.push({
              company_id: companyId,
              collaborator_id: c.id,
              store_id: c.store_id,
              type: "inss" as const,
              description: "INSS (tabela 2026)",
              value: taxes.inss,
              is_fixed: true,
              is_payable: true,
              month,
              year,
            } as PayrollEntry);
          }
          if (isClt && taxes.fgts > 0 && !covered.has("fgts")) {
            autoEntries.push({
              company_id: companyId,
              collaborator_id: c.id,
              store_id: c.store_id,
              type: "fgts" as const,
              description: "FGTS (8%)",
              value: taxes.fgts,
              is_fixed: true,
              is_payable: true,
              month,
              year,
            } as PayrollEntry);
          }
          if (isClt && taxes.irpf > 0 && !covered.has("irpf")) {
            autoEntries.push({
              company_id: companyId,
              collaborator_id: c.id,
              store_id: c.store_id,
              type: "irpf" as const,
              description:
                deps > 0
                  ? `IRPF (tabela 2026, ${deps} dep.)`
                  : "IRPF (tabela 2026)",
              value: taxes.irpf,
              is_fixed: true,
              is_payable: true,
              month,
              year,
            } as PayrollEntry);
          }
        }

        if (autoEntries.length > 0) {
          // Erro aqui era engolido em silêncio — colaborador sumia da folha
          // sem aviso nenhum. Agora aborta a abertura com mensagem clara.
          const { error: autoEntriesError } = await supabase
            .from("payroll_entries")
            .insert(autoEntries);
          if (autoEntriesError) {
            throw new Error(
              "Falha ao lançar salários/encargos: " + autoEntriesError.message,
            );
          }
        }

        // Alertas pros que ficaram de fora do auto-popular (visibilidade RH).
        const skippedAlerts = [
          ...skippedNoSalary.map((id) => ({
            company_id: companyId,
            period_id: period.id,
            collaborator_id: id,
            kind: "collaborator_no_entry" as const,
            severity: "warning" as const,
            message:
              "Sem salário no cadastro (nem na pessoa, nem no cargo) — salário base não foi lançado.",
          })),
          ...skippedVacation.map((id) => ({
            company_id: companyId,
            period_id: period.id,
            collaborator_id: id,
            kind: "collaborator_no_entry" as const,
            severity: "info" as const,
            message:
              "Recibo de férias lançado no mês anterior cobre este mês — salário base não lançado.",
          })),
        ];
        if (skippedAlerts.length > 0) {
          const { error: alertsError } = await supabase
            .from("payroll_alerts")
            .insert(skippedAlerts);
          if (alertsError) {
            console.error("Falha ao criar alertas de colab sem salário:", alertsError.message);
          }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3a-bis. Salário-família — pra cada CLT com salário ≤ limite, conta
        // filhos elegíveis (idade < 14 OU inválido) e cria entry tipo
        // salario_familia. Isento de INSS/IRPF/FGTS, não compõe base.
        //
        // Idempotência via external_id 'salario-familia-<collab_id>-<YYYY-MM>'.
        // Skip mês-seguinte respeitado (skipSalaryNext já filtrou colabs cujo
        // recibo de férias está cobrindo).
        // ─────────────────────────────────────────────────────────────────────
        const sfCandidates = (collaborators ?? []).filter((c) => {
          if (skipSalaryNext.has(c.id)) return false;
          // Salário-família é benefício do INSS: só CLT.
          if ((c as { regime?: string }).regime !== "clt") return false;
          const sal = resolvePayrollSalary(
            c as { current_salary?: number | null; position?: { salary?: number } | null },
          );
          // Filtro grosso pra evitar query desnecessária quando salário já é
          // acima do limite. Salário-família só pra baixa renda (~R$ 1.9k).
          return sal > 0 && sal <= SALARIO_FAMILIA_LIMITE_2026;
        });

        if (sfCandidates.length > 0) {
          const candidateIds = sfCandidates.map((c) => c.id);
          // Carrega dependentes desses colabs em 1 query (evita N+1)
          const { data: depsData } = await supabase
            .from("collaborator_dependents")
            .select("collaborator_id, birth_date, kinship, is_invalid")
            .in("collaborator_id", candidateIds);

          // Anti-dup: pega salário-família já lançados nesse mês
          const sfExternalIds = candidateIds.map(
            (id) => `salario-familia-${id}-${year}-${String(month).padStart(2, "0")}`,
          );
          const { data: existingSF } = await supabase
            .from("payroll_entries")
            .select("external_id")
            .eq("company_id", companyId)
            .eq("month", month)
            .eq("year", year)
            .in("external_id", sfExternalIds);
          const existingSFSet = new Set(
            (existingSF ?? []).map((e) => (e as { external_id: string }).external_id),
          );

          const depsByCollab = new Map<
            string,
            Array<{ birth_date: string | null; kinship: string | null; is_invalid: boolean | null }>
          >();
          for (const d of depsData ?? []) {
            const cid = (d as { collaborator_id: string }).collaborator_id;
            const arr = depsByCollab.get(cid) ?? [];
            arr.push(d as { birth_date: string | null; kinship: string | null; is_invalid: boolean | null });
            depsByCollab.set(cid, arr);
          }

          const sfEntries: PayrollEntry[] = [];
          const refDate = new Date(year, month - 1, 15); // meio do mês como referência
          for (const c of sfCandidates) {
            const fullSalary = resolvePayrollSalary(
              c as { current_salary?: number | null; position?: { salary?: number } | null },
            );
            const deps = depsByCollab.get(c.id) ?? [];
            const eligible = eligibleChildrenForSalarioFamilia(deps, refDate);
            const calc = calcSalarioFamilia({
              grossSalary: fullSalary,
              eligibleChildrenCount: eligible.length,
            });
            if (!calc.eligible || calc.value <= 0) continue;
            const externalId = `salario-familia-${c.id}-${year}-${String(month).padStart(2, "0")}`;
            if (existingSFSet.has(externalId)) continue;
            sfEntries.push({
              company_id: companyId,
              collaborator_id: c.id,
              store_id: c.store_id,
              external_id: externalId,
              type: "salario_familia" as const,
              description: `Salário-família (${eligible.length} filho${eligible.length === 1 ? "" : "s"})`,
              value: calc.value,
              is_fixed: true,
              is_payable: true,
              month,
              year,
            } as PayrollEntry);
          }

          if (sfEntries.length > 0) {
            const { error: sfError } = await supabase
              .from("payroll_entries")
              .insert(sfEntries);
            if (sfError) {
              throw new Error("Falha ao lançar salário-família: " + sfError.message);
            }
          }
        }

        // 3b. Benefícios assigned
        // Pega value_type/applicable_days pra calcular valor mensal correto
        // (daily × dias úteis − feriados da store do colaborador).
        // category é usada pra setar is_payable (Adicional entra na aba Pagamentos).
        const { data: assignments } = await supabase
          .from("benefits_assignments")
          .select(
            "collaborator_id, custom_value, benefit:benefits(name, value, value_type, applicable_days, category), collaborator:collaborators!inner(company_id, status, store_id, contracted_store_id)",
          )
          .eq("collaborator.company_id", companyId)
          .eq("collaborator.status", "ativo");

        // Carrega feriados do ano pra todas as stores envolvidas (1 query).
        const storeIds = Array.from(
          new Set(
            (assignments ?? [])
              .map((a) => {
                const c = a.collaborator as
                  | { store_id: string | null; contracted_store_id: string | null }
                  | null;
                return c?.store_id || c?.contracted_store_id || null;
              })
              .filter((id): id is string => !!id),
          ),
        );

        const holidaysByStore = new Map<string, string[]>();
        if (storeIds.length > 0) {
          const { data: hols } = await supabase
            .from("store_holidays")
            .select("store_id, date")
            .in("store_id", storeIds)
            .gte("date", `${year}-01-01`)
            .lte("date", `${year}-12-31`);
          for (const h of (hols ?? []) as Array<{ store_id: string; date: string }>) {
            const arr = holidaysByStore.get(h.store_id) ?? [];
            arr.push(h.date);
            holidaysByStore.set(h.store_id, arr);
          }
        }

        const benefitEntries =
          (assignments ?? [])
            .map((a) => {
              const benefit = a.benefit as
                | {
                    name: string;
                    value: number;
                    value_type: "monthly" | "daily" | null;
                    applicable_days: string[] | null;
                    category: string | null;
                  }
                | null;
              if (!benefit || benefit.value <= 0) return null;

              const collab = a.collaborator as
                | { store_id: string | null; contracted_store_id: string | null }
                | null;
              const benefitStoreId =
                collab?.store_id || collab?.contracted_store_id || null;
              const holidays = benefitStoreId
                ? holidaysByStore.get(benefitStoreId) ?? []
                : [];

              const valueType = (benefit.value_type ?? "monthly") as "monthly" | "daily";
              const customValue = (a as { custom_value?: number | null }).custom_value;
              const baseValue =
                valueType === "monthly" && customValue != null
                  ? Number(customValue)
                  : benefit.value;
              const monthlyValue = calculateMonthlyBenefitValue(
                baseValue,
                valueType,
                (benefit.applicable_days ?? [
                  "mon",
                  "tue",
                  "wed",
                  "thu",
                  "fri",
                ]) as DayAbbrev[],
                month,
                year,
                holidays,
              );

              if (monthlyValue <= 0) return null;

              return {
                company_id: companyId,
                collaborator_id: a.collaborator_id,
                store_id: null,
                type: "beneficio" as const,
                description: benefit.name,
                value: monthlyValue,
                is_fixed: true,
                is_payable: benefit.category === "adicional",
                month,
                year,
              };
            })
            .filter(Boolean) as PayrollEntry[];

        if (benefitEntries.length > 0) {
          const { error: benefitEntriesError } = await supabase
            .from("payroll_entries")
            .insert(benefitEntries);
          if (benefitEntriesError) {
            throw new Error(
              "Falha ao lançar benefícios: " + benefitEntriesError.message,
            );
          }
        }

        // 3c. Desconto Vale Transporte (6% do salário base) pra quem tem
        // benefício de categoria 'transport'.
        const vtTransportIds = new Set(
          (assignments ?? [])
            .filter((a) =>
              isTransportCategory(
                (a.benefit as { category: string | null } | null)?.category,
              ),
            )
            .map((a) => a.collaborator_id),
        );
        await insertVtDiscounts({
          companyId,
          month,
          year,
          transportCollabIds: vtTransportIds,
          salaryByCollab: new Map(
            (collaborators ?? []).map((c) => [
              c.id,
              resolvePayrollSalary(
                c as {
                  current_salary?: number | null;
                  position?: { salary?: number } | null;
                },
              ),
            ]),
          ),
          storeByCollab: new Map(
            (collaborators ?? []).map((c) => [c.id, c.store_id]),
          ),
          skip: skipSalaryNext,
        });

        // 3d. Ficha fixa (Carro Agregado, descontos fixos, etc.) — materializa
        // os itens permanentes do cadastro neste mês. Consolida duplicatas
        // legadas e reflete edições/remoções feitas no cadastro.
        await materializeFixedEntries({
          companyId,
          month,
          year,
          activeCollabIds: new Set((collaborators ?? []).map((c) => c.id)),
          storeByCollab: new Map(
            (collaborators ?? []).map((c) => [c.id, c.store_id]),
          ),
        });
      }

      const { month: openMonth, year: openYear } = periodToMonthYear(
        values.reference_month,
      );

      // ─────────────────────────────────────────────────────────────────────
      // Carry-over legado REMOVIDO. A recorrência de lançamentos manuais
      // (Carro Agregado, gratificação/bonificação/desconto fixos) agora é
      // governada pela ficha fixa do cadastro (collaborator_fixed_entries),
      // materializada acima por materializeFixedEntries. Manter o carry-over
      // duplicaria/conflitaria com a ficha. Ver migration 20260618120000.
      // ─────────────────────────────────────────────────────────────────────
      const recurringCopied = 0;

      const vacations = await postScheduledVacations(companyId, openMonth, openYear);

      return { period: period as PayrollPeriod, vacationsPosted: vacations.posted, vacationsFailed: vacations.failed, recurringCopied };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      if (result.vacationsFailed > 0) {
        toast.warning(`${result.vacationsFailed} solicitação(ões) de férias não pôde(ram) ser lançada(s). Confira os dados e repopule a folha para tentar novamente.`);
      }
      const parts: string[] = ["Período aberto ✓"];
      if (result.recurringCopied > 0) {
        parts.push(
          `${result.recurringCopied} lançamento${result.recurringCopied === 1 ? "" : "s"} recorrente${result.recurringCopied === 1 ? "" : "s"} copiado${result.recurringCopied === 1 ? "" : "s"} do mês anterior`,
        );
      }
      if (result.vacationsPosted > 0) {
        parts.push(
          `${result.vacationsPosted} férias pendente${result.vacationsPosted === 1 ? "" : "s"} lançada${result.vacationsPosted === 1 ? "" : "s"}`,
        );
      }
      toast.success(parts.join(" · "));
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou. Tenta de novo?");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Deleta período e todos os seus lançamentos
  // ─────────────────────────────────────────────────────────────────────────
  const deletePeriod = useMutation({
    mutationFn: async ({
      periodId,
      reference_month,
    }: {
      periodId: string;
      reference_month: string;
    }) => {
      if (!companyId) throw new Error("Empresa não encontrada");
      const { month, year } = periodToMonthYear(reference_month);

      // 1. Reset vacation_requests do mês — apagar as payroll_entries faz
      //    com que os payroll_entry_ids guardados na request fiquem órfãos.
      //    Marcamos posted_to_payroll=false pra que, ao reabrir o período,
      //    o trigger de pending re-lance os 4-6 lançamentos automaticamente.
      await supabase
        .from("vacation_requests")
        .update({ posted_to_payroll: false, payroll_entry_ids: null })
        .eq("company_id", companyId)
        .eq("payroll_month", month)
        .eq("payroll_year", year)
        .eq("status", "approved");

      // 2. Remove entries do período — SELETIVO.
      //    Preserva entries criadas pela sync (têm external_id da agenda:
      //    salario-base, inss-base, fgts-base, irpf-base, plano-saude-*,
      //    e os ids numéricos dos adicionais sincronizados). Re-abrir a
      //    folha não perde grat/boni/desconto que vieram da agenda.
      //
      //    Apaga:
      //      - entries sem external_id (auto-populate, carry-over, manuais)
      //      - entries com prefixo 'ferias-' (do recibo de férias) —
      //        precisam ser re-postadas pelo openPeriod via vacation flag.
      await supabase
        .from("payroll_entries")
        .delete()
        .eq("company_id", companyId)
        .eq("month", month)
        .eq("year", year)
        .or("external_id.is.null,external_id.like.ferias-%");

      // 3. Remove o período
      const { error } = await supabase
        .from("payroll_periods")
        .delete()
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      toast.success("Período removido ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Repopula apenas o que ainda não foi lançado (colaboradores/benefícios novos)
  // ─────────────────────────────────────────────────────────────────────────
  const repopulatePeriod = useMutation({
    mutationFn: async ({
      reference_month,
    }: {
      reference_month: string;
    }) => {
      if (!companyId) throw new Error("Empresa não encontrada");
      const { month, year } = periodToMonthYear(reference_month);

      const { data: editablePeriod, error: periodError } = await supabase
        .from("payroll_periods")
        .select("status")
        .eq("company_id", companyId)
        .eq("reference_month", reference_month)
        .maybeSingle();
      if (periodError) throw periodError;
      if (!editablePeriod) throw new Error("Folha não encontrada");
      if (!isPeriodEditable(editablePeriod.status)) throw new Error(periodLockedMessage(editablePeriod.status));

      // Entries fixas já existentes → para deduplicar (paginado: passa de 1000)
      const existingEntries = await fetchAllRows<{
        collaborator_id: string;
        type: string;
        description: string | null;
        external_id: string | null;
      }>(() =>
        supabase
          .from("payroll_entries")
          .select("collaborator_id, type, description, external_id")
          .eq("company_id", companyId)
          .eq("month", month)
          .eq("year", year)
          .in("type", ["salario_base", "beneficio", "inss", "irpf", "fgts"]),
      );

      const existingSalaries = new Set(
        (existingEntries ?? [])
          .filter((e) => e.type === "salario_base")
          .map((e) => e.collaborator_id),
      );
      // Normaliza removendo sufixo " (auto)" pra casar tanto entries antigas
      // quanto novas (depois da remoção do sufixo).
      const stripAuto = (desc: string | null) =>
        (desc ?? "").replace(/\s*\(auto\)$/, "");
      const existingBenefits = new Set(
        (existingEntries ?? [])
          .filter((e) => e.type === "beneficio")
          .map((e) => `${e.collaborator_id}::${stripAuto(e.description)}`),
      );
      const existingTaxes = new Set(
        (existingEntries ?? [])
          .filter((e) => !e.external_id?.startsWith("ferias-"))
          .filter((e) => e.type === "inss" || e.type === "fgts" || e.type === "irpf")
          .map((e) => `${e.collaborator_id}::${e.type}`),
      );

      // Salários + encargos pra colaboradores que ainda não foram populados
      const { data: collaborators, error: collaboratorsError } = await supabase
        .from("collaborators")
        .select(
          "id, store_id, dependents_count, current_salary, regime, position:positions(salary)",
        )
        .eq("company_id", companyId)
        .eq("status", "ativo");

      if (collaboratorsError) throw collaboratorsError;

      // Proventos TRIBUTÁVEIS do mês (gratificação etc.) por colaborador — entram
      // na base do IRPF (junto com o salário). INSS/FGTS ficam só no salário.
      // Ferias (recibo próprio) ficam de fora. (Obs.: o "Recalcular encargos" é o
      // recálculo autoritativo — roda depois de TODOS os proventos populados.)
      const { data: taxableProvsRep } = await supabase
        .from("payroll_entries")
        .select("collaborator_id, value, external_id")
        .eq("company_id", companyId)
        .eq("month", month)
        .eq("year", year)
        .in("type", [...IRPF_TAXABLE_EARNING_TYPES]);
      const irpfExtraByCollab = new Map<string, number>();
      for (const e of taxableProvsRep ?? []) {
        if (typeof e.external_id === "string" && e.external_id.startsWith("ferias-")) continue;
        irpfExtraByCollab.set(
          e.collaborator_id,
          (irpfExtraByCollab.get(e.collaborator_id) ?? 0) + Number(e.value),
        );
      }

      const skipSalaryNext = await loadVacationSalarySkip(
        companyId,
        month,
        year,
      );

      const newAutoEntries: PayrollEntry[] = [];
      const skippedNoSalary: string[] = [];
      const skippedVacation: string[] = [];
      for (const c of collaborators ?? []) {
        const salary = resolvePayrollSalary(
          c as { current_salary?: number | null; position?: { salary?: number } | null },
        );
        if (salary <= 0) {
          skippedNoSalary.push(c.id);
          continue;
        }
        if (skipSalaryNext.has(c.id)) {
          skippedVacation.push(c.id);
          continue;
        }
        // Só CLT tem encargos (INSS/IRPF/FGTS). PJ/estagiário: só salário base.
        const isClt = (c as { regime?: string }).regime === "clt";
        const deps = (c as { dependents_count?: number }).dependents_count ?? 0;
        // INSS/FGTS só no salário base; IRPF sobre salário + proventos
        // tributáveis do mês (gratificação etc.), menos INSS e dependentes.
        const inss = calcINSS(salary);
        const fgts = calcFGTS(salary);
        const irpfGross = salary + (irpfExtraByCollab.get(c.id) ?? 0);
        const irpf = calcIRPF({ grossSalary: irpfGross, inss, dependents: deps });
        const taxes = { inss, irpf, fgts };
        const baseEntry = {
          company_id: companyId,
          collaborator_id: c.id,
          store_id: c.store_id,
          is_fixed: true,
          is_payable: true,
          month,
          year,
        };
        if (!existingSalaries.has(c.id)) {
          newAutoEntries.push({
            ...baseEntry,
            type: "salario_base" as const,
            description: "Salário base",
            value: salary,
          } as PayrollEntry);
        }
        if (isClt && taxes.inss > 0 && !existingTaxes.has(`${c.id}::inss`)) {
          newAutoEntries.push({
            ...baseEntry,
            type: "inss" as const,
            description: "INSS (tabela 2026)",
            value: taxes.inss,
          } as PayrollEntry);
        }
        if (isClt && taxes.fgts > 0 && !existingTaxes.has(`${c.id}::fgts`)) {
          newAutoEntries.push({
            ...baseEntry,
            type: "fgts" as const,
            description: "FGTS (8%)",
            value: taxes.fgts,
          } as PayrollEntry);
        }
        if (isClt && taxes.irpf > 0 && !existingTaxes.has(`${c.id}::irpf`)) {
          newAutoEntries.push({
            ...baseEntry,
            type: "irpf" as const,
            description:
              deps > 0
                ? `IRPF (tabela 2026, ${deps} dep.)`
                : "IRPF (tabela 2026)",
            value: taxes.irpf,
          } as PayrollEntry);
        }
      }

      if (newAutoEntries.length > 0) {
        const { error: newAutoEntriesError } = await supabase
          .from("payroll_entries")
          .insert(newAutoEntries);
        if (newAutoEntriesError) {
          throw new Error(
            "Falha ao lançar salários/encargos: " + newAutoEntriesError.message,
          );
        }
      }
      // Manter compat com o retorno (nome legado)
      const newSalaryEntries = newAutoEntries.filter(
        (e) => e.type === "salario_base",
      );

      // Atualiza alertas de "colaborador sem lançamento": apaga os não
      // resolvidos e recria conforme o estado atual da repopulação.
      const { data: periodRow } = await supabase
        .from("payroll_periods")
        .select("id")
        .eq("company_id", companyId)
        .eq("reference_month", reference_month)
        .maybeSingle();
      if (periodRow) {
        await supabase
          .from("payroll_alerts")
          .delete()
          .eq("period_id", periodRow.id)
          .eq("kind", "collaborator_no_entry")
          .is("resolved_at", null);
        const skippedAlerts = [
          ...skippedNoSalary.map((id) => ({
            company_id: companyId,
            period_id: periodRow.id,
            collaborator_id: id,
            kind: "collaborator_no_entry" as const,
            severity: "warning" as const,
            message:
              "Sem salário no cadastro (nem na pessoa, nem no cargo) — salário base não foi lançado.",
          })),
          ...skippedVacation.map((id) => ({
            company_id: companyId,
            period_id: periodRow.id,
            collaborator_id: id,
            kind: "collaborator_no_entry" as const,
            severity: "info" as const,
            message:
              "Recibo de férias lançado no mês anterior cobre este mês — salário base não lançado.",
          })),
        ];
        if (skippedAlerts.length > 0) {
          const { error: alertsError } = await supabase
            .from("payroll_alerts")
            .insert(skippedAlerts);
          if (alertsError) {
            console.error("Falha ao criar alertas de colab sem salário:", alertsError.message);
          }
        }
      }

      // Benefícios
      const { data: assignments } = await supabase
        .from("benefits_assignments")
        .select(
          "collaborator_id, benefit:benefits(name, value, value_type, applicable_days, category), collaborator:collaborators!inner(company_id, status, store_id, contracted_store_id)",
        )
        .eq("collaborator.company_id", companyId)
        .eq("collaborator.status", "ativo");

      const storeIds = Array.from(
        new Set(
          (assignments ?? [])
            .map((a) => {
              const c = a.collaborator as
                | { store_id: string | null; contracted_store_id: string | null }
                | null;
              return c?.store_id || c?.contracted_store_id || null;
            })
            .filter((id): id is string => !!id),
        ),
      );

      const holidaysByStore = new Map<string, string[]>();
      if (storeIds.length > 0) {
        const { data: hols } = await supabase
          .from("store_holidays")
          .select("store_id, date")
          .in("store_id", storeIds)
          .gte("date", `${year}-01-01`)
          .lte("date", `${year}-12-31`);
        for (const h of (hols ?? []) as Array<{ store_id: string; date: string }>) {
          const arr = holidaysByStore.get(h.store_id) ?? [];
          arr.push(h.date);
          holidaysByStore.set(h.store_id, arr);
        }
      }

      const newBenefitEntries = (assignments ?? [])
        .map((a) => {
          const benefit = a.benefit as
            | {
                name: string;
                value: number;
                value_type: "monthly" | "daily" | null;
                applicable_days: string[] | null;
                category: string | null;
              }
            | null;
          if (!benefit || benefit.value <= 0) return null;

          const desc = benefit.name;
          if (existingBenefits.has(`${a.collaborator_id}::${desc}`)) return null;

          const collab = a.collaborator as
            | { store_id: string | null; contracted_store_id: string | null }
            | null;
          const benefitStoreId = collab?.store_id || collab?.contracted_store_id || null;
          const holidays = benefitStoreId ? (holidaysByStore.get(benefitStoreId) ?? []) : [];

          const monthlyValue = calculateMonthlyBenefitValue(
            benefit.value,
            (benefit.value_type ?? "monthly") as "monthly" | "daily",
            (benefit.applicable_days ?? ["mon", "tue", "wed", "thu", "fri"]) as DayAbbrev[],
            month,
            year,
            holidays,
          );
          if (monthlyValue <= 0) return null;

          return {
            company_id: companyId,
            collaborator_id: a.collaborator_id,
            store_id: null,
            type: "beneficio" as const,
            description: desc,
            value: monthlyValue,
            is_fixed: true,
            is_payable: benefit.category === "adicional",
            month,
            year,
          };
        })
        .filter(Boolean) as PayrollEntry[];

      if (newBenefitEntries.length > 0) {
        const { error: newBenefitEntriesError } = await supabase
          .from("payroll_entries")
          .insert(newBenefitEntries);
        if (newBenefitEntriesError) {
          throw new Error(
            "Falha ao lançar benefícios: " + newBenefitEntriesError.message,
          );
        }
      }

      // Desconto VT (6% do salário base) pros que ainda não têm — só adiciona
      // o que falta (insertVtDiscounts deduplica por external_id).
      const vtTransportIds = new Set(
        (assignments ?? [])
          .filter((a) =>
            isTransportCategory(
              (a.benefit as { category: string | null } | null)?.category,
            ),
          )
          .map((a) => a.collaborator_id),
      );
      const vtAdded = await insertVtDiscounts({
        companyId,
        month,
        year,
        transportCollabIds: vtTransportIds,
        salaryByCollab: new Map(
          (collaborators ?? []).map((c) => [
            c.id,
            resolvePayrollSalary(
              c as {
                current_salary?: number | null;
                position?: { salary?: number } | null;
              },
            ),
          ]),
        ),
        storeByCollab: new Map(
          (collaborators ?? []).map((c) => [c.id, c.store_id]),
        ),
        skip: skipSalaryNext,
      });

      // Ficha fixa: materializa/atualiza itens permanentes do cadastro neste
      // mês (consolida duplicatas legadas, reflete edições e remoções).
      const fixedCount = await materializeFixedEntries({
        companyId,
        month,
        year,
        activeCollabIds: new Set((collaborators ?? []).map((c) => c.id)),
        storeByCollab: new Map(
          (collaborators ?? []).map((c) => [c.id, c.store_id]),
        ),
      });

      const vacations = await postScheduledVacations(companyId, month, year);
      return {
        vacationsPosted: vacations.posted,
        vacationsFailed: vacations.failed,
        salariesAdded: newSalaryEntries.length,
        benefitsAdded: newBenefitEntries.length,
        vtAdded,
        fixedCount,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-requests-approved"] });
      if (result.vacationsFailed > 0) {
        toast.warning(`${result.vacationsFailed} solicitação(ões) de férias não pôde(ram) ser lançada(s). Confira os dados e tente repopular novamente.`);
      }
      if (result.vacationsPosted > 0) {
        toast.success(`${result.vacationsPosted} solicitação(ões) de férias incluída(s) nesta folha.`);
      }
      const total = result.salariesAdded + result.benefitsAdded + result.vtAdded;
      if (total === 0 && result.vacationsPosted === 0 && result.vacationsFailed === 0) {
        toast.success("Tudo já populado — nenhum lançamento novo necessário.");
      } else if (total > 0) {
        toast.success(`${total} lançamento(s) adicionado(s) ✓`);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou. Tenta de novo?");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Recalcula INSS/IRPF/FGTS de um período, preservando/recuperando salario_base.
  // Apaga os encargos atuais e reinjeta via computeCollaboratorTaxes (base =
  // salário + proventos que integram INSS/IRPF − faltas).
  // Útil pra periodos antigos com valores obsoletos.
  // ─────────────────────────────────────────────────────────────────────────
  const recalculateTaxes = useMutation({
    mutationFn: async ({ reference_month }: { reference_month: string }) => {
      if (!companyId) throw new Error("Empresa não encontrada");
      const { month, year } = periodToMonthYear(reference_month);

      const existingBaseCoverage = await loadBasePayrollCoverage(
        companyId,
        month,
        year,
      );
      const skipSalaryNext = await loadVacationSalarySkip(
        companyId,
        month,
        year,
      );

      // 1. Apaga encargos de SALÁRIO do período: os criados pelo auto-populate
      //    (sem external_id) e os da sync (inss-base/irpf-base/fgts-base).
      //    NÃO toca nos INSS/IRRF do recibo de férias (external_id 'ferias-%'),
      //    que têm os mesmos types mas pertencem ao recibo, não ao salário.
      const { error: deleteTaxesError } = await supabase
        .from("payroll_entries")
        .delete()
        .eq("company_id", companyId)
        .eq("month", month)
        .eq("year", year)
        .in("type", ["inss", "irpf", "fgts"])
        .or("external_id.is.null,external_id.in.(inss-base,irpf-base,fgts-base)");

      if (deleteTaxesError) throw deleteTaxesError;

      // 1b. Apaga descontos VT do período (derivados do salário, recriados
      //     abaixo). Escopo estrito pelo prefixo 'vt-' pra NÃO tocar descontos
      //     manuais (plano de saúde, adiantamento, etc.).
      const { error: deleteVtError } = await supabase
        .from("payroll_entries")
        .delete()
        .eq("company_id", companyId)
        .eq("month", month)
        .eq("year", year)
        .eq("type", "desconto")
        .like("external_id", "vt-%");
      if (deleteVtError) throw deleteVtError;

      // 2. Pega salários ativos com dependentes
      const { data: collaborators, error: collaboratorsError } = await supabase
        .from("collaborators")
        .select(
          "id, store_id, dependents_count, current_salary, regime, position:positions(salary)",
        )
        .eq("company_id", companyId)
        .eq("status", "ativo");

      if (collaboratorsError) throw collaboratorsError;

      // 2b. Proventos TRIBUTÁVEIS do mês (gratificação, hora extra, etc.) por
      //     colaborador — entram na base do IRPF (junto com o salário). INSS/FGTS
      //     ficam só no salário. Exclui proventos do recibo de férias (IRRF próprio).
      const { data: taxableProvs } = await supabase
        .from("payroll_entries")
        .select("collaborator_id, type, value, external_id")
        .eq("company_id", companyId)
        .eq("month", month)
        .eq("year", year)
        .in("type", [...IRPF_TAXABLE_EARNING_TYPES, ...FALTA_BASE_DEBIT_TYPES]);
      // Buckets por colaborador: proventos que integram INSS, proventos que
      // integram IRPF (superset) e faltas (reduzem as duas bases). Recibo de
      // férias ('ferias-%') fica de fora. value é sempre > 0 (CHECK).
      const inssTaxSet = new Set<string>(INSS_TAXABLE_EARNING_TYPES);
      const irpfTaxSet = new Set<string>(IRPF_TAXABLE_EARNING_TYPES);
      const faltaSet = new Set<string>(FALTA_BASE_DEBIT_TYPES);
      const irpfExtraByCollab = new Map<string, number>();
      const inssExtraByCollab = new Map<string, number>();
      const faltaByCollab = new Map<string, number>();
      for (const e of taxableProvs ?? []) {
        if (typeof e.external_id === "string" && e.external_id.startsWith("ferias-")) continue;
        const v = Number(e.value) || 0;
        const cid = e.collaborator_id;
        const t = (e as { type: string }).type;
        if (inssTaxSet.has(t)) inssExtraByCollab.set(cid, (inssExtraByCollab.get(cid) ?? 0) + v);
        if (irpfTaxSet.has(t)) irpfExtraByCollab.set(cid, (irpfExtraByCollab.get(cid) ?? 0) + v);
        if (faltaSet.has(t)) faltaByCollab.set(cid, (faltaByCollab.get(cid) ?? 0) + v);
      }

      // Quem tem benefício de Vale Transporte (categoria 'transport') → recria
      // o desconto de 6% do salário base junto com os encargos.
      const { data: vtAssignments } = await supabase
        .from("benefits_assignments")
        .select(
          "collaborator_id, benefit:benefits!inner(category), collaborator:collaborators!inner(company_id, status)",
        )
        .eq("benefit.category", VT_BENEFIT_CATEGORY)
        .eq("collaborator.company_id", companyId)
        .eq("collaborator.status", "ativo");
      const vtTransportIds = new Set(
        (vtAssignments ?? []).map((a) => a.collaborator_id),
      );

      // 3. Reinjeta salario_base faltante + encargos usando calcAllTaxes
      const newBaseEntries: PayrollEntry[] = [];
      for (const c of collaborators ?? []) {
        const salary = resolvePayrollSalary(
          c as { current_salary?: number | null; position?: { salary?: number } | null },
        );
        if (salary <= 0) continue;
        if (skipSalaryNext.has(c.id)) continue;
        // Só CLT tem encargos. PJ/estagiário: salário base e VT ficam, sem encargos.
        const isClt = (c as { regime?: string }).regime === "clt";
        const deps = (c as { dependents_count?: number }).dependents_count ?? 0;
        // INSS/FGTS sobre salário + proventos que integram (hora extra,
        // periculosidade) − faltas; IRPF sobre salário + proventos tributáveis
        // (+ gratificação, carro agregado, atestado) − faltas, menos INSS e deps.
        const taxes = computeCollaboratorTaxes({
          salary,
          inssProventos: inssExtraByCollab.get(c.id) ?? 0,
          irpfProventos: irpfExtraByCollab.get(c.id) ?? 0,
          faltaTotal: faltaByCollab.get(c.id) ?? 0,
          dependents: deps,
        });
        const covered = existingBaseCoverage.get(c.id) ?? new Set<BasePayrollType>();
        const base = {
          company_id: companyId,
          collaborator_id: c.id,
          store_id: c.store_id,
          is_fixed: true,
          is_payable: true,
          month,
          year,
        };
        if (!covered.has("salario_base")) {
          newBaseEntries.push({
            ...base,
            type: "salario_base" as const,
            description: "Salário base",
            value: salary,
          } as PayrollEntry);
        }
        if (isClt && taxes.inss > 0) {
          newBaseEntries.push({
            ...base,
            type: "inss" as const,
            description: "INSS (tabela 2026)",
            value: taxes.inss,
          } as PayrollEntry);
        }
        if (isClt && taxes.fgts > 0) {
          newBaseEntries.push({
            ...base,
            type: "fgts" as const,
            description: "FGTS (8%)",
            value: taxes.fgts,
          } as PayrollEntry);
        }
        if (isClt && taxes.irpf > 0) {
          newBaseEntries.push({
            ...base,
            type: "irpf" as const,
            description:
              deps > 0
                ? `IRPF (tabela 2026, ${deps} dep.)`
                : "IRPF (tabela 2026)",
            value: taxes.irpf,
          } as PayrollEntry);
        }
        if (vtTransportIds.has(c.id)) {
          const vt = calcVtDiscount(salary);
          if (vt > 0) {
            newBaseEntries.push({
              ...base,
              external_id: vtDiscountExternalId(c.id, year, month),
              type: "desconto" as const,
              description: VT_DISCOUNT_DESCRIPTION,
              value: vt,
            } as PayrollEntry);
          }
        }
      }

      if (newBaseEntries.length > 0) {
        const { error: insertBaseError } = await supabase
          .from("payroll_entries")
          .insert(newBaseEntries);
        if (insertBaseError) throw insertBaseError;
      }

      // Auditoria: as linhas de INSS/IRPF/FGTS/VT NÃO são logadas (audit_log_trigger
      // pula encargos derivados, pra não poluir). Registra 1 entrada-resumo do
      // recálculo ("fulano recalculou a folha de tal competência").
      try {
        await supabase.rpc("log_payroll_recalc", {
          p_company_id: companyId,
          p_reference_month: reference_month,
          p_scope: "periodo",
        });
      } catch (e) {
        console.error("Falha ao registrar auditoria do recálculo:", e);
      }

      return { count: newBaseEntries.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      const label =
        result.count === 1 ? "lançamento ajustado" : "lançamentos ajustados";
      toast.success(`${result.count} ${label} na folha ✓`);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou. Tenta de novo?");
    },
  });

  return { periods, isLoading, openPeriod, deletePeriod, repopulatePeriod, recalculateTaxes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single period + entries do mês
// ─────────────────────────────────────────────────────────────────────────────

export function usePayrollPeriod(id: string | undefined) {
  return useQuery({
    queryKey: ["payroll-period", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("payroll_periods")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as PayrollPeriod;
    },
    enabled: !!id,
  });
}

export function usePayrollEntries(periodId: string | undefined) {
  const { currentCompany } = useDashboard();
  const queryClient = useQueryClient();
  const companyId = currentCompany?.id;

  // Buscar entries pelo período: como payroll_entries não tem period_id,
  // a query é por (company_id, month, year) lidos do período.
  const { data: period } = usePayrollPeriod(periodId);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["payroll-entries", periodId],
    queryFn: async () => {
      if (!periodId || !companyId || !period) return [];
      const { month, year } = periodToMonthYear(period.reference_month);
      // Pagina pra não perder lançamentos além do limite de 1000 do PostgREST.
      const data = await fetchAllRows<PayrollEntryWithCollaborator>(
        () =>
          supabase
            .from("payroll_entries")
            .select(
              "*, collaborator:collaborators(id, name, cpf, regime, status, pix_key, softcom_surname, store_id, team_id)"
            )
            .eq("company_id", companyId)
            .eq("month", month)
            .eq("year", year)
            .order("created_at", { ascending: false }),
      );
      return data;
    },
    enabled: !!periodId && !!companyId && !!period,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cria lançamento manual (HE, falta, atestado, etc.)
  // ─────────────────────────────────────────────────────────────────────────
  const createEntry = useMutation({
    mutationFn: async (values: NewEntryValues) => {
      if (!period || !companyId) throw new Error("Período não encontrado");
      const { month, year } = periodToMonthYear(period.reference_month);

      if (!isPeriodEditable(period.status)) {
        throw new Error(periodLockedMessage(period.status));
      }

      // Decisão de produto: lançamento FIXO de gratificação/bonificação é
      // recorrente e precisa virar adicional na agenda (pra que apareça em
      // outras folhas e fique consistente com o sistema legado). Lançamento
      // pontual (is_fixed=false) fica só no DNA Softcom.
      // Com a agenda desligada (AGENDA_SYNC_DISABLED), NÃO espelha o adicional:
      // grava só o payroll_entries local. Sem isso, o push offline quebraria o
      // insert local (o payload vai em formato remoto e a row local falha).
      const shouldPushAsAdicional =
        !AGENDA_SYNC_DISABLED &&
        values.is_fixed === true &&
        (values.type === "gratificacao" || values.type === "bonificacao");

      let externalId: string | null = null;
      if (shouldPushAsAdicional) {
        // Mapeamento type → tipo da agenda
        const tipoAgenda =
          values.type === "gratificacao"
            ? "GRATIFICAÇÃO ESPONTANEA"
            : "CUSTO SETOR";

        const { data: pushData, error: pushError } = await supabase.functions.invoke(
          "collaborator-subresource",
          {
            body: {
              action: "create",
              kind: "adicionais",
              collaboratorId: values.collaborator_id,
              data: {
                tipo: tipoAgenda,
                descricao: values.description || tipoAgenda,
                valores: values.value,
              },
            },
          },
        );
        if (pushError) {
          throw new Error(
            "Falha ao criar adicional na agenda: " + pushError.message,
          );
        }
        if (pushData && typeof pushData === "object" && "error" in pushData) {
          const err = pushData as { error: string; details?: string };
          throw new Error(
            err.details ? `${err.error}: ${err.details}` : err.error,
          );
        }
        // edge function já gravou em payroll_entries via apply-financials NEXT
        // sync. MAS pra que o lançamento apareça JÁ neste período aberto,
        // gravamos local também com external_id do adicional retornado, pra
        // evitar duplicação se a sync rodar depois.
        const remote = (pushData as { remote?: { id?: number | string } } | null)?.remote;
        if (remote && remote.id != null) {
          externalId = String(remote.id);
        }
      }

      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("payroll_entries").insert({
        company_id: companyId,
        collaborator_id: values.collaborator_id,
        type: values.type,
        description: values.description || null,
        value: values.value,
        is_fixed: values.is_fixed,
        external_id: externalId,
        month,
        year,
        created_by: userData?.user?.id ?? null,
      });
      if (error) throw error;

      // Recalcula encargos do colaborador se o lançamento muda a base de cálculo
      // (hora extra, gratificação, periculosidade, falta). Best-effort: não
      // derruba a criação do lançamento se o recálculo falhar — só avisa.
      let recalcWarning = false;
      if (entryTypeAffectsTaxBase(values.type)) {
        try {
          await recalcCollaboratorTaxes({
            companyId,
            collaboratorId: values.collaborator_id,
            month,
            year,
          });
        } catch (e) {
          recalcWarning = true;
          console.error("Falha ao recalcular encargos após lançamento:", e);
        }
      }

      return { pushedToAgenda: shouldPushAsAdicional, recalcWarning };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      const suffix = result?.pushedToAgenda
        ? " ✓ (sincronizado com a agenda como adicional)"
        : " ✓";
      toast.success("Lançamento criado" + suffix);
      if (result?.recalcWarning) {
        toast.warning('Encargos não recalcularam sozinhos — clique em "Recalcular".');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou. Tenta de novo?");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Deleta lançamento AVULSO (manual) — só permite se for is_fixed=false E
  // sem external_id. Entries sincronizadas/auto-popular/férias/salário-família
  // não podem ser deletadas por aqui (devem ser estornadas ou recriadas via
  // re-sync). Pra deletar sync, apaga o período inteiro.
  // ─────────────────────────────────────────────────────────────────────────
  const deleteEntry = useMutation({
    mutationFn: async ({ entryId, reason }: { entryId: string; reason: string }) => {
      if (!period || !companyId) throw new Error("Período não encontrado");
      if (!isPeriodEditable(period.status)) {
        throw new Error(periodLockedMessage(period.status));
      }
      const motivo = reason.trim();
      if (motivo.length < 3) {
        throw new Error("Informe o motivo da exclusão (mínimo 3 caracteres).");
      }

      // Captura tipo + colaborador ANTES de excluir, pra decidir se precisa
      // recalcular encargos depois (a RPC apaga a linha no servidor).
      const { data: entryInfo } = await supabase
        .from("payroll_entries")
        .select("type, collaborator_id")
        .eq("id", entryId)
        .maybeSingle();

      // Exclusão COM motivo via RPC SECURITY DEFINER: o audit_log só aceita
      // escrita por trigger, então a RPC valida permissão (financeiro:can_delete)
      // + período aberto no servidor, exclui, e anexa o motivo à linha de
      // auditoria (after.deletion_reason). Permite excluir QUALQUER lançamento do
      // mês (avulso, sincronizado, desconto), não só os avulsos sem external_id.
      const { error } = await supabase.rpc("delete_payroll_entry_with_reason", {
        p_entry_id: entryId,
        p_reason: motivo,
      });
      if (error) throw error;

      // Se o lançamento excluído mudava a base (hora extra, falta, etc.),
      // recalcula os encargos do colaborador. Best-effort.
      const info = entryInfo as { type?: string; collaborator_id?: string } | null;
      if (info?.type && info.collaborator_id && entryTypeAffectsTaxBase(info.type)) {
        const { month, year } = periodToMonthYear(period.reference_month);
        try {
          await recalcCollaboratorTaxes({
            companyId,
            collaboratorId: info.collaborator_id,
            month,
            year,
          });
        } catch (e) {
          console.error("Falha ao recalcular encargos após exclusão:", e);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      toast.success("Lançamento excluído ✓");
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou. Tenta de novo?");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Estorna lançamento (cria entry negativa, não deleta o original)
  // ─────────────────────────────────────────────────────────────────────────
  const reverseEntry = useMutation({
    mutationFn: async ({
      entryId,
      values,
    }: {
      entryId: string;
      values: ReverseEntryValues;
    }) => {
      if (!period || !companyId) throw new Error("Período não encontrado");
      const { data: original, error: fetchError } = await supabase
        .from("payroll_entries")
        .select("*")
        .eq("id", entryId)
        .single();
      if (fetchError || !original) throw fetchError ?? new Error("Lançamento não encontrado");

      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("payroll_entries").insert({
        company_id: companyId,
        collaborator_id: original.collaborator_id,
        store_id: original.store_id,
        type: original.type,
        description: `[Estorno] ${original.description ?? ""} — Motivo: ${values.reason}`,
        value: -original.value, // negativo
        is_fixed: false,
        month: original.month,
        year: original.year,
        created_by: userData?.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      toast.success("Estorno registrado ✓");
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou. Tenta de novo?");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fechar período (vira read-only; só pode estornar via novos lançamentos)
  // ─────────────────────────────────────────────────────────────────────────
  const closePeriod = useMutation({
    mutationFn: async () => {
      if (!periodId) throw new Error("Período não encontrado");
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("payroll_periods")
        .update({
          status: "closed",
          closed_by: userData?.user?.id ?? null,
          closed_at: new Date().toISOString(),
        })
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-period"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      toast.success("Folha do mês fechada ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // Reabrir período fechado (caso precise corrigir)
  const reopenPeriod = useMutation({
    mutationFn: async () => {
      if (!periodId) throw new Error("Período não encontrado");
      const { error } = await supabase
        .from("payroll_periods")
        .update({
          status: "open",
          closed_at: null,
          closed_by: null,
        })
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-period"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      toast.success("Período reaberto.");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  return {
    entries,
    isLoading,
    period,
    createEntry,
    deleteEntry,
    reverseEntry,
    closePeriod,
    reopenPeriod,
  };
}

/**
 * Helper: identifica se uma entry é AVULSA (lançada manualmente via
 * NewEntryDialog). Avulsas podem ser deletadas e NÃO devem aparecer na ficha
 * permanente do colab (são pontuais ao mês).
 */
export function isManualAvulso(entry: { is_fixed?: boolean; external_id?: string | null }): boolean {
  return entry.is_fixed === false && (entry.external_id == null || entry.external_id === "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertas pendentes (pendentes = sem resolved_at)
// ─────────────────────────────────────────────────────────────────────────────

export function usePayrollAlerts(periodId: string | undefined) {
  return useQuery({
    queryKey: ["payroll-alerts", periodId],
    queryFn: async () => {
      if (!periodId) return [];
      const { data, error } = await supabase
        .from("payroll_alerts")
        .select("*, collaborator:collaborators(id, name)")
        .eq("period_id", periodId)
        .is("resolved_at", null)
        .order("severity", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PayrollAlertWithCollaborator[];
    },
    enabled: !!periodId,
  });
}
