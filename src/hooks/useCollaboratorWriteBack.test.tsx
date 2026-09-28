import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUpdateCollaborator } from "./useCollaboratorWriteBack";
import { usePixPayment } from "@/modules/payroll/hooks/use-pix-payment";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

let client: QueryClient;
const entriesKey = ["payroll-entries", "period"];
const linesKey = ["payroll-payable-lines", "period", "aprovado_diretoria"];
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function setup() {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(entriesKey, []);
  client.setQueryData(linesKey, []);
  invoke.mockResolvedValue({ data: { success: true }, error: null });
}
afterEach(() => { cleanup(); client?.clear(); vi.clearAllMocks(); });

describe("cache da folha após correção de PIX", () => {
  it("salvar o cadastro invalida tanto a folha aberta quanto os pagamentos aprovados", async () => {
    setup();
    const { result } = renderHook(useUpdateCollaborator, { wrapper });
    await act(() => result.current.mutateAsync({
      collaboratorId: "person", section: "identificacao", data: { pix_key: "new@example.invalid" },
    }));
    expect(client.getQueryState(entriesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(linesKey)?.isInvalidated).toBe(true);
  });

  it("cancelar uma tentativa consulta novamente a chave liberada no servidor", async () => {
    setup();
    const { result } = renderHook(() => usePixPayment("period"), { wrapper });
    await act(() => result.current.cancel.mutateAsync("entry"));
    expect(client.getQueryState(linesKey)?.isInvalidated).toBe(true);
    expect(invoke).toHaveBeenCalledWith("payroll-pix-pay", { body: { entry_id: "entry", action: "cancel" } });
  });
});
