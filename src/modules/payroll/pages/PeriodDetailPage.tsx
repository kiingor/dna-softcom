import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  ArrowUUpLeft,
  CheckCircle,
  Copy,
  CircleNotch as Loader2,
  Plus,
  Lock,
  LockOpen,
  Download,
  CaretRight,
  CaretDown,
  DotsThreeVertical,
  Info,
  Calendar,
  ArrowsClockwise as RefreshCw,
  Trash,
  MagnifyingGlass,
  X as XIcon,
  ChatCircleText,
  Warning as AlertTriangle,
} from "@phosphor-icons/react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentsTab } from "../components/PaymentsTab";
import { cn } from "@/lib/utils";
import { VacationAdvanceDialog } from "../components/VacationAdvanceDialog";
import { PayrollValidationButton } from "../components/validation/PayrollValidationButton";
import { toast } from "sonner";
import { useDashboard } from "@/contexts/DashboardContext";
import { usePermissions } from "@/hooks/usePermissions";
import {
  usePayrollEntries,
  usePayrollAlerts,
  usePayrollPeriods,
} from "../hooks/use-payroll";
import {
  usePayrollReviews,
  useUpsertPayrollReview,
} from "../hooks/use-payroll-reviews";
import { NewEntryDialog } from "../components/NewEntryDialog";
import {
  PERIOD_STATUS_LABELS,
  PERIOD_STATUS_COLORS,
  ENTRY_TYPE_LABELS,
  ENTRY_TYPE_COLORS,
  ALERT_KIND_LABELS,
  ALERT_SEVERITY_COLORS,
  ALERT_SEVERITY_LABELS,
  formatPeriodLabel,
  periodToMonthYear,
  isEarning,
  isDeduction,
  isPeriodEditable,
  PERIOD_TRANSITIONS,
  type PeriodTransition,
} from "../types";
import { PayrollApprovalTab } from "../components/PayrollApprovalTab";
import { useSetPeriodStatus } from "../hooks/use-payroll-approval";
import type { NewEntryValues } from "../schemas/payroll.schema";
import { exportPayrollExcel } from "../services/payroll-export.service";
import { formatCurrency } from "@/lib/formatters";

