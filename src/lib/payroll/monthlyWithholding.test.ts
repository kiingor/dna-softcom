import { describe, expect, it } from "vitest";
import { calcIRPF, computeCollaboratorTaxes } from "./cltCalc";
import { calcIRPF as edgeCalcIRPF } from "../../../supabase/functions/_shared/clt-calc";

for (const [runtime, calculate] of [["frontend", calcIRPF], ["edge", edgeCalcIRPF]] as const) {
  describe(`retenção mensal — ${runtime}`, () => {
    it("escolhe o simplificado quando supera as deduções legais", () => {
      // Base: 5.200 − 607,20. Tabela: 357,89. Redução: 286,266.
      expect(calculate({ grossSalary: 5200, inss: 400, dependents: 0 })).toBe(71.62);
    });

    it("usa INSS + dependentes quando mais favoráveis, sem acumular regimes", () => {
      expect(calculate({ grossSalary: 5200, inss: 400, dependents: 2 })).toBe(32.93);
    });

    it("reproduz o exemplo mensal de R$ 6.000 da Receita Federal", () => {
      expect(calculate({ grossSalary: 6000, inss: 649.60, dependents: 0 })).toBe(382.88);
    });

    it("dispensa retenção residual logo acima do limite de renda", () => {
      const input = { grossSalary: 5000.55, inss: 392.67, dependents: 0 };
      expect(calculate({ ...input, applyMonthlyRules: false })).toBe(48.46);
      expect(calculate(input)).toBe(0);
    });

    it.each([[5027.94, 0], [5027.95, 10.01]])("aplica o limite inclusivo de retenção para renda %s", (grossSalary, expected) => {
      expect(calculate({ grossSalary, inss: 400, dependents: 0 })).toBe(expected);
    });

    it("mantém o tratamento dos fluxos separados já configurados sem redutor", () => {
      expect(calculate({ grossSalary: 2500, inss: 0, dependents: 0, applyRedutor: false })).toBe(5.34);
      expect(calculate({ grossSalary: 5000, inss: 500, dependents: 0, applyRedutor: false })).toBe(337.01);
    });
  });
}

it("considera salário, gratificação e horas extras sem modificar INSS/FGTS", () => {
  expect(computeCollaboratorTaxes({
    salary: 3609.85, inssProventos: 590.70, irpfProventos: 1390.70,
    faltaTotal: 0, dependents: 0,
  })).toEqual({ inss: 392.67, irpf: 0, fgts: 336.04 });
});

it("mantém paridade entre os cálculos mensal do frontend e da sincronização", () => {
  for (const grossSalary of [0, 3000, 5000, 5000.01, 5000.55, 5027.94, 5027.95, 5200, 6000, 7350, 8000]) {
    for (const inss of [0, 400, 650, 988.09]) {
      for (const dependents of [0, 1, 2, 5]) {
        expect(edgeCalcIRPF({ grossSalary, inss, dependents })).toBe(calcIRPF({ grossSalary, inss, dependents }));
      }
    }
  }
});
