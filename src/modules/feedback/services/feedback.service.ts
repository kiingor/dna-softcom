// Serviço da tela Feedback Colaborador. Tudo passa pela Edge Function
// `feedbacks` (que guarda a x-api-key e checa permissão) — o front nunca
// fala direto com api.softcom.cloud.

import { supabase } from "@/integrations/supabase/client";
import type { BuscaColaborador, FeedbacksResponse, Objetivo } from "../types";

/** Payload de criação/edição (campos camelCase como a agenda espera). */
export interface ObjetivoPayload {
  tipo: string;
  comentario?: string;
  mostrarSuporte: boolean;
  lancamentoUsuarioId?: number;
  /** Só a data (`YYYY-MM-DD`). */
  datas?: string;
  /** Só a data (`YYYY-MM-DD`). */
  lancamentoDatas?: string;
  campanhaId?: string;
  culturaId?: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("feedbacks", { body });
  if (error) {
    // FunctionsHttpError carrega o corpo da resposta em `context` (Response).
    // Tentamos extrair a mensagem amigável que o edge function devolveu.
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string; details?: string };
        if (j?.error) msg = j.details ? `${j.error}: ${j.details}` : j.error;
      } catch {
        /* corpo não-JSON — mantém a mensagem padrão */
      }
    }
    throw new Error(msg);
  }
  return data as T;
}

export const feedbackService = {
  listFeedbacks: (
    companyId: string,
    filters: { lancamentoUsuarioId?: number; suporteId?: number } = {},
  ) => invoke<FeedbacksResponse>({ action: "feedbacks-list", companyId, ...filters }),

  buscaColaborador: (companyId: string, q?: string) =>
    invoke<BuscaColaborador[]>({ action: "busca-colaborador", companyId, q }),

  listObjetivos: (companyId: string, colaboradorId: number) =>
    invoke<Objetivo[]>({ action: "objetivos-list", companyId, colaboradorId }),

  createObjetivo: (companyId: string, colaboradorId: number, data: ObjetivoPayload) =>
    invoke<{ success: boolean; item: Objetivo; warning?: string }>({
      action: "objetivo-create",
      companyId,
      colaboradorId,
      data,
    }),

  updateObjetivo: (
    companyId: string,
    colaboradorId: number,
    itemId: number,
    data: ObjetivoPayload,
  ) =>
    invoke<{ success: boolean; warning?: string }>({
      action: "objetivo-update",
      companyId,
      colaboradorId,
      itemId,
      data,
    }),

  deleteObjetivo: (companyId: string, colaboradorId: number, itemId: number) =>
    invoke<{ success: boolean; warning?: string }>({
      action: "objetivo-delete",
      companyId,
      colaboradorId,
      itemId,
    }),
};
