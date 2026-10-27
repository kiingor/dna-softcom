import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackSettingsTab } from "./FeedbackSettingsTab";

const mock = vi.hoisted(() => ({ save: vi.fn(), mutate: vi.fn(), permissions: vi.fn(), options: vi.fn() }));
vi.mock("@/contexts/DashboardContext", () => ({ useDashboard: () => ({ currentCompany: { id: "company" } }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: mock.permissions }));
vi.mock("../hooks/use-feedback-settings", () => ({
  useFeedbackOptions: mock.options,
  useFeedbackOptionMutation: () => ({ mutateAsync: mock.save, mutate: mock.mutate, isPending: false }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.permissions.mockReturnValue({ canView: true, canCreate: true, canEdit: true });
  mock.options.mockReturnValue({ data: { campaigns: [], cultures: [{ id: "culture", name: "Cooperação", is_active: true }] }, isLoading: false, isError: false });
  mock.save.mockResolvedValue({});
});
afterEach(cleanup);

describe("configurações de campanhas e culturas", () => {
  it("cadastra uma campanha e fecha o formulário após confirmar a gravação", async () => {
    render(<FeedbackSettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Nova campanha" }));
    fireEvent.change(screen.getByLabelText("Nome da campanha"), { target: { value: "  Integração  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith({ id: undefined, name: "Integração", is_active: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("renomeia usando o ID existente e desativa sem excluir", async () => {
    render(<FeedbackSettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Editar cultura Cooperação" }));
    fireEvent.change(screen.getByLabelText("Nome da cultura"), { target: { value: "Colaboração" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith({ id: "culture", name: "Colaboração", is_active: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Desativar cultura Cooperação" }));
    expect(mock.mutate).toHaveBeenCalledWith({ id: "culture", name: "Cooperação", is_active: false });
  });
  it("mantém o nome preenchido quando salvar falha", async () => {
    mock.save.mockRejectedValue(new Error("Duplicado"));
    render(<FeedbackSettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Nova cultura" }));
    fireEvent.change(screen.getByLabelText("Nome da cultura"), { target: { value: "Cooperação" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalled());
    expect(screen.getByLabelText("Nome da cultura")).toHaveValue("Cooperação");
  });
  it("permite leitura sem exibir ações para quem não pode configurar", () => {
    mock.permissions.mockReturnValue({ canView: true, canCreate: false, canEdit: false });
    render(<FeedbackSettingsTab />);
    expect(screen.getByText("Cooperação")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
