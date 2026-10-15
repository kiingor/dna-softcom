import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import FeriasPage from "./FeriasPage";

const mockHasAnyRole = vi.fn(() => false);
const mockUsePermissions = vi.fn(() => ({
  canView: true,
  canCreate: false,
  canEdit: true,
  canDelete: false,
  isLoading: false,
  isCompanyAdmin: false,
}));

vi.mock("@/components/dashboard/PermissionGuard", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({
    user: { id: "user-1" },
    currentCompany: { id: "company-1", name: "Softcom" },
    hasAnyRole: mockHasAnyRole,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                {
                  id: "collab-1",
                  name: "Ana Teste",
                  position: "Analista",
                  admission_date: "2024-02-01",
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/components/ferias/VacationRequestModal", () => ({
  default: () => null,
}));

vi.mock("@/components/ferias/VacationCalendar", () => ({
  default: () => null,
}));

vi.mock("@/modules/core/components/ferias/VacationBalanceBulkImportDialog", () => ({
  VacationBalanceBulkImportDialog: () => null,
}));

vi.mock("@/modules/ferias/components/VacationPaymentDialog", () => ({
  VacationPaymentDialog: () => null,
}));

vi.mock("@/modules/core/components/collaborators/VacationPeriodAdjustDialog", () => ({
  VacationPeriodAdjustDialog: ({
    open,
    period,
  }: {
    open: boolean;
    period: { id: string } | null;
  }) =>
    open && period ? (
      <div data-testid="vacation-adjust-dialog">Editando período {period.id}</div>
    ) : null,
}));

vi.mock("@/hooks/useVacations", () => ({
  vacationRequestStatusLabels: {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Recusada",
    in_progress: "Em Gozo",
    completed: "Concluída",
    cancelled: "Cancelada",
  },
  vacationRequestStatusColors: {
    pending: "",
    approved: "",
    rejected: "",
    in_progress: "",
    completed: "",
    cancelled: "",
  },
  vacationPeriodStatusLabels: {
    pending: "Adquirindo",
    available: "Disponível",
    partially_used: "Parcialmente usado",
    used: "Utilizado",
    paid: "Pago",
    expired: "Vencido",
  },
  vacationPeriodStatusColors: {
    pending: "",
    available: "",
    partially_used: "",
    used: "",
    paid: "",
    expired: "",
  },
  useVacationPeriods: () => ({
    isLoading: false,
    data: [
      {
        id: "period-legacy",
        collaborator_id: "collab-1",
        company_id: "company-1",
        start_date: "2024-02-01",
        end_date: "20236-01-31",
        gozo_start_date: "2025-01-01",
        gozo_end_date: "20236-01-31",
        data_limite: "20236-01-31",
        days_entitled: 30,
        days_taken: 30,
        days_sold: 0,
        days_remaining: 0,
        status: "paid",
        created_at: "2026-01-01T00:00:00Z",
        collaborator: {
          id: "collab-1",
          name: "Ana Teste",
          position: "Analista",
          admission_date: "2024-02-01",
        },
      },
    ],
  }),
  useVacationRequests: () => ({
    isLoading: false,
    data: [
      {
        id: "request-invalid-date",
        collaborator_id: "collab-1",
        company_id: "company-1",
        vacation_period_id: "period-legacy",
        start_date: "2025-01-01",
        end_date: "20236-01-31",
        days_count: 30,
        sell_days: 0,
        status: "pending",
        requested_by: null,
        approved_by: null,
        approved_at: null,
        rejection_reason: null,
        notes: null,
        paid_value: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        collaborator: {
          id: "collab-1",
          name: "Ana Teste",
          position: "Analista",
          admission_date: "2024-02-01",
        },
      },
    ],
  }),
  useUpdateVacationRequest: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteVacationRequest: () => ({ isPending: false, mutate: vi.fn() }),
  useApproveVacationRequest: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe("FeriasPage", () => {
  it("renderiza datas legadas inválidas sem quebrar a página", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <FeriasPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Gerencie solicitações de férias dos colaboradores")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Ana Teste").length).toBeGreaterThan(0);
    });
  });

  it("habilita a ação de editar período para usuário com permissão granular e período pago/utilizado", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <FeriasPage />
      </QueryClientProvider>,
    );

    const actionsButton = await screen.findByRole("button", { name: "Ações para Ana Teste" });
    expect(actionsButton).not.toBeDisabled();

    // Abre a aba Períodos Aquisitivos e clica no botão de editar período
    const periodsTab = screen.getByRole("tab", { name: /Períodos Aquisitivos/i });
    fireEvent.mouseDown(periodsTab);
    fireEvent.click(periodsTab);

    const editPeriodButton = await screen.findByTitle("Editar período aquisitivo");
    expect(editPeriodButton).not.toBeDisabled();

    fireEvent.click(editPeriodButton);
    expect(screen.getByTestId("vacation-adjust-dialog")).toHaveTextContent(
      "Editando período period-legacy",
    );
  });
});
