import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VacationRequest } from "@/hooks/useVacations";
import { VacationPaymentDialog } from "./VacationPaymentDialog";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), update: vi.fn(), eq: vi.fn(), in: vi.fn(), select: vi.fn(), single: vi.fn(),
  success: vi.fn(), canEdit: true, companyId: "company", userId: "user", hasRole: true,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/contexts/DashboardContext", () => ({ useDashboard: () => ({
  currentCompany: { id: mocks.companyId }, user: { id: mocks.userId }, hasAnyRole: () => mocks.hasRole,
}) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canEdit: mocks.canEdit, isLoading: false }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));

const request = {
  id: "request", collaborator_id: "collaborator", company_id: "company", status: "approved",
  paid_value: null, paid_at: null, paid_by: null, collaborator: { id: "collaborator", name: "Colaborador de teste", position: null },
} as VacationRequest;
let client: QueryClient;
const onClose = vi.fn();

function renderDialog(paidValue: number | null = null) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <VacationPaymentDialog request={{ ...request, paid_value: paidValue }} onClose={onClose} />
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canEdit = true;
  mocks.hasRole = true;
  mocks.companyId = "company";
  mocks.userId = "user";
  const query = { update: mocks.update, eq: mocks.eq, in: mocks.in, select: mocks.select, single: mocks.single };
  for (const fn of [mocks.from, mocks.update, mocks.eq, mocks.in, mocks.select]) fn.mockReturnValue(query);
  mocks.single.mockResolvedValue({ data: { id: "request", collaborator_id: "collaborator", paid_value: 1234.56, paid_by: "user" }, error: null });
});
afterEach(() => { cleanup(); client?.clear(); });

describe("registrar valor pago — formulário e gravação", () => {
  it("salva centavos na solicitação e empresa certas e atualiza as consultas", async () => {
    renderDialog();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByLabelText("Valor pago (R$)"), { target: { value: "1.234,56" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.from).toHaveBeenCalledWith("vacation_requests");
    expect(mocks.update).toHaveBeenCalledWith({ paid_value: 1234.56, paid_by: "user" });
    expect(mocks.eq).toHaveBeenCalledWith("id", "request");
    expect(mocks.eq).toHaveBeenCalledWith("company_id", "company");
    expect(mocks.in).toHaveBeenCalledWith("status", ["approved", "in_progress", "completed"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vacation-requests"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vacation-requests-collaborator", "collaborator"] });
    expect(mocks.success).toHaveBeenCalledWith("Valor pago salvo.");
  });

  it("reabre com o valor salvo e permite corrigir para zero sem confundir com ausência", async () => {
    renderDialog(1234.56);
    expect(screen.getByLabelText("Valor pago (R$)")).toHaveValue("1.234,56");
    expect(screen.getByRole("heading", { name: "Editar valor pago" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Valor pago (R$)"), { target: { value: "0,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ paid_value: 0, paid_by: "user" }));
  });

  it.each(["", "-1,00", "1,234"])("mantém o formulário e não grava entrada inválida: %s", async (value) => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Valor pago (R$)"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByLabelText("Valor pago (R$)")).toHaveAttribute("aria-invalid", "true"));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("preserva o valor digitado e permite tentar de novo após falha", async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Valor pago (R$)"), { target: { value: "1.234,56" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar");
    expect(screen.getByLabelText("Valor pago (R$)")).toHaveValue("1.234,56");
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it.each(["permission", "company", "role", "session"])("bloqueia gravação sem contexto autorizado: %s", async (caseName) => {
    if (caseName === "permission") mocks.canEdit = false;
    if (caseName === "company") mocks.companyId = "other-company";
    if (caseName === "role") mocks.hasRole = false;
    if (caseName === "session") mocks.userId = "";
    renderDialog();
    fireEvent.change(screen.getByLabelText("Valor pago (R$)"), { target: { value: "10,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancelar fecha sem salvar", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
