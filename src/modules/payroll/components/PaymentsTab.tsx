import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  CircleNotch as Loader2,
  Info,
  Copy,
  MagnifyingGlass,
  Receipt,
  CheckCircle,
  Users,
  X as XIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/formatters";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { cn } from "@/lib/utils";
import { Segmented } from "./Segmented";
import {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPE_COLORS,
  type PayrollEntryWithCollaborator,
} from "../types";
import {
  buildPaymentLines,
  paymentLineFromSnapshot,
  type FrozenPaymentLine,
  type PaymentLineComponent,
  type PaymentLineDiscount,
} from "../lib/buildPaymentLines";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PixPaymentDialog } from "./PixPaymentDialog";
import { BatchPixDialog, type BatchSelectedLine } from "./BatchPixDialog";
import { AccountBalanceCard } from "./AccountBalanceCard";
import { usePixTransfers, usePixPayment, useVoucher, type PixTransfer } from "../hooks/use-pix-payment";
import { usePermissions } from "@/hooks/usePermissions";
import { useDashboard } from "@/contexts/DashboardContext";

interface PaymentsTabProps {
  periodId: string;
  entries: PayrollEntryWithCollaborator[];
  canManage: boolean;
  /** Status da folha. PIX só existe a partir de 'aprovado_diretoria'. */
  periodStatus?: string;
}

interface PaymentRecord {
  id: string;
  period_id: string;
  entry_id: string;
  amount: number;
  paid_at: string | null;
  paid_by: string | null;
  /** 'manual' = marcado na mão; 'pix_santander' = saiu por PIX e não se desmarca. */
  method?: string | null;
}

