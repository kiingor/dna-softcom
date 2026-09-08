import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PayrollPeriodStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fluxo de aprovação da folha (migration 20260727120100).
//   Rascunho (open) → Aprovado RH → Aprovado Diretoria → Fechado → Exportado
//
// A autoridade é o BANCO: quem valida a transição, o papel de quem disparou e o
// motivo obrigatório da devolução é o trigger trg_payroll_period_status_guard.
// Este hook é só o caminho feliz — se o usuário não puder, a exceção vem de lá
// com a mensagem certa.
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollPeriodNote {
  id: string;
  period_id: string;
  collaborator_id: string | null;
  scope: "period" | "collaborator";
  author_stage: "rh" | "diretoria";
  body: string;
  is_resolved: boolean;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollPeriodApproval {
  id: string;
  period_id: string;
  from_status: PayrollPeriodStatus | null;
  to_status: PayrollPeriodStatus;
  action: string;
  reason: string | null;
  actor_role: string;
  created_by: string | null;
  created_at: string;
}

/** Muda o status do período. `reason` é obrigatório nas devoluções. */
export function useSetPeriodStatus(periodId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      toStatus,
      reason,
    }: {
      toStatus: PayrollPeriodStatus;
      reason?: string;
    }) => {
      if (!periodId) throw new Error("Período não encontrado");
      const { error } = await supabase.rpc("set_payroll_period_status", {
        p_period_id: periodId,
        p_to_status: toStatus,
        p_reason: reason?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-period"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-payable-lines", periodId] });
      queryClient.invalidateQueries({
        queryKey: ["payroll-period-approvals", periodId],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou mudar o status da folha.");
    },
  });
}

/** Observações do período: da folha inteira (collaborator_id null) e por pessoa. */
export function usePeriodNotes(periodId: string | undefined) {
  return useQuery({
    queryKey: ["payroll-period-notes", periodId],
    queryFn: async () => {
      if (!periodId) return [];
      const { data, error } = await supabase
        .from("payroll_period_notes")
        .select("*")
        .eq("period_id", periodId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PayrollPeriodNote[];
    },
    enabled: !!periodId,
  });
}

/** Histórico de transições — quem aprovou, quem devolveu e por quê. */
export function usePeriodApprovals(periodId: string | undefined) {
  return useQuery({
    queryKey: ["payroll-period-approvals", periodId],
    queryFn: async () => {
      if (!periodId) return [];
      const { data, error } = await supabase
        .from("payroll_period_approvals")
        .select("*")
        .eq("period_id", periodId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PayrollPeriodApproval[];
    },
    enabled: !!periodId,
  });
}

/**
 * Cria uma observação. `collaboratorId` null = observação da folha inteira.
 * company_id e author_stage são derivados no servidor (trigger) — o client não
 * escolhe empresa nem se passa por diretoria.
 */
export function useCreatePeriodNote(periodId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      collaboratorId,
      body,
    }: {
      collaboratorId: string | null;
      body: string;
    }) => {
      if (!periodId) throw new Error("Período não encontrado");
      const text = body.trim();
      if (text.length < 3) {
        throw new Error("Escreve pelo menos 3 caracteres na observação.");
      }
      const { error } = await supabase.from("payroll_period_notes").insert({
        period_id: periodId,
        collaborator_id: collaboratorId,
        body: text,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["payroll-period-notes", periodId],
      });
      toast.success("Observação registrada ✓");
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou salvar a observação.");
    },
  });
}

/** Marca a observação como tratada (ou destrata). */
export function useResolvePeriodNote(periodId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      noteId,
      resolved,
    }: {
      noteId: string;
      resolved: boolean;
    }) => {
      const { error } = await supabase.rpc("resolve_payroll_period_note", {
        p_note_id: noteId,
        p_resolved: resolved,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["payroll-period-notes", periodId],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou atualizar a observação.");
    },
  });
}

/** Apaga uma observação (só o autor — a policy garante). */
export function useDeletePeriodNote(periodId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase
        .from("payroll_period_notes")
        .delete()
        .eq("id", noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["payroll-period-notes", periodId],
      });
      toast.success("Observação removida");
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Não rolou remover a observação.");
    },
  });
}
