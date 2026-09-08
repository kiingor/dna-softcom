import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serve: vi.fn(), createClient: vi.fn(), listFeedbacks: vi.fn(),
}));

vi.mock("https://deno.land/std@0.190.0/http/server.ts", () => ({ serve: mocks.serve }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.0", () => ({ createClient: mocks.createClient }));
vi.mock("../../supabase/functions/_shared/softcom-cloud.ts", () => ({
  listFeedbacks: mocks.listFeedbacks,
  buscaColaborador: vi.fn(), createObjetivo: vi.fn(), deleteObjetivo: vi.fn(),
  listObjetivos: vi.fn(), updateObjetivo: vi.fn(), SoftcomCloudError: class extends Error {},
}));

await import("../../supabase/functions/feedbacks/index.ts");
const handler = mocks.serve.mock.calls[0][0] as (request: Request) => Promise<Response>;
const select = vi.fn();
const eq = vi.fn();
const inIds = vi.fn();
const rpc = vi.fn();
const totais = { colaboradores: 3, pendente: 3, emDia: 0, emAtraso: 0, feedbacks: 0 };
const colaboradores = [1, 2, 3].map((id) => ({
  id, nome: `Colaborador ${id}`, status: "Pendente", feedbacks: 0, dataUltimoFeedback: null,
}));

function requestFeedbacks() {
  return handler(new Request("http://localhost/feedbacks", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "feedbacks-list", companyId: "company-id", lancamentoUsuarioId: 8 }),
  }));
}

describe("datas de admissão no painel de feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("Deno", { env: { get: () => "test-value" } });
    rpc.mockResolvedValue({ data: true });
    select.mockReturnValue({ eq });
    eq.mockReturnValue({ in: inIds });
    inIds.mockResolvedValue({
      data: [
        { external_id: "2", admission_date: "2020-01-01" },
        { external_id: "1", admission_date: null },
      ], error: null,
    });
    mocks.createClient.mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-id" } }, error: null }) }, rpc,
    }).mockReturnValueOnce({ from: () => ({ select }) });
    mocks.listFeedbacks.mockResolvedValue({ totais, colaboradores });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("vincula datas pelo ID remoto e restringe a leitura à empresa autorizada", async () => {
    const response = await requestFeedbacks();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totais,
      colaboradores: [
        { ...colaboradores[0], dataAdmissao: null },
        { ...colaboradores[1], dataAdmissao: "2020-01-01" },
        { ...colaboradores[2], dataAdmissao: null },
      ],
    });
    expect(select).toHaveBeenCalledWith("external_id, admission_date");
    expect(eq).toHaveBeenCalledWith("company_id", "company-id");
    expect(inIds).toHaveBeenCalledWith("external_id", ["1", "2", "3"]);
    expect(mocks.listFeedbacks).toHaveBeenCalledWith({ suporteId: undefined, lancamentoUsuarioId: 8 });
  });

  it("consulta datas para quem tem permissão de feedback, sem exigir permissão de cadastro", async () => {
    rpc.mockResolvedValueOnce({ data: false }).mockResolvedValueOnce({ data: [{ can_view: true }] });
    expect((await requestFeedbacks()).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_user_permissions", {
      _user_id: "user-id", _company_id: "company-id", _module: "feedback",
    });
    expect(inIds).toHaveBeenCalled();
  });

  it("nega a consulta antes de acessar a Agenda ou as datas locais quando falta permissão", async () => {
    rpc.mockResolvedValue({ data: false });
    expect((await requestFeedbacks()).status).toBe(403);
    expect(mocks.listFeedbacks).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });

  it("retorna o painel vazio sem consultar datas", async () => {
    mocks.listFeedbacks.mockResolvedValue({ totais: { ...totais, colaboradores: 0, pendente: 0 }, colaboradores: [] });
    expect((await requestFeedbacks()).status).toBe(200);
    expect(select).not.toHaveBeenCalled();
  });

  it("não apresenta falha na consulta como se todos estivessem sem data", async () => {
    inIds.mockResolvedValue({ data: null, error: { message: "Database unavailable" } });
    const response = await requestFeedbacks();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ details: "Não foi possível carregar as datas de admissão." });
  });

  it("divide painéis grandes em lotes sem perder colaboradores", async () => {
    const largePanel = Array.from({ length: 401 }, (_, index) => ({ ...colaboradores[0], id: index + 1 }));
    mocks.listFeedbacks.mockResolvedValue({ totais, colaboradores: largePanel });
    inIds.mockImplementation(async (_column: string, ids: string[]) => ({
      data: ids.map((external_id) => ({ external_id, admission_date: "2025-09-08" })), error: null,
    }));
    const response = await requestFeedbacks();
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(inIds.mock.calls.map((call) => call[1].length)).toEqual([200, 200, 1]);
    expect(result.colaboradores).toHaveLength(401);
    expect(result.colaboradores[400]).toMatchObject({ id: 401, dataAdmissao: "2025-09-08" });
  });
});
