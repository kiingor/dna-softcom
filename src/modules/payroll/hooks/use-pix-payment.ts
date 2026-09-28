import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Pagamento PIX de uma linha da folha.
//
// O fluxo tem DOIS passos e eles são separados de propósito:
//
//   1. `challenge` — abre a transferência no servidor (que valida período
//      aprovado, pensão, chave PIX, já-pago e já-em-voo) e dispara o código no
//      WhatsApp do pagador, com o nome do favorecido e o valor na mensagem.
//   2. `execute` — consome o código e manda o PIX.
//
// O cliente manda `entry_id` e o código. **Nunca** o valor nem a chave: quem
// decide quanto e para quem é a linha congelada na aprovação da diretoria. Isso
// é o que impede que mexer no DevTools mude o destinatário de um pagamento.
// ─────────────────────────────────────────────────────────────────────────────

export type PixTransferStatus =
  | "created"
  | "sent"
  | "confirmed"
  | "settled"
  | "failed"
  | "unknown";

export interface PixTransfer {
  id: string;
  entry_id: string;
  collaborator_id: string;
  amount: number;
  status: PixTransferStatus;
  payee_name: string;
  end_to_end_id: string | null;
  error_message: string | null;
  created_at: string;
  settled_at: string | null;
  environment: string;
}

export interface PixChallenge {
  transfer_id: string;
  challenge_id?: string;
  /** Últimos 4 dígitos do celular que recebeu o código. Nunca o número inteiro. */
  last4: string;
  expires_at: string;
  amount: number;
  payee_name: string;
  payee_pix_key_masked: string;
}

export interface PixExecuteResult {
  status: PixTransferStatus;
  end_to_end_id?: string | null;
  message?: string;
  /** Motivo do banco na recusa (ex.: "chave inexistente"). Só em failed. */
  detail?: string | null;
  error_code?: string | null;
}

/**
 * O supabase-js mascara o corpo em resposta non-2xx, então o erro precisa ser
 * lido em duas camadas — mesma armadilha tratada em useCoreResourceMutation.
 */
function unwrap<T>(error: unknown, data: unknown): T {
  // A payroll-pix-pay responde { error: <CÓDIGO>, message: <frase em pt-BR> }.
  // Preferimos `message`: `error` é código de máquina (FORBIDDEN_ROLE,
  // PAYMENT_2FA_REQUIRED…) e jogar isso num toast não ajuda ninguém.
  const corpo = data as { error?: unknown; message?: unknown } | null;
  const frase =
    corpo && typeof corpo === "object"
      ? (corpo.message ? String(corpo.message) : null) ??
        (corpo.error ? String(corpo.error) : null)
      : null;

  if (error) {
    throw new Error(frase ?? (error as Error).message ?? "Falha na chamada");
  }
  if (corpo && typeof corpo === "object" && "error" in corpo) {
    throw new Error(frase ?? "Falha na chamada");
  }
  return data as T;
}

/** Transferências PIX do período — alimenta o estado de cada linha na tela. */
export function usePixTransfers(periodId: string | undefined) {
  return useQuery({
    queryKey: ["pix-transfers", periodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_pix_transfers")
        .select(
          "id, entry_id, collaborator_id, amount, status, payee_name, end_to_end_id, error_message, created_at, settled_at, environment",
        )
        .eq("period_id", periodId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PixTransfer[];
    },
    enabled: !!periodId,
    // Enquanto houver transferência em voo a tela precisa acompanhar sozinha:
    // o reconciliador roda a cada 2 min e o RH não deve ficar apertando F5.
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as PixTransfer[];
      const emVoo = rows.some((t) =>
        ["created", "sent", "confirmed", "unknown"].includes(t.status),
      );
      return emVoo ? 15_000 : false;
    },
  });
}

export function usePixPayment(periodId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["pix-transfers", periodId] });
    queryClient.invalidateQueries({ queryKey: ["payroll-payments", periodId] });
    queryClient.invalidateQueries({ queryKey: ["payroll-payable-lines", periodId] });
  };

  /** Passo 1: abre a transferência e dispara o código no WhatsApp. */
  const challenge = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.functions.invoke("payroll-pix-pay", {
        body: { entry_id: entryId, action: "challenge" },
      });
      return unwrap<PixChallenge>(error, data);
    },
    onSettled: invalidar,
  });

  /** Passo 2: consome o código e manda o PIX. */
  const execute = useMutation({
    mutationFn: async (vars: {
      entryId: string;
      code: string;
      challengeId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("payroll-pix-pay", {
        body: {
          entry_id: vars.entryId,
          action: "execute",
          code: vars.code,
          challenge_id: vars.challengeId,
        },
      });
      return unwrap<PixExecuteResult>(error, data);
    },
    onSettled: invalidar,
  });

  /**
   * "Conferir agora": pergunta ao banco o estado da transferência em voo desse
   * lançamento, sem esperar o cron. Não move dinheiro — só consulta.
   */
  const checkNow = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.functions.invoke("payroll-pix-pay", {
        body: { entry_id: entryId, action: "check" },
      });
      return unwrap<{ ok: boolean; summary?: unknown }>(error, data);
    },
    onSettled: invalidar,
  });

  /**
   * Cancela uma transferência travada (libera o lançamento). Em produção só vale
   * pra quem nunca saiu ao banco ('created'); no sandbox libera as intermediárias
   * porque o mock nunca finaliza.
   */
  const cancel = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.functions.invoke("payroll-pix-pay", {
        body: { entry_id: entryId, action: "cancel" },
      });
      return unwrap<{ ok: boolean; status: string }>(error, data);
    },
    onSettled: invalidar,
  });

  return { challenge, execute, checkNow, cancel };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagamento em LOTE — um código pro conjunto selecionado.
