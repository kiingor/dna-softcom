import { describe, expect, it } from "vitest";
import { getTempoDeCasa } from "./lib";

describe("segmentação por tempo de casa", () => {
  it.each([
    ["2026-09-08", "ate-um-ano"],
    ["2025-09-09", "ate-um-ano"],
    ["2025-09-08", "ate-um-ano"],
    ["2025-09-07", "mais-de-um-ano"],
    ["2020-01-01", "mais-de-um-ano"],
    ["2025-09-08T00:00:00Z", "ate-um-ano"],
    ["2025-09-08T23:00:00-03:00", "ate-um-ano"],
  ])("classifica %s pela data de admissão, incluindo o aniversário de um ano", (admissao, esperado) => {
    expect(getTempoDeCasa(admissao, "2026-09-08")).toBe(esperado);
  });

  it("usa o aniversário no calendário para admissões em ano bissexto", () => {
    expect(getTempoDeCasa("2024-02-29", "2025-02-28")).toBe("ate-um-ano");
    expect(getTempoDeCasa("2024-02-29", "2025-03-01")).toBe("mais-de-um-ano");
    expect(getTempoDeCasa("2023-02-28", "2024-02-29")).toBe("mais-de-um-ano");
  });

  it.each([null, undefined, "", "inválida", "08/09/2025", "2025-02-30", "2025-13-01", "2026-09-09"])(
    "não atribui uma faixa a uma admissão ausente, inválida ou futura (%s)",
    (admissao) => expect(getTempoDeCasa(admissao, "2026-09-08")).toBeNull(),
  );
});
