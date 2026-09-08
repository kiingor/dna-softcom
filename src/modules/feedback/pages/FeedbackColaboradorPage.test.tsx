import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FeedbackColaborador } from "../types";
import FeedbackColaboradorPage from "./FeedbackColaboradorPage";

const { useFeedbacks, usePermissions } = vi.hoisted(() => ({
  useFeedbacks: vi.fn(),
  usePermissions: vi.fn(),
}));

vi.mock("../hooks/use-feedbacks", () => ({ useFeedbacks }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions }));
vi.mock("../components/GuardiaoSelect", () => ({ GuardiaoSelect: () => null }));
vi.mock("../components/NovoFeedbackDialog", () => ({ NovoFeedbackDialog: () => null }));
vi.mock("../components/ObjetivosSheet", () => ({
  ObjetivosSheet: ({ colaborador }: { colaborador: FeedbackColaborador | null }) =>
    colaborador ? <div role="dialog" aria-label={`Feedbacks de ${colaborador.nome}`} /> : null,
}));

const colaboradores: FeedbackColaborador[] = [
  { id: 1, nome: "Ana", status: "Pendente", feedbacks: 0, dataUltimoFeedback: null, dataAdmissao: "2025-09-08", setor: "Suporte", empresa: "Matriz" },
  { id: 2, nome: "Bruno", status: "Em Atraso", feedbacks: 2, dataUltimoFeedback: "2026-01-01", dataAdmissao: "2025-09-07", setor: "Suporte", empresa: "Matriz" },
  { id: 3, nome: "Carla", status: "Em dia", feedbacks: 3, dataUltimoFeedback: "2026-08-01", dataAdmissao: "2026-02-01", setor: "Vendas", empresa: "Filial" },
  { id: 4, nome: "Diego", status: "Pendente", feedbacks: 0, dataUltimoFeedback: null, dataAdmissao: null, setor: "Suporte", empresa: "Matriz" },
];

function renderPage() {
  return render(<TooltipProvider><FeedbackColaboradorPage /></TooltipProvider>);
}

async function selectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("filtros do painel de feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 12));
    Element.prototype.scrollIntoView = vi.fn();
    usePermissions.mockReturnValue({ canView: true, canCreate: true, canEdit: true, canDelete: true, isLoading: false });
    useFeedbacks.mockReturnValue({
      data: { colaboradores }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("segmenta as duas faixas, atualiza os indicadores e preserva quem não tem data na visão geral", async () => {
    renderPage();
    expect(screen.getByRole("button", { name: /^Diego / })).toBeInTheDocument();
    await selectOption("Tempo de casa", "Até um ano de casa");

    expect(screen.getByRole("button", { name: /^Ana / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Carla / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bruno / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Diego / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Colaboradores 2 / })).toBeInTheDocument();
    expect(screen.getByText(/1 colaborador sem data de admissão válida/)).toBeInTheDocument();

    await selectOption("Tempo de casa", "Mais de um ano de casa");
    expect(screen.getByRole("button", { name: /^Bruno / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ana / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Carla / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Colaboradores 1 / })).toBeInTheDocument();

    await selectOption("Tempo de casa", "Todos os tempos de casa");
    expect(screen.getByRole("button", { name: /^Colaboradores 4 / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Diego / })).toBeInTheDocument();
  });

  it("alterna os status pelos indicadores e pelos títulos sem zerar os demais totais", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Em atraso 1 \+/ }));
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Em atraso" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pendentes 2 / })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^Em atraso 1 \+/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /^Pendentes 2 / }));
    expect(screen.getByRole("region", { name: "Pendente" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Pendentes 2 / }));
    expect(screen.getAllByRole("region")).toHaveLength(3);

    fireEvent.click(within(screen.getByRole("region", { name: "Em dia" })).getByRole("button", { name: "Em dia 1" }));
    expect(screen.getAllByRole("region")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Carla / }));
    expect(screen.getByRole("dialog", { name: "Feedbacks de Carla" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todos os status" }));
    expect(screen.getAllByRole("region")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /^Em dia 1 ≤/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Colaboradores 4 / }));
    expect(screen.getAllByRole("region")).toHaveLength(3);
  });

  it("combina os filtros e permite recuperar um resultado vazio", async () => {
    renderPage();
    await selectOption("Tempo de casa", "Até um ano de casa");
    await selectOption("Setor", "Suporte");
    await selectOption("Empresa", "Matriz");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar colaborador pelo nome" }), { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: /^Pendentes 1 / }));
    expect(screen.getByRole("button", { name: /^Ana / })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /^Em atraso 0 \+/ }));
    expect(screen.getByText("Ninguém com esse filtro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByRole("textbox", { name: "Buscar colaborador pelo nome" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Tempo de casa" })).toHaveTextContent("Todos os tempos de casa");
    expect(screen.getByRole("button", { name: /^Colaboradores 4 / })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("region")).toHaveLength(3);
  });
});
