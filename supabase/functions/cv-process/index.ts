// Edge Function: cv-process
//
// Processa o PDF do CV de um candidato:
//   1. Baixa o PDF (do Storage bucket 'candidate-cvs' OU de URL pública externa)
//   2. Envia pra IA (iarouter/dna-model) que extrai resumo estruturado em pt-BR
//   3. Embed do resumo via OpenAI (text-embedding-3-small @ 1536)
//   4. Upsert em candidate_embeddings + atualiza candidates (cv_url se filePath,
//      cv_summary, cv_processed_at)
//
// Body: { candidateId: uuid, filePath?: string, cvUrl?: string }
//   - filePath: path no bucket 'candidate-cvs' (fluxo de upload via UI)
//   - cvUrl: URL pública (fluxo via api-candidates / migração)
//   Um dos dois é obrigatório.
//
// Auth: aceita JWT de user (admin_gc/gestor_gc/rh) OU service_role (chamada
// interna entre Edge Functions, ex: api-candidates).
//
// Deploy: npx supabase functions deploy cv-process
// Secrets necessários: ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (iarouter, p/ Claude),
//                      OPENAI_API_KEY (embeddings), SUPABASE_SERVICE_ROLE_KEY (auto)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  callClaude,
  extractTextFromResponse,
} from "../_shared/claude.ts";
import { embedText, EMBED_MODEL_LABEL } from "../_shared/embeddings.ts";
import { rateLimitTake } from "../_shared/rate-limit.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CV_EXTRACTION_PROMPT = `Você é um analista de RH especializado em extrair informações estruturadas de currículos brasileiros.

Recebe o PDF de um currículo e devolve um RESUMO ESTRUTURADO em pt-BR no formato:

## Resumo profissional
(2-3 linhas sobre quem é a pessoa profissionalmente)

## Habilidades técnicas
- (skill 1)
- (skill 2)
- ...

## Habilidades comportamentais
- (soft skill 1)
- ...

## Experiência
- **(Empresa)** — (Cargo) — (período: AAAA-AAAA ou AAAA-presente)
  - (1-2 linhas do que fez)
- ...

## Educação
- **(Instituição)** — (Curso) — (período)

## Idiomas
- (idioma 1: nível)
- ...

## Outras observações relevantes
(certificações, projetos, voluntariado, etc.)

