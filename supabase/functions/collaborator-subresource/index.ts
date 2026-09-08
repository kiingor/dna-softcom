// Edge Function: collaborator-subresource
//
// CRUD genérico de sub-recursos do colaborador (afastamentos, absenteismos,
// planos, 13º, férias, PDVs, e outros) — espelha tanto na API legada
// api.softcom.cloud quanto na tabela local correspondente.
//
// Body:
//   {
//     action: 'create' | 'update' | 'delete',
//     kind:   'absenteismos' | 'afastamentos' | 'decimo-terceiro'
//           | 'ferias' | 'planos' | 'pdvs',
//     collaboratorId: uuid (local),
//     localId?:  uuid     (obrigatório em update/delete)
//     data?:     object   (payload — campos no formato LOCAL, snake_case)
//   }
//
// Mapeamento de tabelas e tradução de campos (local→remoto / remoto→local)
// fica neste mesmo arquivo na const ENTITY_MAP.
//
// Permissão: colaboradores:can_create / can_edit / can_delete (+admin bypass).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createSubResource,
  deleteSubResource,
  isAgendaSyncDisabled,
  SoftcomCloudError,
  type SubResourceKind,
  updateSubResource,
} from "../_shared/softcom-cloud.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuração por tipo: tabela local + tradutor de campos
// ─────────────────────────────────────────────────────────────────────────────

interface EntityConfig {
  /** Tabela local que espelha o recurso. */
  table: string;
  /** Mapa campo local → campo remoto (pra POST/PUT). */
  toRemote: (local: Record<string, unknown>) => Record<string, unknown>;
  /** Mapa retorno remoto → row local (pra após POST/PUT). */
  fromRemote: (
    remote: Record<string, unknown>,
    extra: { companyId: string; collaboratorId: string },
  ) => Record<string, unknown>;
  /**
   * Campos da row LOCAL-only que NÃO devem entrar no INSERT vindo do `data`
   * original (ex: `is_invalid` em `collaborator_dependents` — flag local pra
   * salário-família, não existe na agenda). O caller (frontend) aplica via
   * patch separado após o INSERT.
   */
  localOnlyFields?: string[];
}

