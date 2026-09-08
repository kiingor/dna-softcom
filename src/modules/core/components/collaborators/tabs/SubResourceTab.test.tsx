import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubResourceTab } from "./SubResourceTab";
import { FERIAS_FIELDS } from "../vacation-period-fields";

const { invoke, from, toastSuccess, toastError } = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, functions: { invoke } },
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const dates = { start_date: "2025-09-01", end_date: "2026-08-31" };

async function openVacationForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <SubResourceTab
        kind="ferias"
        collaboratorId="collaborator-id"
        table="vacation_periods"
        titleSingular="Férias"
        icon={null}
        emptyTitle="Sem períodos de férias"
        emptyDescription="Nenhum período de férias registrado."
        fields={FERIAS_FIELDS}
        renderRow={(row) => ({ title: row.id })}
        canManage
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Novo férias" }));
  fireEvent.change(screen.getByLabelText(/Início da competência/), {
    target: { value: dates.start_date },
  });
  fireEvent.change(screen.getByLabelText(/Fim da competência/), {
    target: { value: dates.end_date },
  });
  return { queryClient, invalidate };
}

describe("lançamento manual de férias no cadastro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let rows: { id: string }[] = [];
    from.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }),
    });
    invoke.mockImplementation(async () => {
      rows = [{ id: "period-id" }];
      return { data: { success: true, localId: "period-id" }, error: null };
    });
  });

  afterEach(cleanup);

  it("salva preenchendo apenas as datas e atualiza as listas de férias", async () => {
    const { invalidate } = await openVacationForm();

    expect(screen.getByLabelText("Dias de direito")).toHaveValue(30);
    expect(screen.getByLabelText("Dias gozados")).toHaveValue(0);
    expect(screen.getByLabelText("Dias vendidos")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Férias criado."));
    expect(invoke).toHaveBeenCalledWith("collaborator-subresource", {
      body: {
        action: "create",
        kind: "ferias",
        collaboratorId: "collaborator-id",
        data: { ...dates, days_entitled: 30, days_taken: 0, days_sold: 0 },
      },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["subresource-ferias", "collaborator-id"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vacation-periods"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vacation-periods-collaborator"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("period-id")).toBeInTheDocument();
  });

  it("usa os padrões também quando o usuário apaga os campos numéricos", async () => {
    await openVacationForm();
    for (const label of ["Dias de direito", "Dias gozados", "Dias vendidos"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "5" } });
      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][1].body.data).toEqual({
      ...dates, days_entitled: 30, days_taken: 0, days_sold: 0,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("preserva os dias informados pelo usuário", async () => {
    await openVacationForm();
    fireEvent.change(screen.getByLabelText("Dias de direito"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Dias gozados"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Dias vendidos"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][1].body.data).toEqual({
      ...dates, days_entitled: 20, days_taken: 10, days_sold: 5,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("mostra a mensagem do servidor e mantém os dados para corrigir uma falha", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({
        error: "A soma dos dias gozados e vendidos excede os dias de direito.",
      }), { status: 400 })),
    });
    const { invalidate } = await openVacationForm();
    fireEvent.change(screen.getByLabelText("Dias gozados"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "Erro: A soma dos dias gozados e vendidos excede os dias de direito.",
    ));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Dias gozados")).toHaveValue(40);
    expect(screen.getByLabelText(/Início da competência/)).toHaveValue(dates.start_date);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("mantém o tratamento de erro quando o servidor não retorna JSON", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response("Bad Gateway", { status: 502 })),
    });
    await openVacationForm();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "Erro: Edge Function returned a non-2xx status code",
    ));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
