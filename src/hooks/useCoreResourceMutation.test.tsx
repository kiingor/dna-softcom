import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCoreResourceMutation } from "./useCoreResourceMutation";

const { invoke, toastSuccess } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: { id: "company-1" } }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useCoreResourceMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({ data: { success: true }, error: null });
  });

  it("envia syncToRemote:false quando a chamada pede exclusão só no DNA", async () => {
    const { result } = renderHook(() => useCoreResourceMutation("teams"), { wrapper });

    result.current.mutate({ action: "delete", id: "team-1", syncToRemote: false });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Setor removido."));
    expect(invoke).toHaveBeenCalledWith("core-resource-mutate", {
      body: {
        resource: "teams",
        action: "delete",
        companyId: "company-1",
        id: "team-1",
        data: undefined,
        syncToRemote: false,
      },
    });
  });

  it("mantém a opção do hook quando a chamada não sobrescreve", async () => {
    const { result } = renderHook(
      () => useCoreResourceMutation("positions", { syncToRemote: false }),
      { wrapper },
    );

    result.current.mutate({ action: "create", data: { name: "Analista" } });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Cargo criado ✓"));
    expect(invoke.mock.calls[0][1].body.syncToRemote).toBe(false);
  });

  it("concorda o gênero do aviso com o cadastro", async () => {
    const { result } = renderHook(() => useCoreResourceMutation("stores"), { wrapper });

    result.current.mutate({ action: "update", id: "store-1", data: { store_name: "Matriz" } });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Empresa atualizada ✓"));
    expect(invoke.mock.calls[0][1].body.syncToRemote).toBe(true);
  });
});
