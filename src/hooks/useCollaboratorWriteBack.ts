// Hook helper: wrapping de collaborator-create / collaborator-update /
// collaborator-subresource pra garantir PUSH on WRITE pra api.softcom.cloud
// em TODA edição de colaborador.
//
// Substitui chamadas diretas `supabase.from('collaborators').update/insert/delete`
// dispersas pelo client (form, modal, ColaboradoresPage, AdmissionDetailPage,
// CollaboratorValidationTab).
//
// Padrão de toast: usuário sempre sabe quando o write-back rolou.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// As mesmas seções aceitas pelo edge function collaborator-update
// (../supabase/functions/collaborator-update/index.ts ALLOWED_SECTIONS).
export type CollabUpdateSection =
  | "identificacao"
  | "funcionais"
  | "comissoes"
  | "status"
  | "flags";

interface UpdateArgs {
  collaboratorId: string;
  section: CollabUpdateSection;
  data: Record<string, unknown>;
  /** Default true. Desliga se quiser update SÓ local (sem PUSH). */
  syncToRemote?: boolean;
}

interface CreateArgs {
  companyId: string;
  /** Campos do colaborador (snake_case local). Edge function mapeia pro remoto. */
  data: Record<string, unknown>;
  /** Default true. */
  syncToRemote?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// useUpdateCollaborator — chama collaborator-update edge function
// ─────────────────────────────────────────────────────────────────────────────

export function useUpdateCollaborator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: UpdateArgs) => {
      const { data, error } = await supabase.functions.invoke("collaborator-update", {
        body: {
          collaboratorId: args.collaboratorId,
          section: args.section,
          data: args.data,
          syncToRemote: args.syncToRemote ?? true,
        },
      });
      if (error) throw new Error(error.message ?? "Falha na chamada.");
      if (data && typeof data === "object" && "error" in data) {
        const err = data as { error: string; details?: string };
        throw new Error(err.details ? `${err.error}: ${err.details}` : err.error);
      }
      return data;
    },
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: ["collaborator", args.collaboratorId] });
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-payable-lines"] });
    },
    onError: (err: Error) => {
      toast.error("Atualização falhou: " + err.message);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useCreateCollaborator — chama collaborator-create edge function
// ─────────────────────────────────────────────────────────────────────────────

export function useCreateCollaborator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: CreateArgs) => {
      const { data, error } = await supabase.functions.invoke("collaborator-create", {
        body: {
          companyId: args.companyId,
          data: args.data,
          syncToRemote: args.syncToRemote ?? true,
        },
      });
      if (error) throw new Error(error.message ?? "Falha na chamada.");
      if (data && typeof data === "object" && "error" in data) {
        const err = data as { error: string; details?: string };
        throw new Error(err.details ? `${err.error}: ${err.details}` : err.error);
      }
      return data as {
        success?: boolean;
        localId?: string;
        externalId?: string;
        remote?: unknown;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
    },
    onError: (err: Error) => {
      toast.error("Cadastro falhou: " + err.message);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de status — atalho pra mudanças comuns de ativo/inativo/reprovado.
// Todos chamam useUpdateCollaborator section='status' por baixo.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeactivateArgs {
  collaboratorId: string;
  terminationDate?: string | null;
  reason?: string | null;
}

export interface ApproveArgs {
  collaboratorId: string;
}

export interface RejectArgs {
  collaboratorId: string;
  reason?: string | null;
}
