import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";
import { isPeriodEditable } from "@/modules/payroll/types";
import {
  calcVacation,
  calcVacationPaymentDate,
  calcVacationPayrollMonth,
  type VacationCalcResult,
} from "@/lib/payroll/vacationCalc";

export interface VacationPeriod {
  id: string;
  collaborator_id: string;
  company_id: string;
  /** Período de Competência (aquisitivo) — início. Agenda: periodoIn. */
  start_date: string;
  /** Período de Competência (aquisitivo) — fim. Agenda: periodoFn. */
  end_date: string;
  /** Período de Gozo — início. Agenda: periodoInGozo. */
  gozo_start_date: string | null;
  /** Período de Gozo — fim. Agenda: periodoFnGozo. */
  gozo_end_date: string | null;
  /** Data Limite / vencimento concessivo. Agenda: dataLimite. */
  data_limite: string | null;
  days_entitled: number;
  days_taken: number;
  days_sold: number;
  days_remaining: number;
  status: string;
  created_at: string;
  collaborator?: {
    id: string;
    name: string;
    position: string | null;
    admission_date: string | null;
  };
}

export interface VacationRequest {
  id: string;
  collaborator_id: string;
  company_id: string;
  vacation_period_id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  sell_days: number;
  /** Gratificação habitual que compõe base de cálculo das férias (tributada). */
  gratifications: number;
  /** Bonificação livre (sem 1/3, sem tributar). */
  bonifications: number;
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  collaborator?: {
    id: string;
    name: string;
    position: string | null;
  };
  vacation_period?: VacationPeriod;
}

export const useVacationPeriods = () => {
  const { currentCompany } = useDashboard();

  return useQuery({
    queryKey: ["vacation-periods", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("vacation_periods")
        .select("*, collaborator:collaborators(id, name, position, admission_date)")
        .eq("company_id", currentCompany.id)
        .order("end_date", { ascending: false });
      if (error) throw error;
      return data as unknown as VacationPeriod[];
    },
    enabled: !!currentCompany?.id,
  });
};

export const useVacationRequests = () => {
  const { currentCompany } = useDashboard();

  return useQuery({
    queryKey: ["vacation-requests", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("vacation_requests")
        .select("*, collaborator:collaborators(id, name, position), vacation_period:vacation_periods(*)")
        .eq("company_id", currentCompany.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as VacationRequest[];
    },
    enabled: !!currentCompany?.id,
  });
};

export const useCollaboratorVacationPeriods = (collaboratorId: string | undefined) => {
  return useQuery({
    queryKey: ["vacation-periods-collaborator", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("vacation_periods")
        .select("*")
        .eq("collaborator_id", collaboratorId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as unknown as VacationPeriod[];
    },
    enabled: !!collaboratorId,
  });
};

export const useCollaboratorVacationRequests = (collaboratorId: string | undefined) => {
  return useQuery({
    queryKey: ["vacation-requests-collaborator", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("vacation_requests")
        .select("*, vacation_period:vacation_periods(*)")
        .eq("collaborator_id", collaboratorId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as VacationRequest[];
    },
    enabled: !!collaboratorId,
  });
};

export const useCreateVacationRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      collaborator_id: string;
      company_id: string;
      vacation_period_id: string;
      start_date: string;
      end_date: string;
      days_count: number;
      sell_days: number;
      gratifications?: number;
      bonifications?: number;
      requested_by: string;
      notes?: string;
    }) => {
      const { data: result, error } = await supabase
        .from("vacation_requests")
        .insert({
          ...data,
          gratifications: data.gratifications ?? 0,
          bonifications: data.bonifications ?? 0,
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-periods"] });
      toast.success("Solicitação de férias criada!");
    },
    onError: (error: any) => {
      toast.error("Erro ao criar solicitação: " + error.message);
    },
  });
};

