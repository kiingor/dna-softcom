import { describe, expect, it } from "vitest";
import { getExamStatus } from "./examStatus";

describe("vencimento de exames", () => {
  const today = "2026-09-08";
  const pending = { status: "pendente", due_date: today, scheduled_date: null };

  it("mantém o exame no prazo durante toda a data limite", () => {
    expect(getExamStatus(pending, today)).toBe("pendente");
    expect(getExamStatus(pending, "2026-09-09")).toBe("vencido");
  });

  it("considera vencido também um exame agendado cuja data limite passou", () => {
    expect(getExamStatus({
      ...pending,
      status: "agendado",
      due_date: "2026-09-07",
      scheduled_date: "2026-09-10",
    }, today)).toBe("vencido");
  });

  it.each([
    [null, "pendente"],
    ["2026-09-15", "agendado"],
  ])("recalcula um vencimento corrigido preservando o agendamento %s", (scheduled_date, expected) => {
    expect(getExamStatus({
      status: "vencido",
      due_date: "2026-09-30",
      scheduled_date,
    }, today)).toBe(expected);
  });

  it.each(["realizado", "cancelado", "arquivado"])("preserva exames com status %s mesmo com data antiga", (status) => {
    expect(getExamStatus({ ...pending, status, due_date: "2025-01-01" }, today)).toBe(status);
  });
});
