import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjetivoForm } from "./ObjetivoForm";
import type { Objetivo } from "../types";

const campaign = "11111111-1111-4111-8111-111111111111";
const culture = "22222222-2222-4222-8222-222222222222";
const oldCulture = "33333333-3333-4333-8333-333333333333";
const mock = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canView: false }) }));
vi.mock("../hooks/use-feedback-settings", () => ({ useFeedbackOptions: mock.options }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  mock.options.mockReturnValue({ isSuccess: true, data: {
    campaigns: [{ id: campaign, name: "Integração", is_active: true }],
    cultures: [{ id: culture, name: "Cooperação", is_active: true }, { id: oldCulture, name: "Valor anterior", is_active: false }],
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function select(name: RegExp, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
function renderForm(onSubmit = vi.fn(), initial?: Objetivo) {
  render(<MemoryRouter><ObjetivoForm open onOpenChange={vi.fn()} onSubmit={onSubmit} initial={initial} /></MemoryRouter>);
  return onSubmit;
}
describe("feedback Cultura no formulário", () => {
  it("revela os campos de Cultura e exige as duas escolhas antes de salvar", async () => {
    const submit = renderForm();
    expect(screen.queryByRole("combobox", { name: /^Campanha/ })).not.toBeInTheDocument();
    await select(/^Tipo$/, "Cultura");
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText("Escolha a campanha.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    await select(/^Campanha/, "Integração");
    await select(/^Cultura/, "Cooperação");
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ tipo: "Cultura", campanhaId: campaign, culturaId: culture })));
  });
  it("preserva cultura inativa na edição e permite mudar para um tipo comum", async () => {
    renderForm(vi.fn(), { id: 42, tipo: "Cultura", comentario: "Histórico", mostrarSuporte: false, datas: null, lancamentoDatas: null, lancamentoUsuarioId: 1, campanhaId: campaign, culturaId: oldCulture });
    expect(screen.getByRole("combobox", { name: /^Cultura/ })).toHaveTextContent("Valor anterior (inativa)");
    await select(/^Tipo$/, "Comentário");
    expect(screen.queryByRole("combobox", { name: /^Campanha/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Comentário")).toHaveValue("Histórico");
  });
  it("exclui opções inativas do cadastro de novos feedbacks", async () => {
    renderForm();
    await select(/^Tipo$/, "Cultura");
    fireEvent.keyDown(screen.getByRole("combobox", { name: /^Cultura/ }), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Cooperação" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Valor anterior/ })).not.toBeInTheDocument();
  });
});
