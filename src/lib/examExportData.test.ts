import { describe, expect, it } from "vitest";
import type { OccupationalExam } from "@/hooks/useExams";
import { buildExamExportRows } from "./examExportData";

const exam = (overrides: Partial<OccupationalExam> = {}): OccupationalExam => ({
  id: "current",
  collaborator_id: "collaborator",
  company_id: "company",
  position_id: null,
  exam_type: "periodico",
  status: "pendente",
  due_date: "2026-09-01",
  scheduled_date: "2026-09-08",
  completed_date: null,
  risk_group_at_time: null,
  notes: null,
  created_by: null,
  auto_generated: false,
  previous_position_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  collaborator: {
    id: "collaborator",
    name: "Pessoa de teste",
    cpf: "001.234.567-89",
    position: "Cargo antigo",
    job_position: { name: "Implantador de software pleno nível 2" },
    internal_location: "Externo",
    contracted_store: { store_name: "Unidade contratante" },
    store: { store_name: "Unidade de trabalho" },
    rg: "1234567",
    rg_issuer: "SSP/PB",
    gender: "M",
    birth_date: "1995-02-12",
  },
  ...overrides,
});

describe("modelo de exames de Segurança do Trabalho", () => {
  it("monta as 11 colunas do modelo com dados cadastrais e datas sem deslocamento", () => {
    const current = exam();
    const previous = exam({ id: "previous", status: "realizado", completed_date: "2025-09-03" });

    expect(buildExamExportRows([current], [current, previous])).toEqual([{
      NomeCompleto: "PESSOA DE TESTE",
      cnpj_cont: "UNIDADE CONTRATANTE",
      exame: "PERIODICO",
      funcao: "IMPLANTADOR DE SOFTWARE PLENO NÍVEL 2",
      Setor: "EXTERNO",
      cpf: "00123456789",
      rg: "1234567 SSP/PB",
      Sexo: "M",
      data_nasc: "12/02/1995",
      data_prev: "01/09/2026",
      ult_exame: "03/09/2025",
    }]);
  });

  it("busca o último realizado da mesma pessoa e empresa fora do filtro e em histórico desordenado", () => {
    const current = exam();
    const completed = { status: "realizado", completed_date: "2025-09-03" };
    const history = [
      exam({ id: "latest", ...completed }),
      exam({ id: "older", ...completed, completed_date: "2024-09-03" }),
      exam({ id: "other-person", ...completed, collaborator_id: "other", completed_date: "2026-08-01" }),
      exam({ id: "other-company", ...completed, company_id: "other", completed_date: "2026-08-01" }),
      exam({ id: "cancelled", completed_date: "2026-08-01", status: "cancelado" }),
      exam({ id: "pending", completed_date: "2026-08-01" }),
      exam({ id: "missing-date", status: "realizado" }),
      exam({ id: "future", ...completed, completed_date: "2027-01-01" }),
    ];
    expect(buildExamExportRows([current], history)[0].ult_exame).toBe("03/09/2025");
  });

  it("não usa o próprio exame nem realizações posteriores em uma linha histórica", () => {
    const current = exam({ status: "realizado", completed_date: "2026-08-25" });
    const previous = exam({ id: "previous", status: "realizado", completed_date: "2025-09-03" });
    const later = exam({ id: "later", status: "realizado", completed_date: "2026-08-26" });
    expect(buildExamExportRows([current], [current, previous, later])[0].ult_exame).toBe("03/09/2025");
  });

  it("mantém vazios os dados ausentes sem inventar datas ou documentos", () => {
    const current = exam({ collaborator: undefined });
    expect(buildExamExportRows([current])[0]).toEqual({
      NomeCompleto: "", cnpj_cont: "", exame: "PERIODICO", funcao: "", Setor: "",
      cpf: "", rg: "", Sexo: "", data_nasc: "", data_prev: "01/09/2026", ult_exame: "",
    });
  });

  it("usa o cargo do exame e evita repetir o órgão emissor já presente no RG", () => {
    const current = exam();
    current.position = { id: "position", name: "Cargo do exame", risk_group: null };
    current.collaborator.rg = "1234567 SSP/PB";
    current.collaborator.contracted_store = null;
    expect(buildExamExportRows([current])[0]).toMatchObject({
      funcao: "CARGO DO EXAME", rg: "1234567 SSP/PB", cnpj_cont: "UNIDADE DE TRABALHO",
    });
  });

  it("aceita o cargo em texto e dados opcionais nulos", () => {
    const current = exam();
    current.collaborator = {
      id: "collaborator", name: "Teste", cpf: null, position: "Cargo em texto",
      job_position: null, rg: null, rg_issuer: "SSP", birth_date: null, gender: null,
    };
    expect(buildExamExportRows([current])[0]).toMatchObject({
      funcao: "CARGO EM TEXTO", cpf: "", rg: "", data_nasc: "", Sexo: "",
    });
  });
});
