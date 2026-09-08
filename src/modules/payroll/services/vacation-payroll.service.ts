import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { calcVacation, calcVacationPayrollMonth, type VacationCalcResult } from "@/lib/payroll/vacationCalc";
import { postVacationToPayroll } from "@/hooks/useVacations";
import { isPeriodEditable, periodLockedMessage } from "../types";

interface ScheduledVacation {
  id: string;
  collaborator_id: string;
  start_date: string;
  days_count: number;
  sell_days: number | null;
  gratifications: number | null;
  bonifications: number | null;
  calculation_snapshot: unknown;
  payroll_month: number | null;
  payroll_year: number | null;
  posted_to_payroll: boolean;
  payroll_entry_ids: string[] | null;
}

/** Inclui férias aprovadas na competência programada, ao abrir ou repopular. */
export async function postScheduledVacations(companyId: string, month: number, year: number) {
  const { data: period, error: periodError } = await supabase
    .from("payroll_periods")
    .select("status")
    .eq("company_id", companyId)
    .eq("reference_month", `${year}-${String(month).padStart(2, "0")}-01`)
    .maybeSingle();
  if (periodError) throw periodError;
  if (!period) throw new Error("Folha não encontrada");
  if (!isPeriodEditable(period.status)) throw new Error(periodLockedMessage(period.status));

  const approved = await fetchAllRows<ScheduledVacation>(() => supabase
    .from("vacation_requests")
    .select("id, collaborator_id, calculation_snapshot, days_count, sell_days, gratifications, bonifications, start_date, payroll_month, payroll_year, posted_to_payroll, payroll_entry_ids")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .order("id"));

  const scheduled = approved.filter((request) => {
    // Usa a mesma regra da aprovação: mês do gozo, ou competência escolhida
    // no adiantamento. D-2 é a data do recibo, não o mês da folha.
    const target = request.payroll_month != null && request.payroll_year != null
      ? { month: request.payroll_month, year: request.payroll_year }
      : calcVacationPayrollMonth(request.start_date);
    return target.month === month && target.year === year;
  });
  if (scheduled.length === 0) return { posted: 0, failed: 0 };

  const existing = await fetchAllRows<{ id: string }>(() => supabase
    .from("payroll_entries")
    .select("id")
    .eq("company_id", companyId)
    .eq("month", month)
    .eq("year", year)
    .like("external_id", "ferias-%")
    .order("id"));
  const existingIds = new Set(existing.map((entry) => entry.id));
  const pending = scheduled.filter((request) =>
    !request.posted_to_payroll || !request.payroll_entry_ids?.length ||
    request.payroll_entry_ids.some((id) => !existingIds.has(id)));
  if (pending.length === 0) return { posted: 0, failed: 0 };

  const { data: collaborators, error } = await supabase
    .from("collaborators")
    .select("id, store_id, current_salary, dependents_count")
    .eq("company_id", companyId)
    .in("id", [...new Set(pending.map((request) => request.collaborator_id))]);
  if (error) throw error;
  const byId = new Map((collaborators ?? []).map((collaborator) => [collaborator.id, collaborator]));
  const result = { posted: 0, failed: 0 };

  for (const request of pending) {
    const collaborator = byId.get(request.collaborator_id);
    if (!collaborator) { result.failed++; continue; }
    let calc = request.calculation_snapshot as VacationCalcResult | null;
    if (!calc) {
      const salary = Number(collaborator.current_salary ?? 0);
      if (!(salary > 0)) { result.failed++; continue; }
      calc = calcVacation({
        salary,
        daysTaken: request.days_count,
        daysSold: request.sell_days ?? 0,
        dependents: collaborator.dependents_count ?? 0,
        gratifications: request.gratifications ?? 0,
        bonifications: request.bonifications ?? 0,
      });
    }
    try {
      const entryIds = await postVacationToPayroll({
        requestId: request.id,
        companyId,
        collaboratorId: request.collaborator_id,
        storeId: collaborator.store_id,
        month,
        year,
        calc,
      });
      if (entryIds.length === 0) { result.failed++; continue; }
      const { error: updateError } = await supabase.from("vacation_requests")
        .update({
          posted_to_payroll: true,
          payroll_entry_ids: entryIds,
          payroll_month: month,
          payroll_year: year,
          calculation_snapshot: calc as unknown as Json,
        })
        .eq("company_id", companyId)
        .eq("id", request.id);
      if (updateError) throw updateError;
      result.posted++;
    } catch {
      // Os external_ids permitem repetir a operação após uma falha parcial.
      result.failed++;
    }
  }
  return result;
}
