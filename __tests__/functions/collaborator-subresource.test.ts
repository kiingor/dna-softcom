import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serve: vi.fn(),
  createClient: vi.fn(),
  createSubResource: vi.fn(),
  updateSubResource: vi.fn(),
  deleteSubResource: vi.fn(),
  isAgendaSyncDisabled: vi.fn(),
}));

vi.mock("https://deno.land/std@0.190.0/http/server.ts", () => ({ serve: mocks.serve }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.49.0", () => ({ createClient: mocks.createClient }));
vi.mock("../../supabase/functions/_shared/softcom-cloud.ts", () => ({
  ...mocks,
  SoftcomCloudError: class extends Error {},
}));

await import("../../supabase/functions/collaborator-subresource/index.ts");
const handler = mocks.serve.mock.calls[0][0] as (request: Request) => Promise<Response>;

const collab = { id: "collaborator-id", company_id: "company-id", external_id: "123" };
const dates = { start_date: "2025-09-01", end_date: "2026-08-31" };
const insert = vi.fn();

it("remove o desconto da folha substituta sem tocar no arquivo nem nas competências fechadas", async () => {
  vi.resetAllMocks();
  vi.stubGlobal("Deno", { env: { get: () => "test-value" } });
  mocks.isAgendaSyncDisabled.mockReturnValue(true);
  const removed: string[] = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    collaborators: [collab],
    collaborator_health_plans: [{ id: "plan-id", external_id: "plan-external" }],
    payroll_periods: [
      { company_id: collab.company_id, reference_month: "2026-09-01", status: "closed", archived_at: "2026-09-17" },
      { company_id: collab.company_id, reference_month: "2026-09-01", status: "open", archived_at: null },
      { company_id: collab.company_id, reference_month: "2026-08-01", status: "closed", archived_at: null },
    ],
    payroll_entries: [
      { id: "active-discount", month: 9, year: 2026, archived_period_id: null },
      { id: "archived-discount", month: 9, year: 2026, archived_period_id: "test-period" },
      { id: "closed-discount", month: 8, year: 2026, archived_period_id: null },
    ].map((row) => ({ ...row, collaborator_id: collab.id, external_id: "plano-saude-plan-external-202609" })),
  };
  const admin = { from: (table: string) => {
    let rows = tables[table];
    if (!rows) throw new Error(`Unexpected table: ${table}`);
    const query = {
      select: () => query,
      delete: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return query; },
      is: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return query; },
      like: (field: string, value: string) => { rows = rows.filter((row) => String(row[field]).startsWith(value.replace(/%$/, ""))); return query; },
      in: (_field: string, ids: string[]) => { removed.push(...ids); return query; },
      single: async () => ({ data: rows[0], error: null }),
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  } };
  mocks.createClient.mockReturnValueOnce({
    auth: { getUser: async () => ({ data: { user: { id: "user-id" } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
  }).mockReturnValueOnce(admin);
  try {
    const response = await handler(new Request("http://localhost/collaborator-subresource", {
      method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", kind: "planos", collaboratorId: collab.id, localId: "plan-id" }),
    }));
    expect(await response.json()).toMatchObject({ success: true, cascaded: 1 });
    expect(removed).toEqual(["active-discount"]);
  } finally { vi.unstubAllGlobals(); }
});

async function createVacation(data: Record<string, unknown>) {
  return handler(new Request("http://localhost/collaborator-subresource", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", kind: "ferias", collaboratorId: collab.id, data }),
  }));
}

describe("collaborator-subresource: criação manual de férias", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("Deno", { env: { get: () => "test-value" } });
    mocks.isAgendaSyncDisabled.mockReturnValue(true);
    mocks.createSubResource.mockResolvedValue({ id: 456 });
    const userClient = {
      auth: { getUser: async () => ({ data: { user: { id: "user-id" } }, error: null }) },
      rpc: async () => ({ data: true, error: null }),
    };
    insert.mockReturnValue({
      select: () => ({ single: async () => ({ data: { id: "period-id" }, error: null }) }),
    });
    const adminClient = {
      from: (table: string) => {
        if (table === "collaborators") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: collab, error: null }) }) }) };
        }
        if (table === "vacation_periods") return { insert };
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    mocks.createClient.mockReturnValueOnce(userClient).mockReturnValueOnce(adminClient);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([null, undefined, ""])("normaliza campos de dias vazios (%s) antes de inserir", async (empty) => {
    const response = await createVacation({
      ...dates, days_entitled: empty, days_taken: empty, days_sold: empty,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, localId: "period-id" });
    expect(insert).toHaveBeenCalledWith({
      ...dates,
      days_entitled: 30,
      days_taken: 0,
      days_sold: 0,
      company_id: collab.company_id,
      collaborator_id: collab.id,
      external_id: null,
    });
    expect(mocks.createSubResource).not.toHaveBeenCalled();
  });

  it("preserva dias preenchidos no lançamento", async () => {
    const data = { ...dates, days_entitled: 20, days_taken: 10, days_sold: 5 };
    const response = await createVacation(data);

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining(data));
  });

  it.each([
    { ...dates, days_entitled: 0 },
    { ...dates, days_taken: -1 },
    { ...dates, days_sold: 1.5 },
    { ...dates, days_taken: 25, days_sold: 10 },
    { start_date: "2026-09-01", end_date: "2026-08-31" },
    { start_date: null, end_date: dates.end_date },
  ])("rejeita dados inválidos antes de gravar localmente ou na agenda: %j", async (data) => {
    mocks.isAgendaSyncDisabled.mockReturnValue(false);
    const response = await createVacation(data);

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.createSubResource).not.toHaveBeenCalled();
  });

  it.each([
    { id: 456, periodoIn: dates.start_date, periodoFn: dates.end_date, observacao: null },
    { id: 456 },
    { id: 456, periodoIn: null, periodoFn: null },
  ])("usa as colunas reais de férias com a sincronização ligada: %j", async (remote) => {
    mocks.isAgendaSyncDisabled.mockReturnValue(false);
    mocks.createSubResource.mockResolvedValue(remote);
    const response = await createVacation({ ...dates });

    expect(response.status).toBe(200);
    expect(mocks.createSubResource).toHaveBeenCalledWith("ferias", collab.external_id,
      expect.objectContaining({ periodoIn: dates.start_date, periodoFn: dates.end_date }),
    );
    expect(insert).toHaveBeenCalledWith({
      ...dates,
      days_entitled: 30,
      days_taken: 0,
      days_sold: 0,
      company_id: collab.company_id,
      collaborator_id: collab.id,
      external_id: "456",
    });
  });

  it("mapeia gozo e data limite para suas colunas, sem inserir observações inexistentes", async () => {
    mocks.isAgendaSyncDisabled.mockReturnValue(false);
    const data = {
      ...dates, gozo_start_date: "2026-09-01", gozo_end_date: "2026-09-30", data_limite: "2027-08-31",
    };
    mocks.createSubResource.mockResolvedValue({
      id: 456,
      periodoIn: data.start_date,
      periodoFn: data.end_date,
      periodoInGozo: data.gozo_start_date,
      periodoFnGozo: data.gozo_end_date,
      dataLimite: data.data_limite,
      observacao: "Observação legada",
    });

    const response = await createVacation(data);

    expect(response.status).toBe(200);
    expect(mocks.createSubResource).toHaveBeenCalledWith("ferias", collab.external_id,
      expect.objectContaining({
        periodoInGozo: data.gozo_start_date,
        periodoFnGozo: data.gozo_end_date,
        dataLimite: data.data_limite,
      }),
    );
    expect(insert).toHaveBeenCalledWith({
      ...data,
      days_entitled: 30,
      days_taken: 0,
      days_sold: 0,
      company_id: collab.company_id,
      collaborator_id: collab.id,
      external_id: "456",
    });
  });
});