const ENTITY_MAP: Record<SubResourceKind, EntityConfig> = {
  absenteismos: {
    table: "collaborator_absences",
    toRemote: (l) => ({
      datas: l.occurred_on,
      dias: l.days,
      motivo: l.reason,
      observacao: l.notes,
      atestado: l.has_certificate ? 1 : 0,
      bancoHoras: l.bank_hours ?? 0,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      occurred_on: r.datas,
      days: r.dias,
      reason: r.motivo,
      notes: r.observacao,
      has_certificate: !!r.atestado && r.atestado !== 0,
      bank_hours: r.bancoHoras ?? 0,
    }),
  },
  afastamentos: {
    table: "collaborator_leaves",
    toRemote: (l) => ({
      motivo: l.reason_code,
      dataInicial: l.start_date,
      dataFinal: l.end_date,
      descricao: l.description,
      atestado: !!l.has_certificate,
      compensado: l.compensated,
      idViagem: l.trip_id,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      reason_code: r.motivo,
      start_date: r.dataInicial,
      end_date: r.dataFinal,
      description: r.descricao,
      has_certificate: !!r.atestado,
      compensated: r.compensado,
      trip_id: r.idViagem,
    }),
  },
  "decimo-terceiro": {
    table: "bonus_entries",
    toRemote: (l) => ({
      datas: l.posted_at ?? new Date().toISOString().slice(0, 10),
      anos: l.year,
      pago: l.is_paid ? "S" : "N",
      valorPago: l.value_paid,
      observacao: l.notes,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      // mapeia pros campos do bonus_entries (que tem period_id obrigatório)
      // Esse helper assume que o caller já resolveu period_id antes de chamar.
      // Pra simplicidade vamos só guardar external_id e descritivos;
      // o RH ajusta o period_id manualmente depois se precisar.
      notes: r.observacao,
    }),
  },
  ferias: {
    table: "vacation_periods",
    toRemote: (l) => ({
      datas: l.posted_at,
      periodoIn: l.start_date,
      periodoFn: l.end_date,
      dataLimite: l.data_limite,
      dataPrevista: l.planned_start,
      periodoInGozo: l.gozo_start_date,
      periodoFnGozo: l.gozo_end_date,
      pago: l.is_paid ? "S" : "N",
      valorPago: l.value_paid,
      observacao: l.notes,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      // Respostas parciais da agenda não podem apagar as datas enviadas.
      // Usa apenas colunas que existem em vacation_periods.
      ...(r.periodoIn ? { start_date: r.periodoIn } : {}),
      ...(r.periodoFn ? { end_date: r.periodoFn } : {}),
      ...(r.periodoInGozo !== undefined ? { gozo_start_date: r.periodoInGozo } : {}),
      ...(r.periodoFnGozo !== undefined ? { gozo_end_date: r.periodoFnGozo } : {}),
      ...(r.dataLimite !== undefined ? { data_limite: r.dataLimite } : {}),
    }),
  },
  planos: {
    table: "collaborator_health_plans",
    toRemote: (l) => ({
      plano: l.plan_name,
      matriculaPlano: l.registration_code,
      dataInicio: l.start_date,
      tipo: l.beneficiary_type,
      nomes: l.beneficiary_name,
      dataNascimento: l.beneficiary_birth,
      cpf: l.beneficiary_cpf,
      valorPlano: l.plan_value,
      obs: l.notes,
      desativado: !!l.is_disabled,
      dataDesativado: l.disabled_at,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      plan_name: r.plano,
      registration_code: r.matriculaPlano,
      start_date: r.dataInicio,
      beneficiary_type: r.tipo,
      beneficiary_name: r.nomes,
      beneficiary_birth: r.dataNascimento,
      beneficiary_cpf: r.cpf,
      plan_value: r.valorPlano,
      notes: r.obs,
      is_disabled: !!r.desativado,
      disabled_at: r.dataDesativado,
    }),
  },
  pdvs: {
    table: "collaborator_pdvs",
    toRemote: (l) => ({
      pdv: l.pdv_name,
      f10: l.f10 ?? 0,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      pdv_name: r.pdv,
      f10: r.f10 ?? 0,
    }),
  },
  // Os de baixo são suportados pelo cliente mas raramente usados via essa
  // função (eventos é histórico, exames/parentes/emails/estagios/adicionais
  // têm UIs próprias ou são sincronizados em bulk). Mantidos pra completude.
  eventos: {
    table: "collaborator_timeline_events",
    toRemote: (l) => ({
      datas: l.posted_at,
      dataEvento: l.event_date,
      evento: l.event_name,
      funcao: l.position_name,
      observacao: l.notes,
      valorPago: l.value_paid,
      lacrar: !!l.is_sealed,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      event_type: "custom",
      effective_date: r.dataEvento ?? r.datas ?? new Date().toISOString().slice(0, 10),
    }),
  },
  exames: {
    table: "occupational_exams",
    toRemote: (l) => ({
      exameTipo: l.exam_type,
      dataPrevista: l.planned_date,
      dataRealizado: l.completed_date,
      notificacaoEnviada: !!l.notification_sent,
      marcar: l.flagged !== false,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      exam_type: r.exameTipo,
      planned_date: r.dataPrevista,
      completed_date: r.dataRealizado,
    }),
  },
  parentes: {
    table: "collaborator_dependents",
    // Agenda valida payload com whitelist — só aceita os campos listados aqui.
    // is_invalid e notes são LOCAL-ONLY (não existem na agenda); o caller
    // aplica patch separado depois via supabase.from('collaborator_dependents').
    toRemote: (l) => ({
      tipoParente: l.kinship,
      nomeParente: l.name,
      cpf: l.cpf,
      dataNascimento: l.birth_date,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      name: r.nomeParente,
      kinship: r.tipoParente,
      cpf: r.cpf,
      birth_date: r.dataNascimento,
      // is_invalid e notes ficam fora — preservados pela camada caller via
      // post-update local. Sync subsequente da agenda não sobrescreve.
    }),
    // Filtra do INSERT (mesmo se o frontend mandar no `data` original).
    // Sem isso, o merge final do INSERT inclui esses campos e pode quebrar
    // (ex: coluna ainda não existe localmente em ambientes sem a migration).
    localOnlyFields: ["is_invalid", "is_irpf_dependent", "is_health_plan_dependent", "notes"],
  },
  emails: {
    table: "collaborator_emails",
    toRemote: (l) => ({ email: l.email }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      email: r.email,
    }),
  },
  estagios: {
    table: "collaborator_internships",
    toRemote: (l) => ({
      dataInicial: l.start_date,
      dataFinal: l.end_date,
      renovacao: !!l.is_renewal,
      notificacaoEnviada: !!l.notification_sent,
      marcar: l.flagged !== false,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      start_date: r.dataInicial,
      end_date: r.dataFinal,
      is_renewal: !!r.renovacao,
      notification_sent: !!r.notificacaoEnviada,
      flagged: r.marcar !== false,
    }),
  },
  adicionais: {
    table: "collaborator_extras",
    toRemote: (l) => ({
      tipo: l.extra_type,
      descricao: l.description,
      valores: l.value,
      desativado: !!l.is_disabled,
      inspiraTipo: l.inspira_type,
      inspiraGrupo: l.inspira_group,
    }),
    fromRemote: (r, ex) => ({
      company_id: ex.companyId,
      collaborator_id: ex.collaboratorId,
      external_id: String(r.id),
      extra_type: r.tipo,
      description: r.descricao,
      value: r.valores,
      is_disabled: !!r.desativado,
      inspira_type: r.inspiraTipo,
      inspira_group: r.inspiraGrupo,
    }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing auth" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const sbUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await sbUser.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Invalid token" }, 401);

  let action: "create" | "update" | "delete";
  let kind: SubResourceKind;
  let collaboratorId: string;
  let localId: string | undefined;
  let data: Record<string, unknown>;
  try {
    const body = await req.json();
    action = body.action;
    kind = body.kind;
    collaboratorId = String(body.collaboratorId ?? "").trim();
    localId = body.localId ? String(body.localId) : undefined;
    data = body.data ?? {};
    if (!["create", "update", "delete"].includes(action)) throw new Error("action inválido");
    if (!ENTITY_MAP[kind]) throw new Error(`kind ${kind} não suportado`);
    if (!collaboratorId) throw new Error("missing collaboratorId");
    if ((action === "update" || action === "delete") && !localId) {
      throw new Error("localId obrigatório em update/delete");
    }
  } catch (e) {
    return jsonResponse({ error: "Body inválido: " + (e as Error).message }, 400);
  }

  const sbAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Buscar dados do colab pra obter external_id + company_id + permissão
  const { data: collab, error: collabErr } = await sbAdmin
    .from("collaborators")
    .select("id, company_id, external_id")
    .eq("id", collaboratorId)
    .single();
  if (collabErr || !collab) return jsonResponse({ error: "Colaborador não encontrado" }, 404);

  const requiredAction =
    action === "create" ? "can_create" : action === "update" ? "can_edit" : "can_delete";
  const allowed = await checkPermission(sbUser, user.id, collab.company_id, "colaboradores", requiredAction);
  if (!allowed) return jsonResponse({ error: "Sem permissão" }, 403);

  const cfg = ENTITY_MAP[kind];
  // Kill-switch global da agenda: quando desligado, todo CRUD de sub-recurso
  // (inclui FÉRIAS da aba do cadastro) vira LOCAL-ONLY. O `data` já vem em
  // formato local (snake_case), então grava direto; external_id fica null.
  const syncOff = isAgendaSyncDisabled();

  // ─────────────────────────────────────────────────────────────────────────
  if (action === "create") {
    if (kind === "ferias") {
      try {
        // Campos opcionais vazios chegam como null; isso não aciona os
        // DEFAULTs do Postgres e viola o NOT NULL dos dias de férias.
        const daysEntitled = vacationDays(data.days_entitled, 30);
        const daysTaken = vacationDays(data.days_taken, 0);
        const daysSold = vacationDays(data.days_sold, 0);
        if (daysEntitled <= 0) throw new Error("Os dias de direito devem ser maiores que zero.");
        if (daysTaken + daysSold > daysEntitled) {
          throw new Error("A soma dos dias gozados e vendidos excede os dias de direito.");
        }
        if (typeof data.start_date !== "string" || !data.start_date ||
            typeof data.end_date !== "string" || !data.end_date) {
          throw new Error("Informe o início e o fim da competência.");
        }
        if (data.end_date < data.start_date) {
          throw new Error("O fim da competência não pode ser antes do início.");
        }
        data = { ...data, days_entitled: daysEntitled, days_taken: daysTaken, days_sold: daysSold };
      } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 400);
      }
    }

    if (syncOff) {
      const dataFiltered: Record<string, unknown> = { ...data };
      for (const f of cfg.localOnlyFields ?? []) {
        delete dataFiltered[f];
      }
      const merged = {
        ...dataFiltered,
        company_id: collab.company_id,
        collaborator_id: collab.id,
        external_id: null,
      };
      const { data: inserted, error: insErr } = await sbAdmin
        .from(cfg.table)
        .insert(merged)
        .select("id")
        .single();
      if (insErr) {
        return jsonResponse({ error: "Insert local falhou", details: insErr.message }, 500);
      }
      return jsonResponse({ success: true, localId: inserted?.id, disabled: true });
    }

    if (!collab.external_id) {
      return jsonResponse(
        { error: "Colaborador sem external_id (não vinculado à agenda). Sincronize antes." },
        400,
      );
    }
    let remote: Record<string, unknown>;
    try {
      remote = (await createSubResource(kind, collab.external_id, cfg.toRemote(data))) as Record<string, unknown>;
    } catch (err) {
      const status = err instanceof SoftcomCloudError ? err.status : 502;
      return jsonResponse({ error: "POST na agenda falhou", details: (err as Error).message }, status);
    }
    const localRow = cfg.fromRemote(remote, { companyId: collab.company_id, collaboratorId: collab.id });
    // Mescla com dados locais que o caller mandou (caso a API não retorne tudo).
    // Filtra os local-only fields — eles entram via patch separado do caller,
    // não no INSERT base (evita falha se a coluna ainda não existir local).
    const dataFiltered: Record<string, unknown> = { ...data };
    for (const f of cfg.localOnlyFields ?? []) {
      delete dataFiltered[f];
    }
    const merged = { ...dataFiltered, ...localRow };
    const { data: inserted, error: insErr } = await sbAdmin
      .from(cfg.table)
      .insert(merged)
      .select("id")
      .single();
    if (insErr) {
      return jsonResponse({ error: "Insert local falhou (mas remoto criado)", details: insErr.message, remote }, 500);
    }
    return jsonResponse({ success: true, localId: inserted?.id, remote });
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (action === "update") {
    if (syncOff) {
      const { error: updErr } = await sbAdmin.from(cfg.table).update(data).eq("id", localId!);
      if (updErr) return jsonResponse({ error: "Update local falhou", details: updErr.message }, 500);
      return jsonResponse({ success: true, disabled: true });
    }

    // Buscar external_id do item local
    const { data: item, error: itErr } = await sbAdmin
      .from(cfg.table)
      .select("external_id")
      .eq("id", localId!)
      .single();
    if (itErr || !item?.external_id) {
      return jsonResponse({ error: "Item não encontrado ou sem external_id" }, 404);
    }
    try {
      await updateSubResource(kind, collab.external_id!, item.external_id as string, cfg.toRemote(data));
    } catch (err) {
      const status = err instanceof SoftcomCloudError ? err.status : 502;
      return jsonResponse({ error: "PUT na agenda falhou", details: (err as Error).message }, status);
    }
    const { error: updErr } = await sbAdmin.from(cfg.table).update(data).eq("id", localId!);
    if (updErr) return jsonResponse({ error: "Update local falhou (remoto ok)", details: updErr.message }, 500);
    return jsonResponse({ success: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const { data: item } = await sbAdmin
      .from(cfg.table)
      .select("external_id")
      .eq("id", localId!)
      .single();
    // Só chama a agenda se ligado E o item tiver vínculo remoto. O delete local roda sempre.
    if (!syncOff && item?.external_id) {
      try {
        await deleteSubResource(kind, collab.external_id!, item.external_id as string);
      } catch (err) {
        const status = err instanceof SoftcomCloudError ? err.status : 502;
        return jsonResponse({ error: "DELETE na agenda falhou", details: (err as Error).message }, status);
      }
    }
    const { error: delErr } = await sbAdmin.from(cfg.table).delete().eq("id", localId!);
    if (delErr) return jsonResponse({ error: "Delete local falhou (remoto ok)", details: delErr.message }, 500);

    // Cascata do plano de saúde: ao remover o plano, apaga os descontos já
    // materializados na folha (external_id 'plano-saude-{ext}-{YYYYMM}') dos
    // períodos ABERTOS (preserva fechados/exportados — folha finalizada). Sem
    // isto o desconto fica órfão na folha após o RH excluir o plano no cadastro.
    let cascaded = 0;
    if (kind === "planos" && item?.external_id) {
      try {
        cascaded = await prunePlanoSaudeDeductions(
          sbAdmin,
          collab.id,
          collab.company_id,
          String(item.external_id),
        );
      } catch (err) {
        // Não derruba a exclusão do plano por causa do cascata; loga e segue.
        console.error("Falha na cascata de desconto de plano de saúde:", (err as Error).message);
      }
    }
    return jsonResponse({ success: true, cascaded });
  }

  return jsonResponse({ error: "action desconhecido" }, 400);
});

