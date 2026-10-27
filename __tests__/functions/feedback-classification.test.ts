import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("../../supabase/functions/_shared/softcom-cloud.ts", () => ({
  SoftcomCloudError: class extends Error { constructor(public status: number, message: string) { super(message); } },
}));
import { enrichClassifications, prepareClassification, saveClassification } from "../../supabase/functions/feedbacks/classification";

const campaign = "11111111-1111-4111-8111-111111111111";
const culture = "22222222-2222-4222-8222-222222222222";
const mock = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), in: vi.fn(), upsert: vi.fn(), delete: vi.fn() };
const db = mock as unknown as SupabaseClient;
const input = { tipo: "Cultura", campanhaId: campaign, culturaId: culture, comentario: "Exemplo" };

beforeEach(() => {
  vi.resetAllMocks();
  mock.from.mockReturnValue(mock);
  mock.select.mockReturnValue(mock);
  mock.eq.mockReturnValue(mock);
  mock.delete.mockReturnValue(mock);
  mock.maybeSingle.mockResolvedValue({ data: { is_active: true }, error: null });
  mock.upsert.mockResolvedValue({ error: null });
});

describe("classificação local e integração com a Agenda", () => {
  it("retira IDs locais do payload e valida as opções na empresa autorizada", async () => {
    const result = await prepareClassification(db, "company", 7, input);
    expect(result).toEqual({ agendaData: { tipo: "Cultura", comentario: "Exemplo" }, selection: { campaign_id: campaign, culture_id: culture } });
    expect(mock.eq.mock.calls.filter(([key]) => key === "company_id")).toEqual([["company_id", "company"], ["company_id", "company"]]);
  });
  it("recusa IDs ausentes, opção de outra empresa e opção desativada", async () => {
    await expect(prepareClassification(db, "company", 7, { ...input, culturaId: "" })).rejects.toMatchObject({ status: 400 });
    expect(mock.from).not.toHaveBeenCalled();
    mock.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(prepareClassification(db, "company", 7, input)).rejects.toMatchObject({ status: 400 });
    mock.maybeSingle.mockResolvedValueOnce({ data: { is_active: false }, error: null });
    await expect(prepareClassification(db, "company", 7, input)).rejects.toMatchObject({ status: 400 });
  });
  it("preserva opção inativa na edição somente se já pertence ao mesmo feedback", async () => {
    mock.maybeSingle.mockResolvedValueOnce({ data: { campaign_id: campaign, culture_id: culture } })
      .mockResolvedValueOnce({ data: { is_active: false } }).mockResolvedValueOnce({ data: { is_active: false } });
    expect((await prepareClassification(db, "company", 7, input, 42)).selection).toEqual({ campaign_id: campaign, culture_id: culture });
    expect(mock.eq).toHaveBeenCalledWith("agenda_collaborator_id", 7);
    expect(mock.eq).toHaveBeenCalledWith("agenda_objective_id", 42);
  });
  it("limpa a classificação ao mudar de tipo e preserva PATCH sem tipo", async () => {
    expect((await prepareClassification(db, "company", 7, { ...input, tipo: "Comentário" })).selection).toBeNull();
    expect((await prepareClassification(db, "company", 7, { comentario: "Alteração" })).selection).toBeUndefined();
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("devolve aviso explícito após sucesso remoto se a persistência local falhar", async () => {
    mock.upsert.mockResolvedValueOnce({ error: { message: "DB offline" } });
    const warning = await saveClassification(db, "company", 7, 42, "user", { campaign_id: campaign, culture_id: culture });
    expect(warning).toContain("foi salvo na Agenda");
    expect(warning).toContain("Abra a edição");
    expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ agenda_objective_id: 42, updated_by: "user" }), { onConflict: "company_id,agenda_objective_id" });
  });
  it("carrega nomes por empresa, colaborador e IDs de Cultura, sem atribuir metadados a outro tipo", async () => {
    mock.in.mockResolvedValueOnce({ data: [{ agenda_objective_id: 42, campaign_id: campaign, culture_id: culture, campaign: { name: "Integração" }, culture: { name: "Cooperação" } }] });
    const result = await enrichClassifications(db, "company", 7, [{ id: 42, tipo: "Cultura" }, { id: 43, tipo: "Objetivo" }]);
    expect(result[0]).toMatchObject({ campanhaNome: "Integração", culturaNome: "Cooperação" });
    expect(result[1].campanhaId).toBeNull();
    expect(mock.in).toHaveBeenCalledWith("agenda_objective_id", [42]);
    expect(mock.eq).toHaveBeenCalledWith("company_id", "company");
    expect(mock.eq).toHaveBeenCalledWith("agenda_collaborator_id", 7);
  });
  it("não transforma falha de leitura em classificação ausente", async () => {
    mock.in.mockResolvedValueOnce({ data: null, error: {} });
    await expect(enrichClassifications(db, "company", 7, [{ id: 42, tipo: "Cultura" }])).rejects.toThrow("Não foi possível carregar");
  });
});
