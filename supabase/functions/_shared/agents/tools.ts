import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  AgentError,
  dateField,
  enumField,
  record,
  stringList,
  textField,
  uuid,
  type AgentKind,
  type Candidate,
  type JsonRecord,
  type Selection,
  type Source,
  type TaskContext,
  type Tool,
} from "./contracts.ts";
import {
  admissionMetrics,
  counts,
  daysSince,
  hasEvidence,
  type AdmissionRow,
} from "./metrics.ts";

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

const field = (description: string, type = "string") => ({ type, description });
const idField = (description: string) => ({
  ...field(description),
  format: "uuid",
});
const tool = (
  name: string,
  description: string,
  properties: JsonRecord,
  required: string[] = [],
): Tool => ({
  name,
  description,
  input_schema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});
const dates = {
  from: field("Data inicial de criação, AAAA-MM-DD"),
  to: field("Data final de criação, inclusive, AAAA-MM-DD"),
};
const regimes = ["clt", "pj", "estagiario"];
const candidateColumns = "id,name,cv_summary,cv_url,source,is_active";
export const RECRUITER_TOOLS: Tool[] = [
  tool(
    "find_jobs",
    "Localiza vagas e lê descrição/requisitos para contextualizar a busca. Retorna no máximo 20 vagas.",
    {
      query: field("Parte do título da vaga"),
      status: {
        enum: ["open", "paused", "draft", "filled", "cancelled"],
        type: "string",
      },
    },
  ),
  tool(
    "search_candidates",
    "Pesquisa candidatos ativos da empresa, combinando busca semântica e textual. Use briefing completo, incluindo refinamentos anteriores. Não é avaliação de aptidão.",
    {
      brief: field("Perfil completo e critérios atuais, até 2000 caracteres"),
      job_id: idField("Opcional: restringe aos inscritos nesta vaga"),
      source: field("Origem exata, somente se o usuário restringir a origem"),
    },
    ["brief"],
  ),
  tool(
    "get_candidates",
    "Lê currículos resumidos de candidatos ativos, pela ordem pedida. Use a última seleção para comparar ou preparar entrevistas sem refazer a busca.",
    {
      ids: {
        type: "array",
        items: { type: "string", format: "uuid" },
        minItems: 1,
        maxItems: 10,
      },
    },
    ["ids"],
  ),
  tool(
    "select_candidates",
    "Define a seleção final e a ordem dos cards. Cada evidência deve ser um trecho literal do resumo consultado. Todos os IDs precisam ter sido consultados nesta execução.",
    {
      candidates: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: idField("Candidato"),
            reason: field("Motivo profissional, até 500 caracteres"),
            evidence: { type: "array", items: { type: "string" }, maxItems: 6 },
            gaps: { type: "array", items: { type: "string" }, maxItems: 6 },
          },
          required: ["id", "reason", "evidence", "gaps"],
        },
      },
    },
    ["candidates"],
  ),
];
export const ANALYST_TOOLS: Tool[] = [
  tool(
    "list_dimensions",
    "Resolve nomes de lojas e times nos IDs válidos da empresa.",
    {},
  ),
  tool(
    "query_workforce",
    "Composição ATUAL do quadro por status, regime, loja e time. Ativos por padrão. Não representa evolução histórica nem turnover.",
    {
      store_id: idField("Loja"),
      team_id: idField("Time"),
      regime: { type: "string", enum: regimes },
      status: {
        type: "string",
        enum: [
          "ativo",
          "inativo",
          "aguardando_documentacao",
          "validacao_pendente",
          "reprovado",
          "all",
        ],
      },
    },
  ),
  tool(
    "query_admissions",
    "Admissões por status/regime e lista de pendências. Datas filtram criação. Dias na etapa são desconhecidos para registros sem entrada rastreada. Não há filtro de loja nesse cadastro.",
    {
      ...dates,
      status: field(
        "Status da admissão, ou all. Por padrão exclui admitidos/cancelados.",
      ),
      regime: { type: "string", enum: regimes },
      min_days_in_status: { type: "integer", minimum: 0, maximum: 3650 },
      details: field(
        "Incluir até 20 registros com nome e link, mais antigos na etapa primeiro",
        "boolean",
      ),
    },
  ),
  tool(
    "query_recruitment",
    "Retrato atual das vagas e candidaturas por etapa. Intervalo filtra criação das vagas. Dias em aberto não são dias parados na etapa. Não calcula conversão histórica.",
    {
      ...dates,
      job_id: idField("Vaga específica"),
      team_id: idField("Time"),
      status: {
        type: "string",
        enum: ["open", "paused", "draft", "filled", "cancelled", "all"],
      },
      regime: { type: "string", enum: regimes },
    },
  ),
  tool(
    "query_journey",
    "Marcos da jornada e insígnias atuais agregados; não identifica colaboradores.",
    {},
  ),
];