//
// Dois passos, iguais em espírito ao avulso:
//   challengeBatch(entry_ids) → abre uma transferência por lançamento e manda UM
//                               código no WhatsApp do pagador. Devolve a lista
//                               congelada (o que vai ser pago) + o que ficou de
//                               fora (errors/skipped).
//   executeBatch(challenge_id, code) → consome o código UMA vez e paga o
//                               conjunto do desafio. O cliente NÃO manda a lista
//                               de novo: o código autoriza exatamente o que o
//                               passo 1 congelou.
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchLine {
  entry_id: string;
  transfer_id: string;
  payee_name: string;
  amount: number;
  payee_pix_key_masked: string;
}

export interface BatchChallenge {
  /** null = nada estava pronto pra pagar (ver errors/skipped). */
  challenge_id: string | null;
  last4?: string;
  expires_at?: string;
  count: number;
  total_amount: number;
  lines: BatchLine[];
  errors: { entry_id: string; message: string }[];
  skipped: { entry_id: string; status: string; message: string }[];
}

export interface BatchResultItem {
  entry_id: string;
  transfer_id: string;
  status: PixTransferStatus;
  end_to_end_id: string | null;
  message: string;
  error_code: string | null;
  detail: string | null;
}

export interface BatchExecuteResult {
  results: BatchResultItem[];
  skipped: {
    transfer_id: string;
    entry_id: string | null;
    status: string;
    message: string;
  }[];
  counts: { settled: number; confirmed: number; failed: number; unknown: number };
  /** true = o freio de relógio parou o lote no meio; remaining_count ficaram pendentes. */
  budget_hit: boolean;
  remaining_count: number;
}

export function usePixBatch(periodId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["pix-transfers", periodId] });
    queryClient.invalidateQueries({ queryKey: ["payroll-payments", periodId] });
  };

  /** Passo 1: abre as transferências do lote e dispara UM código. */
  const challengeBatch = useMutation({
    mutationFn: async (entryIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("payroll-pix-pay", {
        body: { action: "challenge_batch", entry_ids: entryIds },
      });
      return unwrap<BatchChallenge>(error, data);
    },
    onSettled: invalidar,
  });

  /** Passo 2: consome o código e paga o conjunto congelado no desafio. */
  const executeBatch = useMutation({
    mutationFn: async (vars: { challengeId: string; code: string }) => {
      const { data, error } = await supabase.functions.invoke("payroll-pix-pay", {
        body: {
          action: "execute_batch",
          challenge_id: vars.challengeId,
          code: vars.code,
        },
      });
      return unwrap<BatchExecuteResult>(error, data);
    },
    onSettled: invalidar,
  });

  return { challengeBatch, executeBatch };
}

interface VoucherResult {
  status: "available" | "pending";
  location: string | null;
  mime_type: string | null;
}

/**
 * Comprovante (PDF) de um PIX liquidado. O fluxo do banco é assíncrono: a edge
 * dispara o pedido e faz um poll curto no servidor; se o PDF ainda não saiu,
 * responde 'pending' e a gente chama de novo (a edge é idempotente — só manda
 * transfer_id, e ela mesma rederiva o pagamento a partir da transferência).
 * Devolve a URL de download — o componente abre numa aba.
 *
 * Só funciona em produção: a API de comprovante do Santander não tem sandbox.
 */
export function useVoucher() {
  return useMutation({
    mutationFn: async (transferId: string): Promise<{ location: string; mime: string | null }> => {
      for (let tries = 0; tries < 8; tries++) {
        const r = await supabase.functions.invoke("payroll-pix-voucher", {
          body: { transfer_id: transferId },
        });
        const res = unwrap<VoucherResult>(r.error, r.data);
        if (res.status === "available" && res.location) {
          return { location: res.location, mime: res.mime_type };
        }
        await new Promise((r2) => setTimeout(r2, 2500));
      }
      throw new Error("O comprovante ainda está sendo gerado. Tenta de novo em instantes.");
    },
  });
}
