import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsTab } from "./PaymentsTab";
import type { PayrollEntryWithCollaborator } from "../types";
import type { FrozenPaymentLine } from "../lib/buildPaymentLines";

const { from, transfers } = vi.hoisted(() => ({ from: vi.fn(), transfers: [] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: { id: "company" }, hasAnyRole: () => true }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canCreate: true }) }));
vi.mock("../hooks/use-pix-payment", () => ({
  usePixTransfers: () => ({ data: transfers }),
  usePixPayment: () => ({ checkNow: {}, cancel: {} }),
  useVoucher: () => ({}),
}));
vi.mock("./AccountBalanceCard", () => ({ AccountBalanceCard: () => null }));
vi.mock("./PixPaymentDialog", () => ({ PixPaymentDialog: () => null }));
vi.mock("./BatchPixDialog", () => ({ BatchPixDialog: () => null }));

function entry(type: PayrollEntryWithCollaborator["type"], value: number, extra = {}): PayrollEntryWithCollaborator {
  return {
    id: type, collaborator_id: "ana", company_id: "company", type, value,
    description: null, external_id: null,
    collaborator: { id: "ana", name: "Ana Atual", pix_key: "ana-atual@example.test" },
    ...extra,
  } as PayrollEntryWithCollaborator;
}

function frozen(entryId: string, amount: number, kind: FrozenPaymentLine["kind"]): FrozenPaymentLine {
  return {
    entry_id: entryId, collaborator_id: "ana", kind,
    gross: amount, inss: 0, irpf: 0, other_deductions: 0, net_amount: amount,
    components: [{ entryId, type: entryId, label: entryId === "carro_agregado" ? "Carro Agregado" : "Salário Base", value: amount }],
    discounts: [], payee_name: "Ana Aprovada", payee_document: null,
    payee_pix_key: "ana-aprovada@example.test",
  };
}

let client: QueryClient;
function renderPayments(entries: PayrollEntryWithCollaborator[], status = "open", snapshots: FrozenPaymentLine[] | null = []) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["payroll-payments", "period"], []);
  if (snapshots !== null) client.setQueryData(["payroll-payable-lines", "period", status], snapshots);
  render(<QueryClientProvider client={client}>
    <PaymentsTab periodId="period" entries={entries} canManage periodStatus={status} />
  </QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); client?.clear(); });

describe("Pagamentos — consolidação na tela", () => {
  it("exibe um pagamento de salário com adicionais e férias, e outro de custo setor", () => {
    renderPayments([
      entry("salario_base", 3000), entry("salario_familia", 60),
      entry("gratificacao", 500), entry("carro_agregado", 800), entry("periculosidade", 900),
      entry("ferias", 2000, { external_id: "ferias-request-provento" }),
      entry("ferias", 666.67, { id: "terco", external_id: "ferias-request-terco" }),
      entry("inss", 500), entry("irpf", 100), entry("desconto", 150),
      entry("inss", 200, { id: "vac-inss", external_id: "ferias-request-inss" }),
      entry("irpf", 66.67, { id: "vac-irpf", external_id: "ferias-request-irrf" }),
      entry("bonificacao", 400, { description: "CUSTO SETOR" }),
    ]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText(/0 de 2 pagos/)).toBeInTheDocument();
    expect(screen.getByText(/6\.910,00/)).toBeInTheDocument();
    expect(screen.getByText(/400,00/)).toBeInTheDocument();
    expect(screen.getByText("Veículo")).toBeInTheDocument();
    expect(screen.getByText("CUSTO SETOR")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pagar/ })).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });

  it("preserva agrupamento, valor e favorecido de pagamentos aprovados antes da mudança", () => {
    renderPayments([entry("salario_base", 3000), entry("carro_agregado", 800)], "aprovado_diretoria", [
      frozen("salario_base", 2600, "mensal"), frozen("carro_agregado", 800, "avulso"),
    ]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getAllByText("Ana Aprovada")).toHaveLength(2);
    expect(screen.getAllByText("ana-aprovada@example.test")).toHaveLength(2);
    expect(screen.getByText(/2\.600,00/)).toBeInTheDocument();
    expect(screen.queryByText("Ana Atual")).not.toBeInTheDocument();
    expect(screen.queryByText(/3\.800,00/)).not.toBeInTheDocument();
  });

  it.each(["aprovado_diretoria", "closed", "exported"])("não substitui pagamentos aprovados ausentes por simulação local (%s)", (status) => {
    renderPayments([entry("salario_base", 3000)], status);
    expect(screen.getByText("Nenhum pagamento aprovado disponível para este período.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/3\.000,00/)).not.toBeInTheDocument();
  });

  it("informa falha ao consultar os pagamentos aprovados e não oferece valores recalculados", async () => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      range: async () => ({ data: null, error: new Error("Consulta indisponível") }),
    };
    from.mockReturnValue(query);
    renderPayments([entry("salario_base", 3000)], "aprovado_diretoria", null);
    expect(await screen.findByText(/Não foi possível carregar os pagamentos aprovados/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/3\.000,00/)).not.toBeInTheDocument();
  });
});
