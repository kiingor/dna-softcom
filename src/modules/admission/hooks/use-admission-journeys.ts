import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";
import type {
  AdmissionJourney,
  AdmissionJourneyStatus,
  CollaboratorRegime,
  AdmissionJourneyWithCounts,
} from "../types";
import type { NewAdmissionValues } from "../schemas/admission.schema";
import { REQUIRED_DOCS_BY_REGIME, DOCUMENT_TYPE_LABELS } from "../types";
import { getExamsForRiskGroup } from "@/lib/riskGroupDefaults";

interface UseAdmissionJourneysOptions {
  status?: AdmissionJourneyStatus | "all";
  regime?: CollaboratorRegime | "all";
}

// Gera token URL-safe ~32 chars (uuid-style sem hyphens, com timestamp)
function generateAccessToken(): string {
  const a = crypto.randomUUID().replace(/-/g, "");
  return `adm_${a}`;
}

// Tenta casar nome livre do position_document com enum DocumentType.
// Match heurístico — normaliza pra lowercase + remove acentos.
const DOC_NAME_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\bctps\b|carteira.*trabalho/, type: "ctps" },
  { pattern: /\brg\b|identidade/, type: "rg" },
  { pattern: /\bcpf\b/, type: "cpf" },
  { pattern: /comprovante.*endere|residencia/, type: "comprovante_endereco" },
  { pattern: /foto.*3.*4|3x4/, type: "foto_3x4" },
  { pattern: /atestado.*exame|admissional|aso/, type: "atestado_exame" },
  { pattern: /contrato.*social/, type: "contrato_social" },
  { pattern: /cnpj/, type: "cnpj_doc" },
  { pattern: /matr[ií]cula/, type: "comprovante_matricula" },
  { pattern: /\btce\b|termo.*compromisso/, type: "tce" },
];

function matchDocTypeFromName(name: string): string | null {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  for (const { pattern, type } of DOC_NAME_PATTERNS) {
    if (pattern.test(normalized)) return type;
  }
  return null;
}

// Decisão Q7: TTL de 30 dias com regenerar
const TOKEN_TTL_DAYS = 30;

function tokenExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_TTL_DAYS);
  return d.toISOString();
}

