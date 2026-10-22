import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { FunctionsHttpError } from "@supabase/supabase-js";
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

describe("erro ao salvar o cadastro", () => {
  it.each([403, 500])("mostra a mensagem da aplicação no HTTP %s sem expor detalhes do banco", async (status) => {
    setup();
    const message = status === 403
      ? "Sem permissão para editar colaboradores nesta empresa."
      : "Não foi possível salvar o cadastro.";
    const response = new Response(JSON.stringify({
      error: message, details: "Dado privado que não deve aparecer", sentPayload: { pix_key: "private@example.invalid" },
    }), { status });
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) });
    const { result } = renderHook(useUpdateCollaborator, { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({
        collaboratorId: "person", section: "identificacao", data: { pix_key: "new@example.invalid" },
      })).rejects.toThrow(message);
    });
    await waitFor(() => expect(result.current.error?.message).toBe(message));
    expect(response.bodyUsed).toBe(false);
    expect(client.getQueryState(linesKey)?.isInvalidated).toBe(false);
  });

  it("mantém o erro original se a resposta HTTP não contém JSON", async () => {
    setup();
    const error = new FunctionsHttpError(new Response("Bad Gateway", { status: 502 }));
    invoke.mockResolvedValue({ data: null, error });
    const { result } = renderHook(useUpdateCollaborator, { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({
        collaboratorId: "person", section: "identificacao", data: { pix_key: "new@example.invalid" },
      })).rejects.toThrow(error.message);
    });
  });
});
