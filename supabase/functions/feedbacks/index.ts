// Edge Function: feedbacks
//
// Proxy AO VIVO (sem espelho local) pro painel de Feedback do Colaborador /
// Guardião da Cultura na API legada api.softcom.cloud. Diferente de
// `collaborator-subresource`, NÃO grava em tabela local. Complementa o painel
// com a data de admissão do cadastro do DNA para segmentação por tempo de casa.
//
// Body:
//   {
//     action: 'feedbacks-list' | 'busca-colaborador' | 'objetivos-list'
//           | 'objetivo-create' | 'objetivo-update' | 'objetivo-delete',
//     companyId: uuid (local — pra checagem de permissão),
//     // filtros / ids (conforme a action):
//     suporteId?: number,            // feedbacks-list (1 colaborador)
//     lancamentoUsuarioId?: number,  // feedbacks-list (filtro Guardião)
//     q?: string,                    // busca-colaborador
//     colaboradorId?: number,        // objetivos-* (Suporte_ID legado)
//     itemId?: number,               // objetivo-update / objetivo-delete
//     data?: object,                 // objetivo-create / objetivo-update (campos camelCase da agenda)
//   }
//
// Permissão (módulo 'feedback'): can_view nas leituras; can_create/edit/delete
// nas mutations (+admin bypass).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  buscaColaborador,
  createObjetivo,
  deleteObjetivo,
  listFeedbacks,
  listObjetivos,
  SoftcomCloudError,
  updateObjetivo,
} from "../_shared/softcom-cloud.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODULE = "feedback";

type Action =
  | "feedbacks-list"
  | "busca-colaborador"
  | "objetivos-list"
  | "objetivo-create"
  | "objetivo-update"
  | "objetivo-delete";

const PERMISSION_BY_ACTION: Record<Action, "can_view" | "can_create" | "can_edit" | "can_delete"> = {
  "feedbacks-list": "can_view",
  "busca-colaborador": "can_view",
  "objetivos-list": "can_view",
  "objetivo-create": "can_create",
  "objetivo-update": "can_edit",
  "objetivo-delete": "can_delete",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing auth" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const sbUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await sbUser.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Invalid token" }, 401);

  let body: Record<string, unknown>;
  let action: Action;
  let companyId: string;
  try {
    body = await req.json();
    action = body.action as Action;
    companyId = String(body.companyId ?? "").trim();
    if (!PERMISSION_BY_ACTION[action]) throw new Error("action inválido");
    if (!companyId) throw new Error("missing companyId");
  } catch (e) {
    return jsonResponse({ error: "Body inválido: " + (e as Error).message }, 400);
  }

  const allowed = await checkPermission(
    sbUser,
    user.id,
    companyId,
    MODULE,
    PERMISSION_BY_ACTION[action],
  );
  if (!allowed) return jsonResponse({ error: "Sem permissão" }, 403);

  try {
    switch (action) {
      case "feedbacks-list": {
        const result = await listFeedbacks({
          suporteId: numOrUndef(body.suporteId),
          lancamentoUsuarioId: numOrUndef(body.lancamentoUsuarioId),
        });
        if (result.colaboradores.length === 0) return jsonResponse(result);

        // A permissão de feedback já foi validada acima. Lê somente as datas
        // dos IDs presentes no painel e pertencentes à empresa autorizada.
        const sbAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const ids = [...new Set(result.colaboradores.map((c) => String(c.id)))];
        const admissionDates = new Map<string, string | null>();
        for (let offset = 0; offset < ids.length; offset += 200) {
          const { data: collaborators, error } = await sbAdmin
            .from("collaborators")
            .select("external_id, admission_date")
            .eq("company_id", companyId)
            .in("external_id", ids.slice(offset, offset + 200));
          if (error) throw new Error("Não foi possível carregar as datas de admissão.");
          for (const collaborator of collaborators ?? []) {
            admissionDates.set(collaborator.external_id, collaborator.admission_date);
          }
        }

        return jsonResponse({
          ...result,
          colaboradores: result.colaboradores.map((c) => ({
            ...c,
            dataAdmissao: admissionDates.get(String(c.id)) ?? null,
          })),
        });
      }
      case "busca-colaborador": {
        const result = await buscaColaborador(
          typeof body.q === "string" ? body.q : undefined,
        );
        return jsonResponse(result);
      }
      case "objetivos-list": {
        const colaboradorId = requireNum(body.colaboradorId, "colaboradorId");
        return jsonResponse(await listObjetivos(colaboradorId));
      }
      case "objetivo-create": {
        const colaboradorId = requireNum(body.colaboradorId, "colaboradorId");
        const result = await createObjetivo(
          colaboradorId,
          (body.data ?? {}) as Record<string, unknown>,
        );
        return jsonResponse({ success: true, item: result });
      }
      case "objetivo-update": {
        const colaboradorId = requireNum(body.colaboradorId, "colaboradorId");
        const itemId = requireNum(body.itemId, "itemId");
        await updateObjetivo(
          colaboradorId,
          itemId,
          (body.data ?? {}) as Record<string, unknown>,
        );
        return jsonResponse({ success: true });
      }
      case "objetivo-delete": {
        const colaboradorId = requireNum(body.colaboradorId, "colaboradorId");
        const itemId = requireNum(body.itemId, "itemId");
        await deleteObjetivo(colaboradorId, itemId);
        return jsonResponse({ success: true });
      }
    }
  } catch (err) {
    if (err instanceof SoftcomCloudError) {
      return jsonResponse({ error: "Falha na agenda", details: err.message }, err.status);
    }
    return jsonResponse({ error: "Erro inesperado", details: (err as Error).message }, 500);
  }

  return jsonResponse({ error: "action desconhecido" }, 400);
});

// ─────────────────────────────────────────────────────────────────────────────

function numOrUndef(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function requireNum(v: unknown, field: string): number {
  const n = numOrUndef(v);
  if (n == null) throw new SoftcomCloudError(400, `${field} obrigatório/ inválido`);
  return n;
}

async function checkPermission(
  sbUser: ReturnType<typeof createClient>,
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