export const useUpdateVacationRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string;
      status?: string;
      approved_by?: string;
      approved_at?: string;
      rejection_reason?: string;
    }) => {
      const { data: result, error } = await supabase
        .from("vacation_requests")
        .update(data)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-periods"] });
    },
    onError: (error: any) => {
      toast.error("Erro ao atualizar solicitação: " + error.message);
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Aprovação de férias: snapshot do cálculo + lançamento na folha.
//
// Fluxo:
//   1. Calcula férias com salário/dependentes atuais do colab → snapshot.
//   2. Determina payroll_month/year pelo mês do gozo (ou adiantamento).
//   3. Se folha desse mês existe E está aberta → cria 4 payroll_entries
//      (Férias provento, 1/3 provento, INSS desconto, IRPF desconto) e marca
//      posted_to_payroll=true.
//   4. Se folha não existe ou está fechada → apenas grava o snapshot +
//      payroll_month/year. Ao abrir ou repopular, postScheduledVacations
//      pega esses pendentes e lança automaticamente.
//
// Tudo idempotente via payroll_entries.external_id pattern 'ferias-{requestId}-{kind}'.
// ─────────────────────────────────────────────────────────────────────────────

interface ApproveVacationInput {
  requestId: string;
  approvedBy: string;
}

interface ApproveVacationResult {
  request: VacationRequest;
  calc: VacationCalcResult;
  paymentDate: string; // YYYY-MM-DD
  payrollMonth: number;
  payrollYear: number;
  postedToPayroll: boolean;
  entryIds: string[];
}

export const useApproveVacationRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, approvedBy }: ApproveVacationInput): Promise<ApproveVacationResult> => {
      // 1. Carrega a request + colab (salário + dependentes + store)
      const { data: req, error: reqErr } = await supabase
        .from("vacation_requests")
        .select("*")
        .eq("id", requestId)
        .single();
      if (reqErr || !req) throw new Error("Solicitação não encontrada");

      const { data: collab, error: collabErr } = await supabase
        .from("collaborators")
        .select("id, name, current_salary, dependents_count, store_id")
        .eq("id", req.collaborator_id)
        .single();
      if (collabErr || !collab) throw new Error("Colaborador não encontrado");

      const salary = Number((collab as { current_salary: number | null }).current_salary ?? 0);
      if (!(salary > 0)) {
        throw new Error("Colaborador sem salário cadastrado — não dá pra calcular férias. Atualize o cadastro primeiro.");
      }

      // 2. Calcula férias (com gratificação/bonificação salvas na request)
      // Fallback: se request veio com 0 (modal não auto-carregou), busca o
      // último mês com grat/boni do colab pra não perder esses valores no
      // recibo. User pode sobrescrever editando antes de aprovar se quiser.
      let reqGrat = Number((req as { gratifications: number | null }).gratifications ?? 0);
      let reqBoni = Number((req as { bonifications: number | null }).bonifications ?? 0);
      if (reqGrat === 0 && reqBoni === 0) {
        const { data: extras } = await supabase
          .from("payroll_entries")
          .select("type, value, month, year, external_id")
          .eq("collaborator_id", req.collaborator_id)
          .in("type", ["gratificacao", "bonificacao"])
          .order("year", { ascending: false })
          .order("month", { ascending: false });
        // Exclui entries que vieram de outras férias
        const recurring = (extras ?? []).filter(
          (r) => !(typeof r.external_id === "string" && r.external_id.startsWith("ferias-")),
        );
        if (recurring.length > 0) {
          const top = recurring[0] as { year: number; month: number };
          const sameMonth = recurring.filter(
            (r) => r.year === top.year && r.month === top.month,
          );
          let g = 0, b = 0;
          for (const r of sameMonth) {
            const v = Number(r.value);
            if (r.type === "gratificacao") g += v;
            else if (r.type === "bonificacao") b += v;
          }
          reqGrat = Math.round(g * 100) / 100;
          reqBoni = Math.round(b * 100) / 100;
          // Persiste de volta na request pra próxima vez
          if (reqGrat > 0 || reqBoni > 0) {
            await supabase
              .from("vacation_requests")
              .update({ gratifications: reqGrat, bonifications: reqBoni })
              .eq("id", requestId);
          }
        }
      }

      const calc = calcVacation({
        salary,
        daysTaken: req.days_count,
        daysSold: req.sell_days ?? 0,
        dependents: Number((collab as { dependents_count: number | null }).dependents_count ?? 0),
        gratifications: reqGrat,
        bonifications: reqBoni,
      });

      const paymentDateObj = calcVacationPaymentDate(req.start_date);
      const paymentDateISO = paymentDateObj.toISOString().slice(0, 10);
      const { month: payrollMonth, year: payrollYear } = calcVacationPayrollMonth(req.start_date);

      // 3. Tenta achar folha aberta nesse mês
      const { data: period } = await supabase
        .from("payroll_periods")
        .select("id, status, reference_month")
        .eq("company_id", req.company_id)
        .eq("reference_month", `${payrollYear}-${String(payrollMonth).padStart(2, "0")}-01`)
        .maybeSingle();

      // Postar férias vale enquanto o RH pode editar a folha — inclui
      // 'aprovado_rh'. Depois que a diretoria aprova, a request fica
      // posted=false e entra na folha seguinte (ou após devolução).
      const folhaAberta = isPeriodEditable(period?.status);

      let entryIds: string[] = [];

      // 4. Se folha aberta, lança as entries
      if (folhaAberta) {
        entryIds = await postVacationToPayroll({
          requestId: req.id,
          companyId: req.company_id,
          collaboratorId: collab.id,
          storeId: (collab as { store_id: string | null }).store_id,
          month: payrollMonth,
          year: payrollYear,
          calc,
        });
      }

      // 5. Update da request com snapshot + flags
      const updatePayload: Record<string, unknown> = {
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        calculation_snapshot: calc as unknown as Record<string, unknown>,
        payment_date: paymentDateISO,
        payroll_month: payrollMonth,
        payroll_year: payrollYear,
        posted_to_payroll: folhaAberta,
        payroll_entry_ids: entryIds.length > 0 ? entryIds : null,
      };

      const { data: updated, error: updErr } = await supabase
        .from("vacation_requests")
        .update(updatePayload)
        .eq("id", requestId)
        .select()
        .single();
      if (updErr) throw updErr;

      return {
        request: updated as unknown as VacationRequest,
        calc,
        paymentDate: paymentDateISO,
        payrollMonth,
        payrollYear,
        postedToPayroll: folhaAberta,
        entryIds,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-periods"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      const monthLabel = `${String(result.payrollMonth).padStart(2, "0")}/${result.payrollYear}`;
      if (result.postedToPayroll) {
        toast.success(`Aprovado e lançado na folha de ${monthLabel} (${result.entryIds.length} lançamentos).`);
      } else {
        toast.success(
          `Aprovado. Será lançado automaticamente quando a folha de ${monthLabel} for aberta.`,
        );
      }
    },
    onError: (err: Error) => {
      toast.error("Erro ao aprovar: " + err.message);
    },
  });
};