// Remove os descontos de folha gerados por um plano de saúde (external_id
// 'plano-saude-{planExternalId}-{YYYYMM}') dos períodos ABERTOS do colaborador.
// Preserva períodos fechados/exportados (folha finalizada). Retorna nº removido.
async function prunePlanoSaudeDeductions(
  // deno-lint-ignore no-explicit-any
  sbAdmin: any,
  collaboratorId: string,
  companyId: string,
  planExternalId: string,
): Promise<number> {
  const { data: deds } = await sbAdmin
    .from("payroll_entries")
    .select("id, month, year")
    .eq("collaborator_id", collaboratorId)
    .like("external_id", `plano-saude-${planExternalId}-%`);
  if (!deds || deds.length === 0) return 0;

  const { data: periods } = await sbAdmin
    .from("payroll_periods")
    .select("reference_month, status")
    .eq("company_id", companyId);
  // Meses TRAVADOS a preservar (chave "YYYY-M"). Editável = rascunho ou
  // aprovado pelo RH; a folha só congela quando a diretoria aprova (espelha
  // public.payroll_period_is_locked — migration 20260727120100). Enumeramos os
  // editáveis, nunca os travados: status novo nasce travado por padrão.
  const EDITABLE_PERIOD_STATUSES = ["open", "aprovado_rh"];
  const closedMonths = new Set<string>();
  for (const p of (periods ?? []) as Array<{ reference_month: string; status: string }>) {
    if (p.status && !EDITABLE_PERIOD_STATUSES.includes(p.status)) {
      const ym = String(p.reference_month).substring(0, 7).split("-");
      closedMonths.add(`${Number(ym[0])}-${Number(ym[1])}`);
    }
  }

  const idsToDelete = (deds as Array<{ id: string; month: number; year: number }>)
    .filter((d) => !closedMonths.has(`${d.year}-${d.month}`))
    .map((d) => d.id);
  if (idsToDelete.length === 0) return 0;

  const { error } = await sbAdmin.from("payroll_entries").delete().in("id", idsToDelete);
  if (error) throw new Error(error.message);
  return idsToDelete.length;
}

// ─────────────────────────────────────────────────────────────────────────────

function vacationDays(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Informe quantidades inteiras e não negativas para os dias de férias.");
  }
  return value;
}

async function checkPermission(
  // deno-lint-ignore no-explicit-any
  sbUser: any,
  userId: string,
  companyId: string,
  module: string,
  action: "can_view" | "can_create" | "can_edit" | "can_delete",
): Promise<boolean> {
  const { data: isAdmin } = await sbUser.rpc("is_company_admin", {
    _user_id: userId,
    _company_id: companyId,
  });
  if (isAdmin === true) return true;
  const { data: perms } = await sbUser.rpc("get_user_permissions", {
    _user_id: userId,
    _company_id: companyId,
    _module: module,
  });
  const first = Array.isArray(perms) ? perms[0] : perms;
  return Boolean(first?.[action]);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