export function PaymentsTab({
  periodId,
  entries,
  canManage,
  periodStatus,
}: PaymentsTabProps) {
  const queryClient = useQueryClient();

  // Gate do PIX: papel restrito E módulo. É o padrão registrado em
  // PeriodDetailPage.tsx:131-134 — o toggle "Acesso total" da tela de
  // Permissões liga todos os módulos de uma vez, então módulo sozinho
  // transformaria qualquer acesso total em pagador. O terceiro fator
  // (dispositivo 2FA ativo) é validado no servidor, onde não dá pra burlar.
  const { hasAnyRole, currentCompany } = useDashboard();
  const execPermission = usePermissions("folha_pagamento_exec", true);
  const podePagar =
    hasAnyRole(["admin_gc", "diretoria"]) && execPermission.canCreate;
  // A folha congela em 'aprovado_diretoria': antes disso o valor ainda muda, e
  // pagar um número que pode mudar é assinar cheque em branco.
  const folhaLiberada =
    periodStatus === "aprovado_diretoria" ||
    periodStatus === "closed" ||
    periodStatus === "exported";

  const { data: pixTransfers = [] } = usePixTransfers(periodId);
  const { checkNow, cancel } = usePixPayment(periodId);
  const voucher = useVoucher();
  // Set (não slot único): duas linhas podem gerar comprovante ao mesmo tempo sem
  // uma apagar o spinner da outra.
  const [gerandoComprovante, setGerandoComprovante] = useState<Set<string>>(new Set());

  const handleVoucher = async (transferId: string) => {
    // Abre a aba AGORA, dentro do clique — o gesto do usuário ainda está ativo.
    // Se esperássemos o await (o banco leva alguns segundos), o Chrome barraria
    // como pop-up. A aba fica com um aviso e navega pro PDF quando ele sai.
    const win = window.open("about:blank", "_blank");
    if (win) {
      win.opener = null;
      win.document.write(
        "<!doctype html><meta charset='utf-8'><title>Comprovante</title>" +
          "<body style='font-family:system-ui,sans-serif;padding:2rem;color:#444'>" +
          "Gerando o comprovante… isso pode levar alguns segundos.</body>",
      );
    }
    setGerandoComprovante((s) => new Set(s).add(transferId));
    try {
      const { location } = await voucher.mutateAsync(transferId);
      if (win) win.location.href = location;
      else window.open(location, "_blank"); // aba barrada na abertura: tenta agora
    } catch (err) {
      if (win) win.close();
      toast.error((err as Error).message ?? "Não deu pra gerar o comprovante.");
    } finally {
      setGerandoComprovante((s) => {
        const n = new Set(s);
        n.delete(transferId);
        return n;
      });
    }
  };

  const handleCheckNow = async (entryId: string) => {
    try {
      await checkNow.mutateAsync(entryId);
      toast.info("Conferido com o banco. Se ainda estiver validando, o estado atualiza sozinho.");
    } catch (err) {
      toast.error((err as Error).message ?? "Não deu pra conferir agora.");
    }
  };

  const handleCancel = async (entryId: string) => {
    try {
      await cancel.mutateAsync(entryId);
      toast.success("Transferência cancelada. O lançamento voltou a ficar disponível pra pagar.");
    } catch (err) {
      toast.error((err as Error).message ?? "Não deu pra cancelar.");
    }
  };

  const transferByEntry = useMemo(() => {
    const m = new Map<string, PixTransfer>();
    // A query já vem por created_at DESC: a primeira de cada lançamento é a
    // tentativa mais recente, que é a que a linha deve refletir.
    for (const t of pixTransfers) if (!m.has(t.entry_id)) m.set(t.entry_id, t);
    return m;
  }, [pixTransfers]);

  const [pagando, setPagando] = useState<string | null>(null);

  // Folhas aprovadas usam o valor que o servidor congelou. Isso preserva os
  // pagamentos anteriores quando a regra de agrupamento muda.
  const { data: frozenLines = [], isLoading: loadingFrozen, isError: frozenError } = useQuery({
    queryKey: ["payroll-payable-lines", periodId, periodStatus],
    queryFn: () => fetchAllRows<FrozenPaymentLine>(() => supabase
      .from("payroll_payable_lines")
      .select("entry_id, collaborator_id, kind, gross, inss, irpf, other_deductions, net_amount, components, discounts, payee_name, payee_document, payee_pix_key")
      .eq("period_id", periodId)
      .order("entry_id")),
    enabled: !!periodId && folhaLiberada,
  });

  // A fórmula do líquido vive em ../lib/buildPaymentLines.ts — extraída daqui
  // porque o servidor precisa da MESMA conta pra mandar o valor ao banco, e
  // porque as regras (estorno, partição de férias, mescla, clamp) só existiam
  // como comentário, sem teste. Aqui sobrou só a adaptação para as formas que
  // este componente já renderiza.
  const { payableEntries, taxBreakdownByEntry } = useMemo(() => {
    const useFrozen = folhaLiberada && frozenLines.length > 0;
    const lines = useFrozen ? frozenLines.map(paymentLineFromSnapshot) : buildPaymentLines(entries);
    const sourceById = new Map(entries.map((e) => [e.id, e]));
    const snapshotById = new Map(frozenLines.map((line) => [line.entry_id, line]));

    interface EntryBreakdown {
      inss: number;
      irpf: number;
      discounts: PaymentLineDiscount[];
      components: PaymentLineComponent[];
      /** Tipos que a linha somou — viram as tags na listagem. */
      types: string[];
    }

    const adjustedEntries: PayrollEntryWithCollaborator[] = [];
    const breakdownByEntry = new Map<string, EntryBreakdown>();

    for (const line of lines) {
      const source = sourceById.get(line.entryId);
      if (!source) continue;

      const snapshot = useFrozen ? snapshotById.get(line.entryId) : undefined;
      adjustedEntries.push({
        ...source,
        ...(line.kind === "ferias" ? { type: "ferias" } : {}),
        description: line.description,
        value: line.amount,
        collaborator: snapshot && source.collaborator ? {
          ...source.collaborator,
          name: snapshot.payee_name,
          cpf: snapshot.payee_document,
          pix_key: snapshot.payee_pix_key,
        } : source.collaborator,
      } as PayrollEntryWithCollaborator);

      breakdownByEntry.set(line.entryId, {
        inss: line.inss,
        irpf: line.irpf,
        discounts: line.discounts,
        components: line.components,
        types: line.types,
      });
    }

    return { payableEntries: adjustedEntries, taxBreakdownByEntry: breakdownByEntry };
  }, [entries, folhaLiberada, frozenLines]);

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["payroll-payments", periodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_payments")
        .select("*")
        .eq("period_id", periodId);
      if (error) throw error;
      return (data ?? []) as PaymentRecord[];
    },
    enabled: !!periodId,
  });

  const paymentByEntry = useMemo(() => {
    const map = new Map<string, PaymentRecord>();
    for (const p of payments) map.set(p.entry_id, p);
    return map;
  }, [payments]);

  const handleCopyPix = async (pixKey: string) => {
    try {
      await navigator.clipboard.writeText(pixKey);
      toast.success("PIX copiado");
    } catch {
      toast.error("Não consegui copiar. Tenta selecionar e copiar manualmente.");
    }
  };

  const togglePayment = useMutation({
    mutationFn: async ({
      entryId,
      amount,
      newPaid,
    }: {
      entryId: string;
      amount: number;
      newPaid: boolean;
    }) => {
      // Escrita direta em payroll_payments foi revogada na migration
      // 20260818120400: enquanto o navegador pudesse gravar ali, o 2FA do
      // pagamento seria contornável com três linhas no console. Agora a
      // marcação passa por uma função no servidor, que carimba quem marcou e
      // quando — antes esses dois campos vinham do relógio e da palavra do
      // cliente.
      const { error } = await supabase.rpc("payroll_payment_set_manual_paid", {
        p_entry_id: entryId,
        p_paid: newPaid,
        p_amount: amount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-payments", periodId] });
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  // Busca por nome do colaborador. Normaliza acento pra "joao" achar "João".
  // ̀-ͯ = bloco de combining diacritics (gerados pelo NFD).
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "pendentes" | "pagos">("todos");
  const normalized = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const filteredEntries = useMemo(() => {
    const q = normalized(searchTerm.trim());
    return payableEntries.filter((e) => {
      if (q && !normalized(e.collaborator?.name ?? "").includes(q)) return false;
      if (statusFilter !== "todos") {
        const pago = !!paymentByEntry.get(e.id)?.paid_at;
        if (statusFilter === "pagos" && !pago) return false;
        if (statusFilter === "pendentes" && pago) return false;
      }
      return true;
    });
  }, [payableEntries, searchTerm, statusFilter, paymentByEntry]);

  const total = payableEntries.length;
  const paidCount = payableEntries.filter((e) =>
    paymentByEntry.get(e.id)?.paid_at,
  ).length;
  const totalAmount = payableEntries.reduce((s, e) => s + Number(e.value), 0);
  const paidAmount = payableEntries.reduce((s, e) => {
    const rec = paymentByEntry.get(e.id);
    return rec?.paid_at ? s + Number(e.value) : s;
  }, 0);
  const progressPct = total === 0 ? 0 : Math.round((paidCount / total) * 100);
  const isFiltering = searchTerm.trim().length > 0;

  // ── Seleção pra pagamento em lote ──────────────────────────────────────────
  // Elegível = dá pra pagar por PIX AGORA: folha liberada, quem pode pagar, sem
  // pagamento e sem transferência em voo, e com chave PIX. O gate de verdade é no
  // servidor — isto só evita marcar o que não vai sair.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  const selectableIds = useMemo(() => {
    const s = new Set<string>();
    if (!podePagar || !folhaLiberada) return s;
    for (const e of filteredEntries) {
      const isPaid = !!paymentByEntry.get(e.id)?.paid_at;
      const tx = transferByEntry.get(e.id);
      const emVoo =
        !!tx && ["created", "sent", "confirmed", "unknown"].includes(tx.status);
      if (!isPaid && !emVoo && (e.collaborator?.pix_key ?? null)) s.add(e.id);
    }
    return s;
  }, [filteredEntries, paymentByEntry, transferByEntry, podePagar, folhaLiberada]);

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Linhas do lote — só as marcadas E ainda elegíveis (uma que virou paga/em voo
  // some sozinha). Carrega o demonstrativo pro extrato do diálogo.
  const selectedLines = useMemo<BatchSelectedLine[]>(() => {
    const out: BatchSelectedLine[] = [];
    for (const e of payableEntries) {
      if (!selected.has(e.id) || !selectableIds.has(e.id)) continue;
      const bd = taxBreakdownByEntry.get(e.id);
      out.push({
        entryId: e.id,
        name: e.collaborator?.name ?? "(sem nome)",
        pixKey: e.collaborator?.pix_key ?? null,
        amount: Number(e.value),
        gross: (bd?.components ?? []).reduce((s, c) => s + c.value, 0),
        inss: bd?.inss ?? 0,
        irpf: bd?.irpf ?? 0,
        components: bd?.components ?? [],
        discounts: bd?.discounts ?? [],
      });
    }
    return out;
  }, [payableEntries, selected, selectableIds, taxBreakdownByEntry]);

  const selectedTotal = selectedLines.reduce((s, l) => s + l.amount, 0);

  const allVisibleSelected =
    selectableIds.size > 0 && [...selectableIds].every((id) => selected.has(id));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of selectableIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...selectableIds]);
    });

  if (isLoading || (folhaLiberada && loadingFrozen)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (folhaLiberada && frozenError) {
    return <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar os pagamentos aprovados. Atualize a página para tentar novamente.</p>;
  }

  if (payableEntries.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground">
          Sem lançamentos pagáveis no período. Adicione na aba Lançamentos primeiro.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Saldo + extrato da conta pagadora. Só pra quem pode pagar (o gate real é
          no servidor). Dado sensível, então o card nasce com o saldo oculto. */}
      {podePagar && <AccountBalanceCard companyId={currentCompany?.id} />}

      {/* Resumo — totais líquidos + progresso num bloco só. Antes eram 4 KPIs e
          uma barra de progresso repetindo a mesma contagem. */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-soft">
        <div className="grid grid-cols-3 gap-4">
          <div className="min-w-0">
            <p className="label-eyebrow">Total a pagar</p>
            <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-foreground truncate">
              {formatCurrency(totalAmount)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="label-eyebrow">Pago</p>
            <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-success truncate">
              {formatCurrency(paidAmount)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="label-eyebrow">Pendente</p>
            <p
              className={cn(
                "mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] truncate",
                totalAmount - paidAmount > 0 ? "text-warning" : "text-success",
              )}
            >
              {formatCurrency(totalAmount - paidAmount)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Progress value={progressPct} className="h-1.5 flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {paidCount} de {total} pagos · {progressPct}%
          </span>
        </div>
      </div>

      {/* Toolbar — busca + filtro de status, um padrão só (segmented control) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar colaborador..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9 h-10"
          />
          {isFiltering && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
              aria-label="Limpar busca"
              title="Limpar busca"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <Segmented
          ariaLabel="Filtrar por status de pagamento"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          options={[
            { value: "todos", label: "Todos", count: total },
            { value: "pendentes", label: "Pendentes", count: total - paidCount },
            { value: "pagos", label: "Pagos", count: paidCount },
          ]}
        />
        {podePagar && folhaLiberada && selectableIds.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-10 text-xs"
            onClick={toggleSelectAll}
          >
            {allVisibleSelected
              ? "Limpar seleção"
              : `Selecionar pagáveis (${selectableIds.size})`}
          </Button>
        )}
      </div>

      {/* Lista de colaboradores */}
      {filteredEntries.length > 0 ? (
      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {filteredEntries.map((entry) => {
          const rec = paymentByEntry.get(entry.id);
          const isPaid = !!rec?.paid_at;
          const value = Number(entry.value);
          const pixKey = entry.collaborator?.pix_key ?? null;
          const tx = transferByEntry.get(entry.id);
          const emVoo =
            !!tx && ["created", "sent", "confirmed", "unknown"].includes(tx.status);
          return (
            <div
              key={entry.id}
              className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
                isPaid ? "bg-success/5 dark:bg-success/15" : "hover:bg-muted/30"
              }`}
            >
              {/* Checkbox = SELEÇÃO pra pagamento em lote. Marcar pago na mão
                  virou o botão "Validar" à direita. Pago mostra um check; o que
                  não dá pra pagar agora (sem chave, em voo) fica travado. */}
              <div className="w-4 flex items-center justify-center shrink-0">
                {isPaid ? (
                  <span title="Pago">
                    <CheckCircle className="w-4 h-4 text-success" weight="fill" />
                  </span>
                ) : (
                  <Checkbox
                    checked={selected.has(entry.id)}
                    disabled={!selectableIds.has(entry.id)}
                    onCheckedChange={(checked) => toggleSelect(entry.id, !!checked)}
                    aria-label={`Selecionar ${entry.collaborator?.name ?? "colaborador"} pra pagamento`}
                    title={
                      selectableIds.has(entry.id)
                        ? "Selecionar pra pagamento"
                        : !pixKey
                          ? "Sem chave PIX cadastrada"
                          : emVoo
                            ? "Já está em processamento"
                            : "Indisponível pra pagar agora"
                    }
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className={`text-sm truncate ${
                      isPaid ? "text-muted-foreground" : "font-medium text-foreground"
                    }`}
                  >
                    {entry.collaborator?.name ?? "(sem nome)"}
                  </p>
                  {/* Uma tag por tipo que a linha somou — o valor à direita é o
                      líquido do conjunto, então precisa ficar claro o que entrou. */}
                  {(taxBreakdownByEntry.get(entry.id)?.types ?? [entry.type]).map(
                    (type) => (
                      <span
                        key={type}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium border shrink-0 ${
                          ENTRY_TYPE_COLORS[type] ??
                          "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {ENTRY_TYPE_LABELS[type] ?? type}
                      </span>
                    ),
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs mt-0.5">
                  {pixKey ? (
                    <>
                      <span className="text-muted-foreground">PIX:</span>
                      <span className="font-mono text-foreground/80 truncate max-w-[260px]">
                        {pixKey}
                      </span>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleCopyPix(pixKey);
                        }}
                        className="inline-flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition focus:outline-none focus:ring-2 focus:ring-primary/40"
                        aria-label="Copiar chave PIX"
                        title="Copiar chave PIX"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-muted-foreground/70 italic">
                      PIX não cadastrado
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {entry.description ?? "—"}
                  {isPaid && rec?.paid_at && (
                    <span className="ml-2">
                      · pago em{" "}
                      {new Date(rec.paid_at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}{" "}
                      {new Date(rec.paid_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0 flex items-center gap-1.5">
                {(() => {
                  const tax = taxBreakdownByEntry.get(entry.id);
                  const totalDiscount = tax?.discounts.reduce((s, d) => s + d.value, 0) ?? 0;
                  const hasMultipleComponents = (tax?.components.length ?? 0) > 1;
                  // Popup só faz sentido quando tem algo a explicar (deduções OU componentes mesclados).
                  if (!tax || (tax.inss === 0 && tax.irpf === 0 && totalDiscount === 0 && !hasMultipleComponents)) {
                    return null;
                  }
                  const grossValue = tax.components.reduce((s, c) => s + c.value, 0);
                  return (
                    <HoverCard openDelay={150} closeDelay={100}>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-warning hover:bg-warning/15 dark:hover:bg-warning/15 transition focus:outline-none focus:ring-2 focus:ring-warning/30"
                          aria-label="Ver detalhes do líquido"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <Info className="w-3.5 h-3.5" weight="fill" />
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent align="end" className="w-72 text-xs">
                        <div className="space-y-1.5">
                          {/* Componentes brutos (salário + gratificações) */}
                          {tax.components.map((c, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-muted-foreground truncate" title={c.label}>
                                {c.label}
                              </span>
                              <span className="font-mono shrink-0">
                                {formatCurrency(c.value)}
                              </span>
                            </div>
                          ))}
                          {hasMultipleComponents && (
                            <div className="border-t border-border pt-1.5 flex items-center justify-between gap-2 font-medium">
                              <span>Soma (bruto)</span>
                              <span className="font-mono">
                                {formatCurrency(grossValue)}
                              </span>
                            </div>
                          )}
                          {tax.inss > 0 && (
                            <div className="flex items-center justify-between gap-2 text-destructive dark:text-destructive">
                              <span>− INSS</span>
                              <span className="font-mono">
                                {formatCurrency(tax.inss)}
                              </span>
                            </div>
                          )}
                          {tax.irpf > 0 && (
                            <div className="flex items-center justify-between gap-2 text-destructive dark:text-destructive">
                              <span>− IRPF</span>
                              <span className="font-mono">
                                {formatCurrency(tax.irpf)}
                              </span>
                            </div>
                          )}
                          {tax.discounts.map((d, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-2 text-destructive dark:text-destructive"
                            >
                              <span className="truncate" title={d.label}>
                                − {d.label}
                              </span>
                              <span className="font-mono shrink-0">
                                {formatCurrency(d.value)}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-border pt-1.5 flex items-center justify-between gap-2 font-medium">
                            <span>Líquido</span>
                            <span className="font-mono text-primary dark:text-primary">
                              {formatCurrency(value)}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground/80 pt-1 italic">
                            FGTS é encargo do empregador — não desconta do
                            valor pago.
                          </p>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  );
                })()}
                <p
                  className={`font-mono text-sm font-semibold ${
                    isPaid
                      ? "text-success dark:text-success"
                      : "text-foreground"
                  }`}
                >
                  {formatCurrency(value)}
                </p>

                {/* Estado do PIX, quando existe tentativa pra esta linha. Badge
                    em tom suave do DS, não a borda translúcida de antes. */}
                {tx && tx.status !== "settled" && (
                  tx.status === "failed" ? (
                    <Badge
                      className="border-transparent bg-destructive/12 text-destructive"
                      title={tx.error_message ?? undefined}
                    >
                      Recusado
                    </Badge>
                  ) : tx.status === "unknown" ? (
                    <Badge variant="warning" title={tx.error_message ?? undefined}>
                      Em conferência
                    </Badge>
                  ) : (
                    <Badge variant="info">Enviando…</Badge>
                  )
                )}

                {/* Comprovante do PIX liquidado (PDF do banco). Só aparece pra
                    quem paga e só em transferência settled — pagamento manual
                    (checkbox) não tem comprovante do Santander. */}
                {podePagar && tx?.status === "settled" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    disabled={gerandoComprovante.has(tx.id)}
                    onClick={() => void handleVoucher(tx.id)}
                    title="Gerar o comprovante do PIX (PDF)"
                  >
                    {gerandoComprovante.has(tx.id) ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Receipt className="w-4 h-4" />
                    )}
                    Comprovante
                  </Button>
                )}

                {/* Transferência travada em voo: dá ao operador como conferir
                    agora (sem esperar o cron) e como cancelar pra destravar o
                    lançamento. No sandbox o banco-fake nunca finaliza, então é
                    por aqui que o teste sai do "Enviando…". */}
                {podePagar && emVoo && (
                  <div className="flex items-center gap-1.5">
                    {tx && tx.status !== "created" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        disabled={checkNow.isPending || cancel.isPending}
                        onClick={() => void handleCheckNow(entry.id)}
                        title="Perguntar ao banco o estado agora"
                      >
                        {checkNow.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <MagnifyingGlass className="w-4 h-4" />
                        )}
                        Conferir
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      disabled={checkNow.isPending || cancel.isPending}
                      onClick={() => void handleCancel(entry.id)}
                      title="Cancelar e liberar o lançamento"
                    >
                      {cancel.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <XIcon className="w-4 h-4" />
                      )}
                      Cancelar
                    </Button>
                  </div>
                )}

                {/* Validar = marcar pago NA MÃO (fora do PIX) — o que o checkbox
                    fazia antes. Some quando saiu por PIX (liquidado não se
                    desmarca) e quando há transferência em voo. */}
                {canManage && !emVoo && !(rec?.method === "pix_santander" && isPaid) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-8 gap-1.5 px-2.5 text-xs",
                      isPaid
                        ? "border-success/40 text-success hover:bg-success/10 hover:text-success dark:text-success"
                        : "text-muted-foreground",
                    )}
                    disabled={togglePayment.isPending}
                    title={
                      isPaid
                        ? "Pago na mão — clique pra desmarcar"
                        : "Marcar como pago na mão (fora do PIX)"
                    }
                    onClick={() =>
                      togglePayment.mutate({
                        entryId: entry.id,
                        amount: value,
                        newPaid: !isPaid,
                      })
                    }
                  >
                    <CheckCircle
                      className="w-3.5 h-3.5"
                      weight={isPaid ? "fill" : "regular"}
                    />
                    {isPaid ? "Pago" : "Validar"}
                  </Button>
                )}

                {/* Botão Pagar — a ação primária da linha (laranja aponta pra
                    ela). Some quando já pago ou já em voo. */}
                {podePagar && folhaLiberada && !isPaid && !emVoo && (
                  <Button
                    size="sm"
                    variant={tx?.status === "failed" ? "outline" : "default"}
                    className="h-8 px-3.5 text-xs"
                    disabled={!pixKey}
                    title={pixKey ? undefined : "Colaborador sem chave PIX cadastrada"}
                    onClick={() => setPagando(entry.id)}
                  >
                    {tx?.status === "failed" ? "Tentar de novo" : "Pagar"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {searchTerm.trim()
              ? "Nenhum colaborador com esse nome."
              : statusFilter === "pagos"
                ? "Nenhum pagamento concluído ainda."
                : statusFilter === "pendentes"
                  ? "Tudo pago por aqui ✓"
                  : "Sem lançamentos pagáveis."}
          </p>
        </div>
      )}

      {/* Diálogo de pagamento — montado fora da lista pra não remontar a cada
          re-render das linhas. */}
      {pagando && (() => {
        const entry = filteredEntries.find((e) => e.id === pagando);
        if (!entry) return null;
        const bd = taxBreakdownByEntry.get(entry.id);
        return (
          <PixPaymentDialog
            open
            onOpenChange={(o) => !o && setPagando(null)}
            periodId={periodId}
            entryId={entry.id}
            collaboratorName={entry.collaborator?.name ?? ""}
            pixKey={entry.collaborator?.pix_key ?? null}
            amount={Number(entry.value)}
            gross={(bd?.components ?? []).reduce((s, c) => s + c.value, 0)}
            inss={bd?.inss ?? 0}
            irpf={bd?.irpf ?? 0}
            components={bd?.components ?? []}
            discounts={bd?.discounts ?? []}
          />
        );
      })()}

      {/* Barra flutuante do lote — aparece quando há seleção. Mostra quantos,
          quanto, e o "Pagar" que abre o extrato do lote. */}
      {selectedLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg">
            <span className="flex items-center gap-1.5 text-sm text-foreground">
              <Users className="w-4 h-4 text-primary" weight="duotone" />
              <span className="font-semibold tabular-nums">{selectedLines.length}</span>
              <span className="text-muted-foreground">
                selecionado{selectedLines.length === 1 ? "" : "s"}
              </span>
            </span>
            <span className="h-5 w-px bg-border" />
            <span className="mono text-sm font-semibold tabular-nums text-foreground">
              {formatCurrency(selectedTotal)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSelected(new Set())}
            >
              Limpar
            </Button>
            <Button
              size="sm"
              className="h-8 px-4 text-xs"
              onClick={() => setBatchOpen(true)}
            >
              Pagar
            </Button>
          </div>
        </div>
      )}

      {batchOpen && (
        <BatchPixDialog
          open={batchOpen}
          onOpenChange={(o) => !o && setBatchOpen(false)}
          periodId={periodId}
          lines={selectedLines}
          onExecuted={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}
