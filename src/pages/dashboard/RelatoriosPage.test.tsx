import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RelatoriosPage from "./RelatoriosPage";

const { exportToExcel, exportToPDF, from } = vi.hoisted(() => ({
  exportToExcel: vi.fn(), exportToPDF: vi.fn(), from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: { id: "company", company_name: "Empresa teste" }, hasAnyRole: () => false }),
}));
vi.mock("@/hooks/useClosedPeriods", () => ({ useClosedPeriods: () => ({ isPeriodClosed: () => false }) }));
vi.mock("@/components/dashboard/PermissionGuard", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/payslipPdfGenerator", () => ({ generatePayslipPDF: vi.fn(), convertEntriesToPayslipData: vi.fn() }));
vi.mock("jspdf", () => ({ default: vi.fn() }));
vi.mock("@/lib/exportUtils", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/exportUtils")>(), exportToExcel, exportToPDF,
}));

const stores = [{ id: "jp", store_name: "João Pessoa" }, { id: "nt", store_name: "Natal" }];
const entries = [
  { id: "e1", collaborator_id: "ana", collaborator: { id: "ana", name: "Ana", store_id: "nt" }, store_id: "jp", type: "salario_base", value: 1000 },
  { id: "e2", collaborator_id: "ana", collaborator: { id: "ana", name: "Ana", store_id: "nt" }, store_id: "jp", type: "gratificacao", value: 200 },
  { id: "e3", collaborator_id: "bruno", collaborator: { id: "bruno", name: "Bruno", store_id: "nt" }, store_id: null, type: "salario_base", value: 2000 },
  { id: "e4", collaborator_id: "carla", collaborator: null, store_id: null, type: "salario_base", value: 500 },
];

let client: QueryClient;
function renderReport() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const now = new Date();
  client.setQueryData(["company-details", "company"], { company_name: "Empresa teste" });
  client.setQueryData(["collaborators-with-details", "company"], []);
  client.setQueryData(["collaborators-filter", "company"], [{ id: "ana", name: "Ana" }, { id: "bruno", name: "Bruno" }]);
  client.setQueryData(["stores-filter", "company"], stores);
  client.setQueryData(["payroll-entries-report", "company", now.getMonth() + 1, now.getFullYear()], entries);
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  client.setQueryData(["payroll-entries-report", "company", previous.getMonth() + 1, previous.getFullYear()], []);
  render(<QueryClientProvider client={client}><RelatoriosPage /></QueryClientProvider>);
}

async function selectFilter(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("Relatórios — resumo por PDV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { cleanup(); client?.clear(); });

  it("mostra todos os PDVs na mesma tabela e exporta os mesmos totais", () => {
    renderReport();
    const table = screen.getByRole("table", { name: "Resumo da folha por PDV" });
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["João Pessoa", "Natal", "Sem PDV", "Total geral"]);
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["PDV", "Salário base", "FGTS", "Agregado", "Custo setor", "Gratificação", "Líquido", "Custo total"]);
    expect(within(table).getByRole("row", { name: /João Pessoa/ })).toHaveTextContent("1.200,00");

    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(exportToExcel.mock.calls[0][0].storeSummary.totals).toMatchObject({ earnings: 3700, net: 3700 });
    expect(from).not.toHaveBeenCalled();
  });

  it("filtra pelo PDV do lançamento e aplica o mesmo recorte ao PDF", async () => {
    renderReport();
    await selectFilter("Filtrar por PDV", "João Pessoa");
    const table = screen.getByRole("table", { name: "Resumo da folha por PDV" });
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["João Pessoa", "Total geral"]);
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(exportToPDF.mock.calls[0][0]).toMatchObject({
      grandTotal: 1200,
      storeSummary: { rows: [expect.objectContaining({ storeId: "jp", net: 1200 })] },
    });
    expect(exportToPDF.mock.calls[0][0].entries).toHaveLength(2);
  });

  it("combina filtros de colaborador e PDV, inclusive o grupo Sem PDV", async () => {
    renderReport();
    await selectFilter("Filtrar por PDV", "Sem PDV");
    expect(screen.getByRole("table")).toHaveTextContent("500,00");
    await selectFilter("Filtrar por colaborador", "Ana");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/Nenhum lançamento encontrado para esta competência e os filtros/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel" })).toBeDisabled();
    await selectFilter("Filtrar por PDV", "Todos os PDVs");
    expect(screen.getByRole("table")).toHaveTextContent("João Pessoa");
    expect(screen.getByRole("table")).not.toHaveTextContent("Natal");
  });

  it("atualiza o resumo ao navegar para uma competência sem lançamentos", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Competência anterior" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Próxima competência" }));
    expect(screen.getByRole("table")).toHaveTextContent("João Pessoa");
  });
});
