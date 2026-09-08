import { beforeEach, describe, expect, it, vi } from "vitest";
import { calcVacation } from "@/lib/payroll/vacationCalc";
import { postScheduledVacations } from "./vacation-payroll.service";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  post: vi.fn(),
  updateError: false,
}));

vi.mock("@/hooks/useVacations", () => ({ postVacationToPayroll: state.post }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let payload: Record<string, unknown> | undefined;
      const rows = () => (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const query = {
        select: () => query,
        order: () => query,
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
        like: (key: string, value: string) => { filters.push((row) => String(row[key]).startsWith(value.slice(0, -1))); return query; },
        range: async (from: number, to: number) => ({ data: rows().slice(from, to + 1), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        update: (values: Record<string, unknown>) => { payload = values; return query; },
        then: (resolve: (result: { data: Record<string, unknown>[]; error: Error | null }) => void) => {
          const error = payload && state.updateError ? new Error("Falha ao atualizar") : null;
          if (payload && !error) rows().forEach((row) => Object.assign(row, payload));
          return Promise.resolve({ data: rows(), error }).then(resolve);
        },
      };
      return query;
    },
  },
}));

const snapshot = calcVacation({ salary: 3000, daysTaken: 30, gratifications: 500, bonifications: 100 });

beforeEach(() => {
  state.updateError = false;
  state.tables = {
    payroll_periods: [{ company_id: "company", reference_month: "2026-09-01", status: "open" }],
    vacation_requests: [{
      id: "request", company_id: "company", collaborator_id: "collab", status: "approved",
      start_date: "2026-09-01", days_count: 30, sell_days: 0, gratifications: 500, bonifications: 100,
      payroll_month: 9, payroll_year: 2026, calculation_snapshot: snapshot,
      posted_to_payroll: false, payroll_entry_ids: null,
    }],
    collaborators: [{ id: "collab", company_id: "company", store_id: "store", current_salary: 9000, dependents_count: 0 }],
    payroll_entries: [],
  };
  state.post.mockReset().mockImplementation(async () => {
    state.tables.payroll_entries = [{ id: "entry", company_id: "company", month: 9, year: 2026, external_id: "ferias-request-provento" }];
    return ["entry"];
  });
});

describe("postScheduledVacations", () => {
  it("inclui as férias programadas usando o valor aprovado e não duplica ao repopular", async () => {
    expect(await postScheduledVacations("company", 9, 2026)).toEqual({ posted: 1, failed: 0 });
    expect(state.post).toHaveBeenCalledWith(expect.objectContaining({ month: 9, year: 2026, calc: snapshot }));
    expect(await postScheduledVacations("company", 9, 2026)).toEqual({ posted: 0, failed: 0 });
    expect(state.post).toHaveBeenCalledTimes(1);
  });

  it("usa mês do gozo para solicitação antiga sem competência, inclusive no dia 1", async () => {
    Object.assign(state.tables.vacation_requests[0], { payroll_month: null, payroll_year: null });
    await postScheduledVacations("company", 9, 2026);
    expect(state.post).toHaveBeenCalledTimes(1);
    expect(state.tables.vacation_requests[0]).toMatchObject({ payroll_month: 9, payroll_year: 2026 });
  });

  it("respeita a competência escolhida ao adiantar férias", async () => {
    state.tables.vacation_requests[0].start_date = "2026-11-15";
    await postScheduledVacations("company", 9, 2026);
    expect(state.post).toHaveBeenCalledTimes(1);
    state.post.mockClear();
    state.tables.vacation_requests[0].payroll_month = 10;
    await postScheduledVacations("company", 9, 2026);
    expect(state.post).not.toHaveBeenCalled();
  });

  it("não lança solicitações pendentes, rejeitadas, de outra empresa ou de outro mês", async () => {
    const request = state.tables.vacation_requests[0];
    state.tables.vacation_requests = [
      { ...request, status: "pending" }, { ...request, status: "rejected" },
      { ...request, company_id: "other" }, { ...request, payroll_month: 10 },
    ];
    expect(await postScheduledVacations("company", 9, 2026)).toEqual({ posted: 0, failed: 0 });
    expect(state.post).not.toHaveBeenCalled();
  });

  it("recupera recibo parcialmente removido", async () => {
    Object.assign(state.tables.vacation_requests[0], { posted_to_payroll: true, payroll_entry_ids: ["entry", "missing"] });
    state.tables.payroll_entries = [{ id: "entry", company_id: "company", month: 9, year: 2026, external_id: "ferias-request-provento" }];
    expect(await postScheduledVacations("company", 9, 2026)).toEqual({ posted: 1, failed: 0 });
  });

  it("inclui gratificação e bonificação no fallback de recibo sem snapshot", async () => {
    state.tables.vacation_requests[0].calculation_snapshot = null;
    await postScheduledVacations("company", 9, 2026);
    expect(state.post).toHaveBeenCalledWith(expect.objectContaining({
      calc: expect.objectContaining({ salary: 9000, gratifications: 500, bonifications: 100 }),
    }));
  });

  it("informa falha de gravação sem declarar férias lançadas", async () => {
    state.updateError = true;
    expect(await postScheduledVacations("company", 9, 2026)).toEqual({ posted: 0, failed: 1 });
    expect(state.tables.vacation_requests[0].posted_to_payroll).toBe(false);
  });

  it("recusa incluir férias em folha aprovada pela diretoria", async () => {
    state.tables.payroll_periods[0].status = "aprovado_diretoria";
    await expect(postScheduledVacations("company", 9, 2026)).rejects.toThrow();
    expect(state.post).not.toHaveBeenCalled();
  });
});
