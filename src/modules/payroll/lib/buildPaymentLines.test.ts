import { describe, it, expect } from "vitest";
import { buildPaymentLines, paymentLineFromSnapshot, type PayableEntryInput } from "./buildPaymentLines";

// Helper: monta um lançamento mínimo com o que a fórmula usa.
function entry(
  collaboratorId: string,
  name: string,
  type: string,
  value: number,
  extra: Partial<PayableEntryInput> = {},
): PayableEntryInput {
  return {
    id: extra.id ?? `${collaboratorId}-${type}-${value}`,
    collaborator_id: collaboratorId,
    type,
    value,
    description: null,
    collaborator: { name },
    ...extra,
  };
}

/** Lançamento do fluxo de férias — o que define é o prefixo do external_id. */
function vac(
  collaboratorId: string,
  name: string,
  type: string,
  value: number,
  extra: Partial<PayableEntryInput> = {},
): PayableEntryInput {
  return entry(collaboratorId, name, type, value, {
    external_id: `ferias-req1-${type}`,
    ...extra,
  });
}

describe("buildPaymentLines", () => {
  it("preserva valor e agrupamento de um pagamento congelado sob a regra anterior", () => {
    const line = paymentLineFromSnapshot({
      entry_id: "carro-antigo",
      collaborator_id: "c1",
      kind: "avulso",
      gross: 800,
      inss: 0,
      irpf: 0,
      other_deductions: 0,
      net_amount: 800,
      components: [{ entryId: "carro-antigo", type: "carro_agregado", label: "Carro Agregado", value: 800 }],
      discounts: [],
      payee_name: "Ana",
      payee_document: null,
      payee_pix_key: null,
    });
    expect(line.entryId).toBe("carro-antigo");
    expect(line.kind).toBe("avulso");
    expect(line.amount).toBe(800);
  });
  it("mescla salário e adicionais numa linha só, com o salário base de âncora", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000, { id: "e-salario" }),
      entry("c1", "Ana", "gratificacao", 500, { id: "e-grat" }),
      entry("c1", "Ana", "hora_extra", 200, { id: "e-he" }),
      entry("c1", "Ana", "carro_agregado", 800, { id: "e-veiculo" }),
      entry("c1", "Ana", "salario_familia", 60, { id: "e-familia" }),
      entry("c1", "Ana", "periculosidade", 900, { id: "e-periculosidade" }),
      entry("c1", "Ana", "inss", 300),
      entry("c1", "Ana", "irpf", 100),
    ]);

    expect(lines).toHaveLength(1);
    const [l] = lines;
    // Âncora é o salário base, não o primeiro da lista — é o id mais estável
    // entre recálculos, e é ele que carrega a marcação de pago.
    expect(l.entryId).toBe("e-salario");
    expect(l.kind).toBe("mensal");
    expect(l.gross).toBe(5460);
    expect(l.amount).toBe(5060);
    expect(l.types).toEqual(["salario_base", "gratificacao", "hora_extra", "periculosidade", "salario_familia", "carro_agregado"]);
    expect(l.components).toHaveLength(6);
  });

  it("usa a ordem de MONTHLY_MERGED_TYPES nos componentes, não a ordem de entrada", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_familia", 60, { id: "e-fam" }),
      entry("c1", "Ana", "hora_extra", 200, { id: "e-he" }),
      entry("c1", "Ana", "salario_base", 3000, { id: "e-salario" }),
    ]);

    expect(lines[0].components.map((c) => c.type)).toEqual([
      "salario_base",
      "hora_extra",
      "salario_familia",
    ]);
  });

  it("cai no primeiro da mescla quando não existe salário base", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "gratificacao", 500, { id: "e-grat" }),
      entry("c1", "Ana", "hora_extra", 200, { id: "e-he" }),
    ]);

    expect(lines[0].entryId).toBe("e-grat");
  });

  it("subtrai os débitos manuais do líquido mensal", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "desconto", 150, { description: "Plano de saúde" }),
      entry("c1", "Ana", "adiantamento", 500),
      entry("c1", "Ana", "falta", 100),
      entry("c1", "Ana", "emprestimo", 250),
    ]);

    expect(lines[0].otherDeductions).toBe(1000);
    expect(lines[0].amount).toBe(2000);
    expect(lines[0].discounts).toHaveLength(4);
    expect(lines[0].discounts[0].label).toBe("Plano de saúde");
  });

  it("ignora FGTS: é encargo do empregador, não sai do salário", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "fgts", 240),
    ]);

    expect(lines[0].amount).toBe(3000);
  });

  it("anula o par estornado e some com o grupo inteiro", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000, { id: "e-salario" }),
      entry("c1", "Ana", "gratificacao", 500, { id: "e-grat-pos" }),
      entry("c1", "Ana", "gratificacao", -500, { id: "e-grat-neg" }),
    ]);

    // A gratificação estornada não entra: nem a positiva, nem a negativa.
    expect(lines[0].gross).toBe(3000);
    expect(lines[0].types).toEqual(["salario_base"]);
  });

  it("preserva o grupo quando o estorno é parcial", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "gratificacao", 500, { id: "e-grat-pos" }),
      entry("c1", "Ana", "gratificacao", -200, { id: "e-grat-neg" }),
    ]);

    // Saldo positivo: sobrevive só a linha positiva (a negativa é descartada
    // por não ser > 0), então o bruto conta os 500 cheios.
    expect(lines[0].gross).toBe(3500);
  });

  it("descarta a linha quando o líquido não é positivo", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 1000),
      entry("c1", "Ana", "adiantamento", 1000),
    ]);

    // Zero não vira PIX. Quem some daqui continua aparecendo na aprovação.
    expect(lines).toHaveLength(0);
  });

  it("soma férias ao salário e desconta os impostos de cada origem uma vez", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000, { id: "e-salario" }),
      entry("c1", "Ana", "inss", 300),
      entry("c1", "Ana", "desconto", 100),
      vac("c1", "Ana", "ferias", 2000, { id: "e-ferias" }),
      vac("c1", "Ana", "gratificacao", 666.67, { id: "e-terco" }),
      vac("c1", "Ana", "inss", 200),
      vac("c1", "Ana", "irpf", 66.67),
    ]);

    expect(lines).toHaveLength(1);
    const [mensal] = lines;
    expect(mensal.entryId).toBe("e-salario");
    expect(mensal.gross).toBeCloseTo(5666.67, 2);
    expect(mensal.amount).toBeCloseTo(5000, 2);
    expect(mensal.inss).toBe(500);
    expect(mensal.irpf).toBe(66.67);
    expect(mensal.otherDeductions).toBe(100);
    expect(mensal.types).toEqual(["salario_base", "ferias"]);
    expect(mensal.components.map((c) => c.entryId)).toEqual(["e-salario", "e-ferias", "e-terco"]);
  });

  it("consolida férias antes de verificar se o líquido é positivo", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 1000),
      entry("c1", "Ana", "adiantamento", 1200),
      vac("c1", "Ana", "ferias", 2000),
      vac("c1", "Ana", "inss", 200),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(1600);
  });

  it("inclui os extras do recibo de férias no pagamento consolidado", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "bonificacao", 400, { id: "setor" }),
      vac("c1", "Ana", "ferias", 2000),
      vac("c1", "Ana", "bonificacao", 300),
      vac("c1", "Ana", "gratificacao", 200),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.kind === "mensal")?.amount).toBe(5500);
    expect(lines.find((l) => l.kind === "avulso")?.entryId).toBe("setor");
  });

  it("não aplica débito manual no cheque de férias", () => {
    const lines = buildPaymentLines([
      vac("c1", "Ana", "ferias", 2000),
      // Defensivo: mesmo marcado como de férias, débito manual é ignorado.
      vac("c1", "Ana", "desconto", 500),
    ]);

    const ferias = lines.find((l) => l.kind === "ferias")!;
    expect(ferias.amount).toBe(2000);
    expect(ferias.otherDeductions).toBe(0);
  });

  it("só paga benefício marcado como pagável", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "beneficio", 300, { is_payable: true, id: "e-ben-ok" }),
      entry("c1", "Ana", "beneficio", 400, { is_payable: false, id: "e-ben-no" }),
      entry("c1", "Ana", "beneficio", 500, { id: "e-ben-null" }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(3300);
    expect(lines[0].components.map((c) => c.entryId)).toContain("e-ben-ok");
    expect(lines[0].components).toHaveLength(2);
  });

  it("deixa apenas custo setor em linha própria e soma veículo ao salário", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "inss", 300),
      entry("c1", "Ana", "bonificacao", 4000, { id: "e-bon" }),
      entry("c1", "Ana", "carro_agregado", 800, { id: "e-carro" }),
    ]);

    const avulsos = lines.filter((l) => l.kind === "avulso");
    expect(avulsos).toHaveLength(1);
    // O imposto do mês já foi consumido pela linha mensal — não desconta de novo.
    expect(avulsos.every((l) => l.inss === 0 && l.irpf === 0)).toBe(true);
    expect(avulsos[0].amount).toBe(4000);
    const mensal = lines.find((l) => l.kind === "mensal")!;
    expect(mensal.amount).toBe(3500);
    expect(mensal.components.find((c) => c.entryId === "e-carro")?.label).toBe("Veículo");
  });

  it("soma atestado, auxílio transporte e retroativo ao pagamento mensal", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "atestado", 100),
      entry("c1", "Ana", "auxilio_vale_transporte", 200),
      entry("c1", "Ana", "salario_retroativo", 300),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(3600);
  });

  it("mantém os colaboradores independentes", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "desconto", 500),
      entry("c2", "Bruno", "salario_base", 2000),
      entry("c2", "Bruno", "inss", 180),
    ]);

    const ana = lines.find((l) => l.collaboratorId === "c1")!;
    const bruno = lines.find((l) => l.collaboratorId === "c2")!;
    expect(ana.amount).toBe(2500);
    expect(bruno.amount).toBe(1820);
  });

  it("ordena por nome do colaborador e depois pela descrição", () => {
    const lines = buildPaymentLines([
      entry("c2", "Bruno", "salario_base", 2000),
      entry("c1", "Ana", "salario_base", 3000),
      entry("c1", "Ana", "bonificacao", 100, { description: "Zebra" }),
      entry("c1", "Ana", "bonificacao", 100, { description: "Alfa" }),
    ]);

    expect(lines.map((l) => l.collaboratorName)).toEqual([
      "Ana",
      "Ana",
      "Ana",
      "Bruno",
    ]);
    // Dentro da Ana: "Alfa" < "Salário Base" < "Zebra".
    expect(lines.slice(0, 3).map((l) => l.description)).toEqual([
      "Alfa",
      "Salário Base",
      "Zebra",
    ]);
  });

  it("aceita valor em string, como vem do numeric do Postgres", () => {
    const lines = buildPaymentLines([
      entry("c1", "Ana", "salario_base", "3000.50" as unknown as number),
      entry("c1", "Ana", "inss", "300.25" as unknown as number),
    ]);

    expect(lines[0].amount).toBeCloseTo(2700.25, 2);
  });

  it("não devolve nada quando não há provento", () => {
    expect(buildPaymentLines([])).toEqual([]);
    expect(
      buildPaymentLines([
        entry("c1", "Ana", "inss", 300),
        entry("c1", "Ana", "fgts", 240),
      ]),
    ).toEqual([]);
  });
});
