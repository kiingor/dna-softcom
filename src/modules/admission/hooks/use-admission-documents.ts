import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";
import type { AdmissionDocument, AIValidationResult } from "../types";
import type { RejectDocumentValues } from "../schemas/admission.schema";

interface ValidateResponse {
  success: boolean;
  result: AIValidationResult;
  confidence: number;
}

export function useAdmissionDocuments(journeyId: string | undefined) {
  const { currentCompany } = useDashboard();
  const queryClient = useQueryClient();
  const companyId = currentCompany?.id;

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["admission-documents", journeyId],
    queryFn: async () => {
      if (!journeyId) return [];
      const { data, error } = await supabase
        .from("admission_documents")
        .select("*")
        .eq("journey_id", journeyId)
        .order("doc_type", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdmissionDocument[];
    },
    enabled: !!journeyId,
    // O candidato envia em outra sessão; o cache do painel não é invalidado lá.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const approveDocument = useMutation({
    mutationFn: async (documentId: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data: doc, error: fetchError } = await supabase
        .from("admission_documents")
        .select("doc_type")
        .eq("id", documentId)
        .single();
      if (fetchError) throw fetchError;

      const { error } = await supabase
        .from("admission_documents")
        .update({
          status: "approved",
          reviewer_id: userData?.user?.id ?? null,
          reviewed_at: new Date().toISOString(),
          rejection_reason: null,
        })
        .eq("id", documentId);
      if (error) throw error;

      if (companyId && journeyId) {
        await supabase.from("admission_events").insert({
          company_id: companyId,
          journey_id: journeyId,
          kind: "doc_approved",
          actor_id: userData?.user?.id ?? null,
          document_id: documentId,
          message: `Documento "${doc?.doc_type}" aprovado`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-documents"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Documento ok ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  const rejectDocument = useMutation({
    mutationFn: async ({
      documentId,
      values,
    }: {
      documentId: string;
      values: RejectDocumentValues;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data: doc } = await supabase
        .from("admission_documents")
        .select("doc_type")
        .eq("id", documentId)
        .single();

      const { error } = await supabase
        .from("admission_documents")
        .update({
          status: "needs_adjustment",
          reviewer_id: userData?.user?.id ?? null,
          reviewed_at: new Date().toISOString(),
          rejection_reason: values.rejection_reason,
        })
        .eq("id", documentId);
      if (error) throw error;

      if (companyId && journeyId) {
        await supabase.from("admission_events").insert({
          company_id: companyId,
          journey_id: journeyId,
          kind: "doc_rejected",
          actor_id: userData?.user?.id ?? null,
          document_id: documentId,
          message: `"${doc?.doc_type}" precisa de ajuste: ${values.rejection_reason}`,
        });
      }

      // Avisa o candidato via WhatsApp se ele tem telefone cadastrado.
      // Falha silenciosa — RH pode reenviar manualmente do detail.
      if (journeyId) {
        try {
          await supabase.functions.invoke("admission-send-whatsapp", {
            body: {
              journey_id: journeyId,
              public_url_origin: window.location.origin,
              context: "needs_adjustment",
              doc_label: doc?.doc_type,
              reason: values.rejection_reason,
            },
          });
        } catch (err) {
          console.warn("[admission] notify whatsapp falhou:", err);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-documents"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Ajuste solicitado. Candidato será avisado.");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  const validateDocument = useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await supabase.functions.invoke<ValidateResponse>(
        "admission-document-validate",
        { body: { document_id: documentId } },
      );
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
      if (!data || !data.success) throw new Error("Resposta inválida da IA");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-documents"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Parecer da IA pronto.");
    },
    onError: (err: Error) => {
      toast.error("IA não conseguiu validar. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // Cria um admission_document de exame on-demand (usado quando o RH precisa
  // anexar exame em admissão antiga, antes da feature de auto-geração).
  const createExamDoc = useMutation({
    mutationFn: async ({
      slug,
      label,
    }: {
      slug: string;
      label: string;
    }) => {
      if (!journeyId || !companyId) throw new Error("Faltam ids");
      const { data, error } = await supabase
        .from("admission_documents")
        .insert({
          company_id: companyId,
          journey_id: journeyId,
          doc_type: "atestado_exame",
          required: true,
          status: "pending",
          notes: `EXAM:${slug} — ${label}`,
        })
        .select()
        .single();
      if (error) throw error;
      return data as AdmissionDocument;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-documents"] });
    },
  });

  // Upload manual de arquivo pra um doc existente (ex: RH recebe atestado
  // por outro canal). Path no bucket: <company_id>/<journey_id>/<doc_id>.<ext>
  const uploadDocFile = useMutation({
    mutationFn: async ({
      documentId,
      file,
    }: {
      documentId: string;
      file: File;
    }) => {
      if (!journeyId || !companyId) throw new Error("Faltam ids");

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${companyId}/${journeyId}/${documentId}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("admission-docs")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: userData } = await supabase.auth.getUser();
      const { error: updErr } = await supabase
        .from("admission_documents")
        .update({
          status: "submitted",
          file_url: path,
          file_name: file.name,
          uploaded_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      if (updErr) throw updErr;

      await supabase.from("admission_events").insert({
        company_id: companyId,
        journey_id: journeyId,
        kind: "docs_submitted",
        actor_id: userData?.user?.id ?? null,
        document_id: documentId,
        message: `RH anexou arquivo: ${file.name}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-documents"] });
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Arquivo enviado ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  return {
    documents,
    isLoading,
    approveDocument,
    rejectDocument,
    validateDocument,
    uploadDocFile,
    createExamDoc,
  };
}
