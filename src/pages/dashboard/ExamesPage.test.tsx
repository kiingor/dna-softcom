import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExams, type OccupationalExam } from "@/hooks/useExams";
import ExamesPage from "./ExamesPage";

const { from, update, updateFilter, save, toastSuccess, toastError, exportPDF, exportExcel, permissions } = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  updateFilter: vi.fn(),
  save: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  exportPDF: vi.fn(),
  exportExcel: vi.fn(),
  permissions: { canView: true, canEdit: true, isLoading: false, isAdmin: false },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: { id: "company-id", company_name: "Empresa" } }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => permissions }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/examExportUtils", () => ({ exportExamsToPDF: exportPDF, exportExamsToExcel: exportExcel }));
vi.mock("@/components/exames/ExamRequestModal", () => ({ ExamRequestModal: () => null }));
vi.mock("@/components/exames/ExamUploadModal", () => ({ ExamUploadModal: () => null }));

const makeExam = (overrides: Partial<OccupationalExam> = {}): OccupationalExam => ({
  id: "exam-id",
  collaborator_id: "collaborator-id",
  company_id: "company-id",
  position_id: null,
  exam_type: "periodico",
  status: "vencido",
  due_date: "2026-05-01",
  scheduled_date: null,
  completed_date: null,
  risk_group_at_time: "GR1",
  notes: "Observação existente",
  created_by: null,
  auto_generated: true,
  previous_position_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  collaborator: { id: "collaborator-id", name: "Colaborador de teste", cpf: "", position: null },
  ...overrides,
});

let rows: OccupationalExam[];
let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<QueryClientProvider client={queryClient}><ExamesPage /></QueryClientProvider>);
  return { invalidate };
}

async function openDeadline() {
  fireEvent.click(await screen.findByRole("button", { name: "Alterar data limite de Colaborador de teste" }));
  return screen.getByLabelText("Nova data limite");
}