/**
 * Tipo das rows de payroll_entries geradas pelo recibo de férias.
 * Exportado pra facilitar testes do row-builder puro.
 */
export type VacationPayrollRow = {
  company_id: string;
  collaborator_id: string;
  store_id: string | null;
  external_id: string;
  type: "ferias" | "gratificacao" | "bonificacao" | "inss" | "irpf";
  description: string;
  value: number;
  month: number;
  year: number;
  is_fixed: boolean;
};

/**
 * Função PURA: monta as rows de payroll_entries pra um recibo de férias,
 * dado o cálculo + identificadores. Não acessa o banco — usar com
 * `postVacationToPayroll` ou diretamente em testes.
 *
 * Cardinalidade:
 *   - mínimo: 2 (férias provento + 1/3) quando salário > 0
 *   - +1 se gratificação > 0
 *   - +1 se bonificação > 0
 *   - +2 se vendeu dias (abono + 1/3 abono)
 *   - +1 se INSS > 0
 *   - +1 se IRRF > 0
 *   - máximo: 8
 *
 * Idempotência via `external_id` pattern `ferias-{requestId}-{kind}`.
 */
export function buildVacationPayrollRows(args: {
  requestId: string;
  companyId: string;
  collaboratorId: string;
  storeId: string | null;
  month: number;
  year: number;
  calc: VacationCalcResult;
}): VacationPayrollRow[] {
  const { requestId, companyId, collaboratorId, storeId, month, year, calc } = args;
  const rows: VacationPayrollRow[] = [];
  const base = { company_id: companyId, collaborator_id: collaboratorId, store_id: storeId, month, year, is_fixed: false };

  if (calc.valor_ferias > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-provento`,
      type: "ferias",
      description: `Férias (${calc.daysTaken} dias)`,
      value: calc.valor_ferias,
    });
  }
  if (calc.um_terco_ferias > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-terco`,
      type: "ferias",
      description: "1/3 sobre férias",
      value: calc.um_terco_ferias,
    });
  }
  if (calc.gratificacao_valor > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-gratificacao`,
      type: "gratificacao",
      description: "Gratificação s/ Férias",
      value: calc.gratificacao_valor,
    });
  }
  if (calc.valor_bonificacao > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-bonificacao`,
      type: "bonificacao",
      description: "Bonificação s/ Férias — isenta",
      value: calc.valor_bonificacao,
    });
  }
  if (calc.valor_abono > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-abono`,
      type: "ferias",
      description: `Abono pecuniário (${calc.daysSold} dias) — isento INSS/IR`,
      value: calc.valor_abono,
    });
  }
  if (calc.um_terco_abono > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-terco-abono`,
      type: "ferias",
      description: "1/3 sobre abono — isento INSS/IR",
      value: calc.um_terco_abono,
    });
  }
  if (calc.inss > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-inss`,
      type: "inss",
      description: "INSS s/ Férias",
      value: calc.inss,
    });
  }
  if (calc.irrf > 0) {
    rows.push({
      ...base,
      external_id: `ferias-${requestId}-irrf`,
      type: "irpf",
      description: "IRRF s/ Férias",
      value: calc.irrf,
    });
  }

  return rows;
}

/**
 * Cria os 4 (ou 6, se há abono) lançamentos de férias em payroll_entries.
 * Idempotente via external_id pattern 'ferias-{requestId}-{kind}'.
 * Retorna os IDs criados.
 */
export async function postVacationToPayroll(args: {
  requestId: string;
  companyId: string;
  collaboratorId: string;
  storeId: string | null;
  month: number;
  year: number;
  calc: VacationCalcResult;
}): Promise<string[]> {
  const rows = buildVacationPayrollRows(args);
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("payroll_entries")
    .upsert(rows, { onConflict: "collaborator_id,external_id", ignoreDuplicates: false })
    .select("id");
  if (error) throw new Error("Falha ao lançar na folha: " + error.message);
  return (data ?? []).map((r) => r.id as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// Adiantamento de Férias — move uma vacation_request aprovada pra uma folha
// específica (a "atual" do user).
//
// Cenários cobertos:
//   1. Request já posted em outro mês → deleta entries do mês antigo, re-cria
//      no mês destino, atualiza payroll_month/year + payroll_entry_ids.
//   2. Request ainda não posted (não tinha folha aberta) → só cria entries
//      no mês destino e marca posted=true.
//
// Snapshot do cálculo é preservado — só muda em qual folha cai.
// ─────────────────────────────────────────────────────────────────────────────

export const useAdvanceVacationToPeriod = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      requestId: string;
      targetMonth: number;
      targetYear: number;
    }) => {
      const { requestId, targetMonth, targetYear } = args;

      // 1. Carrega request
      const { data: req, error: reqErr } = await supabase
        .from("vacation_requests")
        .select("*")
        .eq("id", requestId)
        .single();
      if (reqErr || !req) throw new Error("Solicitação não encontrada");
      if (req.status !== "approved") {
        throw new Error("Só dá pra adiantar férias APROVADAS.");
      }

      // 2. Carrega colab pra pegar store + dados pra eventual fallback de cálculo
      const { data: collab } = await supabase
        .from("collaborators")
        .select("id, store_id, current_salary, dependents_count")
        .eq("id", req.collaborator_id)
        .single();
      if (!collab) throw new Error("Colaborador não encontrado");

      // 3. Resolve calc: snapshot existente (preferido) ou recalcula
      let calc: VacationCalcResult | null =
        (req.calculation_snapshot as unknown as VacationCalcResult | null) ?? null;
      if (!calc) {
        const salary = Number((collab as { current_salary: number | null }).current_salary ?? 0);
        if (!(salary > 0)) {
          throw new Error("Sem snapshot e sem salário cadastrado — não dá pra recalcular.");
        }
        calc = calcVacation({
          salary,
          daysTaken: req.days_count,
          daysSold: req.sell_days ?? 0,
          dependents: Number((collab as { dependents_count: number | null }).dependents_count ?? 0),
          gratifications: Number((req as { gratifications: number | null }).gratifications ?? 0),
          bonifications: Number((req as { bonifications: number | null }).bonifications ?? 0),
        });
      }

      // 4. Se já tinha entries antigas, apaga
      const oldIds = (req.payroll_entry_ids as string[] | null) ?? [];
      if (oldIds.length > 0) {
        await supabase
          .from("payroll_entries")
          .delete()
          .in("id", oldIds);
      }

      // 5. Cria entries no mês destino
      const newIds = await postVacationToPayroll({
        requestId: req.id,
        companyId: req.company_id,
        collaboratorId: req.collaborator_id,
        storeId: (collab as { store_id: string | null }).store_id,
        month: targetMonth,
        year: targetYear,
        calc,
      });

      // 6. Atualiza request
      const newPaymentDate = new Date(targetYear, targetMonth - 1, 1);
      const { error: updErr } = await supabase
        .from("vacation_requests")
        .update({
          posted_to_payroll: true,
          payroll_month: targetMonth,
          payroll_year: targetYear,
          payroll_entry_ids: newIds.length > 0 ? newIds : null,
          payment_date: newPaymentDate.toISOString().slice(0, 10),
        })
        .eq("id", requestId);
      if (updErr) throw updErr;

      return { requestId, newIds, calc, targetMonth, targetYear };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      queryClient.invalidateQueries({ queryKey: ["vacation-periods"] });
      toast.success("Férias adiantadas pra esta folha ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + err.message);
    },
  });
};

export const useDeleteVacationRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("vacation_requests")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacation-requests"] });
      toast.success("Solicitação removida!");
    },
    onError: (error: any) => {
      toast.error("Erro ao remover solicitação: " + error.message);
    },
  });
};

// Status helpers
export const vacationRequestStatusLabels: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Rejeitada",
  in_progress: "Em Gozo",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export const vacationRequestStatusColors: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/25",
  approved: "bg-info/10 text-info border-info/25",
  rejected: "bg-destructive/10 text-destructive border-destructive/25",
  in_progress: "bg-success/10 text-success border-success/25",
  completed: "bg-gray-100 text-gray-800 border-gray-200",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
};

export const vacationPeriodStatusLabels: Record<string, string> = {
  pending: "Adquirindo",
  available: "Disponível",
  partially_used: "Parcialmente Usado",
  used: "Utilizado",
  expired: "Vencido",
};

export const vacationPeriodStatusColors: Record<string, string> = {
  pending: "bg-info/10 text-info border-info/25",
  available: "bg-success/10 text-success border-success/25",
  partially_used: "bg-warning/10 text-warning border-warning/25",
  used: "bg-gray-100 text-gray-800 border-gray-200",
  expired: "bg-destructive/10 text-destructive border-destructive/25",
};
