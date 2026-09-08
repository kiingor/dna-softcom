import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { exportToExcel, exportToPDF } from "./exportUtils";
import { buildStorePayrollSummary } from "@/modules/payroll/lib/buildStorePayrollSummary";
import { formatCurrency } from "./formatters";

const { writeFile, autoTable, pdfSave, pdfOptions } = vi.hoisted(() => ({
  writeFile: vi.fn(), autoTable: vi.fn(), pdfSave: vi.fn(), pdfOptions: vi.fn(),
}));

vi.mock("xlsx", async (importOriginal) => ({ ...await importOriginal<typeof XLSX>(), writeFile }));
vi.mock("jspdf-autotable", () => ({ default: autoTable }));
vi.mock("jspdf", () => ({
  default: class {
    constructor(options: unknown) { pdfOptions(options); }
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    lastAutoTable = { finalY: 90 };
    setFontSize() {}
    setFont() {}
    text() {}
    setLineWidth() {}
    line() {}
    addPage() {}
    save = pdfSave;
  },
}));

const entries = [
  { collaborator_name: "Ana", store_id: "jp", type: "salario_base", value: 1000 },
  { collaborator_name: "Ana", store_id: "jp", type: "fgts", value: 80 },
  { collaborator_name: "Ana", store_id: "jp", type: "gratificacao", value: 200 },
  { collaborator_name: "Ana", store_id: "jp", type: "bonificacao", value: 50 },
  { collaborator_name: "Ana", store_id: "jp", type: "inss", value: 100 },
  { collaborator_name: "Ana", store_id: "jp", type: "emprestimo", value: 50 },
  { collaborator_name: "Bruno", store_id: "nt", type: "salario_base", value: 2000 },
  { collaborator_name: "Bruno", store_id: "nt", type: "fgts", value: 160 },
  { collaborator_name: "Bruno", store_id: "nt", type: "carro_agregado", value: 300 },
];
const data = {
  companyName: "Empresa teste",
  period: "Setembro/2026",
  entries,
  totals: [],
  grandTotal: 3400,
  storeSummary: buildStorePayrollSummary(entries, [
    { id: "jp", store_name: "João Pessoa" }, { id: "nt", store_name: "Natal" },
  ]),
};

describe("exportação do resumo por PDV", () => {
  beforeEach(() => vi.clearAllMocks());

  it("abre o Excel no resumo e mantém valores numéricos, descontos negativos e totais corretos", () => {
    exportToExcel(data);

    const workbook = writeFile.mock.calls[0][0] as XLSX.WorkBook;
    expect(workbook.SheetNames).toEqual(["Resumo por PDV", "Relatório"]);
    const sheet = workbook.Sheets["Resumo por PDV"];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(rows[5]).toEqual(["PDV", "Salário base", "FGTS", "Agregado", "Custo setor", "Gratificação", "Empréstimo", "INSS", "Líquido", "Custo total"]);
    expect(rows[6]).toEqual(["João Pessoa", 1000, 80, 0, 50, 200, -50, -100, 1100, 1330]);
    expect(rows[7]).toEqual(["Natal", 2000, 160, 300, 0, 0, 0, 0, 2300, 2460]);
    expect(rows[8]).toEqual(["Total geral", 3000, 240, 300, 50, 200, -50, -100, 3400, 3790]);
    expect(sheet.B7).toMatchObject({ t: "n", v: 1000, z: expect.stringContaining("R$") });
    expect(sheet.J9).toMatchObject({ t: "n", v: 3790, z: expect.stringContaining("R$") });
  });

  it("começa o PDF com o mesmo resumo e usa os mesmos totais nos extratos", async () => {
    await exportToPDF(data);

    expect(pdfOptions).toHaveBeenCalledWith({ orientation: "landscape" });
    const summary = autoTable.mock.calls[0][1];
    expect(summary.head[0]).toEqual(["PDV", "Salário base", "FGTS", "Agregado", "Custo setor", "Gratificação", "Empréstimo", "INSS", "Líquido", "Custo total"]);
    expect(summary.body[0]).toEqual(["João Pessoa", ...[1000, 80, 0, 50, 200, -50, -100, 1100, 1330].map(formatCurrency)]);
    expect(summary.foot[0]).toEqual(["Total geral", ...[3000, 240, 300, 50, 200, -50, -100, 3400, 3790].map(formatCurrency)]);
    expect(summary).toMatchObject({ horizontalPageBreak: true, horizontalPageBreakRepeat: 0 });
    expect(autoTable.mock.calls[3][1].body[0]).toEqual([3550, 150, 3400, 240, 3790].map(formatCurrency));
    expect(pdfSave).toHaveBeenCalledWith("relatorio_folha_Setembro_2026.pdf");
  });

  it("continua exportando o relatório quando não recebe resumo por PDV", () => {
    exportToExcel({ ...data, storeSummary: undefined });
    expect((writeFile.mock.calls[0][0] as XLSX.WorkBook).SheetNames).toEqual(["Relatório"]);
  });
});