describe("alteração da data limite de exames periódicos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 15));
    permissions.canEdit = true;
    rows = [makeExam()];

    const updateQuery = { eq: updateFilter, select: () => ({ single: save }) };
    update.mockReturnValue(updateQuery);
    updateFilter.mockReturnValue(updateQuery);
    save.mockImplementation(async () => {
      const patch = update.mock.lastCall![0];
      rows = rows.map((exam) => exam.id === "exam-id" ? { ...exam, ...patch } : exam);
      return { data: { id: "exam-id" }, error: null };
    });
    from.mockImplementation((table: string) => {
      if (table === "exam_documents") {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null }),
        update,
      };
      return query;
    });
  });

  afterEach(() => {
    cleanup();
    queryClient?.clear();
    vi.useRealTimers();
  });

  it.each([
    { scheduled_date: null, status: "pendente", label: "Pendente" },
    { scheduled_date: "2026-09-16", status: "agendado", label: "Agendado" },
  ])("corrige um exame antigo e atualiza o status para $label", async ({ scheduled_date, status, label }) => {
    rows = [makeExam({ scheduled_date })];
    const { invalidate } = renderPage();
    const input = await openDeadline();

    expect(input).toHaveValue("01/05/2026");
    fireEvent.change(input, { target: { value: "30/09/2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar data limite" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(update).toHaveBeenCalledWith({ due_date: "2026-09-30", status });
    expect(updateFilter).toHaveBeenCalledWith("id", "exam-id");
    expect(updateFilter).toHaveBeenCalledWith("company_id", "company-id");
    const row = screen.getByRole("row", { name: /Colaborador de teste/ });
    expect(within(row).getByText("30/09/2026")).toBeInTheDocument();
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Vencidos").parentElement).toHaveTextContent("0Vencidos");
    expect(rows[0]).toMatchObject({ scheduled_date, completed_date: null, notes: "Observação existente" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collaborator-exams"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["subresource-exames"] });
  });

  it("altera pela aba Vencimentos e mantém um exame agendado no prazo até o fim de hoje", async () => {
    rows = [makeExam({ status: "agendado", scheduled_date: "2026-09-08" })];
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencimentos" }), { button: 0 });
    const input = await openDeadline();
    fireEvent.change(input, { target: { value: "08/09/2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar data limite" }));

    expect(await screen.findByText("Urgente (0d)")).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ due_date: "2026-09-08" });
    expect(screen.getByText("Vencidos").parentElement).toHaveTextContent("0Vencidos");
    expect(screen.getByText("Próx. 30 dias").parentElement).toHaveTextContent("1Próx. 30 dias");
    expect(rows[0]).toMatchObject({ status: "agendado", scheduled_date: "2026-09-08", completed_date: null });
  });

  it("impede datas inválidas e permite cancelar sem alterar o exame", async () => {
    renderPage();
    const input = await openDeadline();
    for (const value of ["", "10/09/", "31/02/2026"]) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole("button", { name: "Salvar data limite" })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("mantém a data preenchida e o vencimento anterior quando o salvamento falha", async () => {
    save.mockResolvedValue({ data: null, error: { message: "Não foi possível salvar" } });
    const { invalidate } = renderPage();
    const input = await openDeadline();
    fireEvent.change(input, { target: { value: "30/09/2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar data limite" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Erro ao atualizar exame: Não foi possível salvar"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(input).toHaveValue("30/09/2026");
    expect(rows[0].due_date).toBe("2026-05-01");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("exibe a ação apenas para exames periódicos abertos", async () => {
    rows = [
      makeExam(),
      ...["realizado", "cancelado", "arquivado"].map((status) => makeExam({ id: status, status })),
      makeExam({ id: "admissional", exam_type: "admissional" }),
    ];
    renderPage();
    await screen.findByRole("button", { name: "Alterar data limite de Colaborador de teste" });
    expect(screen.getAllByRole("button", { name: /Alterar data limite de/ })).toHaveLength(1);
    expect(screen.getByText("Vencidos").parentElement).toHaveTextContent("2Vencidos");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencimentos" }), { button: 0 });
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("respeita a permissão de edição", async () => {
    permissions.canEdit = false;
    renderPage();
    await screen.findByRole("row", { name: /Colaborador de teste/ });
    expect(screen.queryByRole("button", { name: /Alterar data limite de/ })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Vencimentos" }), { button: 0 });
    expect(screen.queryByRole("button", { name: /Alterar data limite de/ })).not.toBeInTheDocument();
  });

  it("exporta o filtro de vencidos usando o status calculado pela data limite", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    rows = [
      makeExam({ status: "pendente", due_date: "2026-09-07" }),
      makeExam({ id: "future", status: "pendente", due_date: "2026-10-01" }),
    ];
    renderPage();
    await screen.findAllByRole("row", { name: /Colaborador de teste/ });
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Vencido" }));
    fireEvent.click(screen.getByTitle("Exportar PDF"));
    expect(exportPDF).toHaveBeenCalledWith(expect.objectContaining({
      entries: [expect.objectContaining({ data_prev: "07/09/2026" })],
    }));
  });

  it.each(["PDF", "Excel", "Imprimir"])("exporta %s com os dados cadastrais e o último exame fora do período filtrado", async (type) => {
    const collaborator = {
      id: "collaborator-id", name: "Colaborador de teste", cpf: "001.234.567-89", position: "Implantador",
      contracted_store: { store_name: "Unidade contratante" }, internal_location: "Externo",
      rg: "1234567", rg_issuer: "SSP/PB", gender: "M", birth_date: "1995-02-12",
    };
    rows = [
      makeExam({ collaborator, due_date: "2026-09-01" }),
      makeExam({ id: "previous", collaborator, status: "realizado", due_date: "2025-09-03", completed_date: "2025-09-03" }),
    ];
    renderPage();
    await screen.findAllByRole("row", { name: /Colaborador de teste/ });
    fireEvent.change(screen.getByLabelText("Data limite a partir de"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByTitle(type === "Imprimir" ? type : `Exportar ${type}`));

    expect(type === "Excel" ? exportExcel : exportPDF).toHaveBeenCalledWith({
      companyName: "Empresa",
      entries: [{
        NomeCompleto: "COLABORADOR DE TESTE", cnpj_cont: "UNIDADE CONTRATANTE", exame: "PERIODICO",
        funcao: "IMPLANTADOR", Setor: "EXTERNO", cpf: "00123456789", rg: "1234567 SSP/PB",
        Sexo: "M", data_nasc: "12/02/1995", data_prev: "01/09/2026", ult_exame: "03/09/2025",
      }],
    });
  });

  it("carrega todo o histórico quando os exames ultrapassam uma página da API", async () => {
    rows = Array.from({ length: 1001 }, (_, index) => makeExam({ id: `exam-${index}` }));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useExams(), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.exams).toEqual(rows);
    expect(from).toHaveBeenCalledTimes(3);
  });
});
