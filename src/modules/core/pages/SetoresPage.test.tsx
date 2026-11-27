import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SetoresPage from "./SetoresPage";

type QueryResult = { data?: unknown; count?: number | null; error?: unknown };

const { usePermissions, mutate, from } = vi.hoisted(() => ({
  usePermissions: vi.fn(),
  mutate: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({ usePermissions }));
vi.mock("@/hooks/useCoreResourceMutation", () => ({
  useCoreResourceMutation: () => ({ mutate, isPending: false }),
}));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: { id: "company-1" }, stores: [] }),
}));
vi.mock("@/components/dashboard/PermissionGuard", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

const TEAM = {
  id: "team-1",
  name: "Suporte",
  description: null,
  store_id: null,
  created_at: "2026-01-01T00:00:00Z",
  stores: null,
};

let results: Record<string, QueryResult>;
let filters: Array<{ table: string; column: string; value: unknown }>;

function mockSupabase() {
  from.mockImplementation((table: string) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push({ table, column, value });
        return builder;
      },
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: null, count: null, error: null, ...results[table] }).then(
          onFulfilled,
          onRejected,
        ),
    };
    return builder;
  });
}

function mockPermissions({
  canDeleteTeams = true,
  canViewCollaborators = true,
}: { canDeleteTeams?: boolean; canViewCollaborators?: boolean } = {}) {
  usePermissions.mockImplementation((module: string) => ({
    canView: module === "colaboradores" ? canViewCollaborators : true,
    canCreate: module === "setores",
    canEdit: module === "setores",
    canDelete: module === "setores" ? canDeleteTeams : false,
    isLoading: false,
    isAdmin: false,
  }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SetoresPage />
    </QueryClientProvider>,
  );
}

async function openTeamMenu() {
  const trigger = await screen.findByRole("button", { name: "Ações do setor Suporte" });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

async function openDeleteDialog() {
  await openTeamMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir" }));
  return screen.findByRole("alertdialog");
}

describe("exclusão de setor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    filters = [];
    results = {
      teams: { data: [TEAM] },
      collaborators: { data: [] },
      positions: { count: 0 },
      job_openings: { count: 0 },
    };
    mockSupabase();
    mockPermissions();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("exclui um setor sem vínculos depois da confirmação", async () => {
    renderPage();
    const dialog = await openDeleteDialog();

    expect(
      await within(dialog).findByText(/"Suporte" vai sair da lista de setores/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Vão ficar sem setor/)).not.toBeInTheDocument();
    expect(filters).toEqual(
      expect.arrayContaining([
        { table: "collaborators", column: "team_id", value: "team-1" },
        { table: "positions", column: "team_id", value: "team-1" },
        { table: "job_openings", column: "team_id", value: "team-1" },
      ]),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }));
    expect(mutate).toHaveBeenCalledWith({ action: "delete", id: "team-1", syncToRemote: false });
  });

  it("bloqueia quando ainda há colaboradores ativos ou em admissão no setor", async () => {
    results.collaborators = {
      data: [{ status: "ativo" }, { status: "aguardando_documentacao" }, { status: "inativo" }],
    };
    renderPage();
    const dialog = await openDeleteDialog();

    expect(await within(dialog).findByText("Ainda não dá pra excluir")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Ainda tem 2 colaboradores ativos ou em admissão em "Suporte"/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("avisa o que fica sem setor quando só há inativos, cargos e vagas", async () => {
    results.collaborators = { data: [{ status: "inativo" }, { status: "reprovado" }] };
    results.positions = { count: 1 };
    results.job_openings = { count: 2 };
    renderPage();
    const dialog = await openDeleteDialog();

    expect(
      await within(dialog).findByText(
        "Vão ficar sem setor: 2 colaboradores inativos, 1 cargo e 2 vagas.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }));
    expect(mutate).toHaveBeenCalledWith({ action: "delete", id: "team-1", syncToRemote: false });
  });

  it("mantém bloqueado quando a conferência dos vínculos falha", async () => {
    results.collaborators = { error: { message: "falha de rede" } };
    renderPage();
    const dialog = await openDeleteDialog();

    expect(
      await within(dialog).findByText(/Não deu pra conferir quem está neste setor/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("não libera a exclusão sem acesso a Colaboradores, porque a contagem viria zerada", async () => {
    mockPermissions({ canViewCollaborators: false });
    renderPage();
    const dialog = await openDeleteDialog();

    expect(
      within(dialog).getByText(/você precisa de acesso a Colaboradores/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    expect(filters.some((f) => f.table === "collaborators")).toBe(false);
  });

  it("esconde a opção para quem não pode excluir setores", async () => {
    mockPermissions({ canDeleteTeams: false });
    renderPage();
    await openTeamMenu();

    expect(await screen.findByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Excluir/ })).not.toBeInTheDocument();
  });
});