export interface ToolOptions {
  db: SupabaseClient;
  companyId: string;
  kind: AgentKind;
  context: TaskContext;
  now: Date;
  signal: AbortSignal;
  embed: (text: string, signal: AbortSignal) => Promise<number[]>;
  embeddingModel: string;
  requireModule: (module: string) => Promise<void>;
}
export function createAgentTools(options: ToolOptions) {
  const { db, companyId, now, signal } = options;
  const context: TaskContext = structuredClone(options.context);
  const sources: Source[] = [];
  const candidates = new Map<string, Candidate>();
  let selected: Selection[] = [];
  const definitions =
    options.kind === "recruiter" ? RECRUITER_TOOLS : ANALYST_TOOLS;
  const source = (label: string, href: string, detail?: string) => {
    const item = { label, href, detail, consultedAt: now.toISOString() };
    if (!sources.some((s) => s.label === label && s.detail === detail))
      sources.push(item);
    return item;
  };
  const checked = <T>(result: { data: T | null; error: unknown }): T => {
    if (result.error)
      throw new AgentError(
        503,
        "query_failed",
        "Não consegui consultar esses dados. Tente novamente.",
      );
    return result.data as T;
  };
  const partial = (count: number | null, length: number) =>
    count !== null && count > length;
  // Máximo explícito: agregados calculados sobre amostras são identificados como parciais.
  async function rows(
    table: string,
    columns: string,
    filters: (query: Query) => Query,
  ) {
    const result: JsonRecord[] = [];
    let total = 0;
    for (let offset = 0; offset < 2000; offset += 500) {
      signal.throwIfAborted();
      const response = await filters(
        db
          .from(table)
          .select(columns, { count: "exact" })
          .eq("company_id", companyId),
      )
        .order("id")
        .range(offset, offset + 499)
        .abortSignal(signal);
      const data = checked(response) as JsonRecord[];
      total = response.count ?? data.length;
      result.push(...data);
      if (data.length < 500 || result.length >= total) break;
    }
    return { data: result, total, partial: total > result.length };
  }
  async function ensureEntity(table: string, id: string | undefined) {
    if (!id) return;
    const result = checked(
      await db
        .from(table)
        .select("id")
        .eq("company_id", companyId)
        .eq("id", id)
        .abortSignal(signal)
        .maybeSingle(),
    );
    if (!result)
      throw new AgentError(
        404,
        "reference_not_found",
        "Não encontrei essa referência nesta empresa. Confira a loja, o time ou a vaga.",
      );
  }
  async function loadCandidates(ids: string[]) {
    if (!ids.length) return [];
    await options.requireModule("candidatos");
    const result = await db
      .from("candidates")
      .select(candidateColumns)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .in("id", ids)
      .abortSignal(signal);
    const list = (checked(result) as Candidate[]).map((c) => ({
      ...c,
      cv_summary: c.cv_summary?.slice(0, 6000) ?? null,
    }));
    const ordered = ids
      .map((id) => list.find((c) => c.id === id))
      .filter((c): c is Candidate => !!c);
    for (const candidate of ordered) candidates.set(candidate.id, candidate);
    source(
      "Currículos consultados",
      "/dashboard/candidatos",
      `${ordered.length} candidatos ativos`,
    );
    return ordered;
  }
  function dateFilters(query: Query, args: JsonRecord) {
    const from = dateField(args.from),
      to = dateField(args.to);
    if (from && to && from > to)
      throw new AgentError(
        400,
        "invalid_period",
        "A data inicial precisa vir antes da final.",
      );
    if (from) query = query.gte("created_at", `${from}T00:00:00-03:00`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999-03:00`);
    return query;
  }
  async function dispatch(name: string, input: unknown): Promise<unknown> {
    const args = record(input);
    const definition = definitions.find((t) => t.name === name);
    if (!definition)
      throw new AgentError(400, "unknown_tool", "Consulta não disponível.");
    const fields = Object.keys(
      definition.input_schema.properties as JsonRecord,
    );
    if (Object.keys(args).some((k) => !fields.includes(k)))
      throw new AgentError(
        400,
        "invalid_filter",
        "Esta consulta não aceita esse filtro.",
      );
    switch (name) {
      case "find_jobs": {
        await options.requireModule("vagas");
        let query = db
          .from("job_openings")
          .select("id,title,description,requirements,regime,status", {
            count: "exact",
          })
          .eq("company_id", companyId);
        const term = textField(args.query, 120, true),
          status = enumField(args.status, [
            "open",
            "paused",
            "draft",
            "filled",
            "cancelled",
          ]);
        if (term)
          query = query.ilike("title", `%${term.replace(/[,%_()\\]/g, " ")}%`);
        if (status) query = query.eq("status", status);
        else query = query.eq("status", "open");
        const response = await query
          .order("title")
          .limit(20)
          .abortSignal(signal);
        const data = checked(response) as JsonRecord[];
        return {
          data,
          total: response.count,
          partial: partial(response.count, data.length),
          source: source("Vagas", "/dashboard/vagas"),
        };
      }
      case "search_candidates": {
        await options.requireModule("candidatos");
        const brief = textField(args.brief, 2000)!;
        const jobId = uuid(args.job_id, true),
          origin = textField(args.source, 100, true);
        let eligibleIds: string[] | null = null;
        if (jobId) {
          await options.requireModule("vagas");
          const job = checked(
            await db
              .from("job_openings")
              .select("id")
              .eq("company_id", companyId)
              .eq("id", jobId)
              .abortSignal(signal)
              .maybeSingle(),
          );
          if (!job)
            throw new AgentError(
              404,
              "job_not_found",
              "Não encontrei essa vaga nesta empresa.",
            );
          const applications = await rows(
            "candidate_applications",
            "id,candidate_id",
            (q) => q.eq("job_id", jobId),
          );
          if (applications.partial)
            throw new AgentError(
              400,
              "too_many_applications",
              "Há candidaturas demais para esta consulta. Refine a seleção.",
            );
          eligibleIds = applications.data.map((r) => String(r.candidate_id));
        }
        const tokenWords =
          brief
            .match(/[\p{L}\p{N}+#.]{3,}/gu)
            ?.filter(
              (w) =>
                ![
                  "para",
                  "com",
                  "uma",
                  "que",
                  "dos",
                  "das",
                  "experiência",
                  "preciso",
                  "alguém",
                  "priorize",
                ].includes(w.toLowerCase()),
            )
            .slice(0, 8) ?? [];
        let query = db
          .from("candidates")
          .select(candidateColumns)
          .eq("company_id", companyId)
          .eq("is_active", true);
        if (eligibleIds) query = query.in("id", eligibleIds);
        if (origin) query = query.eq("source", origin);
        if (tokenWords.length)
          query = query.or(
            tokenWords
              .map(
                (w) => `cv_summary.ilike.%${w.replace(/[^\p{L}\p{N}]/gu, "")}%`,
              )
              .join(","),
          );
        const lexical = checked(
          await query
            .order("created_at", { ascending: false })
            .limit(30)
            .abortSignal(signal),
        ) as Candidate[];
        let semantic: { candidate_id: string; similarity: number }[] = [],
          semanticAvailable = true;
        try {
          const embedding = await options.embed(brief, signal);
          semantic = checked(
            await db
              .rpc("agent_match_candidates", {
                query_embedding: JSON.stringify(embedding),
                filter_company_id: companyId,
                embedding_model: options.embeddingModel,
                candidate_ids: eligibleIds,
                candidate_source: origin ?? null,
              })
              .abortSignal(signal),
          ) as typeof semantic;
        } catch {
          signal.throwIfAborted();
          semanticAvailable = false;
        }
        const semanticCandidates = await loadCandidates(
          semantic.map((s) => s.candidate_id),
        );
        const combined = new Map(
          [...lexical, ...semanticCandidates].map((c) => [c.id, c]),
        );
        const ranked = [...combined.values()]
          .map((c) => ({
            ...c,
            cv_summary: c.cv_summary?.slice(0, 6000) ?? null,
          }))
          .sort((a, b) => {
            const score = (c: Candidate) => {
              const sem = semantic.findIndex((s) => s.candidate_id === c.id),
                lex = lexical.findIndex((s) => s.id === c.id);
              return (
                (sem < 0 ? 0 : 1 / (60 + sem + 1)) +
                (lex < 0 ? 0 : 1 / (60 + lex + 1))
              );
            };
            return score(b) - score(a);
          })
          .slice(0, 12);
        candidates.clear();
        selected = [];
        context.selection = [];
        ranked.forEach((c) => candidates.set(c.id, c));
        context.brief = brief;
        context.jobId = jobId;
        const activeResponse = await db
          .from("candidates")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true)
          .abortSignal(signal);
        checked(activeResponse);
        const indexResponse = await db
          .from("candidate_embeddings")
          .select("candidate_id,model")
          .eq("company_id", companyId)
          .eq("model", options.embeddingModel)
          .limit(2001)
          .abortSignal(signal);
        const indexes = checked(indexResponse) as { candidate_id: string }[];
        const indexCoverage = indexes.length
          ? await db
              .from("candidates")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId)
              .eq("is_active", true)
              .in(
                "id",
                indexes.slice(0, 2000).map((i) => i.candidate_id),
              )
              .abortSignal(signal)
          : { data: null, error: null, count: 0 };
        checked(indexCoverage);
        // Conta apenas ativos entre os embeddings compatíveis observados.
        return {
          status: !semanticAvailable
            ? "partial"
            : ranked.length
              ? "ok"
              : "empty",
          candidates: ranked.map(({ cv_url, ...c }) => c),
          semantic_available: semanticAvailable,
          coverage: {
            active_candidates: activeResponse.count,
            active_indexed_candidates: indexCoverage.count,
            limited: indexes.length > 2000,
            note: "Cobertura da empresa, independente dos filtros da busca. Quando limitada, é um mínimo observado.",
          },
          criteria: { brief, job_id: jobId, source: origin },
          source: source(
            "Banco de talentos",
            "/dashboard/candidatos",
            `Busca: ${brief.slice(0, 160)}`,
          ),
        };
      }
      case "get_candidates": {
        const ids = stringList(args.ids, 10).map((id) => uuid(id)!);
        if (!ids.length)
          throw new AgentError(
            400,
            "invalid_list",
            "Escolha pelo menos um candidato.",
          );
        const data = await loadCandidates(ids);
        return {
          candidates: data.map(({ cv_url, ...c }) => c),
          unavailable_count: ids.length - data.length,
        };
      }
      case "select_candidates": {
        if (!Array.isArray(args.candidates) || args.candidates.length > 10)
          throw new AgentError(400, "invalid_selection", "Seleção inválida.");
        const next = args.candidates.map((value) => {
          const item = record(value),
            id = uuid(item.id)!;
          const candidate = candidates.get(id);
          if (!candidate)
            throw new AgentError(
              400,
              "candidate_not_loaded",
              "Consulte os candidatos antes de selecioná-los.",
            );
          const evidence = stringList(item.evidence),
            gaps = stringList(item.gaps);
          if (evidence.some((e) => !hasEvidence(candidate.cv_summary, e)))
            throw new AgentError(
              400,
              "unsupported_evidence",
              "Uma evidência não está no resumo consultado. Use trechos literais ou informe a lacuna.",
            );
          return { id, reason: textField(item.reason, 500)!, evidence, gaps };
        });
        if (new Set(next.map((c) => c.id)).size !== next.length)
          throw new AgentError(
            400,
            "duplicate_candidate",
            "Remova candidatos repetidos da seleção.",
          );
        selected = next;
        context.selection = next;
        return {
          selection: next.map((s) => ({
            ...s,
            name: candidates.get(s.id)!.name,
          })),
          note: "Use esta mesma ordem na resposta. Os cards já foram preparados.",
        };
      }
      case "list_dimensions": {
        await options.requireModule("colaboradores");
        const stores = checked(
          await db
            .from("stores")
            .select("id,store_name")
            .eq("company_id", companyId)
            .limit(200)
            .abortSignal(signal),
        );
        const teams = checked(
          await db
            .from("teams")
            .select("id,name")
            .eq("company_id", companyId)
            .limit(200)
            .abortSignal(signal),
        );
        return { stores, teams };
      }
      case "query_workforce": {
        await options.requireModule("colaboradores");
        const status =
          enumField(args.status, [
            "ativo",
            "inativo",
            "aguardando_documentacao",
            "validacao_pendente",
            "reprovado",
            "all",
          ]) ?? "ativo";
        const regime = enumField(args.regime, regimes),
          store = uuid(args.store_id, true),
          team = uuid(args.team_id, true);
        await ensureEntity("stores", store);
        await ensureEntity("teams", team);
        const result = await rows(
          "collaborators",
          "id,regime,status,store_id,team_id,position",
          (q) => {
            if (status !== "all") q = q.eq("status", status);
            if (regime) q = q.eq("regime", regime);
            if (store) q = q.eq("store_id", store);
            if (team) q = q.eq("team_id", team);
            return q;
          },
        );
        const stores = checked(
          await db
            .from("stores")
            .select("id,store_name")
            .eq("company_id", companyId)
            .abortSignal(signal),
        ) as { id: string; store_name: string }[];
        const teams = checked(
          await db
            .from("teams")
            .select("id,name")
            .eq("company_id", companyId)
            .abortSignal(signal),
        ) as { id: string; name: string }[];
        return {
          total: result.total,
          analyzed: result.data.length,
          partial: result.partial,
          filters: { status, regime, store_id: store, team_id: team },
          by_regime: counts(result.data, (r) => String(r.regime)),
          by_status: counts(result.data, (r) => String(r.status)),
          by_store: counts(
            result.data,
            (r) =>
              stores.find((s) => s.id === r.store_id)?.store_name ??
              "Sem loja informada",
          ),
          by_team: counts(
            result.data,
            (r) =>
              teams.find((s) => s.id === r.team_id)?.name ??
              "Sem time informado",
          ),
          source: source(
            "Quadro atual",
            "/dashboard/colaboradores",
            `Status: ${status}; agrupamentos sobre ${result.data.length} registros`,
          ),
        };
      }
      case "query_admissions": {
        await options.requireModule("admissoes");
        const status = enumField(args.status, [
          "created",
          "docs_pending",
          "docs_in_review",
          "docs_needs_adjustment",
          "docs_approved",
          "exam_scheduled",
          "exam_done",
          "contract_signed",
          "admitted",
          "cancelled",
          "tests_pending",
          "tests_in_review",
          "all",
        ]);
        const regime = enumField(args.regime, regimes);
        if (args.details !== undefined && typeof args.details !== "boolean")
          throw new AgentError(
            400,
            "invalid_filter",
            "O filtro details precisa ser verdadeiro ou falso.",
          );
        const minDays = args.min_days_in_status;
        if (
          minDays !== undefined &&
          (!Number.isInteger(minDays) ||
            Number(minDays) < 0 ||
            Number(minDays) > 3650)
        )
          throw new AgentError(
            400,
            "invalid_filter",
            "Informe um número de dias entre 0 e 3650.",
          );
        const result = await rows(
          "admission_journeys",
          "id,candidate_name,status,regime,created_at,status_entered_at",
          (q) => {
            q = dateFilters(q, args);
            if (status && status !== "all") q = q.eq("status", status);
            else if (!status) q = q.not("status", "in", "(admitted,cancelled)");
            if (regime) q = q.eq("regime", regime);
            return q;
          },
        );
        const metrics = admissionMetrics(
          result.data as unknown as AdmissionRow[],
          now,
          minDays as number | undefined,
        );
        return {
          total_before_age_filter: result.total,
          matched_in_analyzed_rows: metrics.matched,
          partial: result.partial,
          unknown_status_entry: metrics.unknown_status_entry,
          by_status: metrics.by_status,
          rows: args.details
            ? metrics.rows
                .slice(0, 20)
                .map((r) => ({ ...r, href: `/dashboard/admissoes/${r.id}` }))
            : undefined,
          details_limited: args.details && metrics.matched > 20,
          filters: args,
          source: source(
            "Admissões",
            "/dashboard/admissoes",
            "Datas filtram criação; tempo na etapa desconhecido nos registros sem transição rastreada",
          ),
        };
      }
      case "query_recruitment": {
        await options.requireModule("vagas");
        const status =
            enumField(args.status, [
              "open",
              "paused",
              "draft",
              "filled",
              "cancelled",
              "all",
            ]) ?? "open",
          regime = enumField(args.regime, regimes),
          job = uuid(args.job_id, true),
          team = uuid(args.team_id, true);
        await ensureEntity("job_openings", job);
        await ensureEntity("teams", team);
        const jobs = await rows(
          "job_openings",
          "id,title,status,regime,opened_at,created_at,team_id",
          (q) => {
            q = dateFilters(q, args);
            if (status !== "all") q = q.eq("status", status);
            if (regime) q = q.eq("regime", regime);
            if (job) q = q.eq("id", job);
            if (team) q = q.eq("team_id", team);
            return q;
          },
        );
        const ids = jobs.data.slice(0, 100).map((j) => j.id);
        const apps = ids.length
          ? await rows("candidate_applications", "id,job_id,stage", (q) =>
              q.in("job_id", ids),
            )
          : { data: [], partial: false, total: 0 };
        return {
          total_jobs: jobs.total,
          partial: jobs.partial || jobs.data.length > 100 || apps.partial,
          jobs: jobs.data.slice(0, 100).map((j) => ({
            ...j,
            days_since_open: daysSince(j.opened_at as string | null, now),
            applications: apps.data.filter((a) => a.job_id === j.id).length,
            by_stage: counts(
              apps.data.filter((a) => a.job_id === j.id),
              (a) => String(a.stage),
            ),
            href: `/dashboard/vagas/${j.id}`,
          })),
          note: "Distribuição atual. Não comprova taxa histórica de conversão nem tempo parado em cada etapa.",
          source: source("Funil de vagas", "/dashboard/vagas"),
        };
      }
      case "query_journey": {
        await options.requireModule("jornada");
        const milestones = checked(
          await db
            .from("agent_milestone_overview")
            .select("*")
            .eq("company_id", companyId)
            .limit(100)
            .abortSignal(signal),
        );
        return {
          milestones,
          source: source("Marcos da jornada", "/dashboard/jornada"),
        };
      }
    }
    throw new AgentError(400, "unknown_tool", "Consulta não disponível.");
  }
  return {
    definitions,
    context,
    sources,
    async execute(name: string, input: unknown) {
      const output = await dispatch(name, input);
      if (options.kind === "analyst" && name.startsWith("query_"))
        context.analysis = { tool: name, filters: record(input) };
      return output;
    },
    selection: () => selected.map((s) => ({ ...candidates.get(s.id)!, ...s })),
    async hydrateContext() {
      if (options.kind !== "recruiter" || !context.selection?.length)
        return {
          brief: context.brief,
          jobId: context.jobId,
          analysis: context.analysis,
        };
      const available = await loadCandidates(
        context.selection.map((s) => uuid(s.id)!),
      );
      context.selection = context.selection.filter((s) =>
        available.some((c) => c.id === s.id),
      );
      return {
        brief: context.brief,
        jobId: context.jobId,
        previous_selection: context.selection.map((s, index) => ({
          rank: index + 1,
          ...s,
          ...available.find((c) => c.id === s.id),
          cv_url: undefined,
        })),
      };
    },
  };
}
