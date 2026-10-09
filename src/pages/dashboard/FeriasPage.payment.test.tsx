import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VacationRequest } from "@/hooks/useVacations";
import FeriasPage from "./FeriasPage";

const state = vi.hoisted(() => ({ requests: [] as VacationRequest[], canEdit: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/contexts/DashboardContext", () => ({ useDashboard: () => ({
  currentCompany: { id: "company" }, user: { id: "user" }, hasAnyRole: () => true,
}) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canEdit: state.canEdit, isLoading: false }) }));
vi.mock("@/components/dashboard/PermissionGuard", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ferias/VacationRequestModal", () => ({ default: () => null }));
vi.mock("@/components/ferias/VacationCalendar", () => ({ default: () => null }));
vi.mock("@/modules/core/components/ferias/VacationBalanceBulkImportDialog", () => ({ VacationBalanceBulkImportDialog: () => null }));
vi.mock("@/modules/core/components/collaborators/VacationPeriodAdjustDialog", () => ({ VacationPeriodAdjustDialog: () => null }));
vi.mock("@/hooks/useVacations", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/useVacations")>(),
  useVacationRequests: () => ({ data: state.requests, isLoading: false }),
  useVacationPeriods: () => ({ data: [], isLoading: false }),
  useUpdateVacationRequest: () => ({}), useDeleteVacationRequest: () => ({}), useApproveVacationRequest: () => ({}),
}));

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["collaborators-vacation-overview", "company"], []);
  render(<QueryClientProvider client={client}><FeriasPage /></QueryClientProvider>);
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Solicitações/ }), { button: 0, ctrlKey: false });
}

beforeEach(() => {
  state.canEdit = true;
  state.requests = ["approved", "in_progress", "completed", "pending", "rejected", "cancelled"].map((status, i) => ({
    id: status, company_id: "company", collaborator_id: status, vacation_period_id: "period",
    start_date: "2026-10-01", end_date: "2026-10-30", days_count: 30, sell_days: 0,
    gratifications: 0, bonifications: 0, status, requested_by: "user", approved_by: null,
    approved_at: null, rejection_reason: null, notes: null, paid_at: null, paid_by: null,
    paid_value: i === 0 ? 0 : i === 1 ? 1234.56 : null,
    created_at: "2026-09-01", updated_at: "2026-09-01",
    collaborator: { id: status, name: `Teste ${status}`, position: null },
  }));
});
afterEach(() => { cleanup(); client?.clear(); });

describe("Férias — valor pago por solicitação", () => {
  it("mostra valores persistidos, inclusive zero, e oferece edição só após aprovação", () => {
    renderPage();
    for (const status of ["approved", "in_progress", "completed"]) {
      const row = within(screen.getByText(`Teste ${status}`).closest("tr")!);
      expect(row.getByRole("button", { name: /valor pago/ })).toBeInTheDocument();
    }
    for (const status of ["pending", "rejected", "cancelled"]) {
      const row = within(screen.getByText(`Teste ${status}`).closest("tr")!);
      expect(row.queryByRole("button", { name: /valor pago/ })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/R\$\s*0,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*1\.234,56/)).toBeInTheDocument();
    expect(screen.getAllByText("Não informado")).toHaveLength(4);
  });

  it("abre o formulário com o valor salvo da solicitação selecionada", () => {
    renderPage();
    const row = within(screen.getByText("Teste in_progress").closest("tr")!);
    fireEvent.click(row.getByRole("button", { name: "Editar valor pago" }));
    expect(screen.getByLabelText("Valor pago (R$)")).toHaveValue("1.234,56");
  });

  it("exibe o mesmo valor nos detalhes", () => {
    renderPage();
    const row = within(screen.getByText("Teste in_progress").closest("tr")!);
    fireEvent.click(row.getByRole("button", { name: "Ver detalhes da solicitação" }));
    expect(within(screen.getByRole("dialog")).getByText(/R\$\s*1\.234,56/)).toBeInTheDocument();
  });

  it("oculta a edição para usuários sem permissão de editar férias", () => {
    state.canEdit = false;
    renderPage();
    expect(screen.queryByRole("button", { name: /valor pago/ })).not.toBeInTheDocument();
  });
});
