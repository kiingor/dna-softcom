// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAgentTools } from "../../supabase/functions/_shared/agents/tools";
const company = randomUUID(),
  otherCompany = randomUUID(),
  a = randomUUID(),
  b = randomUUID(),
  inactive = randomUUID();
type Row = Record<string, unknown>;
function database(seed: Record<string, Row[]>) {
  const calls: { table: string; filters: [string, string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      const call = { table, filters: [] as [string, string, unknown][] };
      calls.push(call);
      let list = [...(seed[table] ?? [])],
        offset = 0,
        end = Infinity,
        head = false,
        single = false;
      const query = {
        select(_columns?: string, options?: { head?: boolean }) {
          head = !!options?.head;
          return query;
        },
        eq(key: string, value: unknown) {
          call.filters.push(["eq", key, value]);
          list = list.filter((r) => r[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          call.filters.push(["in", key, values]);
          list = list.filter((r) => values.includes(r[key]));
          return query;
        },
        not(key: string, _operator: string, value: string) {
          const excluded = value.replace(/[()]/g, "").split(",");
          list = list.filter((r) => !excluded.includes(String(r[key])));
          return query;
        },
        gte(key: string, value: unknown) {
          list = list.filter((r) => String(r[key]) >= String(value));
          return query;
        },
        lte(key: string, value: unknown) {
          list = list.filter((r) => String(r[key]) <= String(value));
          return query;
        },
        or() {
          return query;
        },
        ilike() {
          return query;
        },
        order() {
          return query;
        },
        limit(value: number) {
          end = value;
          return query;
        },
        range(start: number, last: number) {
          offset = start;
          end = last + 1;
          return query;
        },
        abortSignal() {
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        then(
          resolve: (value: {
            data: Row[] | Row | null;
            error: null;
            count: number;
          }) => unknown,
        ) {
          return Promise.resolve({
            data: head
              ? null
              : single
                ? (list[0] ?? null)
                : list.slice(offset, end),
            error: null,
            count: list.length,
          }).then(resolve);
        },
      };
      return query;
    },
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
  return { db: db as unknown as SupabaseClient, calls, rpc: db.rpc };
}
const candidate = (id: string, cid = company, active = true) => ({
  id,
  company_id: cid,
  is_active: active,
  name: `Candidato ${id.slice(0, 4)}`,
  cv_summary: "Atendimento ao cliente com SQL e suporte técnico.",
  cv_url: null,
  source: "site",
});
function setup(
  kind: "analyst" | "recruiter" = "recruiter",
  seed: Record<string, Row[]> = {},
  requireModule = vi.fn(async () => {}),
) {
  const fake = database({
    candidates: [
      candidate(a),
      candidate(b, otherCompany),
      candidate(inactive, company, false),
    ],
    ...seed,
  });
  const tools = createAgentTools({
    db: fake.db,
    companyId: company,
    kind,
    context: {},
    now: new Date("2026-09-17"),
    signal: new AbortController().signal,
    embed: async () => [1, 0],
    embeddingModel: "compatible",
    requireModule,
  });
  return { ...fake, tools, requireModule };
}
describe("ferramentas de recrutamento", () => {
  it("nunca recupera candidato de outra empresa nem candidato inativo", async () => {
    const { tools } = setup();
    const result = (await tools.execute("get_candidates", {
      ids: [a, b, inactive],
    })) as { candidates: Row[]; unavailable_count: number };
    expect(result.candidates.map((c) => c.id)).toEqual([a]);
    expect(result.unavailable_count).toBe(2);
  });
  it("valida evidências e mantém ordem de seleção explícita", async () => {
    const second = randomUUID();
    const { tools } = setup("recruiter", {
      candidates: [candidate(a), candidate(second)],
    });
    await tools.execute("get_candidates", { ids: [a, second] });
    await tools.execute("select_candidates", {
      candidates: [
        {
          id: second,
          reason: "Suporte SQL",
          evidence: ["Atendimento ao cliente com SQL"],
          gaps: ["Confirmar disponibilidade"],
        },
        {
          id: a,
          reason: "Suporte",
          evidence: [],
          gaps: ["Confirmar experiência específica"],
        },
      ],
    });
    expect(tools.selection().map((c) => c.id)).toEqual([second, a]);
    expect(tools.context.selection?.map((c) => c.id)).toEqual([second, a]);
  });
  it("rejeita evidência inventada e ID não consultado", async () => {
    const { tools } = setup();
    await tools.execute("get_candidates", { ids: [a] });
    await expect(
      tools.execute("select_candidates", {
        candidates: [
          {
            id: a,
            reason: "Experiência",
            evidence: ["Mais de cinco anos em SQL"],
            gaps: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "unsupported_evidence" });
    await expect(
      tools.execute("select_candidates", {
        candidates: [{ id: b, reason: "Experiência", evidence: [], gaps: [] }],
      }),
    ).rejects.toMatchObject({ code: "candidate_not_loaded" });
  });
  it("bloqueia consulta sem permissão do módulo", async () => {
    const { tools, calls } = setup(
      "recruiter",
      {},
      vi.fn(async () => {
        throw new Error("no permission");
      }),
    );
    await expect(
      tools.execute("get_candidates", { ids: [a] }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("não aceita empresa escolhida pelo modelo como filtro", async () => {
    const { tools } = setup();
    await expect(
      tools.execute("get_candidates", { ids: [a], company_id: otherCompany }),
    ).rejects.toMatchObject({ code: "invalid_filter" });
  });
  it("busca incorpora briefing completo e usa apenas o modelo de embedding compatível", async () => {
    const { tools, rpc } = setup();
    await tools.execute("search_candidates", {
      brief: "Suporte SQL, priorizando atendimento ao cliente",
    });
    expect(tools.context.brief).toContain("priorizando atendimento");
    expect(rpc).toHaveBeenCalledWith(
      "agent_match_candidates",
      expect.objectContaining({
        filter_company_id: company,
        embedding_model: "compatible",
      }),
    );
  });
  it("informa falha semântica como resultado parcial", async () => {
    const fake = database({ candidates: [], candidate_embeddings: [] });
    const tools = createAgentTools({
      db: fake.db,
      companyId: company,
      kind: "recruiter",
      context: {},
      now: new Date(),
      signal: new AbortController().signal,
      embed: async () => {
        throw new Error("offline");
      },
      embeddingModel: "compatible",
      requireModule: async () => {},
    });
    const result = (await tools.execute("search_candidates", {
      brief: "Suporte SQL",
    })) as { status: string; semantic_available: boolean };
    expect(result.status).toBe("partial");
    expect(result.semantic_available).toBe(false);
  });
});
describe("ferramentas do Analista", () => {
  it("distribuição padrão considera somente ativos da empresa", async () => {
    const { tools } = setup("analyst", {
      collaborators: [
        { id: a, company_id: company, status: "ativo", regime: "clt" },
        { id: inactive, company_id: company, status: "inativo", regime: "pj" },
        { id: b, company_id: otherCompany, status: "ativo", regime: "pj" },
      ],
    });
    const result = (await tools.execute("query_workforce", {})) as {
      total: number;
      by_regime: Row;
    };
    expect(result.total).toBe(1);
    expect(result.by_regime).toEqual({ clt: 1 });
  });
  it("rejeita filtro de loja em admissão, cujo cadastro não tem esse vínculo", async () => {
    const { tools } = setup("analyst");
    await expect(
      tools.execute("query_admissions", { store_id: randomUUID() }),
    ).rejects.toMatchObject({ code: "invalid_filter" });
  });
  it("admissões sem tempo na etapa não entram como atrasadas", async () => {
    const { tools } = setup("analyst", {
      admission_journeys: [
        {
          id: a,
          company_id: company,
          status: "docs_in_review",
          regime: "clt",
          created_at: "2026-01-01",
          status_entered_at: null,
        },
      ],
    });
    const result = (await tools.execute("query_admissions", {
      status: "docs_in_review",
      min_days_in_status: 7,
      details: true,
    })) as { matched_in_analyzed_rows: number; unknown_status_entry: number };
    expect(result.matched_in_analyzed_rows).toBe(0);
    expect(result.unknown_status_entry).toBe(1);
  });
  it("preserva filtros da tarefa atual para turnos futuros", async () => {
    const { tools } = setup("analyst");
    await tools.execute("query_admissions", { status: "docs_in_review" });
    expect(tools.context.analysis).toEqual({
      tool: "query_admissions",
      filters: { status: "docs_in_review" },
    });
  });
  it("marca agregação parcial quando ultrapassa 2000 registros", async () => {
    const records = Array.from({ length: 2001 }, (_, i) => ({
      id: String(i),
      company_id: company,
      status: "ativo",
      regime: "clt",
    }));
    const { tools } = setup("analyst", { collaborators: records });
    const result = (await tools.execute("query_workforce", {})) as {
      total: number;
      analyzed: number;
      partial: boolean;
    };
    expect(result).toMatchObject({
      total: 2001,
      analyzed: 2000,
      partial: true,
    });
  });
  it("rejeita período invertido", async () => {
    const { tools } = setup("analyst");
    await expect(
      tools.execute("query_admissions", {
        from: "2026-10-01",
        to: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "invalid_period" });
  });
});
