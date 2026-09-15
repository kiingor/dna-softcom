import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { exportExamsToExcel, exportExamsToPDF } from "./examExportUtils";
import type { ExamExportData } from "./examExportData";

const { writeFile, autoTable, save } = vi.hoisted(() => ({
  writeFile: vi.fn(), autoTable: vi.fn(), save: vi.fn(),
}));
vi.mock("xlsx", async (importOriginal) => ({ ...await importOriginal<typeof XLSX>(), writeFile }));
vi.mock("jspdf-autotable", () => ({ default: autoTable }));
vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 297 } };
    setFontSize() {}
    setFont() {}
    text() {}
    setLineWidth() {}
    line() {}
    save = save;
  },
}));

const headers = ["NomeCompleto", "cnpj_cont", "exame", "funcao", "Setor", "cpf", "rg", "Sexo", "data_nasc", "data_prev", "ult_exame"];
const data: ExamExportData = {
  companyName: "Empresa de teste",
  entries: [{
    NomeCompleto: "PESSOA DE TESTE", cnpj_cont: "UNIDADE", exame: "PERIODICO",
    funcao: "IMPLANTADOR", Setor: "EXTERNO", cpf: "00123456789", rg: "1234567 SSP/PB",
    Sexo: "M", data_nasc: "12/02/1995", data_prev: "01/09/2026", ult_exame: "03/09/2025",
  }],
};

describe("arquivos de exportação de exames", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gera um XLSX com cabeçalhos na primeira linha e CPF como texto, inclusive após reabrir", () => {
    exportExamsToExcel(data);
    const workbook = writeFile.mock.calls[0][0] as XLSX.WorkBook;
    const reopened = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
    const sheet = reopened.Sheets.Exames;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      headers,
      ["PESSOA DE TESTE", "UNIDADE", "PERIODICO", "IMPLANTADOR", "EXTERNO", "00123456789", "1234567 SSP/PB", "M", "12/02/1995", "01/09/2026", "03/09/2025"],
    ]);
    expect(sheet.F2).toMatchObject({ t: "s", v: "00123456789" });
    expect(sheet["!ref"]).toBe("A1:K2");
    expect(writeFile.mock.calls[0][1]).toMatch(/^exames_ocupacionais_.*\.xlsx$/);
  });

  it("gera PDF com os mesmos campos e na mesma ordem do Excel", async () => {
    await exportExamsToPDF(data);
    expect(autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      head: [headers],
      body: [["PESSOA DE TESTE", "UNIDADE", "PERIODICO", "IMPLANTADOR", "EXTERNO", "00123456789", "1234567 SSP/PB", "M", "12/02/1995", "01/09/2026", "03/09/2025"]],
    }));
    expect(save).toHaveBeenCalledWith(expect.stringMatching(/^exames_ocupacionais_.*\.pdf$/));
  });

  it("mantém os 11 cabeçalhos quando o filtro não tem resultados", () => {
    exportExamsToExcel({ ...data, entries: [] });
    const sheet = (writeFile.mock.calls[0][0] as XLSX.WorkBook).Sheets.Exames;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([headers]);
  });
});