export function useAdmissionJourneys(options: UseAdmissionJourneysOptions = {}) {
  const { currentCompany } = useDashboard();
  const queryClient = useQueryClient();
  const companyId = currentCompany?.id;

  const { data: journeys = [], isLoading } = useQuery({
    queryKey: ["admission-journeys", companyId, options.status, options.regime],
    queryFn: async () => {
      if (!companyId) return [];
      let q = supabase
        .from("admission_journeys")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (options.status && options.status !== "all") q = q.eq("status", options.status);
      if (options.regime && options.regime !== "all") q = q.eq("regime", options.regime);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AdmissionJourneyWithCounts[];
    },
    enabled: !!companyId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cria nova journey + auto-popula admission_documents.
  // Se tem cargo (position_id) com documentos cadastrados em position_documents,
  // usa esses. Caso contrário, fallback pro default por regime.
  // Exame ocupacional é definido pelo risk_group do cargo (mecânica existente).
  // ─────────────────────────────────────────────────────────────────────────
  const createJourney = useMutation({
    mutationFn: async (values: NewAdmissionValues) => {
      if (!companyId) throw new Error("Empresa não encontrada");

      const { data: userData } = await supabase.auth.getUser();
      const accessToken = generateAccessToken();

      // 0. Se tem cargo vinculado, busca os documentos cadastrados nele.
      let positionDocs: {
        name: string;
        observation: string | null;
        file_type: string;
      }[] = [];
      let positionRiskGroup: string | null = null;
      if (values.position_id) {
        const [docsRes, posRes] = await Promise.all([
          supabase
            .from("position_documents")
            .select("name, observation, file_type")
            .eq("position_id", values.position_id),
          supabase
            .from("positions")
            .select("risk_group")
            .eq("id", values.position_id)
            .maybeSingle(),
        ]);
        positionDocs = (docsRes.data ?? []) as typeof positionDocs;
        positionRiskGroup =
          (posRes.data as { risk_group: string | null } | null)?.risk_group ??
          null;
      }

      // 0b. Exames padrão pelo grupo de risco
      const requiredExams = getExamsForRiskGroup(positionRiskGroup);

      // 1. Cria journey
      const { data: journey, error: journeyError } = await supabase
        .from("admission_journeys")
        .insert({
          company_id: companyId,
          candidate_name: values.candidate_name,
          candidate_email: values.candidate_email || null,
          candidate_phone: values.candidate_phone || null,
          candidate_cpf: values.candidate_cpf || null,
          regime: values.regime,
          position_id: values.position_id || null,
          status: "docs_pending",
          access_token: accessToken,
          token_expires_at: tokenExpiry(),
          notes: values.notes || null,
          created_by: userData?.user?.id ?? null,
        })
        .select()
        .single();

      if (journeyError) throw journeyError;
      if (!journey) throw new Error("Falha ao criar admissão");

      // 2. Popula docs:
      //    - Se cargo tem position_documents, usa esses (mapeando nome → enum
      //      DocumentType quando possível, senão "outro").
      //    - Senão, fallback pro default do regime.
      const docsToInsert =
        positionDocs.length > 0
          ? positionDocs.map((d) => {
              const isText = d.file_type === "texto";
              const isYesNo = d.file_type === "sim_nao";
              // Docs com tipo de resposta especial (texto/sim_nao) sempre vão
              // como 'outro' e marcam o tipo via prefixo em notes pra UI saber.
              const useOutro = isText || isYesNo;
              const mapped = useOutro ? null : matchDocTypeFromName(d.name);
              const baseNotes = mapped
                ? d.observation
                : `${d.name}${d.observation ? ` — ${d.observation}` : ""}`;
              const prefix = isText ? "[TEXTO] " : isYesNo ? "[SIM_NAO] " : "";
              return {
                company_id: companyId,
                journey_id: journey.id,
                doc_type: mapped ?? ("outro" as const),
                required: true,
                status: "pending" as const,
                notes: prefix + (baseNotes ?? ""),
              };
            })
          : REQUIRED_DOCS_BY_REGIME[values.regime].map((docType) => ({
              company_id: companyId,
              journey_id: journey.id,
              doc_type: docType,
              required: true,
              status: "pending" as const,
            }));

      const { error: docsError } = await supabase
        .from("admission_documents")
        .insert(docsToInsert);

      if (docsError) throw docsError;

      // 2b. Cria 1 admission_document por exame exigido (doc_type='atestado_exame',
      //     notes guardam o slug + label do exame). Diferenciamos do "atestado
      //     único" pelo formato `EXAM:slug — label` em notes.
      if (requiredExams.length > 0) {
        const examEntries = requiredExams.map((exam) => ({
          company_id: companyId,
          journey_id: journey.id,
          doc_type: "atestado_exame" as const,
          required: true,
          status: "pending" as const,
          notes: `EXAM:${exam.slug} — ${exam.label}`,
        }));
        const { error: examErr } = await supabase
          .from("admission_documents")
          .insert(examEntries);
        if (examErr) console.warn("[admission] falha ao gerar exames:", examErr);
      }

      // 3. Evento na timeline
      const examLine = positionRiskGroup
        ? ` · Exame admissional (Grupo ${positionRiskGroup})`
        : "";
      const { error: eventError } = await supabase.from("admission_events").insert({
        company_id: companyId,
        journey_id: journey.id,
        kind: "created",
        actor_id: userData?.user?.id ?? null,
        message: `Admissão criada para ${values.candidate_name} (${values.regime.toUpperCase()})${examLine}`,
      });

      if (eventError) console.error("Erro ao registrar evento:", eventError);

      // 4. Auto-envio do link por email se candidato tem email cadastrado.
      //    Falha silenciosa: RH ainda pode reenviar manualmente no detail.
      if (values.candidate_email) {
        try {
          await supabase.functions.invoke("admission-send-token", {
            body: {
              journey_id: journey.id,
              public_url_origin: window.location.origin,
            },
          });
        } catch (err) {
          console.warn("[admission] auto-send do email falhou:", err);
        }
      }

      // 5. Auto-envio do link por WhatsApp se tem telefone.
      //    Edge function admission-send-whatsapp precisa estar deployada.
      //    Falha silenciosa: RH pode reenviar manualmente.
      if (values.candidate_phone) {
        try {
          await supabase.functions.invoke("admission-send-whatsapp", {
            body: {
              journey_id: journey.id,
              public_url_origin: window.location.origin,
            },
          });
        } catch (err) {
          console.warn("[admission] auto-send do whatsapp falhou:", err);
        }
      }

      return journey;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-journeys"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Admissão criada ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reenvia link por WhatsApp (botão "Enviar por WhatsApp" no detail)
  // ─────────────────────────────────────────────────────────────────────────
  const sendTokenWhatsApp = useMutation({
    mutationFn: async (journeyId: string) => {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        sent_to: string;
        channel: string;
      }>("admission-send-whatsapp", {
        body: {
          journey_id: journeyId,
          public_url_origin: window.location.origin,
        },
      });

      if (error) {
        let msg = error.message;
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string; details?: string }> } }).context;
        if (ctx?.json) {
          try {
            const body = await ctx.json();
            if (body?.error) msg = body.error + (body.details ? ` — ${body.details}` : "");
          } catch {
            // ignore
          }
        }
        throw new Error(msg);
      }
      if (!data) throw new Error("Resposta vazia");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success(`WhatsApp enviado pra ${data.sent_to} ✓`);
    },
    onError: (err: Error) => {
      toast.error("Não rolou enviar. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reenvia link por email (botão "Enviar por email" no detail)
  // ─────────────────────────────────────────────────────────────────────────
  const sendTokenEmail = useMutation({
    mutationFn: async (journeyId: string) => {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        sent_to: string;
        resend_id: string;
      }>("admission-send-token", {
        body: {
          journey_id: journeyId,
          public_url_origin: window.location.origin,
        },
      });

      if (error) {
        let msg = error.message;
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string; details?: string }> } }).context;
        if (ctx?.json) {
          try {
            const body = await ctx.json();
            if (body?.error) msg = body.error + (body.details ? ` — ${body.details}` : "");
          } catch {
            // ignore
          }
        }
        throw new Error(msg);
      }
      if (!data) throw new Error("Resposta vazia");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success(`Email enviado pra ${data.sent_to} ✓`);
    },
    onError: (err: Error) => {
      toast.error("Não rolou enviar. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Atualiza status (e registra evento)
  // ─────────────────────────────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      message,
    }: {
      id: string;
      status: AdmissionJourneyStatus;
      message?: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();

      const { error: updateError } = await supabase
        .from("admission_journeys")
        .update({ status })
        .eq("id", id);

      if (updateError) throw updateError;

      // Mapeia status → kind do evento
      const kindByStatus: Partial<Record<AdmissionJourneyStatus, string>> = {
        cancelled: "cancelled",
        admitted: "admitted",
        contract_signed: "contract_signed",
        exam_scheduled: "exam_scheduled",
        exam_done: "exam_completed",
      };

      const kind = (kindByStatus[status] ?? "note") as
        | "cancelled"
        | "admitted"
        | "contract_signed"
        | "exam_scheduled"
        | "exam_completed"
        | "note";

      if (companyId) {
        await supabase.from("admission_events").insert({
          company_id: companyId,
          journey_id: id,
          kind,
          actor_id: userData?.user?.id ?? null,
          message: message ?? `Status mudou para "${status}"`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-journeys"] });
      queryClient.invalidateQueries({ queryKey: ["admission-journey"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Atualizado ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Regenera access_token (decisão Q7: regenerável)
  // ─────────────────────────────────────────────────────────────────────────
  const regenerateToken = useMutation({
    mutationFn: async (id: string) => {
      const newToken = generateAccessToken();
      const { error } = await supabase
        .from("admission_journeys")
        .update({
          access_token: newToken,
          token_expires_at: tokenExpiry(),
        })
        .eq("id", id);
      if (error) throw error;

      if (companyId) {
        const { data: userData } = await supabase.auth.getUser();
        await supabase.from("admission_events").insert({
          company_id: companyId,
          journey_id: id,
          kind: "token_sent",
          actor_id: userData?.user?.id ?? null,
          message: "Link de acesso regenerado (validade 30 dias)",
        });
      }
      return newToken;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-journey"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Link regenerado ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Exclui a journey (cascade ON DELETE remove documents + events)
  // ─────────────────────────────────────────────────────────────────────────
  const deleteJourney = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("admission_journeys")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-journeys"] });
      queryClient.invalidateQueries({ queryKey: ["admission-journey"] });
      toast.success("Admissão removida ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  return {
    journeys,
    isLoading,
    createJourney,
    updateStatus,
    regenerateToken,
    sendTokenEmail,
    sendTokenWhatsApp,
    deleteJourney,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single journey por id (pra detail page)
// ─────────────────────────────────────────────────────────────────────────────

export function useAdmissionJourney(id: string | undefined) {
  return useQuery({
    queryKey: ["admission-journey", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("admission_journeys")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as AdmissionJourney;
    },
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
}

// Helper exportado pra construir URL pública do form do candidato
export function buildCandidateFormUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/admissao/${token}`;
}

// Lista legível de docs requeridos pra mostrar em UI
export function listRequiredDocs(regime: CollaboratorRegime): string {
  return REQUIRED_DOCS_BY_REGIME[regime]
    .map((d) => DOCUMENT_TYPE_LABELS[d])
    .join(", ");
}
