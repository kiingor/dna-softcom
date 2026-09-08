import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";

export interface OccupationalExam {
  id: string;
  collaborator_id: string;
  company_id: string;
  position_id: string | null;
  exam_type: string;
  status: string;
  due_date: string;
  scheduled_date: string | null;
  completed_date: string | null;
  risk_group_at_time: string | null;
  notes: string | null;
  created_by: string | null;
  auto_generated: boolean;
  previous_position_id: string | null;
  created_at: string;
  updated_at: string;
  collaborator?: { id: string; name: string; cpf: string; position: string | null };
  position?: { id: string; name: string; risk_group: string | null } | null;
}

export interface ExamDocument {
  id: string;
  exam_id: string;
  company_id: string;
  file_url: string;
  file_name: string;
  version: number;
  uploaded_by: string | null;
  uploaded_at: string;
}

export const useExams = () => {
  const { currentCompany } = useDashboard();
  const queryClient = useQueryClient();
  const companyId = currentCompany?.id;

  const { data: exams = [], isLoading } = useQuery({
    queryKey: ["occupational-exams", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("occupational_exams")
        .select("*, collaborator:collaborators!inner(id, name, cpf, position, status), position:positions!occupational_exams_position_id_fkey(id, name, risk_group)")
        .eq("company_id", companyId)
        .eq("collaborator.status", "ativo")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as unknown as OccupationalExam[];
    },
    enabled: !!companyId,
  });

  const createExamMutation = useMutation({
    mutationFn: async (exam: {
      collaborator_id: string;
      exam_type: string;
      due_date: string;
      notes?: string;
      position_id?: string;
      risk_group_at_time?: string;
      previous_position_id?: string;
      auto_generated?: boolean;
    }) => {
      const { error } = await supabase.from("occupational_exams").insert({
        ...exam,
        company_id: companyId!,
        status: "pendente",
        auto_generated: exam.auto_generated ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["occupational-exams"] });
      toast.success("Exame criado com sucesso!");
    },
    onError: (e: any) => toast.error("Erro ao criar exame: " + e.message),
  });

  const updateExamMutation = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      status?: string;
      exam_type?: string;
      due_date?: string;
      scheduled_date?: string | null;
      completed_date?: string | null;
      risk_group_at_time?: string | null;
      notes?: string | null;
    }) => {
      if (!companyId) throw new Error("Selecione uma empresa para atualizar o exame.");
      const { error } = await supabase
        .from("occupational_exams")
        .update(data)
        .eq("id", id)
        .eq("company_id", companyId)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: () => {
      // O trigger SQL generate_next_periodic_exam cria o próximo exame
      // periódico automaticamente quando status vira 'realizado' (admissional
      // ou periódico), usando a periodicidade do cargo. Por isso aqui só
      // invalidamos — não criamos o próximo no frontend (evita duplicar).
      queryClient.invalidateQueries({ queryKey: ["occupational-exams"] });
      queryClient.invalidateQueries({ queryKey: ["collaborator-exams"] });
      queryClient.invalidateQueries({ queryKey: ["subresource-exames"] });
      toast.success("Exame atualizado!");
    },
    onError: (e: any) => toast.error("Erro ao atualizar exame: " + e.message),
  });

  const deleteExamMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("occupational_exams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["occupational-exams"] });
      toast.success("Exame cancelado!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  return {
    exams,
    isLoading,
    createExam: createExamMutation.mutate,
    updateExam: updateExamMutation.mutate,
    deleteExam: deleteExamMutation.mutate,
    isCreating: createExamMutation.isPending,
    isUpdating: updateExamMutation.isPending,
  };
};

export const useExamDocuments = (examId?: string) => {
  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["exam-documents", examId],
    queryFn: async () => {
      if (!examId) return [];
      const { data, error } = await supabase
        .from("exam_documents")
        .select("*")
        .eq("exam_id", examId)
        .order("version", { ascending: false });
      if (error) throw error;
      return data as ExamDocument[];
    },
    enabled: !!examId,
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ examId, companyId, file }: { examId: string; companyId: string; file: File }) => {
      const fileExt = file.name.split(".").pop();
      const filePath = `${companyId}/${examId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("exam-documents")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("exam-documents")
        .getPublicUrl(filePath);

      // Get next version
      const { data: existing } = await supabase
        .from("exam_documents")
        .select("version")
        .eq("exam_id", examId)
        .order("version", { ascending: false })
        .limit(1);

      const nextVersion = (existing?.[0]?.version || 0) + 1;

      const { error: insertError } = await supabase.from("exam_documents").insert({
        exam_id: examId,
        company_id: companyId,
        file_url: urlData.publicUrl,
        file_name: file.name,
        version: nextVersion,
        uploaded_by: (await supabase.auth.getUser()).data.user?.id,
      });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-documents"] });
      queryClient.invalidateQueries({ queryKey: ["occupational-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exam-doc-counts"] });
      toast.success("ASO enviado com sucesso!");
    },
    onError: (e: any) => toast.error("Erro ao enviar ASO: " + e.message),
  });

  return {
    documents,
    isLoading,
    uploadDocument: uploadDocumentMutation.mutate,
    isUploading: uploadDocumentMutation.isPending,
  };
};

export const useCollaboratorExams = (collaboratorId?: string) => {
  const { data: exams = [], isLoading } = useQuery({
    queryKey: ["collaborator-exams", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("occupational_exams")
        .select("*, position:positions!occupational_exams_position_id_fkey(id, name, risk_group)")
        .eq("collaborator_id", collaboratorId)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return data as unknown as OccupationalExam[];
    },
    enabled: !!collaboratorId,
  });

  return { exams, isLoading };
};