Regras:
- Português brasileiro.
- Seja objetivo e estruturado, não comente sobre o documento.
- Se uma seção não aparecer no CV, omita inteiramente (não escreva "não informado").
- Não inclua dados sensíveis como CPF, RG, endereço completo no resumo.
- Foco no que ajuda numa busca por matching de vaga: skills, experiência, formação.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  // GET /?ping=claude — smoke test do Claude (sem PDF, sem auth)
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("ping") === "claude") {
      const t0 = Date.now();
      try {
        const resp = await Promise.race([
          callClaude({
            messages: [{ role: "user", content: "Diga 'ok' e nada mais." }],
            maxTokens: 10,
            direct: true,
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout 30s")), 30000)
          ),
        ]);
        return jsonResponse({
          ok: true,
          ms: Date.now() - t0,
          text: extractTextFromResponse(resp),
          model: resp.model,
          baseUrl: Deno.env.get("ANTHROPIC_BASE_URL") || "default",
        });
      } catch (e) {
        return jsonResponse({
          ok: false,
          ms: Date.now() - t0,
          error: (e as Error).message,
          baseUrl: Deno.env.get("ANTHROPIC_BASE_URL") || "default",
        }, 500);
      }
    }
    return jsonResponse({ ok: true, hint: "Use ?ping=claude pra smoke test" });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
    );
  }

  // 1. Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Detecta chamada interna (service_role) — bypassa permission check.
  // Usada por api-candidates pra disparar cv-process após inserção.
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  const isInternalCall = bearerToken === serviceKey;

  // Cliente admin pra storage + DB writes (bypassa RLS pra service_role)
  const sbAdmin = createClient(supabaseUrl, serviceKey);

  // 2. Parse body
  let candidateId: string;
  let filePath: string | undefined;
  let cvUrl: string | undefined;
  try {
    const body = await req.json();
    candidateId = body.candidateId;
    filePath = body.filePath;
    cvUrl = body.cvUrl;
    if (!candidateId || (!filePath && !cvUrl)) throw new Error("missing");
  } catch {
    return jsonResponse(
      { error: "Body must include { candidateId, filePath?, cvUrl? }" },
      400,
    );
  }

  // Rate-limit: processar CV chama IA (custo). Por candidato (10 a cada 10 min —
  // reprocessar acontece, loop não) mais teto global por minuto. Fail-open.
  const okCand = await rateLimitTake(sbAdmin, "cv-process", candidateId, 10, 600);
  const okGlobal = await rateLimitTake(sbAdmin, "cv-process:global", "all", 90, 60);
  if (!okCand || !okGlobal) {
    return jsonResponse(
      { error: "Muitos processamentos em pouco tempo. Tenta de novo em instantes." },
      429,
    );
  }

  // 3. Verifica candidate
  const { data: candidate, error: candErr } = await sbAdmin
    .from("candidates")
    .select("id, company_id, name")
    .eq("id", candidateId)
    .single();

  if (candErr || !candidate) {
    return jsonResponse({ error: "Candidate not found" }, 404);
  }

  // Permission check só em chamada de user (não em service_role interna)
  if (!isInternalCall) {
    const sbUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await sbUser.auth.getUser();
    if (authErr || !user) {
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    const { data: roles } = await sbUser
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roleStrings = (roles ?? []).map((r) =>
      String((r as { role: string }).role),
    );
    const isAdmin = roleStrings.includes("admin_gc") ||
      roleStrings.includes("admin");
    const isGestor = roleStrings.includes("gestor_gc") ||
      roleStrings.includes("rh");

    if (!isAdmin && !isGestor) {
      return jsonResponse(
        { error: "Sem permissão pra processar CVs" },
        403,
      );
    }

    // gestor_gc: precisa pertencer à empresa do candidato
    if (!isAdmin && isGestor) {
      const { data: belongs } = await sbUser.rpc("user_belongs_to_company", {
        _company_id: candidate.company_id,
        _user_id: user.id,
      });
      if (!belongs) {
        return jsonResponse(
          { error: "Candidato não é da sua empresa" },
          403,
        );
      }
    }
  }

  // Helpers de tracing/timeouts pra identificar etapa lenta
  const trace: Array<{ step: string; ms: number; ok: boolean; info?: string }> = [];
  const tStart = Date.now();
  const stepStart = () => Date.now();
  const stepEnd = (name: string, t0: number, ok: boolean, info?: string) => {
    const ms = Date.now() - t0;
    trace.push({ step: name, ms, ok, info });
    console.log(`[cv-process] ${name}: ${ms}ms ${ok ? "ok" : "FAIL"}${info ? ` (${info})` : ""}`);
  };
  const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`Timeout ${ms}ms em ${label}`)), ms)
      ),
    ]);
  };

  // 4. Obtém PDF — Storage (filePath) OU HTTP fetch (cvUrl)
  let buffer: ArrayBuffer;
  let t0 = stepStart();
  if (filePath) {
    try {
      const { data: pdfBlob, error: dlErr } = await withTimeout(
        sbAdmin.storage.from("candidate-cvs").download(filePath),
        15000,
        "storage.download",
      );
      if (dlErr || !pdfBlob) throw new Error(dlErr?.message ?? "no blob");
      buffer = await pdfBlob.arrayBuffer();
      stepEnd("download_storage", t0, true, `${Math.round(buffer.byteLength / 1024)}KB`);
    } catch (err) {
      stepEnd("download_storage", t0, false, (err as Error).message);
      return jsonResponse({ error: "PDF não encontrado no Storage", trace }, 404);
    }
  } else {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(cvUrl!, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        stepEnd("fetch_cv_url", t0, false, `HTTP ${resp.status}`);
        return jsonResponse({ error: `HTTP ${resp.status} ao baixar CV`, trace }, 422);
      }
      buffer = await resp.arrayBuffer();
      stepEnd("fetch_cv_url", t0, true, `${Math.round(buffer.byteLength / 1024)}KB`);
    } catch (err) {
      stepEnd("fetch_cv_url", t0, false, (err as Error).message);
      return jsonResponse({ error: "Falha baixando CV da URL", trace }, 422);
    }
  }

  t0 = stepStart();
  const base64Pdf = arrayBufferToBase64(buffer);
  stepEnd("base64_encode", t0, true, `${Math.round(base64Pdf.length / 1024)}KB`);

  // 5. Claude extrai resumo estruturado (timeout 50s, antes do Edge timeout de 60s)
  t0 = stepStart();
  let summary: string;
  let tokenCount = 0;
  try {
    const claudeResp = await withTimeout(
      callClaude({
        system: CV_EXTRACTION_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64Pdf,
                },
              },
              {
                type: "text",
                text: `Currículo de ${candidate.name}. Extraia o resumo estruturado conforme o formato solicitado.`,
              },
            ],
          },
        ],
        maxTokens: 2000,
        direct: true,
      }),
      50000,
      "claude.messages.create",
    );
    tokenCount = (claudeResp.usage?.input_tokens ?? 0) + (claudeResp.usage?.output_tokens ?? 0);
    summary = extractTextFromResponse(claudeResp).trim();
    if (!summary || summary.length < 20) {
      throw new Error("Resumo vazio ou muito curto");
    }
    stepEnd("claude", t0, true, `${summary.length} chars`);
  } catch (err) {
    stepEnd("claude", t0, false, (err as Error).message);
    return jsonResponse(
      {
        error: "Falha ao processar PDF com Claude",
        details: (err as Error).message,
        trace,
        totalMs: Date.now() - tStart,
      },
      500,
    );
  }

  // 6. Embedding (OpenAI — text-embedding-3-small @ 1536)
  let embedding: number[];
  try {
    embedding = await embedText(summary);
  } catch (err) {
    return jsonResponse(
      {
        error: "Falha no embedding",
        details: (err as Error).message,
      },
      500,
    );
  }

  // 7. Upsert embedding + atualiza candidates
  const { error: upsertErr } = await sbAdmin
    .from("candidate_embeddings")
    .upsert(
      {
        candidate_id: candidateId,
        company_id: candidate.company_id,
        content: summary,
        embedding: JSON.stringify(embedding),
        model: EMBED_MODEL_LABEL,
        token_count: summary.length,
      },
      { onConflict: "candidate_id" },
    );

  if (upsertErr) {
    return jsonResponse(
      { error: "Falha ao salvar embedding", details: upsertErr.message },
      500,
    );
  }

  // Atualiza candidates: cv_url só quando veio de filePath (Storage); pra cvUrl
  // externa preserva o valor já existente na linha.
  const updates: Record<string, unknown> = {
    cv_summary: summary,
    cv_processed_at: new Date().toISOString(),
  };
  if (filePath) updates.cv_url = filePath;

  await sbAdmin.from("candidates").update(updates).eq("id", candidateId);

  return jsonResponse({
    success: true,
    summary,
    tokens: tokenCount,
    candidateId,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