import PermissionGuard from "@/components/dashboard/PermissionGuard";
function PeriodDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const { currentCompany, hasAnyRole } = useDashboard();
  const canManage = hasAnyRole(["admin_gc", "gestor_gc"]);
  const paymentsPermission = usePermissions("folha_pagamentos");
  const canViewPayments = paymentsPermission.canView || paymentsPermission.isAdmin;
  const canManagePayments = canManage && (paymentsPermission.canEdit || paymentsPermission.isAdmin);
  // Aprovar como diretoria é gate de PAPEL, nunca de módulo: o toggle "Acesso
  // total" da tela de permissões concede todos os módulos, então gatear por
  // módulo transformaria qualquer usuário com acesso total em diretoria.
  const canApproveDiretoria = hasAnyRole(["diretoria", "admin_gc"]);

  const {
    period,
    entries,
    isLoading,
    createEntry,
    deleteEntry,
    reverseEntry,
    closePeriod,
    reopenPeriod,
  } = usePayrollEntries(id);
  const { recalculateTaxes } = usePayrollPeriods();
  const [confirmRecalc, setConfirmRecalc] = useState(false);
  /** Lançamento selecionado pra confirmação de exclusão (com motivo). */
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<{
    id: string;
    description: string;
    type: string;
    value: number;
  } | null>(null);
  /** Motivo da exclusão (obrigatório, registrado na auditoria). */
  const [deleteReason, setDeleteReason] = useState("");
  /** Transição de status pendente de confirmação (aprovar / devolver). */
  const [pendingTransition, setPendingTransition] =
    useState<PeriodTransition | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const setPeriodStatus = useSetPeriodStatus(id);

  const { data: alerts = [] } = usePayrollAlerts(id);

  const [isNewEntryOpen, setIsNewEntryOpen] = useState(false);
  const [vacationAdvanceOpen, setVacationAdvanceOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"close" | "reopen" | null>(
    null
  );
  const [reversingEntry, setReversingEntry] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [expandedCollabs, setExpandedCollabs] = useState<Set<string>>(new Set());

  // Filtros de empresa (store) e setor (team). 'all' = sem filtro.
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  // Busca por nome do colaborador (igual aba Pagamentos). Normaliza acento
  // (NFD + remove combining diacritics) pra "joao" achar "João".
  const [searchTerm, setSearchTerm] = useState("");
  const normalizeSearch = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Conferência de lançamentos por colaborador (igual ao "Pago" de Pagamentos).
  const [reviewFilter, setReviewFilter] = useState<"all" | "reviewed" | "pending">("all");
  const [obsFilter, setObsFilter] = useState<"all" | "with" | "without">("all");
  // Filtro de cargo (multi-seleção) — guarda os NOMES de cargo selecionados.
  // São ~177 cargos, então o popover tem busca (cargoSearch) pra filtrar a lista.
  const [positionFilter, setPositionFilter] = useState<Set<string>>(new Set());
  const [cargoSearch, setCargoSearch] = useState("");
  const togglePosition = (name: string, on: boolean) =>
    setPositionFilter((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  const { data: reviews = [] } = usePayrollReviews(id);
  const upsertReview = useUpsertPayrollReview(id ?? "");
  const reviewByCollab = useMemo(() => {
    const map = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) map.set(r.collaborator_id, r);
    return map;
  }, [reviews]);
  const hasObs = (collabId: string) =>
    !!reviewByCollab.get(collabId)?.observation?.trim();
  const isReviewed = (collabId: string) =>
    !!reviewByCollab.get(collabId)?.is_reviewed;

  // Carrega lookups da company atual pra popular os dropdowns.
  const { data: stores = [] } = useQuery({
    queryKey: ["folha-stores-lookup", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("stores")
        .select("id, store_name")
        .eq("company_id", currentCompany.id)
        .order("store_name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!currentCompany?.id,
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["folha-teams-lookup", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("company_id", currentCompany.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!currentCompany?.id,
  });

  // Cargo (position) de cada colaborador da empresa — uma fonte só que alimenta
  // o FILTRO de Cargo (multi-seleção) E o split de ESTAGIÁRIOS (cargo "estagiário").
  const { data: positionsList = [] } = useQuery({
    queryKey: ["folha-positions-lookup", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [] as { id: string; name: string }[];
      const { data, error } = await supabase
        .from("positions")
        .select("id, name")
        .eq("company_id", currentCompany.id);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!currentCompany?.id,
  });
  const { data: collabPosList = [] } = useQuery({
    queryKey: ["folha-collab-position-ids", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [] as { id: string; position_id: string | null }[];
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, position_id")
        .eq("company_id", currentCompany.id);
      if (error) throw error;
      return (data ?? []) as { id: string; position_id: string | null }[];
    },
    enabled: !!currentCompany?.id,
  });
  const positionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positionsList) m.set(p.id, p.name);
    return m;
  }, [positionsList]);
  // collaborator_id → nome do cargo (ou null).
  const collabPosition = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of collabPosList) {
      m.set(c.id, c.position_id ? positionNameById.get(c.position_id) ?? null : null);
    }
    return m;
  }, [collabPosList, positionNameById]);
  // Cargos distintos (ordenados) pro filtro multi-seleção. Cargos com o mesmo
  // nome (ex.: 2× "Estagiario") viram UMA opção e filtram os dois.
  const positionNames = useMemo(() => {
    const s = new Set<string>();
    for (const p of positionsList) if (p.name) s.add(p.name);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [positionsList]);
  // Estagiários: colaboradores cujo cargo contém "estagi" (pega os 2+ cargos).
  const internIds = useMemo(() => {
    const s = new Set<string>();
    for (const [cid, name] of collabPosition) {
      if (name && /estagi/i.test(name)) s.add(cid);
    }
    return s;
  }, [collabPosition]);

  // Aplica filtros — usa entry.store_id (preferência) ou colab.store_id como fallback;
  // team_id vem só do collaborator.
  const filteredEntries = useMemo(() => {
    if (storeFilter === "all" && teamFilter === "all") return entries;
    return entries.filter((e) => {
      if (storeFilter !== "all") {
        const sid = e.store_id ?? e.collaborator?.store_id ?? null;
        if (sid !== storeFilter) return false;
      }
      if (teamFilter !== "all") {
        const tid = e.collaborator?.team_id ?? null;
        if (tid !== teamFilter) return false;
      }
      return true;
    });
  }, [entries, storeFilter, teamFilter]);

  // Aba "Lançamentos" (RH) NÃO lista Bonificação (type='bonificacao', vinda do
  // "CUSTO SETOR" da agenda) — é custo interno de setor, não lançamento de
  // folha do colaborador. Some da listagem, do contador e do net mostrado
  // aqui. A aba Pagamentos, os totais do topo e a exportação seguem intactos.
  const lancamentoEntries = useMemo(
    () =>
      filteredEntries.filter((e) => {
        if (e.type === "bonificacao" && !e.external_id?.startsWith("ferias-")) return false;
        // Filtro de cargo (multi-seleção): mantém só os colaboradores cujo
        // cargo está entre os selecionados. Afeta KPIs e lista desta aba.
        if (positionFilter.size > 0) {
          const pos = collabPosition.get(e.collaborator_id) ?? null;
          if (!pos || !positionFilter.has(pos)) return false;
        }
        return true;
      }),
    [filteredEntries, positionFilter, collabPosition],
  );

  const isFiltering = storeFilter !== "all" || teamFilter !== "all";

  const handleCopyPix = async (pixKey: string) => {
    try {
      await navigator.clipboard.writeText(pixKey);
      toast.success("PIX copiado");
    } catch {
      toast.error("Não consegui copiar. Tenta selecionar e copiar manualmente.");
    }
  };

  const toggleCollab = (id: string) => {
    setExpandedCollabs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // FGTS é custo do empregador — aparece só como info na linha do salário, sem
  // reduzir o líquido. INSS e IRPF agora são LINHAS PRÓPRIAS (igual ao holerite
  // do contador): antes eram absorvidos/distribuídos, o que escondia que o IRPF
  // incide sobre salário + gratificação (a base cheia).
  const TAX_TYPES = new Set(["fgts"]);

  const groupedByCollab = useMemo(() => {
    type DisplayEntry = (typeof filteredEntries)[number] & {
      _adjustedValue?: number;
      _taxesApplied?: { inss?: number; irpf?: number; fgts?: number };
    };
    type Group = {
      id: string;
      name: string;
      surname: string | null;
      pixKey: string | null;
      entries: DisplayEntry[];
      taxBreakdown: { inss: number; irpf: number; fgts: number };
      net: number;
    };
    const map = new Map<string, Group>();
    for (const e of lancamentoEntries) {
      const collabId = e.collaborator_id ?? "_orphan";
      if (!map.has(collabId)) {
        map.set(collabId, {
          id: collabId,
          name: e.collaborator?.name ?? "(sem nome)",
          surname: e.collaborator?.softcom_surname ?? null,
          pixKey: e.collaborator?.pix_key ?? null,
          entries: [],
          taxBreakdown: { inss: 0, irpf: 0, fgts: 0 },
          net: 0,
        });
      }
      const g = map.get(collabId)!;
      const v = Number(e.value);
      if (TAX_TYPES.has(e.type)) {
        g.taxBreakdown[e.type as "inss" | "irpf" | "fgts"] += v;
        // FGTS é custo do empregador — não desconta do líquido do colaborador.
        if (e.type !== "fgts") g.net -= v;
      } else {
        g.entries.push(e);
        g.net += isEarning(e.type) ? v : -v;
      }
    }
    // FGTS é custo do empregador: mostra como info na linha do salário base, sem
    // reduzir o líquido. INSS e IRPF NÃO são mais absorvidos — viram linhas
    // próprias (ver TAX_TYPES). Assim o IRPF aparece com o valor cheio (sobre
    // salário + gratificação), igual ao holerite do contador.
    for (const g of map.values()) {
      const { fgts } = g.taxBreakdown;
      const salaryEntry = g.entries.find((e) => e.type === "salario_base");
      if (salaryEntry && fgts > 0) {
        salaryEntry._adjustedValue = Number(salaryEntry.value);
        salaryEntry._taxesApplied = { fgts };
      }
    }
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
  }, [lancamentoEntries]);

  // Aplica a busca por nome em cima dos grupos já montados. Mantém os totais
  // do topo intactos (igual aba Pagamentos: a busca só filtra a lista exibida).
  const isSearching = searchTerm.trim().length > 0;
  const hasReviewFilters = reviewFilter !== "all" || obsFilter !== "all";
  const visibleGroups = useMemo(() => {
    const q = normalizeSearch(searchTerm.trim());
    return groupedByCollab.filter((g) => {
      if (
        q &&
        !normalizeSearch(g.name).includes(q) &&
        !normalizeSearch(g.surname ?? "").includes(q)
      )
        return false;
      const r = reviewByCollab.get(g.id);
      if (reviewFilter === "reviewed" && !r?.is_reviewed) return false;
      if (reviewFilter === "pending" && r?.is_reviewed) return false;
      if (obsFilter === "with" && !r?.observation?.trim()) return false;
      if (obsFilter === "without" && r?.observation?.trim()) return false;
      return true;
    });
  }, [groupedByCollab, searchTerm, reviewFilter, obsFilter, reviewByCollab]);

  // Contagem de lançamentos dentro dos grupos visíveis (pro cabeçalho).
  const visibleCollabIds = new Set(visibleGroups.map((g) => g.id));
  const visibleLancCount = isSearching || hasReviewFilters
    ? lancamentoEntries.filter((e) =>
        visibleCollabIds.has(e.collaborator_id ?? "_orphan"),
      ).length
    : lancamentoEntries.length;

  const allExpanded =
    visibleGroups.length > 0 &&
    visibleGroups.every((g) => expandedCollabs.has(g.id));

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedCollabs(new Set());
    } else {
      setExpandedCollabs(new Set(visibleGroups.map((g) => g.id)));
    }
  };

  // KPIs da aba LANÇAMENTOS — calculados sobre os lançamentos exibidos nesta aba
  // (exclui bonificação/custo-setor). FGTS é custo do empregador, então fica fora
  // do líquido (igual ao que a tabela mostra). Pagamentos tem KPIs próprios.
  //
  // Os ESTAGIÁRIOS (por cargo) saem dos totais principais e ganham KPIs à parte.
  const lancamentoStats = useMemo(() => {
    const mkBucket = () => ({
      earnings: 0,
      deductions: 0,
      byCollab: new Set<string>(),
    });
    const main = mkBucket();
    const intern = mkBucket();
    for (const e of lancamentoEntries) {
      const bucket = internIds.has(e.collaborator_id) ? intern : main;
      const v = Number(e.value);
      bucket.byCollab.add(e.collaborator_id);
      if (isEarning(e.type)) bucket.earnings += v;
      else if (isDeduction(e.type) && e.type !== "fgts") bucket.deductions += v;
    }
    const finalize = (b: ReturnType<typeof mkBucket>) => ({
      collaborators: b.byCollab.size,
      earnings: b.earnings,
      deductions: b.deductions,
      net: b.earnings - b.deductions,
    });
    return { main: finalize(main), intern: finalize(intern) };
  }, [lancamentoEntries, internIds]);

  if (isLoading || !period) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Editável = 'open' ou 'aprovado_rh' (a folha só congela quando a diretoria
  // aprova). Fonte única em types.ts, espelhando payroll_period_is_locked() no
  // banco — não enumerar status travados aqui.
  const isEditable = isPeriodEditable(period.status);
  const isReopenable =
    period.status === "closed" || period.status === "exported";
  // Transições de fluxo disponíveis a partir do status atual, filtradas pelo
  // papel de quem está olhando.
  const transitions = (PERIOD_TRANSITIONS[period.status] ?? []).filter((t) =>
    t.role === "diretoria" ? canApproveDiretoria : canManage,
  );

  const handleNewEntry = async (values: NewEntryValues) => {
    await createEntry.mutateAsync(values);
    setIsNewEntryOpen(false);
  };

  const handleReverse = async () => {
    if (!reversingEntry) return;
    if (reverseReason.length < 5) {
      toast.error("Conta um pouco mais o motivo (mín 5 caracteres).");
      return;
    }
    await reverseEntry.mutateAsync({
      entryId: reversingEntry,
      values: { reason: reverseReason },
    });
    setReversingEntry(null);
    setReverseReason("");
  };

  const handleExport = () => {
    // Exporta EXATAMENTE os colaboradores visíveis (respeita Empresa/Setor/Cargo
    // + busca + filtros de conferência/observação). Inclui todos os tipos de
    // lançamento do colaborador (incl. bonificação/encargos) pro contador.
    const exportEntries = filteredEntries.filter((e) =>
      visibleCollabIds.has(e.collaborator_id ?? "_orphan"),
    );
    if (exportEntries.length === 0) {
      toast.error(
        isFiltering || isSearching || hasReviewFilters || positionFilter.size > 0
          ? "Nada pra exportar com esses filtros. Limpa os filtros pra exportar o período inteiro."
          : "Nada pra exportar — período sem lançamentos.",
      );
      return;
    }
    try {
      // Observações da conferência por colaborador → coluna no Excel.
      const observationByCollab = new Map<string, string>();
      for (const [cid, r] of reviewByCollab.entries()) {
        const obs = r.observation?.trim();
        if (obs) observationByCollab.set(cid, obs);
      }
      const collabsCount = exportPayrollExcel({
        period,
        entries: exportEntries,
        companyName: currentCompany?.company_name ?? "Empresa",
        cnpj: null, // TODO: companies.cnpj quando disponível no context
        observationByCollab,
      });
      toast.success(
        `Pronto ✓ ${collabsCount} colaborador${collabsCount === 1 ? "" : "es"} exportado${collabsCount === 1 ? "" : "s"} (1 arquivo, 1 aba por regime).`,
      );
    } catch (err) {
      toast.error("Não rolou exportar. Tenta de novo?");
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/dashboard/folha">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Folha
          </Link>
        </Button>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {formatPeriodLabel(period.reference_month)}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Badge
                variant="outline"
                className={`border-0 ${PERIOD_STATUS_COLORS[period.status]}`}
              >
                {PERIOD_STATUS_LABELS[period.status]}
              </Badge>
              {period.closed_at && (
                <span className="text-sm text-muted-foreground">
                  · fechado em{" "}
                  {new Date(period.closed_at).toLocaleDateString("pt-BR")}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {alerts.length > 0 && (
              <Button
                variant="outline"
                onClick={() => setAlertsOpen(true)}
                className="border-warning/25 text-warning hover:bg-warning/15 hover:text-warning dark:border-warning/25 dark:text-warning"
              >
                <AlertTriangle className="w-4 h-4 mr-2" weight="fill" />
                Alertas
                <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-warning/10 text-warning text-xs font-semibold dark:bg-warning/15 dark:text-warning">
                  {alerts.length}
                </span>
              </Button>
            )}
            {/* Transições do fluxo (Aprovar RH / Aprovar Diretoria / Devolver)
                ficam AQUI, como ação principal — não dentro de "Ações". É o
                que a pessoa vem fazer nesta tela. */}
            {transitions.map((t) => (
              <Button
                key={t.to}
                variant={t.destructive ? "outline" : "default"}
                className={
                  t.destructive
                    ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    : undefined
                }
                onClick={() => setPendingTransition(t)}
              >
                {t.destructive ? (
                  <ArrowUUpLeft className="w-4 h-4 mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" weight="fill" />
                )}
                {t.label}
              </Button>
            ))}
            {canViewPayments && (
              <PayrollValidationButton
                companyId={currentCompany?.id}
                referenceMonth={period.reference_month}
                canManage={canManagePayments}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <DotsThreeVertical className="w-4 h-4 mr-2" weight="bold" />
                  Ações
                  <CaretDown className="w-3.5 h-3.5 ml-2 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                  {formatPeriodLabel(period.reference_month)}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onSelect={handleExport}
                  disabled={filteredEntries.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Exportar Excel
                </DropdownMenuItem>

                {canManage && isEditable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setIsNewEntryOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Novo lançamento
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setVacationAdvanceOpen(true)}>
                      <Calendar className="w-4 h-4 mr-2" />
                      Adiantar férias
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setConfirmRecalc(true)}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Recalcular encargos
                    </DropdownMenuItem>
                  </>
                )}

                {/* As transições do fluxo saíram daqui: agora são botões
                    próprios no topo, ao lado de "Validar folha". Manter nos
                    dois lugares duplicaria a ação. */}

                {canManage && isReopenable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setConfirmAction("reopen")}>
                      <LockOpen className="w-4 h-4 mr-2" />
                      Reabrir período
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Filtros: Empresa + Setor */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Empresa</label>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as empresas</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.store_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Setor</label>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os setores</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isFiltering && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStoreFilter("all");
              setTeamFilter("all");
            }}
            className="h-9 text-xs"
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Alertas pendentes viram um botão no topo (abre dialog) pra dar mais
          espaço vertical à tela. Ver <Dialog> no fim do componente.
          Os KPIs saíram daqui — agora ficam DENTRO de cada aba, com os totais
          próprios (lançamentos ≠ pagamentos). */}

      {/* Tabs: Lançamentos (RH) / Pagamentos (Financeiro) / Aprovação (Diretoria) */}
      <Tabs defaultValue="lancamentos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          {canViewPayments && (
            <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
          )}
          <TabsTrigger value="aprovacao">Aprovação</TabsTrigger>
        </TabsList>

        <TabsContent value="aprovacao">
          <PayrollApprovalTab
            periodId={period.id}
            entries={filteredEntries}
            status={period.status}
            canComment={canManage || canApproveDiretoria}
          />
        </TabsContent>

        {canViewPayments && (
          <TabsContent value="pagamentos">
            <Card>
              <CardHeader>
                <CardTitle>Pagamentos</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Valores líquidos (com INSS e IRPF já descontados conforme a
                  tabela 2026). Benefícios, FGTS e lançamentos estornados ficam
                  fora. Passa o mouse no ícone <Info className="inline w-3 h-3 mx-0.5 text-warning" weight="fill" /> pra ver bruto/desconto/líquido.
                </p>
              </CardHeader>
              <CardContent>
                <PaymentsTab
                  periodId={period.id}
                  entries={filteredEntries}
                  canManage={canManagePayments}
                  periodStatus={period.status}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="lancamentos">
          {/* Resumo dos lançamentos — mesmo padrão de card da aba Pagamentos.
              Antes eram 8 cards grandes (principais + estagiários) tomando meia
              tela; agora é um bloco coeso por grupo, com os números em mono. */}
          <div className="space-y-3 mb-4">
            <div className="rounded-lg border border-border bg-card p-4 shadow-soft">
              <p className="label-eyebrow mb-3">
                {lancamentoStats.intern.collaborators > 0 ? "Folha — sem estagiários" : "Folha"}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="min-w-0">
                  <p className="label-eyebrow">Pessoas</p>
                  <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-foreground">
                    {lancamentoStats.main.collaborators}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="label-eyebrow">Proventos</p>
                  <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-success truncate">
                    {formatCurrency(lancamentoStats.main.earnings)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="label-eyebrow">Descontos</p>
                  <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-destructive truncate">
                    {formatCurrency(lancamentoStats.main.deductions)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="label-eyebrow">Líquido</p>
                  <p
                    className={cn(
                      "mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] truncate",
                      lancamentoStats.main.net >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {formatCurrency(lancamentoStats.main.net)}
                  </p>
                </div>
              </div>
            </div>

            {lancamentoStats.intern.collaborators > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 shadow-soft">
                <p className="label-eyebrow mb-3">Estagiários</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="min-w-0">
                    <p className="label-eyebrow">Pessoas</p>
                    <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-foreground">
                      {lancamentoStats.intern.collaborators}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="label-eyebrow">Proventos</p>
                    <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-success truncate">
                      {formatCurrency(lancamentoStats.intern.earnings)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="label-eyebrow">Descontos</p>
                    <p className="mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] text-destructive truncate">
                      {formatCurrency(lancamentoStats.intern.deductions)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="label-eyebrow">Líquido</p>
                    <p
                      className={cn(
                        "mono mt-1 text-lg font-semibold leading-tight tracking-[-0.02em] truncate",
                        lancamentoStats.intern.net >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {formatCurrency(lancamentoStats.intern.net)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Lançamentos */}
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Lançamentos</CardTitle>
                {visibleGroups.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleAll}
                    className="text-xs h-7"
                  >
                    {allExpanded ? "Recolher todos" : "Expandir todos"}
                  </Button>
                )}
              </div>

              {/* Filtros da aba (igual Pagamentos tem sua busca): colaborador +
                  conferência + observação. Empresa/Setor ficam no topo da tela. */}
              {entries.length > 0 && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-medium">
                      Colaborador
                    </label>
                    <div className="relative">
                      <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        type="text"
                        placeholder="Buscar colaborador..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-[240px] pl-9 pr-9 h-10"
                      />
                      {isSearching && (
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
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-medium">
                      Conferência
                    </label>
                    <Select
                      value={reviewFilter}
                      onValueChange={(v) => setReviewFilter(v as typeof reviewFilter)}
                    >
                      <SelectTrigger className="w-[180px] h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="reviewed">Conferidos</SelectItem>
                        <SelectItem value="pending">Não conferidos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-medium">
                      Observação
                    </label>
                    <Select
                      value={obsFilter}
                      onValueChange={(v) => setObsFilter(v as typeof obsFilter)}
                    >
                      <SelectTrigger className="w-[180px] h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="with">Com observação</SelectItem>
                        <SelectItem value="without">Sem observação</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-medium">
                      Cargo
                    </label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-[190px] h-10 justify-between font-normal"
                        >
                          <span className="truncate">
                            {positionFilter.size === 0
                              ? "Todos os cargos"
                              : `${positionFilter.size} cargo${positionFilter.size > 1 ? "s" : ""}`}
                          </span>
                          <CaretDown className="w-3.5 h-3.5 ml-2 opacity-60 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[260px] p-0">
                        <div className="p-2 border-b border-border">
                          <div className="relative">
                            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <Input
                              type="text"
                              placeholder="Buscar cargo..."
                              value={cargoSearch}
                              onChange={(e) => setCargoSearch(e.target.value)}
                              className="h-8 pl-8 text-sm"
                            />
                          </div>
                        </div>
                        <div className="max-h-[260px] overflow-y-auto p-1">
                          {(() => {
                            const q = normalizeSearch(cargoSearch.trim());
                            const shown = q
                              ? positionNames.filter((n) => normalizeSearch(n).includes(q))
                              : positionNames;
                            if (positionNames.length === 0) {
                              return (
                                <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                                  Sem cargos cadastrados.
                                </p>
                              );
                            }
                            if (shown.length === 0) {
                              return (
                                <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                                  Nenhum cargo com esse nome.
                                </p>
                              );
                            }
                            return shown.map((name) => (
                              <label
                                key={name}
                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                              >
                                <Checkbox
                                  checked={positionFilter.has(name)}
                                  onCheckedChange={(c) => togglePosition(name, !!c)}
                                />
                                <span className="truncate">{name}</span>
                              </label>
                            ));
                          })()}
                        </div>
                        {positionFilter.size > 0 && (
                          <div className="border-t border-border p-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full h-7 text-xs"
                              onClick={() => setPositionFilter(new Set())}
                            >
                              Limpar cargos ({positionFilter.size})
                            </Button>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                  {(isSearching || hasReviewFilters || positionFilter.size > 0) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearchTerm("");
                        setReviewFilter("all");
                        setObsFilter("all");
                        setPositionFilter(new Set());
                      }}
                      className="h-9 text-xs"
                    >
                      Limpar
                    </Button>
                  )}
                </div>
              )}

              {/* Contagem */}
              {lancamentoEntries.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {visibleGroups.length} colaborador
                  {visibleGroups.length === 1 ? "" : "es"} · {visibleLancCount}{" "}
                  lançamento{visibleLancCount === 1 ? "" : "s"}
                  {isSearching || hasReviewFilters ? (
                    <span className="ml-1">
                      (de {groupedByCollab.length} colaborador
                      {groupedByCollab.length === 1 ? "" : "es"})
                    </span>
                  ) : (
                    isFiltering && (
                      <span className="ml-1">(de {entries.length} no total)</span>
                    )
                  )}
                </p>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {entries.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-muted-foreground mb-2">
                    Mês ainda zerado.
                  </p>
                  {canManage && isEditable && (
                    <Button onClick={() => setIsNewEntryOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Lançar primeiro
                    </Button>
                  )}
                </div>
              ) : lancamentoEntries.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Nenhum lançamento com esses filtros.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStoreFilter("all");
                      setTeamFilter("all");
                      setPositionFilter(new Set());
                    }}
                  >
                    Limpar filtros
                  </Button>
                </div>
              ) : visibleGroups.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Nenhum colaborador com esses filtros.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setReviewFilter("all");
                      setObsFilter("all");
                      setPositionFilter(new Set());
                    }}
                  >
                    Limpar filtros
                  </Button>
                </div>
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[35%]">Colaborador</TableHead>
                    <TableHead className="w-[120px]">Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right w-[140px] whitespace-nowrap">Valor</TableHead>
                    <TableHead className="w-[170px] p-0"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleGroups.map((g) => {
                    const isOpen = expandedCollabs.has(g.id);
                    return (
                      <Fragment key={g.id}>
                        <TableRow
                          className={`hover:bg-muted/50 cursor-pointer ${
                            isReviewed(g.id)
                              ? "bg-success/5 dark:bg-success/15"
                              : "bg-muted/20"
                          }`}
                          onClick={() => toggleCollab(g.id)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2 font-medium">
                              {isOpen ? (
                                <CaretDown className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <CaretRight className="w-4 h-4 text-muted-foreground" />
                              )}
                              {g.surname && g.surname.trim() && g.surname.trim() !== g.name ? (
                                <span className="flex flex-col leading-tight min-w-0">
                                  <span className="font-medium truncate">{g.surname}</span>
                                  <span className="text-[11px] text-muted-foreground font-normal truncate">
                                    {g.name}
                                  </span>
                                </span>
                              ) : (
                                <span className="truncate">{g.name}</span>
                              )}
                            </div>
                            {/* PIX do colaborador — mesma apresentação da aba
                                Pagamentos, pra quem confere o lançamento não
                                precisar trocar de aba pra ver a chave. */}
                            <div className="flex items-center gap-1.5 text-xs mt-1 pl-6">
                              {g.pixKey ? (
                                <>
                                  <span className="text-muted-foreground">PIX:</span>
                                  <span className="font-mono text-foreground/80 truncate max-w-[260px]">
                                    {g.pixKey}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      handleCopyPix(g.pixKey!);
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
                          </TableCell>
                          <TableCell
                            colSpan={2}
                            className="text-xs text-muted-foreground"
                          >
                            {g.entries.length} lançamento
                            {g.entries.length === 1 ? "" : "s"}
                          </TableCell>
                          <TableCell
                            className={`text-right text-sm font-mono font-semibold whitespace-nowrap ${
                              g.net >= 0
                                ? "text-primary dark:text-primary"
                                : "text-destructive dark:text-destructive"
                            }`}
                          >
                            {g.net >= 0 ? "+ " : "- "}
                            {formatCurrency(Math.abs(g.net))}
                          </TableCell>
                          <TableCell className="p-0 pr-2 align-middle">
                            {/* Validar = a antiga marcação "Conferido", agora um
                                botão explícito (mesmo padrão da aba Pagamentos).
                                O checkbox saiu — na folha ele virou seleção. */}
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className={cn(
                                  "h-7 gap-1.5 px-2.5 text-xs",
                                  isReviewed(g.id)
                                    ? "border-success/40 text-success hover:bg-success/10 hover:text-success dark:text-success"
                                    : "text-muted-foreground",
                                )}
                                disabled={!canManage || upsertReview.isPending}
                                title={
                                  isReviewed(g.id)
                                    ? "Conferido — clique pra desmarcar"
                                    : "Marcar como conferido"
                                }
                                aria-label={`${isReviewed(g.id) ? "Desmarcar" : "Validar"} ${g.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  upsertReview.mutate({
                                    collaboratorId: g.id,
                                    patch: { is_reviewed: !isReviewed(g.id) },
                                  });
                                }}
                              >
                                <CheckCircle
                                  className="w-3.5 h-3.5"
                                  weight={isReviewed(g.id) ? "fill" : "regular"}
                                />
                                {isReviewed(g.id) ? "Validado" : "Validar"}
                              </Button>
                              <ReviewObsButton
                                hasObs={hasObs(g.id)}
                                observation={reviewByCollab.get(g.id)?.observation ?? ""}
                                disabled={!canManage}
                                onSave={(text) =>
                                  upsertReview.mutate({
                                    collaboratorId: g.id,
                                    patch: { observation: text.trim() || null },
                                  })
                                }
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen &&
                          g.entries.map((e) => {
                            const earning = isEarning(e.type);
                            const isAdjusted = e._adjustedValue !== undefined;
                            const value = isAdjusted
                              ? e._adjustedValue!
                              : Number(e.value);
                            const taxes = e._taxesApplied;
                            const deductions: Array<{
                              label: string;
                              value: number;
                            }> = [];
                            const employerCosts: Array<{
                              label: string;
                              value: number;
                            }> = [];
                            if (isAdjusted && taxes) {
                              if (taxes.inss)
                                deductions.push({ label: "INSS", value: taxes.inss });
                              if (taxes.irpf)
                                deductions.push({ label: "IRPF", value: taxes.irpf });
                              // FGTS não desconta do colaborador — é custo da empresa.
                              if (taxes.fgts)
                                employerCosts.push({ label: "FGTS", value: taxes.fgts });
                            }
                            return (
                              <TableRow
                                key={e.id}
                                className="hover:bg-muted/30"
                              >
                                <TableCell className="pl-10 text-xs text-muted-foreground">
                                  ↳
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                                      ENTRY_TYPE_COLORS[e.type] ??
                                      "bg-muted text-muted-foreground border-border"
                                    }`}
                                  >
                                    {ENTRY_TYPE_LABELS[e.type] ?? e.type}
                                  </span>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground max-w-xs">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="truncate">
                                      {e.description ?? "—"}
                                    </span>
                                    {isAdjusted &&
                                      (deductions.length > 0 ||
                                        employerCosts.length > 0) && (
                                      <HoverCard openDelay={150} closeDelay={100}>
                                        <HoverCardTrigger asChild>
                                          <button
                                            type="button"
                                            className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full text-warning hover:bg-warning/15 dark:hover:bg-warning/15 transition focus:outline-none focus:ring-2 focus:ring-warning/30"
                                            aria-label="Ver detalhes do líquido"
                                            onClick={(ev) => ev.stopPropagation()}
                                          >
                                            <Info className="w-3.5 h-3.5" weight="fill" />
                                          </button>
                                        </HoverCardTrigger>
                                        <HoverCardContent
                                          align="start"
                                          className="w-64 text-xs"
                                        >
                                          <div className="space-y-1.5">
                                            <div className="flex items-center justify-between gap-2 text-foreground">
                                              <span className="text-muted-foreground">
                                                Bruto
                                              </span>
                                              <span className="font-mono">
                                                {formatCurrency(Number(e.value))}
                                              </span>
                                            </div>
                                            {deductions.map((d) => (
                                              <div
                                                key={d.label}
                                                className="flex items-center justify-between gap-2 text-destructive dark:text-destructive"
                                              >
                                                <span>− {d.label}</span>
                                                <span className="font-mono">
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
                                            {employerCosts.map((c) => (
                                              <div
                                                key={c.label}
                                                className="flex items-center justify-between gap-2 text-muted-foreground"
                                                title="Custo do empregador — não desconta do colaborador"
                                              >
                                                <span>{c.label} (custo empresa)</span>
                                                <span className="font-mono">
                                                  {formatCurrency(c.value)}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </HoverCardContent>
                                      </HoverCard>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell
                                  className={`text-right text-sm font-mono whitespace-nowrap ${
                                    value < 0
                                      ? "text-destructive dark:text-destructive"
                                      : earning
                                      ? "text-primary dark:text-primary"
                                      : "text-foreground"
                                  }`}
                                >
                                  {value < 0 ? "" : earning ? "+ " : "- "}
                                  {formatCurrency(Math.abs(value))}
                                </TableCell>
                                <TableCell className="w-[44px] p-0 pr-1 align-middle">
                                  {canManage && isEditable ? (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                      title="Excluir lançamento"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        setDeleteReason("");
                                        setConfirmDeleteEntry({
                                          id: e.id,
                                          description: e.description ?? ENTRY_TYPE_LABELS[e.type] ?? e.type,
                                          type: ENTRY_TYPE_LABELS[e.type] ?? e.type,
                                          value: Number(e.value),
                                        });
                                      }}
                                    >
                                      <Trash className="w-3.5 h-3.5" />
                                    </Button>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Alertas pendentes (popup) */}
      <Dialog open={alertsOpen} onOpenChange={setAlertsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" weight="fill" />
              Alertas pendentes ({alerts.length})
            </DialogTitle>
          </DialogHeader>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-3 py-2 text-sm border-b border-border last:border-0"
              >
                <Badge
                  variant="outline"
                  className={`border-0 shrink-0 ${ALERT_SEVERITY_COLORS[a.severity]}`}
                >
                  {ALERT_SEVERITY_LABELS[a.severity] ?? a.severity}
                </Badge>
                <span className="flex-1">
                  <span className="text-muted-foreground">
                    {ALERT_KIND_LABELS[a.kind]}
                  </span>{" "}
                  {a.collaborator?.name && (
                    <strong className="text-foreground">
                      {a.collaborator.name}
                    </strong>
                  )}{" "}
                  — {a.message}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <NewEntryDialog
        open={isNewEntryOpen}
        onOpenChange={setIsNewEntryOpen}
        onSubmit={handleNewEntry}
        isSubmitting={createEntry.isPending}
      />

      {/* Confirmação de exclusão de lançamento (com motivo obrigatório) */}
      <AlertDialog
        open={!!confirmDeleteEntry}
        onOpenChange={(o) => !deleteEntry.isPending && !o && setConfirmDeleteEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {confirmDeleteEntry && (
                  <>
                    Vai apagar <strong>{confirmDeleteEntry.description}</strong>{" "}
                    ({confirmDeleteEntry.type}) — {formatCurrency(confirmDeleteEntry.value)}.
                    <br />
                    Essa ação é permanente e fica registrada na auditoria com o motivo abaixo.
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-reason" className="text-sm font-medium">
              Motivo da exclusão <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="delete-reason"
              value={deleteReason}
              onChange={(ev) => setDeleteReason(ev.target.value)}
              placeholder="Ex: lançamento duplicado / plano cancelado / valor incorreto…"
              rows={3}
              autoFocus
              disabled={deleteEntry.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório (mínimo 3 caracteres). Vai aparecer no log de auditoria.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteEntry.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteEntry.isPending || deleteReason.trim().length < 3}
              onClick={(ev) => {
                ev.preventDefault();
                if (!confirmDeleteEntry) return;
                deleteEntry.mutate(
                  { entryId: confirmDeleteEntry.id, reason: deleteReason },
                  { onSuccess: () => setConfirmDeleteEntry(null) },
                );
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteEntry.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {currentCompany?.id && (
        <VacationAdvanceDialog
          open={vacationAdvanceOpen}
          onOpenChange={setVacationAdvanceOpen}
          companyId={currentCompany.id}
          targetMonth={periodToMonthYear(period.reference_month).month}
          targetYear={periodToMonthYear(period.reference_month).year}
        />
      )}

      {/* Confirmar recalcular encargos */}
      <AlertDialog
        open={confirmRecalc}
        onOpenChange={(o) => !recalculateTaxes.isPending && setConfirmRecalc(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalcular encargos do período?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga os lançamentos de INSS, IRPF e FGTS desse mês e recria
              usando a tabela oficial 2026. A base do INSS/FGTS considera salário
              + hora extra + periculosidade menos faltas; o IRPF inclui também
              gratificação/carro agregado/atestado e os dependentes. Salário
              base, proventos, benefícios e descontos manuais ficam intactos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recalculateTaxes.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (period) {
                  recalculateTaxes.mutate(
                    { reference_month: period.reference_month },
                    { onSuccess: () => setConfirmRecalc(false) },
                  );
                }
              }}
              disabled={recalculateTaxes.isPending}
            >
              {recalculateTaxes.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Recalcular agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar fechar/reabrir */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "close" ? "Fechar período?" : "Reabrir período?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "close"
                ? "Após fechar, lançamentos viram read-only. Pra mudar algo, vai ter que estornar via novo lançamento. É reversível, mas marca data de fechamento."
                : "Período volta a aceitar novos lançamentos e edições. Use só se realmente precisa corrigir antes de exportar pro contador."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction === "close") closePeriod.mutate();
                else if (confirmAction === "reopen") reopenPeriod.mutate();
                setConfirmAction(null);
              }}
            >
              {confirmAction === "close" ? "Fechar" : "Reabrir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transição de status do fluxo de aprovação */}
      <AlertDialog
        open={!!pendingTransition}
        onOpenChange={(o) => {
          if (!o) {
            setPendingTransition(null);
            setTransitionReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingTransition?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTransition?.to === "aprovado_rh" &&
                "A folha vai pra fila da diretoria. O RH continua podendo corrigir lançamentos até a diretoria aprovar."}
              {pendingTransition?.to === "aprovado_diretoria" &&
                "Aprovação final: a folha CONGELA. Ninguém mais cria, edita ou exclui lançamento até alguém devolver pra rascunho."}
              {pendingTransition?.needsReason &&
                " Conta o motivo — ele fica registrado no histórico e aparece pra quem for corrigir."}
              {pendingTransition?.to === "closed" &&
                "Fecha a competência pra exportar pro contador."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingTransition?.needsReason && (
            <div className="space-y-2">
              <Label htmlFor="transition-reason">Motivo</Label>
              <Textarea
                id="transition-reason"
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
                placeholder="Ex: gratificação da Ana está com valor do mês passado"
                rows={3}
              />
              {transitionReason.trim().length > 0 &&
                transitionReason.trim().length < 5 && (
                  <p className="text-xs text-destructive">
                    Pelo menos 5 caracteres.
                  </p>
                )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                setPeriodStatus.isPending ||
                (pendingTransition?.needsReason === true &&
                  transitionReason.trim().length < 5)
              }
              onClick={async (ev) => {
                // Sem o preventDefault o AlertDialog fecha antes da mutation
                // resolver e o erro do servidor não chega na tela.
                ev.preventDefault();
                if (!pendingTransition) return;
                try {
                  await setPeriodStatus.mutateAsync({
                    toStatus: pendingTransition.to,
                    reason: transitionReason,
                  });
                  toast.success(`${pendingTransition.label} ✓`);
                  setPendingTransition(null);
                  setTransitionReason("");
                } catch {
                  // O onError do hook já mostra a mensagem do banco.
                }
              }}
              className={
                pendingTransition?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {pendingTransition?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Estorno */}
      <AlertDialog
        open={!!reversingEntry}
        onOpenChange={(o) => !o && setReversingEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Cria um lançamento contrário (valor negativo) com referência ao
              original. O lançamento aprovado fica preservado pra auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo do estorno</label>
            <textarea
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
              rows={3}
              placeholder="Por que precisou estornar?"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReverseReason("")}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleReverse}>Estornar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Botão de observação da conferência (por colaborador). Abre um popover com
 * textarea pra anotar divergências. Ícone fica âmbar quando já tem observação.
 */
function ReviewObsButton({
  hasObs,
  observation,
  disabled,
  onSave,
}: {
  hasObs: boolean;
  observation: string;
  disabled: boolean;
  onSave: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(observation);

  // Re-sincroniza ao (re)abrir, pra refletir o que está salvo.
  useEffect(() => {
    if (open) setText(observation);
  }, [open, observation]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={`h-7 w-7 ${hasObs ? "text-warning hover:text-warning hover:bg-warning/15 dark:hover:bg-warning/15" : "text-muted-foreground/40 hover:text-foreground"}`}
          title={hasObs ? `Observação: ${observation}` : "Adicionar observação"}
          onClick={(e) => e.stopPropagation()}
        >
          <ChatCircleText className="w-4 h-4" weight={hasObs ? "fill" : "regular"} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-medium text-muted-foreground">
          Observação / divergência
        </p>
        <Textarea
          rows={3}
          placeholder="Ex: salário divergente, falta lançar VT…"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled || text === observation}
            onClick={() => {
              onSave(text);
              setOpen(false);
            }}
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// A rota /dashboard/folha/:id não tinha gate nenhum: bastava digitar a URL.
// O módulo 'folha' agora barra quem não tem permissão de visualizar.
export default function PeriodDetailPage() {
  return (
    <PermissionGuard module="folha">
      <PeriodDetailPageContent />
    </PermissionGuard>
  );
}
