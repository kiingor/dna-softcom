import { describe, expect, it } from "vitest";
import { objetivoSchema } from "./objetivo.schema";
import { feedbackOptionSchema } from "./feedback-option.schema";

describe("validação do feedback de cultura", () => {
  const input = { tipo: "Cultura", comentario: "Reconhecimento", mostrarSuporte: true };
  it("exige campanha e cultura apenas no novo tipo", () => {
    const result = objetivoSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual(["campanhaId", "culturaId"]);
    for (const tipo of ["Comentário", "Objetivo", "META"]) {
      expect(objetivoSchema.safeParse({ ...input, tipo }).success).toBe(true);
    }
  });
  it("aceita as duas referências válidas e recusa valores arbitrários", () => {
    const values = { ...input, campanhaId: "11111111-1111-4111-8111-111111111111", culturaId: "22222222-2222-4222-8222-222222222222" };
    expect(objetivoSchema.safeParse(values).success).toBe(true);
    expect(objetivoSchema.safeParse({ ...values, culturaId: "Cooperação" }).success).toBe(false);
  });
  it("normaliza o nome dos cadastros e recusa nomes vazios ou extensos", () => {
    expect(feedbackOptionSchema.parse({ name: "  Cooperação  " })).toEqual({ name: "Cooperação" });
    expect(feedbackOptionSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(feedbackOptionSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
  });
});
