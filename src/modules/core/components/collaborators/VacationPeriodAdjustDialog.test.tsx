import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { VacationPeriodAdjustDialog } from "./VacationPeriodAdjustDialog";

const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("VacationPeriodAdjustDialog", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: { id: "period-1" }, error: null });
  });

  it("higieniza datas legadas inválidas (ex.: ano com 5 dígitos) ao abrir e permite salvar a edição", async () => {
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <VacationPeriodAdjustDialog
          open={true}
          onOpenChange={onOpenChange}
          period={{
            id: "period-1",
            collaborator_id: "collab-1",
            start_date: "2024-02-01",
            end_date: "2025-01-31",
            gozo_start_date: null,
            // Data legada corrompida que antes virava "20236-01-3" e travava gozoIncompleto
            gozo_end_date: "20236-01-31",
            data_limite: "20236-01-31",
            days_entitled: 30,
            days_taken: 15,
            days_sold: 0,
            days_remaining: 15,
            status: "paid",
            manual_adjustment_notes: "Ajuste anterior",
          }}
        />
      </QueryClientProvider>,
    );

    const saveButton = screen.getByRole("button", { name: /Salvar/i });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("edit_vacation_period_manual", {
        _period_id: "period-1",
        _start_date: "2024-02-01",
        _end_date: "2025-01-31",
        _days_entitled: 30,
        _days_taken: 15,
        _days_sold: 0,
        _status: "released",
        _gozo_start_date: null,
        _gozo_end_date: null,
        _data_limite: null,
        _notes: "Ajuste anterior",
      });
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
