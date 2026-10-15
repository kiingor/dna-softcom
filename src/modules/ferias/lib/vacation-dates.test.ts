import { describe, expect, it } from "vitest";
import {
  formatVacationDate,
  parseVacationDate,
  toVacationDateInputValue,
  vacationConcessiveDeadline,
} from "./vacation-dates";

describe("datas de férias", () => {
  it.each(["20236-01-31", "2026-02-30", "infinity", "inválida", new Date(NaN)])(
    "sinaliza data inválida sem lançar exceção: %s",
    (value) => {
      expect(parseVacationDate(value)).toBeNull();
      expect(formatVacationDate(value)).toBe("Data inválida");
      expect(toVacationDateInputValue(value)).toBe("");
    },
  );

  it.each([null, undefined, ""])("distingue data ausente: %s", (value) => {
    expect(parseVacationDate(value)).toBeNull();
    expect(formatVacationDate(value)).toBe("—");
    expect(toVacationDateInputValue(value)).toBe("");
  });

  it("mantém datas válidas, ano bissexto e formatos da interface", () => {
    expect(formatVacationDate("2024-02-29")).toBe("29/02/2024");
    expect(formatVacationDate("2026-01-02", "dd/MM/yy")).toBe("02/01/26");
    expect(formatVacationDate("2026-09-24T14:30:00", "dd/MM/yyyy HH:mm")).toBe("24/09/2026 14:30");
    expect(toVacationDateInputValue("2026-09-24T14:30:00Z")).toBe("2026-09-24");
  });

  it("usa o limite oficial e só estima o vencimento quando ele está ausente", () => {
    expect(
      formatVacationDate(
        vacationConcessiveDeadline({ end_date: "2025-12-31", data_limite: "2026-10-01" }),
      ),
    ).toBe("01/10/2026");
    expect(
      formatVacationDate(vacationConcessiveDeadline({ end_date: "2025-12-31" })),
    ).toBe("31/12/2026");
    expect(
      vacationConcessiveDeadline({ end_date: "2025-12-31", data_limite: "20236-01-31" }),
    ).toBeNull();
    expect(vacationConcessiveDeadline({ end_date: "inválida" })).toBeNull();
  });
});
