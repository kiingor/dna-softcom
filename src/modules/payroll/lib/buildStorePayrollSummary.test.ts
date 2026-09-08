import { describe, expect, it } from "vitest";
import { buildStorePayrollSummary, calculatePayrollReportTotals, getPayrollReportTypeValue } from "./buildStorePayrollSummary";

const stores = [
  { id: "jp", store_name: "João Pessoa" },
  { id: "cg", store_name: "Campina Grande" },
  { id: "nt", store_name: "Natal" },
];

const entry = (store_id: string | null, type: string, value: number) => ({ store_id, type, value });

describe("resumo da folha por PDV", () => {
  it("consolida cada tipo por PDV e totaliza proventos, descontos e FGTS sem duplicar custo setor", () => {
    const summary = buildStorePayrollSummary([
      entry("jp", "salario_base", 3000),
      entry("jp", "salario_base", 2000),
      entry("jp", "fgts", 400),
      entry("jp", "carro_agregado", 700),
      entry("jp", "bonificacao", 400),
      entry("jp", "gratificacao", 500),
      entry("jp", "inss", 250),
      entry("jp", "emprestimo", 75),
      entry("cg", "salario_base", 2500),
      entry("cg", "fgts", 200),
      entry("cg", "gratificacao", 100),
      entry("nt", "salario_base", 1500),
      entry("nt", "carro_agregado", 100),
      entry("nt", "fgts", 120),
    ], stores);

    expect(summary.rows.map((row) => row.storeName)).toEqual(["Campina Grande", "João Pessoa", "Natal"]);
    expect(summary.columns.slice(0, 5).map((column) => column.label)).toEqual([
      "Salário base", "FGTS", "Agregado", "Custo setor", "Gratificação",
    ]);
    expect(summary.rows[1]).toMatchObject({
      valuesByType: { salario_base: 5000, fgts: 400, carro_agregado: 700, bonificacao: 400, gratificacao: 500 },
      earnings: 6600, deductions: 325, net: 6275, companyCost: 7000,
    });
    expect(summary.totals).toEqual({
      valuesByType: { salario_base: 9000, fgts: 720, carro_agregado: 800, bonificacao: 400, gratificacao: 600, inss: 250, emprestimo: 75 },
      earnings: 10800, deductions: 325, fgts: 720, net: 10475, companyCost: 11520,
    });
    expect(getPayrollReportTypeValue(summary.rows[0], "carro_agregado")).toBe(0);
    expect(getPayrollReportTypeValue(summary.rows[1], "emprestimo")).toBe(-75);
  });

  it("preserva o PDV do lançamento após transferência e usa o cadastro quando não há PDV no lançamento", () => {
    const summary = buildStorePayrollSummary([
      { ...entry("jp", "salario_base", 3000), collaborator: { store_id: "nt" } },
      { ...entry(null, "gratificacao", 100), collaborator: { store_id: "nt" } },
    ], stores);

    expect(summary.rows.map((row) => [row.storeId, row.earnings])).toEqual([["jp", 3000], ["nt", 100]]);
  });

  it("mantém lançamentos sem PDV ou sem colaborador visíveis no total", () => {
    const summary = buildStorePayrollSummary([
      { ...entry(null, "salario_base", 1000), collaborator: null },
      entry(null, "gratificacao", 100),
      entry("nt", "salario_base", 2000),
      entry("missing", "salario_base", 500),
    ], stores);

    expect(summary.rows[summary.rows.length - 1]).toMatchObject({ storeId: null, storeName: "Sem PDV", earnings: 1100 });
    expect(summary.rows.find((row) => row.storeId === "missing")).toMatchObject({ earnings: 500 });
    expect(summary.totals.earnings).toBe(3600);
  });

  it("separa PDVs com o mesmo nome pelo identificador", () => {
    const summary = buildStorePayrollSummary([
      entry("a", "salario_base", 1000), entry("b", "salario_base", 2000),
    ], [{ id: "a", store_name: "Centro" }, { id: "b", store_name: "Centro" }]);

    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.map((row) => row.earnings)).toEqual([1000, 2000]);
  });

  it("inclui os demais tipos presentes e usa a classificação atual da folha", () => {
    const summary = buildStorePayrollSummary([
      entry("jp", "salario_retroativo", 100),
      entry("jp", "periculosidade", 200),
      entry("jp", "auxilio_vale_transporte", 50),
      entry("jp", "ferias", 1000),
      entry("jp", "salario_familia", 60),
      entry("jp", "emprestimo", 80),
    ], stores);

    expect(summary.columns.map((column) => column.type)).toEqual(expect.arrayContaining([
      "salario_retroativo", "periculosidade", "auxilio_vale_transporte", "ferias", "salario_familia", "emprestimo",
    ]));
    expect(summary.totals).toMatchObject({ earnings: 1410, deductions: 80, net: 1330 });
  });

  it("compensa estornos e preserva líquido negativo", () => {
    const summary = buildStorePayrollSummary([
      entry("jp", "salario_base", 3000),
      entry("jp", "salario_base", -3000),
      entry("jp", "inss", 100),
      entry("jp", "inss", -100),
      entry("jp", "emprestimo", 200),
    ], stores);

    expect(summary.rows[0]).toMatchObject({ earnings: 0, deductions: 200, net: -200, companyCost: 0 });
    const reversal = calculatePayrollReportTotals([entry("jp", "inss", -100)]);
    expect(getPayrollReportTypeValue(reversal, "inss")).toBe(100);
  });

  it("soma centavos de diferentes PDVs sem divergência entre linhas e total geral", () => {
    const summary = buildStorePayrollSummary([
      entry("jp", "gratificacao", 0.1),
      entry("jp", "gratificacao", 0.2),
      entry("nt", "gratificacao", 0.7),
      entry("jp", "inss", 0.1),
    ], stores);

    expect(summary.rows[0]).toMatchObject({ earnings: 0.3, net: 0.2 });
    expect(summary.totals).toMatchObject({ earnings: 1, deductions: 0.1, net: 0.9 });
  });

  it("mantém as cinco colunas principais e totais zerados numa competência vazia", () => {
    const summary = buildStorePayrollSummary([], stores);
    expect(summary.rows).toEqual([]);
    expect(summary.columns).toHaveLength(5);
    expect(summary.totals).toEqual({ valuesByType: {}, earnings: 0, deductions: 0, fgts: 0, net: 0, companyCost: 0 });
  });
});
