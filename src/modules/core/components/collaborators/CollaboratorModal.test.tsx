import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CollaboratorModal from "./CollaboratorModal";

const mocks = vi.hoisted(() => ({
  collaborator: undefined as Record<string, unknown> | undefined,
  company: { id: "company" },
  empty: [], invoke: vi.fn(), update: vi.fn(), create: vi.fn(),
  invalidate: vi.fn(), prefetch: vi.fn(), success: vi.fn(), error: vi.fn(), close: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "collaborator" ? mocks.collaborator : mocks.empty,
    isLoading: false, refetch: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate, prefetchQuery: mocks.prefetch }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@/hooks/useCollaboratorWriteBack", () => ({
  useUpdateCollaborator: () => ({ mutateAsync: mocks.update }),
  useCreateCollaborator: () => ({ mutateAsync: mocks.create }),
}));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: mocks.company, hasAnyRole: () => true }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canEdit: true, canCreate: true }) }));
vi.mock("@/modules/payroll/hooks/use-store-holidays", () => ({ useStoreHolidays: () => ({ holidayDates: [] }) }));
vi.mock("@/modules/payroll/hooks/use-payroll", () => ({ recalcCollaboratorTaxes: vi.fn() }));
vi.mock("@/lib/whatsappNotifications", () => ({ sendWhatsAppNotification: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("./CollaboratorValidationTab", () => ({ default: () => null }));
vi.mock("./tabs/SubResourceTab", () => ({ SubResourceTab: () => null }));
vi.mock("./tabs/CollaboratorTimelineTab", () => ({ CollaboratorTimelineTab: () => null }));
vi.mock("./tabs/CollaboratorDependentsTab", () => ({ CollaboratorDependentsTab: () => null }));
vi.mock("./tabs/CollaboratorUniformTab", () => ({ CollaboratorUniformTab: () => null }));
vi.mock("./tabs/CollaboratorMedicalCertsTab", () => ({ CollaboratorMedicalCertsTab: () => null }));
vi.mock("./tabs/CollaboratorAlimonyTab", () => ({ CollaboratorAlimonyTab: () => null }));
vi.mock("./CollaboratorPhotoUploader", () => ({ CollaboratorPhotoUploader: () => null }));
vi.mock("./VacationPeriodAdjustDialog", () => ({ VacationPeriodAdjustDialog: () => null }));
vi.mock("@/components/exames/PositionChangeDialog", () => ({ PositionChangeDialog: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", () => { throw new Error("Rede bloqueada neste teste."); });
  mocks.collaborator = {
    id: "person", company_id: "company", name: "Pessoa fictícia", cpf: "11144477735",
    email: "person@example.invalid", pix_key: "old@example.invalid", user_id: null, status: "ativo",
  };
  mocks.update.mockResolvedValue({ success: true });
  mocks.create.mockResolvedValue({ success: true, localId: "new-person" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderModal(collaboratorId: string | null = "person") {
  return render(<CollaboratorModal open onOpenChange={mocks.close} collaboratorId={collaboratorId} />);
}

describe("salvar cadastro sem criar acesso ao Portal por engano", () => {
  it("salva PIX de colaborador sem login sem solicitar criação de usuário", async () => {
    renderModal();
    expect(screen.getByRole("switch", { name: "Criar acesso ao Portal" })).not.toBeChecked();
    expect(screen.queryByLabelText("Senha de acesso ao Portal")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Chave PIX"), { target: { value: "new@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar", exact: true }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      section: "identificacao", data: expect.objectContaining({ pix_key: "new@example.invalid" }),
    }));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("explica o 403 da criação de acesso e permite desativar a opção para salvar o cadastro", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
      error: "Sem permissão para criar usuários nesta empresa", details: "privado",
    }), { status: 403 })) });
    renderModal();
    fireEvent.click(screen.getByRole("switch", { name: "Criar acesso ao Portal" }));
    const password = screen.getByLabelText("Senha de acesso ao Portal");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(password, { target: { value: "senha-ficticia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar", exact: true }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      "Erro ao criar acesso: Sem permissão para criar usuários nesta empresa Desative a opção de criar acesso para salvar somente o cadastro.",
    ));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Criar acesso ao Portal" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar", exact: true }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalled();
  });

  it("descarta senha residual ao desligar a opção de criar acesso", async () => {
    renderModal();
    const toggle = screen.getByRole("switch", { name: "Criar acesso ao Portal" });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Senha de acesso ao Portal"), { target: { value: "curta" } });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Salvar", exact: true }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("não oferece criar outro acesso quando o colaborador já tem login", () => {
    mocks.collaborator!.user_id = "existing-user";
    renderModal();
    expect(screen.queryByRole("switch", { name: "Criar acesso ao Portal" })).not.toBeInTheDocument();
  });

  it("permite cadastrar colaborador com email e PIX sem exigir criação de login", async () => {
    mocks.collaborator = undefined;
    render(<CollaboratorModal open onOpenChange={mocks.close} collaboratorId={null}
      prefill={{ name: "Pessoa fictícia", cpf: "11144477735", email: "person@example.invalid", pix_key: "new@example.invalid" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar", exact: true }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "person@example.invalid", pix_key: "new@example.invalid" }),
    }));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("solicita criação de acesso somente depois da escolha explícita e envia o vínculo ao cadastrar", async () => {
    mocks.collaborator = undefined;
    mocks.invoke.mockResolvedValue({ data: { user_id: "new-user" }, error: null });
    render(<CollaboratorModal open onOpenChange={mocks.close} collaboratorId={null}
      prefill={{ name: "Pessoa fictícia", cpf: "11144477735", email: "person@example.invalid" }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Criar acesso ao Portal" }));
    fireEvent.change(screen.getByLabelText("Senha de acesso ao Portal"), { target: { value: "senha-ficticia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar", exact: true }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("create-collaborator-user", {
      body: { email: "person@example.invalid", password: "senha-ficticia", full_name: "Pessoa fictícia", company_id: "company" },
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ user_id: "new-user" }) }));
  });
});
