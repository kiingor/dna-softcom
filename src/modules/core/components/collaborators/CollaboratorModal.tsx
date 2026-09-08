import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useCreateCollaborator,
  useUpdateCollaborator,
} from "@/hooks/useCollaboratorWriteBack";
import { useDashboard } from "@/contexts/DashboardContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FloppyDisk as Save, Plus, CurrencyDollar as DollarSign, Gift, Buildings as Building2, Users, CircleNotch as Loader2, X, Wallet, TreePalm as Palmtree, ArrowsLeftRight as ArrowRightLeft, Power, Trash, Clock, Stethoscope, TShirt, Scales, CheckCircle, IdentificationCard, Bandaids, CalendarX, Storefront, ArrowsClockwise } from "@phosphor-icons/react";
import { SubResourceTab, type FieldDef } from "./tabs/SubResourceTab";
import { FERIAS_FIELDS } from "./vacation-period-fields";
import { toast } from "sonner";
import { formatCPFInput, cleanCPF, validateCPF, formatPhoneInput, formatCEPInput, cleanCEP, BRAZIL_STATES } from "@/lib/validators";
import { sendWhatsAppNotification } from "@/lib/whatsappNotifications";
import { AGENDA_SYNC_DISABLED } from "@/lib/agenda-sync";
import { formatCurrency, formatCurrencyForInput, formatNumberAsCurrency, parseCurrencyInput, getCurrentCompetencia, formatDateBR, toTitleCase } from "@/lib/formatters";
import { calculateMonthlyBenefitValue, getBenefitCalculationDescription, DayAbbrev } from "@/lib/workingDays";
import { calcAllTaxes } from "@/lib/payroll/cltCalc";
import { useStoreHolidays } from "@/modules/payroll/hooks/use-store-holidays";
import { recalcCollaboratorTaxes } from "@/modules/payroll/hooks/use-payroll";
import { PERIOD_EDITABLE_STATUSES } from "@/modules/payroll/types";
import CollaboratorValidationTab from "./CollaboratorValidationTab";
import { PositionChangeDialog } from "@/components/exames/PositionChangeDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { VacationPeriodAdjustDialog } from "./VacationPeriodAdjustDialog";
import { Pencil } from "@phosphor-icons/react";
import { CollaboratorPhotoUploader } from "./CollaboratorPhotoUploader";
import { CollaboratorTimelineTab } from "./tabs/CollaboratorTimelineTab";
import { CollaboratorDependentsTab } from "./tabs/CollaboratorDependentsTab";
import { CollaboratorUniformTab } from "./tabs/CollaboratorUniformTab";
import { CollaboratorMedicalCertsTab } from "./tabs/CollaboratorMedicalCertsTab";
import { CollaboratorAlimonyTab } from "./tabs/CollaboratorAlimonyTab";

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_HINT,
  PASSWORD_TOO_SHORT,
  isPasswordLongEnough,
} from "@/lib/security/password-policy";
// Field configs das sub-abas (Afastamentos, Absenteísmos, Férias, 13º, Planos, PDVs)
const AFASTAMENTO_FIELDS: FieldDef[] = [
  { name: "reason_code", label: "Código do motivo", type: "number", placeholder: "ex: 1" },
  { name: "start_date", label: "Data inicial", type: "date", required: true },
  { name: "end_date", label: "Data final", type: "date" },
  { name: "description", label: "Descrição", type: "textarea", placeholder: "Detalhes do afastamento" },
  { name: "has_certificate", label: "Tem atestado?", type: "checkbox" },
];
const ABSENTEISMO_FIELDS: FieldDef[] = [
  { name: "occurred_on", label: "Data", type: "date", required: true },
  { name: "days", label: "Dias", type: "number", placeholder: "1" },
  { name: "reason", label: "Motivo", type: "text", placeholder: "ex: Doença sem atestado" },
  { name: "notes", label: "Observação", type: "textarea" },
  { name: "has_certificate", label: "Tem atestado?", type: "checkbox" },
  { name: "bank_hours", label: "Banco de horas (h)", type: "number" },
];
const DECIMO_FIELDS: FieldDef[] = [
  { name: "year", label: "Ano", type: "number", placeholder: "2026", required: true },
  { name: "value_paid", label: "Valor pago (R$)", type: "number" },
  { name: "is_paid", label: "Pago?", type: "checkbox" },
  { name: "notes", label: "Observação", type: "textarea" },
];
const PLANO_FIELDS: FieldDef[] = [
  { name: "plan_name", label: "Nome do plano", type: "text", required: true },
  { name: "registration_code", label: "Matrícula", type: "text" },
  { name: "start_date", label: "Início", type: "date" },
  { name: "beneficiary_type", label: "Tipo", type: "text", placeholder: "TITULAR / DEPENDENTE" },
  { name: "beneficiary_name", label: "Nome do beneficiário", type: "text" },
  { name: "beneficiary_birth", label: "Nascimento", type: "date" },
  { name: "beneficiary_cpf", label: "CPF beneficiário", type: "text" },
  { name: "plan_value", label: "Valor mensal (R$)", type: "number" },
  { name: "notes", label: "Observação", type: "textarea" },
];
const PDV_FIELDS: FieldDef[] = [
  { name: "pdv_name", label: "Nome do PDV", type: "text", required: true },
  // f10 (flag legada) — oculto da UI; mantido no schema/sync mas não editável aqui
];

// Tradução dos status do enum vacation_periods (paid/pending/etc) pra pt-BR.
const VACATION_STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  approved: "Aprovado",
  available: "Disponível",
  partially_used: "Parcialmente usado",
  used: "Usado",
  expired: "Vencido",
  in_progress: "Em gozo",
  completed: "Concluído",
};

interface PendingEntry {
  id: string;
  type: "salario_base" | "hora_extra" | "custo" | "despesa" | "beneficio" | "inss" | "fgts" | "irpf";
  description: string;
  value: number;
  is_fixed: boolean;
  source: "position" | "manual" | "tax";
}

interface PendingBenefit {
  id: string;
  benefit_id: string;
  benefit_name: string;
  value: number;
  value_type: "monthly" | "daily";
  applicable_days: string[];
  monthly_value: number;
}

export interface CollaboratorPrefill {
  name?: string;
  softcom_surname?: string;
  cpf?: string;
  rg?: string;
  email?: string;
  phone?: string;
  pix_key?: string;
  birth_date?: string;
  position_id?: string;
  regime?: "clt" | "pj" | "estagiario";
  address?: string;
  district?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  notes?: string;
}

interface CollaboratorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaboratorId?: string | null;
  prefill?: CollaboratorPrefill;
  onSuccess?: (collaboratorId?: string) => void;
}

const CollaboratorModal = ({
  open,
  onOpenChange,
  collaboratorId,
  prefill,
  onSuccess,
}: CollaboratorModalProps) => {
  const queryClient = useQueryClient();
  const { currentCompany, hasAnyRole } = useDashboard();
  const isNew = !collaboratorId;
  const { month: currentMonth, year: currentYear } = getCurrentCompetencia();
  // Write-back pra agenda: substitui supabase.from('collaborators').update direto
  const updateCollaborator = useUpdateCollaborator();
  const createCollaborator = useCreateCollaborator();

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    softcom_surname: "",
    cpf: "",
    rg: "",
    email: "",
    phone: "",
    recado_phone: "",
    pis: "",
    discord_username: "",
    accounting_code: "",
    internal_code: "",
    pix_key: "",
    birth_date: "",
    position_id: "",
    store_id: "",
    contracted_store_id: "",
    team_id: "",
    admission_date: "",
    regime: "clt" as "clt" | "pj" | "estagiario",
    status: "ativo" as "ativo" | "inativo" | "aguardando_documentacao" | "validacao_pendente" | "reprovado",
    is_temp: false,
    is_pcd: false,
    is_apprentice: false,
    dependents_count: 0,
    address: "",
    district: "",
    city: "",
    state: "",
    postal_code: "",
    notes: "",
    photo_url: "",
    password: "",
  });
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSyncingDetails, setIsSyncingDetails] = useState(false);

  /**
   * Dispara `sync-collaborator-details` pra esse colab: traz da agenda
   * afastamentos, absenteismos, ferias, 13, planos, pdvs, exames, eventos
   * e popula as tabelas locais. Após sucesso, invalida queries dos
   * SubResourceTabs pra atualizar a UI.
   */
  const handleSyncDetails = async () => {
    if (!collaboratorId) return;
    setIsSyncingDetails(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-collaborator-details", {
        body: { collaboratorId },
      });
      if (error) throw error;
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      // Invalida queries do SubResourceTab (afastamentos, absenteismos, ferias, 13, planos, pdvs)
      ["afastamentos", "absenteismos", "ferias", "decimo-terceiro", "planos", "pdvs"].forEach((kind) => {
        queryClient.invalidateQueries({ queryKey: [`subresource-${kind}`, collaboratorId] });
      });
      // Invalida também queries dos tabs com componente próprio
      queryClient.invalidateQueries({ queryKey: ["collaborator-timeline", collaboratorId] });
      queryClient.invalidateQueries({ queryKey: ["collaborator-dependents", collaboratorId] });
      queryClient.invalidateQueries({ queryKey: ["collaborator-medical-certs", collaboratorId] });
      toast.success("Detalhes sincronizados da agenda.");
    } catch (err) {
      toast.error("Falha ao sincronizar: " + (err as Error).message);
    } finally {
      setIsSyncingDetails(false);
    }
  };
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previousPositionId, setPreviousPositionId] = useState<string | null>(null);
  const [adjustingPeriod, setAdjustingPeriod] = useState<any | null>(null);

  // Pending entries/benefits for new collaborators
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
  const [pendingBenefits, setPendingBenefits] = useState<PendingBenefit[]>([]);

  // Modals
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [addBenefitOpen, setAddBenefitOpen] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<any>(null);
  const [editingFixedEntry, setEditingFixedEntry] = useState<{
    id: string;
    type: string;
    description: string | null;
    value: number;
  } | null>(null);
  const [editEntryValue, setEditEntryValue] = useState("");
  const [editEntryDescription, setEditEntryDescription] = useState("");
  const [savingFixedEdit, setSavingFixedEdit] = useState(false);
  const [editingSalary, setEditingSalary] = useState(false);
  const [editSalaryValue, setEditSalaryValue] = useState("");
  const [savingSalary, setSavingSalary] = useState(false);
  const [deletingAssignment, setDeletingAssignment] = useState<any>(null);
  const [editingAssignmentValue, setEditingAssignmentValue] = useState<{
    assignment: any;
    inputValue: string;
  } | null>(null);
  const [savingCustomValue, setSavingCustomValue] = useState(false);
  const [createStoreOpen, setCreateStoreOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [positionChangeOpen, setPositionChangeOpen] = useState(false);

  // Entry form state - extended with month/year/installment
  const [entryForm, setEntryForm] = useState({
    type: "hora_extra" as "salario_base" | "hora_extra" | "custo" | "despesa" | "beneficio" | "auxilio_vale_transporte",
    description: "",
    value: "",
    is_fixed: false,
    month: currentMonth,
    year: currentYear,
    is_installment: false,
    installment_count: 2,
  });

  // Benefit assignment state
  const [selectedBenefitId, setSelectedBenefitId] = useState("");

  const canManage = hasAnyRole(["admin", "admin_gc", "gestor_gc"]);

  // Tipos manuais que viram ficha fixa (espelha FIXED_MANUAL_TYPES do
  // use-payroll). Lançamento no cadastro = permanente: só esses tipos.
  const FIXED_MANUAL_TYPES = [
    "carro_agregado", "desconto", "bonificacao", "gratificacao",
    "hora_extra", "atestado", "falta", "adiantamento",
  ];

  // Prefetch das queries das abas quando o modal abre — assim ao trocar pra
  // aba Histórico/Dependentes/etc os dados já estão cacheados.
  useEffect(() => {
    if (!open || !collaboratorId) return;
    const prefetch = (queryKey: string, table: string, orderByCol?: string, ascending = false) => {
      queryClient.prefetchQuery({
        queryKey: [queryKey, collaboratorId],
        queryFn: async () => {
          let q = supabase.from(table as never).select("*").eq("collaborator_id", collaboratorId);
          if (orderByCol) q = q.order(orderByCol, { ascending });
          const { data } = await q;
          return data ?? [];
        },
        staleTime: 5 * 60 * 1000,
      });
    };
    prefetch("collaborator-timeline", "collaborator_timeline_events", "effective_date");
    prefetch("collaborator-dependents", "collaborator_dependents", "created_at", true);
    prefetch("collaborator-medical-certs", "collaborator_medical_certificates", "issued_at");
    prefetch("collaborator-uniform-sizes", "collaborator_uniform_sizes", "measured_at");
    prefetch("collaborator-alimony", "collaborator_alimony_orders", "effective_from");
  }, [open, collaboratorId, queryClient]);

  // Fetch collaborator data
  const { data: collaborator, isLoading: loadingCollaborator } = useQuery({
    queryKey: ["collaborator", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return null;
      const { data, error } = await supabase
        .from("collaborators")
        .select("*")
        .eq("id", collaboratorId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!collaboratorId && open,
  });

  // Fetch positions
  const { data: positions = [] } = useQuery({
    queryKey: ["positions", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentCompany?.id && open,
  });

  // Fetch stores
  const { data: stores = [], refetch: refetchStores } = useQuery({
    queryKey: ["stores", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("stores")
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("store_name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentCompany?.id && open,
  });

  // Fetch teams
  const { data: teams = [], refetch: refetchTeams } = useQuery({
    queryKey: ["teams", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentCompany?.id && open,
  });

  // Fetch payroll entries for existing collaborator
  const { data: payrollEntries = [], refetch: refetchEntries } = useQuery({
    queryKey: ["payroll-entries", collaboratorId, currentMonth, currentYear],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("payroll_entries")
        .select("*")
        .eq("collaborator_id", collaboratorId)
        .eq("month", currentMonth)
        .eq("year", currentYear)
        .order("type");
      if (error) throw error;
      return data;
    },
    enabled: !!collaboratorId && open,
  });

  // Ficha fixa: lançamentos recorrentes PERMANENTES do colaborador (Carro
  // Agregado, descontos fixos, etc.). Moram no cadastro, não na competência —
  // aparecem sempre, independente do mês, até serem excluídos. A folha os
  // materializa por mês ao Abrir/Repopular. Ver collaborator_fixed_entries.
  const { data: fixedEntries = [], refetch: refetchFixedEntries } = useQuery({
    queryKey: ["collaborator-fixed-entries", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("collaborator_fixed_entries")
        .select("*")
        .eq("collaborator_id", collaboratorId)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!collaboratorId && open,
  });

  // ──────────────────────────────────────────────────────────────────────
  // Salário "do cadastro" (display-only)
  //
  // A aba Financeiro mostra a competência ATUAL (mês do sistema). Os
  // lançamentos de salário-base, porém, ficam presos no mês em que a última
  // sync rodou (external_id='salario-base' é único por colab → 1 linha só).
  // Quando o mês vira — ou quando a folha do mês ainda não foi aberta — a
  // competência atual fica sem salário, e o cadastro aparece zerado mesmo
  // com o colaborador tendo salário (current_salary preenchido).
  //
  // Aqui sintetizamos salário-base + encargos a partir de current_salary
  // quando NÃO existe salario_base real pra competência. É só pra exibição
  // (id 'synthetic-*', flag _synthetic) — nada é gravado no banco. Some
  // automaticamente assim que a folha do mês gerar os lançamentos reais.
  const displayEntries = useMemo(() => {
    if (isNew) return pendingEntries as any[];
    const real = (payrollEntries ?? []) as any[];

    // Salário + encargos: usa o que já foi lançado na folha do mês (real); se a
    // competência ainda não tem salário, sintetiza do current_salary (só
    // exibição). Lançamentos manuais NÃO vêm mais daqui — vêm da ficha fixa.
    const SALARY_TAX_TYPES = ["salario_base", "inss", "irpf", "fgts"];
    const realSalaryTax = real.filter((e) => SALARY_TAX_TYPES.includes(e.type));
    const hasRealSalary = realSalaryTax.some(
      (e) => e.type === "salario_base" && Number(e.value) > 0,
    );
    const baseSalary = Number((collaborator as any)?.current_salary ?? 0);

    let salaryPart = realSalaryTax;
    if (!hasRealSalary && baseSalary > 0) {
      const synthetic: any[] = [
        {
          id: "synthetic-salario-base",
          external_id: "salario-base",
          type: "salario_base",
          description: "Salário Base",
          value: baseSalary,
          is_fixed: true,
          _synthetic: true,
        },
      ];
      if (formData.regime === "clt") {
        const deps = formData.dependents_count ?? 0;
        const taxes = calcAllTaxes({ grossSalary: baseSalary, dependents: deps });
        if (taxes.inss > 0) {
          synthetic.push({
            id: "synthetic-inss", external_id: "inss-base", type: "inss",
            description: "INSS (tabela 2026)", value: taxes.inss,
            is_fixed: true, _synthetic: true,
          });
        }
        if (taxes.irpf > 0) {
          synthetic.push({
            id: "synthetic-irpf", external_id: "irpf-base", type: "irpf",
            description: deps > 0
              ? `IRPF (tabela 2026, ${deps} dep.)`
              : "IRPF (tabela 2026)",
            value: taxes.irpf, is_fixed: true, _synthetic: true,
          });
        }
        if (taxes.fgts > 0) {
          synthetic.push({
            id: "synthetic-fgts", external_id: "fgts-base", type: "fgts",
            description: "FGTS (8%)", value: taxes.fgts,
            is_fixed: true, _synthetic: true,
          });
        }
      }
      salaryPart = synthetic;
    }

    // Ficha fixa (Carro Agregado, descontos fixos, ...) — sempre visível,
    // independente de competência. Some só quando o RH exclui no cadastro.
    const fichaPart = (fixedEntries ?? []).map((f) => ({
      id: f.id,
      type: f.type,
      description: f.description,
      value: Number(f.value),
      is_fixed: true,
      _fixed: true,
    }));

    return [...salaryPart, ...fichaPart];
  }, [isNew, pendingEntries, payrollEntries, fixedEntries, collaborator, formData.regime, formData.dependents_count]);

  // Fetch benefit assignments for existing collaborator
  const { data: benefitAssignments = [], refetch: refetchAssignments } = useQuery({
    queryKey: ["benefit-assignments", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("benefits_assignments")
        .select(`*, benefit:benefits(*)`)
        .eq("collaborator_id", collaboratorId);
      if (error) throw error;
      return data;
    },
    enabled: !!collaboratorId && open,
  });

  // Fetch available benefits
  const { data: availableBenefits = [] } = useQuery({
    queryKey: ["benefits", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("benefits")
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentCompany?.id && open,
  });

  // Feriados da store do colaborador (pra cálculo de benefícios diários).
  // Cai pra contracted_store_id se não tem store_id.
  const benefitStoreId = formData.store_id || formData.contracted_store_id || null;
  const { holidayDates } = useStoreHolidays(
    open ? benefitStoreId : null,
    currentYear,
  );

  // Fetch vacation periods for existing collaborator
  const { data: vacationPeriods = [] } = useQuery({
    queryKey: ["vacation-periods-collaborator", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("vacation_periods")
        .select("*")
        .eq("collaborator_id", collaboratorId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!collaboratorId && open,
  });

  // Fetch vacation requests for existing collaborator
  const { data: vacationRequests = [] } = useQuery({
    queryKey: ["vacation-requests-collaborator", collaboratorId],
    queryFn: async () => {
      if (!collaboratorId) return [];
      const { data, error } = await supabase
        .from("vacation_requests")
        .select("*, vacation_period:vacation_periods(*)")
        .eq("collaborator_id", collaboratorId)
        .in("status", ["approved", "in_progress", "completed"])
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!collaboratorId && open,
  });

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      if (collaborator) {
        const c = collaborator as typeof collaborator & {
          rg?: string | null;
          birth_date?: string | null;
          regime?: "clt" | "pj" | "estagiario" | null;
          is_pcd?: boolean | null;
          is_apprentice?: boolean | null;
          address?: string | null;
          district?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          notes?: string | null;
          softcom_surname?: string | null;
          pix_key?: string | null;
        };
        const cExtra = c as typeof c & {
          recado_phone?: string | null;
          pis?: string | null;
          discord_username?: string | null;
          accounting_code?: string | null;
          internal_code?: string | null;
          photo_url?: string | null;
        };
        setFormData({
          name: c.name || "",
          softcom_surname: c.softcom_surname || "",
          cpf: c.cpf || "",
          rg: c.rg || "",
          email: c.email || "",
          phone: c.phone || "",
          recado_phone: cExtra.recado_phone || "",
          pis: cExtra.pis || "",
          discord_username: cExtra.discord_username || "",
          accounting_code: cExtra.accounting_code || "",
          internal_code: cExtra.internal_code || "",
          pix_key: c.pix_key || "",
          birth_date: c.birth_date || "",
          position_id: c.position_id || "",
          store_id: c.store_id || "",
          contracted_store_id: c.contracted_store_id || "",
          team_id: c.team_id || "",
          admission_date: c.admission_date || "",
          regime: (c.regime as "clt" | "pj" | "estagiario") || "clt",
          status: c.status || "ativo",
          is_temp: c.is_temp || false,
          is_pcd: c.is_pcd || false,
          is_apprentice: c.is_apprentice || false,
          dependents_count: (c as { dependents_count?: number }).dependents_count ?? 0,
          address: c.address || "",
          district: c.district || "",
          city: c.city || "",
          state: c.state || "",
          postal_code: c.postal_code ? formatCEPInput(c.postal_code) : "",
          notes: c.notes || "",
          photo_url: cExtra.photo_url || "",
          password: "",
        });
        setShowPasswordField(!c.user_id);
      } else {
        // Modal de "novo colaborador" — usa prefill se existir (vindo da
        // tela de admissão, p.ex.) pra deixar tudo preenchido.
        setFormData({
          name: prefill?.name ?? "",
          softcom_surname: prefill?.softcom_surname ?? "",
          cpf: prefill?.cpf ?? "",
          rg: prefill?.rg ?? "",
          email: prefill?.email ?? "",
          phone: prefill?.phone ?? "",
          recado_phone: "",
          pis: "",
          discord_username: "",
          accounting_code: "",
          internal_code: "",
          pix_key: prefill?.pix_key ?? "",
          birth_date: prefill?.birth_date ?? "",
          position_id: prefill?.position_id ?? "",
          store_id: "",
          contracted_store_id: "",
          team_id: "",
          admission_date: "",
          regime: prefill?.regime ?? "clt",
          status: "ativo",
          is_temp: false,
          is_pcd: false,
          is_apprentice: false,
          dependents_count: 0,
          address: prefill?.address ?? "",
          district: prefill?.district ?? "",
          city: prefill?.city ?? "",
          state: prefill?.state ?? "",
          postal_code: prefill?.postal_code
            ? formatCEPInput(prefill.postal_code)
            : "",
          notes: prefill?.notes ?? "",
          photo_url: "",
          password: "",
        });
        setShowPasswordField(false);
        setPendingEntries([]);
        setPendingBenefits([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collaborator]);

  // When position or dependents change, recalcula entries do salário/encargos.
  // INSS/IRPF/FGTS usam tabela 2026 oficial via calcAllTaxes.
  useEffect(() => {
    if (!open) return;

    const position = positions.find((p) => p.id === formData.position_id);

    if (isNew) {
      setPendingEntries((prev) => {
        const filtered = prev.filter((e) => e.source !== "position" && e.source !== "tax");

        if (position && position.salary > 0) {
          const taxes = calcAllTaxes({
            grossSalary: position.salary,
            dependents: formData.dependents_count,
          });

          const newEntries: PendingEntry[] = [
            {
              id: `position-${position.id}`,
              type: "salario_base" as const,
              description: `Salário Base - ${position.name}`,
              value: position.salary,
              is_fixed: true,
              source: "position" as const,
            },
          ];

          if (taxes.inss > 0) {
            newEntries.push({
              id: `tax-inss-${position.id}`,
              type: "inss" as const,
              description: "INSS (tabela 2026)",
              value: taxes.inss,
              is_fixed: true,
              source: "tax" as const,
            });
          }

          if (taxes.fgts > 0) {
            newEntries.push({
              id: `tax-fgts-${position.id}`,
              type: "fgts" as const,
              description: "FGTS (8%)",
              value: taxes.fgts,
              is_fixed: true,
              source: "tax" as const,
            });
          }

          if (taxes.irpf > 0) {
            newEntries.push({
              id: `tax-irpf-${position.id}`,
              type: "irpf" as const,
              description:
                formData.dependents_count > 0
                  ? `IRPF (tabela 2026, ${formData.dependents_count} dep.)`
                  : "IRPF (tabela 2026)",
              value: taxes.irpf,
              is_fixed: true,
              source: "tax" as const,
            });
          }

          return [...filtered, ...newEntries];
        }

        return filtered;
      });
    }
    // For existing collaborators, position changes are handled exclusively via PositionChangeDialog
  }, [formData.position_id, formData.dependents_count, positions.length, isNew, open, collaboratorId, currentCompany, currentMonth, currentYear, previousPositionId]);

  // Handle position change via dialog (existing collaborators only)
  const handlePositionChange = async (newPositionId: string, riskGroupChanged: boolean) => {
    if (!collaboratorId || !currentCompany) return;
    const newPosition = positions.find((p) => p.id === newPositionId);
    if (!newPosition) return;

    try {
      // 1. Update collaborator position
      await supabase
        .from("collaborators")
        .update({ position_id: newPositionId, position: newPosition.name })
        .eq("id", collaboratorId);

      // 2. Delete ONLY current month salary/tax entries (preserve history)
      await supabase
        .from("payroll_entries")
        .delete()
        .eq("collaborator_id", collaboratorId)
        .eq("month", currentMonth)
        .eq("year", currentYear)
        .in("type", ["salario_base", "inss", "fgts", "irpf"]);

      // 3. Create new entries with new position values + impostos via tabela 2026
      if (newPosition.salary > 0) {
        const taxes = calcAllTaxes({
          grossSalary: newPosition.salary,
          dependents: formData.dependents_count,
        });

        const entriesToCreate: any[] = [
          {
            collaborator_id: collaboratorId,
            company_id: currentCompany.id,
            type: "salario_base",
            description: `Salário Base - ${newPosition.name}`,
            value: newPosition.salary,
            month: currentMonth,
            year: currentYear,
            is_fixed: true,
          },
        ];

        if (taxes.inss > 0) {
          entriesToCreate.push({
            collaborator_id: collaboratorId,
            company_id: currentCompany.id,
            type: "inss",
            description: "INSS (tabela 2026)",
            value: taxes.inss,
            month: currentMonth,
            year: currentYear,
            is_fixed: true,
          });
        }

        if (taxes.fgts > 0) {
          entriesToCreate.push({
            collaborator_id: collaboratorId,
            company_id: currentCompany.id,
            type: "fgts",
            description: "FGTS (8%)",
            value: taxes.fgts,
            month: currentMonth,
            year: currentYear,
            is_fixed: true,
          });
        }

        if (taxes.irpf > 0) {
          entriesToCreate.push({
            collaborator_id: collaboratorId,
            company_id: currentCompany.id,
            type: "irpf",
            description:
              formData.dependents_count > 0
                ? `IRPF (tabela 2026, ${formData.dependents_count} dep.)`
                : "IRPF (tabela 2026)",
            value: taxes.irpf,
            month: currentMonth,
            year: currentYear,
            is_fixed: true,
          });
        }

        await supabase.from("payroll_entries").insert(entriesToCreate);
      }

      // 4. Always create mudanca_funcao exam on position change
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      const { error: examError } = await supabase.from("occupational_exams").insert({
        collaborator_id: collaboratorId,
        company_id: currentCompany.id,
        exam_type: "mudanca_funcao",
        status: "pendente",
        due_date: dueDate.toISOString().slice(0, 10),
        position_id: newPositionId,
        previous_position_id: collaborator?.position_id || null,
        risk_group_at_time: newPosition.risk_group || null,
        auto_generated: true,
        notes: riskGroupChanged
          ? "Gerado automaticamente por troca de função (grupo de risco alterado)"
          : "Gerado automaticamente por troca de função",
      });
      if (examError) {
        console.error("Erro ao criar exame de mudança de função:", examError);
        throw new Error("Falha ao criar exame de mudança de função: " + examError.message);
      }

      // Send WhatsApp notification for the new exam
      sendWhatsAppNotification(currentCompany.id, collaboratorId, "exam_created", {
        tipo_exame: "Mudança de Função",
        data_exame: dueDate.toISOString().slice(0, 10),
      });

      // Update local state
      setFormData((prev) => ({ ...prev, position_id: newPositionId }));
      setPreviousPositionId(newPositionId);
      setPositionChangeOpen(false);
      refetchEntries();
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      queryClient.invalidateQueries({ queryKey: ["collaborator", collaboratorId] });
      queryClient.invalidateQueries({ queryKey: ["occupational-exams"] });

      toast.success("Cargo atualizado! Valores de salário aplicados a partir deste mês. Um exame de Mudança de Função foi criado.");
    } catch (error: any) {
      toast.error("Erro ao trocar cargo: " + error.message);
    }
  };

  // Initialize previousPositionId when modal opens for existing collaborator
  useEffect(() => {
    if (open && collaborator && collaborator.position_id) {
      setPreviousPositionId(collaborator.position_id);
    } else if (!open) {
      setPreviousPositionId(null);
    }
  }, [open, collaborator]);

  // Handle CPF input with mask
  const handleCPFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCPFInput(e.target.value);
    setFormData((prev) => ({ ...prev, cpf: formatted }));
  };

  // Handle phone input with mask
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneInput(e.target.value);
    setFormData((prev) => ({ ...prev, phone: formatted }));
  };

  // Handle value input with currency mask
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCurrencyForInput(e.target.value);
    setEntryForm((prev) => ({ ...prev, value: formatted }));
  };

  // Create store mutation
  const createStoreMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("stores")
        .insert({ store_name: name, company_id: currentCompany!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      refetchStores();
      setFormData((prev) => ({ ...prev, store_id: data.id }));
      setCreateStoreOpen(false);
      setNewStoreName("");
      toast.success("Empresa criada!");
    },
    onError: () => {
      toast.error("Erro ao criar empresa");
    },
  });

  // Create team mutation
  const createTeamMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("teams")
        .insert({ name, company_id: currentCompany!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      refetchTeams();
      setFormData((prev) => ({ ...prev, team_id: data.id }));
      setCreateTeamOpen(false);
      setNewTeamName("");
      toast.success("Setor criado!");
    },
    onError: () => {
      toast.error("Erro ao criar setor");
    },
  });

  // Save collaborator
  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    const cleanedCPF = cleanCPF(formData.cpf);
    if (!validateCPF(cleanedCPF)) {
      toast.error("CPF inválido");
      return;
    }

    if (formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        toast.error("Email inválido. Por favor, insira um email válido.");
        return;
      }
    }

    if (formData.password && !isPasswordLongEnough(formData.password)) {
      toast.error(PASSWORD_TOO_SHORT);
      return;
    }

    setIsSaving(true);
    let savedCollabId: string | undefined;
    try {
      let userId: string | null = null;

      if (formData.email.trim() && formData.password) {
        setIsCreatingUser(true);
        const normalizedEmail = formData.email.trim().toLowerCase();
        
        const { data: createData, error: createError } = await supabase.functions.invoke(
          "create-collaborator-user",
          {
            body: {
              email: normalizedEmail,
              password: formData.password,
             full_name: formData.name,
             company_id: currentCompany!.id,
           },
          }
        );

        if (createError) {
          console.error("Edge function error:", createError);
          toast.error("Erro ao criar acesso: " + createError.message);
          setIsCreatingUser(false);
          return;
        }

        if (createData?.error) {
          toast.error(createData.error);
          setIsCreatingUser(false);
        } else if (createData?.user_id) {
          userId = createData.user_id;
        }
        
        setIsCreatingUser(false);
      }

      const baseData = {
        name: formData.name.trim(),
        softcom_surname: formData.softcom_surname.trim() || null,
        cpf: cleanedCPF,
        rg: formData.rg.trim() || null,
        email: formData.email.trim().toLowerCase() || null,
        phone: formData.phone.replace(/\D/g, "") || null,
        recado_phone: formData.recado_phone.replace(/\D/g, "") || null,
        pis: formData.pis.replace(/\D/g, "") || null,
        discord_username: formData.discord_username.trim() || null,
        accounting_code: formData.accounting_code.trim() || null,
        internal_code: formData.internal_code.trim() || null,
        photo_url: formData.photo_url || null,
        pix_key: formData.pix_key.trim() || null,
        birth_date: formData.birth_date || null,
        position_id: formData.position_id || null,
        store_id: formData.store_id || null,
        contracted_store_id: formData.contracted_store_id || null,
        team_id: formData.team_id || null,
        admission_date: formData.admission_date || null,
        regime: formData.regime,
        is_temp: formData.is_temp,
        is_pcd: formData.is_pcd,
        is_apprentice: formData.is_apprentice,
        dependents_count: formData.dependents_count,
        address: formData.address.trim() || null,
        district: formData.district.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state || null,
        postal_code: cleanCEP(formData.postal_code) || null,
        notes: formData.notes.trim() || null,
        company_id: currentCompany!.id,
        position: positions.find((p) => p.id === formData.position_id)?.name || null,
        ...(userId && { user_id: userId }),
      };

      // Cadastro avulso pelo admin: já entra "ativo". Quem precisa do fluxo
      // de admissão (aguardando_documentacao) é admission-public-submit.
      const saveData = isNew
        ? { ...baseData, status: "ativo" as const }
        : baseData;

      if (isNew) {
        // Via edge function collaborator-create → POST na agenda + INSERT local.
        // Se a agenda recusar (ex: CPF duplicado lá), local NÃO é gravado.
        const createResult = await createCollaborator.mutateAsync({
          companyId: currentCompany!.id,
          data: saveData,
        });
        const newCollabId = createResult.localId;
        if (!newCollabId) {
          throw new Error("Edge function não retornou localId");
        }
        savedCollabId = newCollabId;

        if (pendingEntries.length > 0) {
          // Itens fixos manuais (Carro Agregado, etc.) vão pra ficha fixa
          // (permanente). O resto (salário auto, avulsos) entra na folha do mês.
          const fichaPending = pendingEntries.filter(
            (e) => e.is_fixed && FIXED_MANUAL_TYPES.includes(e.type as string),
          );
          const payrollPending = pendingEntries.filter(
            (e) => !(e.is_fixed && FIXED_MANUAL_TYPES.includes(e.type as string)),
          );
          if (payrollPending.length > 0) {
            await supabase.from("payroll_entries").insert(
              payrollPending.map((e) => ({
                collaborator_id: newCollabId,
                company_id: currentCompany!.id,
                type: e.type,
                value: e.value,
                description: e.description,
                month: currentMonth,
                year: currentYear,
                is_fixed: e.is_fixed,
              })),
            );
          }
          if (fichaPending.length > 0) {
            const { data: userData } = await supabase.auth.getUser();
            await supabase.from("collaborator_fixed_entries").insert(
              fichaPending.map((e) => ({
                company_id: currentCompany!.id,
                collaborator_id: newCollabId,
                type: e.type,
                description: e.description || null,
                value: e.value,
                is_active: true,
                created_by: userData?.user?.id ?? null,
              })),
            );
          }
        }

        if (pendingBenefits.length > 0) {
          const assignmentsToCreate = pendingBenefits.map((b) => ({
            benefit_id: b.benefit_id,
            collaborator_id: newCollabId,
          }));
          await supabase.from("benefits_assignments").insert(assignmentsToCreate);
        }

        const message = userId
          ? `${formData.name} cadastrado ✓ ${AGENDA_SYNC_DISABLED ? "(acesso ao Portal)" : "(sincronizado com a agenda + acesso ao Portal)"}`
          : `${formData.name} cadastrado ✓${AGENDA_SYNC_DISABLED ? "" : " (sincronizado com a agenda)"}`;
        toast.success(message);

        sendWhatsAppNotification(currentCompany!.id, newCollabId, "collaborator_registered");
      } else {
        // Edição: chama collaborator-update por SEÇÃO. A edge function filtra
        // os campos relevantes de cada seção (mapLocalForSection) e grava no
        // banco local.
        //
        // syncToRemote:false — NÃO empurra pra agenda (api.softcom.cloud
        // responde 404 em escrita de colaborador, igual aconteceu com cargo —
        // ver fix e3b7402). Sem isso, qualquer save (mesmo sem mudança)
        // quebrava com 404. Reativar quando a escrita na agenda voltar.
        // Sequencial pra capturar erros por seção. Status é updated separado
        // via handleDeactivate/Reactivate, então não enviamos aqui.
        const payload: Record<string, unknown> = { ...saveData };
        if (userId) payload.user_id = userId;

        // Identificação (nome, CPF, endereço, contatos, lookups de setor/empresa)
        await updateCollaborator.mutateAsync({
          collaboratorId: collaboratorId!,
          section: "identificacao",
          data: payload,
          syncToRemote: false,
        });
        // Funcionais (regime, salário, cargo, datas, dados de CTPS/banco)
        await updateCollaborator.mutateAsync({
          collaboratorId: collaboratorId!,
          section: "funcionais",
          data: payload,
          syncToRemote: false,
        });
        // Comissões (se houver algum campo de comissão preenchido)
        if (
          payload.commission_monthly !== undefined ||
          payload.commission_license !== undefined ||
          payload.commission_upgrade !== undefined ||
          payload.commission_tef_install !== undefined ||
          payload.commission_tef_monthly !== undefined
        ) {
          await updateCollaborator.mutateAsync({
            collaboratorId: collaboratorId!,
            section: "comissoes",
            data: payload,
            syncToRemote: false,
          });
        }
        // Flags (is_temp, is_manager_*, is_godfather)
        await updateCollaborator.mutateAsync({
          collaboratorId: collaboratorId!,
          section: "flags",
          data: payload,
          syncToRemote: false,
        });

        // user_id é local-only (sem write-back) — patch direto se mudou
        if (userId) {
          await supabase
            .from("collaborators")
            .update({ user_id: userId })
            .eq("id", collaboratorId!);
        }

        const message = userId
          ? "Colaborador atualizado ✓ (acesso ao portal criado)"
          : "Colaborador atualizado ✓";
        toast.success(message);
      }

      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      onSuccess?.(savedCollabId ?? collaboratorId ?? undefined);
      onOpenChange(false);
    } catch (error: any) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setIsSaving(false);
      setIsCreatingUser(false);
    }
  };

  // Desativar colaborador (status=inativo + termination_date).
  // Passa pela edge function collaborator-update sec='status' pra PUSH na agenda.
  const handleDeactivate = async () => {
    if (!collaboratorId) return;
    setIsDeactivating(true);
    try {
      await updateCollaborator.mutateAsync({
        collaboratorId,
        section: "status",
        data: {
          status: "inativo",
          termination_date: new Date().toISOString().slice(0, 10),
        },
      });
      toast.success(
        AGENDA_SYNC_DISABLED
          ? "Colaborador desativado ✓"
          : "Colaborador desativado ✓ (sincronizado com a agenda)",
      );
      queryClient.invalidateQueries({ queryKey: ["collaborator-timeline", collaboratorId] });
      onSuccess?.();
      setConfirmDeactivate(false);
      onOpenChange(false);
    } catch (error) {
      // toast já é emitido pelo hook em onError
      console.error("Desativar falhou:", error);
    } finally {
      setIsDeactivating(false);
    }
  };

  // Reativar colaborador (volta status pra ativo, limpa termination_date)
  const handleReactivate = async () => {
    if (!collaboratorId) return;
    setIsDeactivating(true);
    try {
      await updateCollaborator.mutateAsync({
        collaboratorId,
        section: "status",
        data: { status: "ativo", termination_date: null },
      });
      toast.success(
        AGENDA_SYNC_DISABLED
          ? "Colaborador reativado ✓"
          : "Colaborador reativado ✓ (sincronizado com a agenda)",
      );
      queryClient.invalidateQueries({ queryKey: ["collaborator-timeline", collaboratorId] });
      setFormData((prev) => ({ ...prev, status: "ativo" }));
      onSuccess?.();
    } catch (error) {
      console.error("Reativar falhou:", error);
    } finally {
      setIsDeactivating(false);
    }
  };

  // Excluir colaborador (chama Edge Function que apaga auth user + dados)
  const handleDelete = async () => {
    if (!collaboratorId) return;
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-collaborator", {
        body: { collaboratorId },
      });
      if (error) throw error;
      if ((data as { error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error);
      }
      toast.success("Colaborador excluído.");
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      onSuccess?.();
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (error: any) {
      toast.error("Erro ao excluir: " + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Add pending entry (for new collaborators)
  const handleAddPendingEntry = () => {
    if (!entryForm.value) {
      toast.error("Valor é obrigatório");
      return;
    }

    const numericValue = parseCurrencyInput(entryForm.value);

    if (entryForm.is_installment && entryForm.installment_count > 1) {
      const valuePerInstallment = numericValue / entryForm.installment_count;
      for (let i = 0; i < entryForm.installment_count; i++) {
        const entryMonth = ((entryForm.month + i - 1) % 12) + 1;
        const entryYear = entryForm.year + Math.floor((entryForm.month + i - 1) / 12);
        const desc = `${entryForm.description || getEntryTypeLabel(entryForm.type)} (${i + 1}/${entryForm.installment_count})`;
        setPendingEntries((prev) => [
          ...prev,
          {
            id: `manual-${Date.now()}-${i}`,
            type: entryForm.type,
            description: desc,
            value: valuePerInstallment,
            is_fixed: false,
            source: "manual",
          },
        ]);
      }
    } else {
      setPendingEntries((prev) => [
        ...prev,
        {
          id: `manual-${Date.now()}`,
          type: entryForm.type,
          description: entryForm.description || getEntryTypeLabel(entryForm.type),
          value: numericValue,
          is_fixed: entryForm.is_fixed,
          source: "manual",
        },
      ]);
    }

    setAddEntryOpen(false);
    setEntryForm({ type: "hora_extra", description: "", value: "", is_fixed: false, month: currentMonth, year: currentYear, is_installment: false, installment_count: 2 });
    toast.success("Lançamento adicionado!");
  };

  // Add fixed entry to the ficha (for existing collaborators).
  // Lançamento no cadastro = PERMANENTE: grava em collaborator_fixed_entries,
  // não na folha do mês. Reflete na folha aberta/futura ao Repopular.
  const handleAddEntry = async () => {
    if (!entryForm.value) {
      toast.error("Valor é obrigatório");
      return;
    }
    const numericValue = parseCurrencyInput(entryForm.value);
    if (!(numericValue > 0)) {
      toast.error("Valor precisa ser maior que zero.");
      return;
    }
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("collaborator_fixed_entries")
        .insert({
          company_id: currentCompany!.id,
          collaborator_id: collaboratorId,
          type: entryForm.type,
          description: entryForm.description || null,
          value: numericValue,
          is_active: true,
          created_by: userData?.user?.id ?? null,
        });
      if (error) {
        if (error.code === "23505") {
          toast.error("Já existe um lançamento fixo desse tipo e descrição.");
          return;
        }
        throw error;
      }

      await refetchFixedEntries();
      setAddEntryOpen(false);
      setEntryForm({ type: "hora_extra", description: "", value: "", is_fixed: false, month: currentMonth, year: currentYear, is_installment: false, installment_count: 2 });
      toast.success("Lançamento fixo adicionado ✓ — aparece na folha ao Repopular.");
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Erro ao adicionar lançamento";
      toast.error(msg);
    }
  };

  // external_ids das materializações de um item da ficha nos períodos EDITÁVEIS
  // da empresa (formato fixedEntryExternalId do use-payroll: 'fixed-<id>-<YYYY-MM>').
  // Editável = rascunho ou aprovado pelo RH; folha aprovada pela diretoria é
  // imutável e fica de fora de propósito.
  const fixedEntryOpenExternalIds = async (fixedId: string): Promise<string[]> => {
    const { data, error } = await supabase
      .from("payroll_periods")
      .select("reference_month")
      .eq("company_id", currentCompany!.id)
      .in("status", [...PERIOD_EDITABLE_STATUSES]);
    if (error) throw error;
    return (data ?? []).map((p) => {
      const [y, m] = String(p.reference_month).split("-");
      return `fixed-${fixedId}-${y}-${m}`;
    });
  };

  // Delete payroll entry
  const handleDeleteEntry = async () => {
    if (!deletingEntry) return;

    if (isNew) {
      setPendingEntries((prev) => prev.filter((e) => e.id !== deletingEntry.id));
      setDeletingEntry(null);
      toast.success("Lançamento removido!");
      return;
    }

    // Só itens da ficha fixa são excluíveis daqui. Salário/encargo derivam do
    // cadastro e linhas sincronizadas (plano de saúde, VT) pertencem aos seus
    // módulos — o botão nem aparece; guarda defensiva se chegar por outro caminho.
    if (!deletingEntry._fixed) {
      toast.error("Esse lançamento é gerenciado pela folha ou pelo módulo de origem.");
      setDeletingEntry(null);
      return;
    }

    try {
      // Remove também a materialização nos períodos abertos: o Repopular NÃO
      // limpa órfãos de ficha excluída (só consolida legado sem external_id).
      const extIds = await fixedEntryOpenExternalIds(deletingEntry.id);
      if (extIds.length > 0) {
        const { error: peErr } = await supabase
          .from("payroll_entries")
          .delete()
          .eq("collaborator_id", collaboratorId!)
          .in("external_id", extIds);
        if (peErr) throw peErr;
      }
      const { error } = await supabase
        .from("collaborator_fixed_entries")
        .delete()
        .eq("id", deletingEntry.id);
      if (error) throw error;
      await refetchFixedEntries();
      refetchEntries();
      setDeletingEntry(null);
      toast.success("Lançamento removido do cadastro e da folha aberta.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao remover lançamento",
      );
    }
  };

  // Edita valor/descrição de um item da ficha fixa e reflete na hora nos
  // períodos abertos (mesma linha que o Repopular materializa via upsert).
  const handleSaveFixedEntryEdit = async () => {
    if (!editingFixedEntry) return;
    const numericValue = parseCurrencyInput(editEntryValue);
    if (!(numericValue > 0)) {
      toast.error("Valor precisa ser maior que zero.");
      return;
    }
    setSavingFixedEdit(true);
    try {
      const { error } = await supabase
        .from("collaborator_fixed_entries")
        .update({
          value: numericValue,
          description: editEntryDescription || null,
        })
        .eq("id", editingFixedEntry.id);
      if (error) {
        if (error.code === "23505") {
          toast.error("Já existe um lançamento fixo desse tipo e descrição.");
          return;
        }
        throw error;
      }

      const extIds = await fixedEntryOpenExternalIds(editingFixedEntry.id);
      if (extIds.length > 0) {
        const { error: peErr } = await supabase
          .from("payroll_entries")
          .update({
            value: numericValue,
            description: editEntryDescription || null,
          })
          .eq("collaborator_id", collaboratorId!)
          .in("external_id", extIds);
        if (peErr) throw peErr;
      }

      await refetchFixedEntries();
      refetchEntries();
      setEditingFixedEntry(null);
      toast.success("Lançamento atualizado ✓ — folha aberta já reflete o novo valor.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao atualizar lançamento",
      );
    } finally {
      setSavingFixedEdit(false);
    }
  };

  // Edita o salário do colaborador (current_salary) e reflete no mês corrente
  // da folha: atualiza a linha salario_base do período aberto mais recente e
  // recalcula INSS/IRPF/FGTS + VT via recalcCollaboratorTaxes (motor da folha).
  // Meses anteriores não mudam — diferença retroativa é lançamento avulso
  // "Salário Retroativo" na folha. Salário-família não recalcula aqui (raro;
  // o Repopular do período cobre).
  const handleSaveSalaryEdit = async () => {
    const numericValue = parseCurrencyInput(editSalaryValue);
    if (!(numericValue > 0)) {
      toast.error("Valor precisa ser maior que zero.");
      return;
    }
    setSavingSalary(true);
    try {
      const { error } = await supabase
        .from("collaborators")
        .update({ current_salary: numericValue })
        .eq("id", collaboratorId!);
      if (error) throw error;

      const { data: periods, error: perErr } = await supabase
        .from("payroll_periods")
        .select("reference_month")
        .eq("company_id", currentCompany!.id)
        .in("status", [...PERIOD_EDITABLE_STATUSES])
        .order("reference_month", { ascending: false })
        .limit(1);
      if (perErr) throw perErr;

      if (periods && periods.length > 0) {
        const [y, m] = String(periods[0].reference_month).split("-").map(Number);
        const { error: upErr } = await supabase
          .from("payroll_entries")
          .update({ value: numericValue })
          .eq("collaborator_id", collaboratorId!)
          .eq("type", "salario_base")
          .eq("month", m)
          .eq("year", y);
        if (upErr) throw upErr;
        await recalcCollaboratorTaxes({
          companyId: currentCompany!.id,
          collaboratorId: collaboratorId!,
          month: m,
          year: y,
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["collaborator", collaboratorId] });
      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      refetchEntries();
      setEditingSalary(false);
      toast.success("Salário atualizado ✓ — folha do mês aberto recalculada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao atualizar salário",
      );
    } finally {
      setSavingSalary(false);
    }
  };

  // Add pending benefit (for new collaborators)
  const handleAddPendingBenefit = () => {
    if (!selectedBenefitId) {
      toast.error("Selecione um benefício");
      return;
    }

    const benefit = availableBenefits.find((b) => b.id === selectedBenefitId);
    if (!benefit) return;

    const valueType = (benefit.value_type || "monthly") as "monthly" | "daily";
    const applicableDays = benefit.applicable_days || ["mon", "tue", "wed", "thu", "fri"];

    const monthlyValue = calculateMonthlyBenefitValue(
      benefit.value || 0,
      valueType,
      applicableDays as DayAbbrev[],
      currentMonth,
      currentYear,
      holidayDates,
    );

    setPendingBenefits((prev) => [
      ...prev,
      {
        id: `benefit-${benefit.id}`,
        benefit_id: benefit.id,
        benefit_name: benefit.name,
        value: benefit.value || 0,
        value_type: valueType,
        applicable_days: applicableDays,
        monthly_value: monthlyValue,
      },
    ]);

    setAddBenefitOpen(false);
    setSelectedBenefitId("");
    toast.success("Benefício adicionado!");
  };

  // Add benefit assignment (for existing collaborators)
  const handleAddBenefit = async () => {
    if (!selectedBenefitId) {
      toast.error("Selecione um benefício");
      return;
    }

    try {
      const { error } = await supabase.from("benefits_assignments").insert({
        benefit_id: selectedBenefitId,
        collaborator_id: collaboratorId,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("Este benefício já está atribuído");
          return;
        }
        throw error;
      }

      refetchAssignments();
      setAddBenefitOpen(false);
      setSelectedBenefitId("");
      toast.success("Benefício atribuído!");
    } catch (error) {
      toast.error("Erro ao atribuir benefício");
    }
  };

  // Delete benefit assignment
  const handleDeleteAssignment = async () => {
    if (!deletingAssignment) return;

    if (isNew) {
      setPendingBenefits((prev) => prev.filter((b) => b.id !== deletingAssignment.id));
      setDeletingAssignment(null);
      toast.success("Benefício removido!");
    } else {
      try {
        await supabase.from("benefits_assignments").delete().eq("id", deletingAssignment.id);
        refetchAssignments();
        setDeletingAssignment(null);
        toast.success("Benefício removido!");
      } catch (error) {
        toast.error("Erro ao remover benefício");
      }
    }
  };

  // Save custom monthly value override for an assignment
  const handleSaveCustomValue = async () => {
    if (!editingAssignmentValue) return;
    const parsed = parseCurrencyInput(editingAssignmentValue.inputValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Valor inválido.");
      return;
    }
    setSavingCustomValue(true);
    try {
      const defaultValue =
        Number(editingAssignmentValue.assignment.benefit?.value ?? 0);
      // Se o valor digitado for o mesmo do default, limpa custom_value
      // pra deixar a vinculação reagir a futuras mudanças do benefício.
      const newCustom = parsed === defaultValue ? null : parsed;
      const { error } = await supabase
        .from("benefits_assignments")
        .update({ custom_value: newCustom })
        .eq("id", editingAssignmentValue.assignment.id);
      if (error) throw error;
      await refetchAssignments();
      setEditingAssignmentValue(null);
      toast.success("Valor atualizado ✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar valor";
      toast.error(msg);
    } finally {
      setSavingCustomValue(false);
    }
  };

  // Calculate totals
  const calculateTotalCost = () => {
    let entriesTotal = 0;
    let benefitsTotal = 0;
    let taxTotal = 0;

    // Mesma regra de visibilidade do bloco Lançamentos — totais batem com o
    // que o user vê. Vacation/ferias entries são avulsas, não compõem o
    // "custo recorrente" do colab.
    const isRecurringMonthly = (e: { type: string; value: number; external_id?: string | null }) => {
      if (!(Number(e.value) > 0)) return false;
      if (e.type === "ferias") return false;
      if (typeof e.external_id === "string" && e.external_id.startsWith("ferias-")) return false;
      return true;
    };

    // Helper compartilhado: classifica sinal da entry (proventos vs deduções)
    const signedEntryValue = (e: { type: string; value: number }) => {
      if (e.type === "fgts") return 0; // FGTS vai pra taxTotal, não pro entriesTotal
      if (e.type === "inss" || e.type === "irpf") return -e.value;
      if (e.type === "custo" || e.type === "despesa") return -e.value;
      if (
        e.type === "desconto" ||
        e.type === "falta" ||
        e.type === "adiantamento" ||
        e.type === "emprestimo"
      )
        return -e.value;
      return e.value; // proventos
    };

    if (isNew) {
      entriesTotal = pendingEntries
        .filter(isRecurringMonthly)
        .reduce((sum, e) => sum + signedEntryValue(e), 0);
      taxTotal = pendingEntries
        .filter(isRecurringMonthly)
        .reduce((sum, e) => (e.type === "fgts" ? sum + e.value : sum), 0);
      benefitsTotal = pendingBenefits.reduce((sum, b) => sum + b.monthly_value, 0);
    } else {
      // displayEntries inclui o salário sintético do cadastro quando a
      // competência atual não tem salario_base real (ver useMemo acima).
      entriesTotal = displayEntries
        .filter(isRecurringMonthly)
        .reduce((sum, e) => sum + signedEntryValue(e), 0);
      taxTotal = displayEntries
        .filter(isRecurringMonthly)
        .reduce((sum, e) => (e.type === "fgts" ? sum + e.value : sum), 0);
      benefitsTotal = benefitAssignments.reduce((sum, a: any) => {
        if (!a.benefit) return sum;
        const valueType = a.benefit.value_type || "monthly";
        const baseValue =
          valueType === "monthly" && a.custom_value != null
            ? Number(a.custom_value)
            : a.benefit.value || 0;
        const value = calculateMonthlyBenefitValue(
          baseValue,
          valueType,
          (a.benefit.applicable_days || ["mon", "tue", "wed", "thu", "fri"]) as DayAbbrev[],
          currentMonth,
          currentYear,
          holidayDates,
        );
        return sum + value;
      }, 0);
    }

    return { entriesTotal, benefitsTotal, taxTotal, total: entriesTotal + benefitsTotal, companyCost: entriesTotal + benefitsTotal + taxTotal };
  };

  const totals = calculateTotalCost();

  // Get entry type label
  const getEntryTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      salario_base: "Salário base",
      hora_extra: "Hora extra",
      falta: "Falta",
      atestado: "Atestado",
      beneficio: "Benefício",
      adiantamento: "Adiantamento",
      bonificacao: "Bonificação",
      gratificacao: "Gratificação",
      carro_agregado: "Carro Agregado",
      auxilio_vale_transporte: "Auxílio Vale Transporte",
      desconto: "Desconto",
      // Legacy
      salario: "Salário",
      adicional: "Adicional",
      custo: "Custo",
      despesa: "Despesa",
      vale: "Vale",
      inss: "INSS",
      fgts: "FGTS",
      irpf: "IRPF",
    };
    return labels[type] || type;
  };

  // Get entry type color
  const getEntryTypeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    if (type === "custo" || type === "despesa" || type === "inss" || type === "irpf") return "destructive";
    if (type === "salario_base") return "default";
    if (type === "fgts" || type === "beneficio") return "outline";
    return "secondary";
  };

  // Get available benefits (not already assigned)
  const assignedBenefitIds = isNew
    ? pendingBenefits.map((b) => b.benefit_id)
    : benefitAssignments.map((a: any) => a.benefit_id);
  const unassignedBenefits = availableBenefits.filter(
    (b) => !assignedBenefitIds.includes(b.id)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl h-[85vh] p-0 flex flex-col overflow-hidden gap-0">
          {/* a11y: título escondido mas presente no DOM */}
          <DialogHeader className="sr-only">
            <DialogTitle>
              {isNew ? "Novo Colaborador" : `Editar: ${formData.name || "Colaborador"}`}
            </DialogTitle>
          </DialogHeader>

          {loadingCollaborator && !isNew ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            /* Content with Tabs */
            <Tabs defaultValue="geral" className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Header compacto + Tabs */}
              <div className="shrink-0 border-b">
                <div className="flex items-center gap-3 px-6 pt-5 pb-3 pr-12">
                  <h2 className="text-base font-semibold text-foreground truncate capitalize">
                    {isNew ? "Novo Colaborador" : (formData.name || "Colaborador").toLowerCase()}
                  </h2>
                  {!isNew && formData.status && (
                    <Badge
                      variant="outline"
                      className={
                        formData.status === "ativo"
                          ? "bg-success/10 text-success dark:bg-success/15 dark:text-success border-0 text-xs font-normal h-5 px-2"
                          : formData.status === "inativo"
                            ? "bg-muted text-muted-foreground border-0 text-xs font-normal h-5 px-2"
                            : formData.status === "aguardando_documentacao"
                              ? "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning border-0 text-xs font-normal h-5 px-2"
                              : formData.status === "validacao_pendente"
                                ? "bg-info/10 text-info dark:bg-info/15 dark:text-info border-0 text-xs font-normal h-5 px-2"
                                : "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive border-0 text-xs font-normal h-5 px-2"
                      }
                    >
                      {formData.status === "ativo"
                        ? "Ativo"
                        : formData.status === "inativo"
                          ? "Inativo"
                          : formData.status === "aguardando_documentacao"
                            ? "Aguardando docs"
                            : formData.status === "validacao_pendente"
                              ? "Validação pendente"
                              : "Reprovado"}
                    </Badge>
                  )}
                </div>
                {collaboratorId && (
                  <div className="px-6 pb-3">
                    <TabsList className="flex-wrap h-auto bg-transparent p-0 gap-1 justify-start">
                    <TabsTrigger
                      value="geral"
                      className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-md gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <IdentificationCard className="w-4 h-4" />
                      Geral
                    </TabsTrigger>
                    <TabsTrigger
                      value="financeiro"
                      className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-md gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <Wallet className="w-4 h-4" />
                      Financeiro
                    </TabsTrigger>
                    {["validacao_pendente", "reprovado"].includes(formData.status) && (
                      <TabsTrigger
                        value="validacao"
                        className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-md gap-1.5 px-3 py-1.5 text-sm"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Validação
                      </TabsTrigger>
                    )}
                    <TabsTrigger
                      value="saude"
                      className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-md gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <Stethoscope className="w-4 h-4" />
                      Saúde & Ausências
                    </TabsTrigger>
                    <TabsTrigger
                      value="ferias"
                      className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-md gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <Palmtree className="w-4 h-4" />
                      Férias
                    </TabsTrigger>
                    <TabsTrigger
                      value="lotacao"
                      className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-md gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <Storefront className="w-4 h-4" />
                      PDV
                    </TabsTrigger>
                  </TabsList>
                </div>
              )}
              </div>

              <TabsContent value="geral" className="flex-1 min-h-0 overflow-hidden m-0 data-[state=active]:flex flex-col data-[state=inactive]:hidden">
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2 mb-1">
                      <Users className="w-5 h-5 text-primary" />
                      Dados Cadastrais
                    </h3>
                    <p className="text-xs text-muted-foreground">Identidade, contato e documentos do colaborador.</p>
                  </div>

                  {/* Foto + Nome/Sobrenome lado a lado */}
                  <div className="flex items-start gap-6 pb-2">
                    <CollaboratorPhotoUploader
                      collaboratorId={collaboratorId ?? null}
                      companyId={currentCompany?.id ?? ""}
                      photoUrl={formData.photo_url || null}
                      name={formData.name}
                      onChange={(path) =>
                        setFormData((prev) => ({ ...prev, photo_url: path ?? "" }))
                      }
                      canEdit={canManage}
                    />
                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="name">Nome Completo *</Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Nome do colaborador"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="softcom_surname">Sobrenome Softcom</Label>
                        <Input
                          id="softcom_surname"
                          value={formData.softcom_surname}
                          onChange={(e) => setFormData((prev) => ({ ...prev, softcom_surname: e.target.value }))}
                          placeholder="Apelido interno (ex: Lucas P.)"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="internal_code">Código interno</Label>
                        <Input
                          id="internal_code"
                          value={formData.internal_code}
                          readOnly
                          disabled
                          placeholder="Preenchido automaticamente"
                          className="bg-muted cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Documentos: CPF + RG + Data Nasc + PIS */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF *</Label>
                      <Input
                        id="cpf"
                        value={formData.cpf}
                        onChange={handleCPFChange}
                        placeholder="000.000.000-00"
                        maxLength={14}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rg">RG</Label>
                      <Input
                        id="rg"
                        value={formData.rg}
                        onChange={(e) => setFormData((prev) => ({ ...prev, rg: e.target.value }))}
                        placeholder="00.000.000-0"
                        maxLength={20}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="birth_date">Data de Nascimento</Label>
                      <Input
                        id="birth_date"
                        type="date"
                        value={formData.birth_date}
                        onChange={(e) => setFormData((prev) => ({ ...prev, birth_date: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pis">PIS / NIS</Label>
                      <Input
                        id="pis"
                        value={formData.pis}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, pis: e.target.value }))
                        }
                        placeholder="000.00000.00-0"
                        maxLength={20}
                      />
                    </div>
                  </div>

                  {/* Contato: Email + Telefone + Telefone Recado + Discord */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => {
                          setFormData((prev) => ({ ...prev, email: e.target.value }));
                          if (e.target.value.trim() && (isNew || showPasswordField)) {
                            setShowPasswordField(true);
                          }
                        }}
                        placeholder="email@exemplo.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Telefone</Label>
                      <Input
                        id="phone"
                        value={formData.phone}
                        onChange={handlePhoneChange}
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="discord_username">Discord</Label>
                      <Input
                        id="discord_username"
                        value={formData.discord_username}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            discord_username: e.target.value,
                          }))
                        }
                        placeholder="usuario#1234 ou @usuario"
                      />
                    </div>
                  </div>

                  {/* Password Field */}
                  {formData.email.trim() && showPasswordField && (
                    <div className="space-y-2 p-4 bg-muted/50 rounded-lg border border-dashed">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="password" className="text-sm font-medium">
                          Senha de Acesso ao Portal
                        </Label>
                        <Badge variant="secondary" >
                          Opcional
                        </Badge>
                      </div>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                        placeholder={PASSWORD_HINT}
                        minLength={MIN_PASSWORD_LENGTH}
                      />
                      <p className="text-xs text-muted-foreground">
                        Se preenchida, o colaborador poderá acessar o Portal do Colaborador com este email e senha.
                      </p>
                    </div>
                  )}

                  {/* Pagamento: Chave PIX + Código contabilidade */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pix_key">Chave PIX</Label>
                      <Input
                        id="pix_key"
                        value={formData.pix_key}
                        onChange={(e) => setFormData((prev) => ({ ...prev, pix_key: e.target.value }))}
                        placeholder="CPF, e-mail, telefone ou chave aleatória"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accounting_code">Código contabilidade</Label>
                      <Input
                        id="accounting_code"
                        value={formData.accounting_code}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            accounting_code: e.target.value,
                          }))
                        }
                        placeholder="Identificador externo"
                      />
                    </div>
                  </div>

                  {/* Tipo de Contrato (regime) */}
                  <div className="space-y-2">
                    <Label>Tipo de Contrato</Label>
                    <Select
                      value={formData.regime}
                      onValueChange={(v) => setFormData((prev) => ({ ...prev, regime: v as typeof prev.regime }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clt">CLT</SelectItem>
                        <SelectItem value="pj">PJ</SelectItem>
                        <SelectItem value="estagiario">Estagiário</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Endereço */}
                  <div className="space-y-2">
                    <Label htmlFor="address">Endereço</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="Rua, número, complemento"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="district">Bairro</Label>
                      <Input
                        id="district"
                        value={formData.district}
                        onChange={(e) => setFormData((prev) => ({ ...prev, district: e.target.value }))}
                        placeholder="Bairro"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="postal_code">CEP</Label>
                      <Input
                        id="postal_code"
                        value={formData.postal_code}
                        onChange={(e) => setFormData((prev) => ({ ...prev, postal_code: formatCEPInput(e.target.value) }))}
                        placeholder="00000-000"
                        maxLength={9}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">Cidade</Label>
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                        placeholder="Cidade"
                      />
                    </div>
                    <div className="space-y-2 w-24">
                      <Label>UF</Label>
                      <Select
                        value={formData.state}
                        onValueChange={(v) => setFormData((prev) => ({ ...prev, state: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent>
                          {BRAZIL_STATES.map((uf) => (
                            <SelectItem key={uf} value={uf}>
                              {uf}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Separator />

                  {/* Empresa + Empresa Contratada (lado a lado) */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Empresa</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreateStoreOpen(true)}
                          className="h-6 text-xs"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Nova
                        </Button>
                      </div>
                      <Select
                        value={formData.store_id}
                        onValueChange={(v) => setFormData((prev) => ({ ...prev, store_id: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {stores.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.store_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Empresa Contratada</Label>
                      <Select
                        value={formData.contracted_store_id}
                        onValueChange={(v) =>
                          setFormData((prev) => ({ ...prev, contracted_store_id: v }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {stores.map((store) => (
                            <SelectItem key={store.id} value={store.id}>
                              {store.store_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Team with quick create */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Setor</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreateTeamOpen(true)}
                        className="h-6 text-xs"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Novo
                      </Button>
                    </div>
                    <Select
                      value={formData.team_id}
                      onValueChange={(v) => setFormData((prev) => ({ ...prev, team_id: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um setor" />
                      </SelectTrigger>
                      <SelectContent>
                        {teams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Position */}
                  <div className="space-y-2">
                    <Label>Cargo</Label>
                    {!isNew && formData.position_id ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50">
                          <span className="text-sm font-medium">
                            {positions.find((p) => p.id === formData.position_id)?.name || "—"}
                          </span>
                          {(() => {
                            const pos = positions.find((p) => p.id === formData.position_id);
                            return pos && pos.salary > 0 ? (
                              <Badge variant="secondary" >{formatCurrency(pos.salary)}</Badge>
                            ) : null;
                          })()}
                        </div>
                        {canManage && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPositionChangeOpen(true)}
                            className="shrink-0"
                          >
                            <ArrowRightLeft className="w-4 h-4 mr-1" />
                            Trocar Função
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Select
                        value={formData.position_id}
                        onValueChange={(v) => setFormData((prev) => ({ ...prev, position_id: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um cargo" />
                        </SelectTrigger>
                        <SelectContent>
                          {positions.map((pos) => (
                            <SelectItem key={pos.id} value={pos.id}>
                              {pos.name} {pos.salary > 0 && `(${formatCurrency(pos.salary)})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Admission Date */}
                  <div className="space-y-2">
                    <Label htmlFor="admission_date">Data de Admissão</Label>
                    <Input
                      id="admission_date"
                      type="date"
                      value={formData.admission_date}
                      onChange={(e) => setFormData((prev) => ({ ...prev, admission_date: e.target.value }))}
                    />
                  </div>

                  <Separator />

                  {/* Flags: Avulso / PCD / Aprendiz */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Avulso</Label>
                      <div className="flex items-center space-x-2 pt-2">
                        <Switch
                          checked={formData.is_temp}
                          onCheckedChange={(v) => setFormData((prev) => ({ ...prev, is_temp: v }))}
                        />
                        <span className="text-sm text-muted-foreground">
                          {formData.is_temp ? "Sim" : "Não"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>PCD</Label>
                      <div className="flex items-center space-x-2 pt-2">
                        <Switch
                          checked={formData.is_pcd}
                          onCheckedChange={(v) => setFormData((prev) => ({ ...prev, is_pcd: v }))}
                        />
                        <span className="text-sm text-muted-foreground">
                          {formData.is_pcd ? "Sim" : "Não"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Jovem Aprendiz</Label>
                      <div className="flex items-center space-x-2 pt-2">
                        <Switch
                          checked={formData.is_apprentice}
                          onCheckedChange={(v) => setFormData((prev) => ({ ...prev, is_apprentice: v }))}
                        />
                        <span className="text-sm text-muted-foreground">
                          {formData.is_apprentice ? "Sim" : "Não"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Dependentes pra cálculo de IRPF */}
                  <div className="space-y-2">
                    <Label htmlFor="dependents_count">Dependentes legais (IRPF)</Label>
                    <Input
                      id="dependents_count"
                      type="number"
                      min={0}
                      max={30}
                      step={1}
                      value={formData.dependents_count}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          dependents_count: Math.max(0, Math.min(30, parseInt(e.target.value || "0", 10))),
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Cada dependente reduz R$ 189,59 da base de cálculo do IRPF.
                    </p>
                  </div>

                  {/* Observações */}
                  <div className="space-y-2">
                    <Label htmlFor="notes">Observações</Label>
                    <textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="Notas internas sobre o colaborador..."
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Dependentes — colapsável na Geral. Alimenta `dependents_count` e impacta IRPF */}
                {collaboratorId && (
                  <div className="px-6 pb-6 pt-2">
                    <details className="rounded-lg border bg-card p-4">
                      <summary className="cursor-pointer select-none font-semibold text-foreground flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" />
                        Dependentes legais
                        <span className="text-xs text-muted-foreground font-normal ml-auto">clique pra abrir</span>
                      </summary>
                      <div className="mt-4">
                        <CollaboratorDependentsTab
                          collaboratorId={collaboratorId}
                          companyId={currentCompany?.id || ""}
                          canEdit={canManage}
                        />
                      </div>
                    </details>
                  </div>
                )}

                {/* Fardamento — seção colapsável (uso baixa frequência) */}
                {collaboratorId && (
                  <div className="px-6 pb-6">
                    <details className="rounded-lg border bg-card p-4">
                      <summary className="cursor-pointer select-none font-semibold text-foreground flex items-center gap-2">
                        <TShirt className="w-4 h-4 text-primary" />
                        Fardamento
                        <span className="text-xs text-muted-foreground font-normal ml-auto">clique pra abrir</span>
                      </summary>
                      <div className="mt-4">
                        <CollaboratorUniformTab
                          collaboratorId={collaboratorId}
                          companyId={currentCompany?.id || ""}
                          canEdit={canManage}
                        />
                      </div>
                    </details>
                  </div>
                )}
              </ScrollArea>
              </div>
              </TabsContent>

              <TabsContent value="financeiro" className="flex-1 min-h-0 overflow-hidden m-0 data-[state=active]:flex flex-col data-[state=inactive]:hidden">
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Financeiro Header com Resumo KPI */}
                <div className="shrink-0 px-6 py-4 border-b">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Wallet className="w-5 h-5 text-primary" />
                        Financeiro
                      </h3>
                    </div>
                    <div className="flex items-stretch gap-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Líquido</span>
                        <span className="font-mono text-sm font-semibold text-foreground">{formatCurrency(totals.total)}</span>
                      </div>
                      <div className="w-px bg-border" />
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">FGTS</span>
                        <span className="font-mono text-sm font-semibold text-foreground">{formatCurrency(totals.taxTotal)}</span>
                      </div>
                      <div className="w-px bg-border" />
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Benefícios</span>
                        <span className="font-mono text-sm font-semibold text-foreground">{formatCurrency(totals.benefitsTotal)}</span>
                      </div>
                      <div className="w-px bg-border" />
                      <div className="flex flex-col rounded-md bg-primary/10 px-3 py-1.5 -my-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-primary/80">Custo empresa</span>
                        <span className="font-mono text-base font-bold text-primary">{formatCurrency(totals.companyCost)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scrollable Content */}
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-6 space-y-6">
                    {/* Lançamentos + Benefícios em duas colunas */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Payroll Entries */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          Lançamentos
                        </h4>
                        {canManage && (
                          <Button size="sm" variant="outline" onClick={() => setAddEntryOpen(true)} className="h-7 text-xs">
                            <Plus className="w-3 h-3 mr-1" />
                            Novo
                          </Button>
                        )}
                      </div>
                      
                      {(() => {
                        const allEntries = isNew ? pendingEntries : displayEntries;
                        const visibleEntries = allEntries.filter((e: any) => {
                          if (e.type === "beneficio") return false;
                          // FGTS só pra CLT. PJ/estagiário não tem encargo de FGTS.
                          if (e.type === "fgts" && formData.regime !== "clt") return false;
                          // Linhas zeradas/negativas viram ruído — esconde.
                          if (!(Number(e.value) > 0)) return false;
                          // Lançamentos de férias são AVULSOS do mês de pagamento —
                          // só fazem sentido na folha, não na ficha do colab.
                          // Identifica via external_id 'ferias-*' (criado pelo
                          // postVacationToPayroll). type='ferias' como cinto-extra.
                          if (e.type === "ferias") return false;
                          if (typeof e.external_id === "string" && e.external_id.startsWith("ferias-")) return false;
                          // Lançamentos AVULSOS (NewEntryDialog: is_fixed=false +
                          // sem external_id) são pontuais ao mês — não fazem
                          // parte da ficha permanente do colab.
                          const hasExtId = typeof e.external_id === "string" && e.external_id.length > 0;
                          if (e.is_fixed === false && !hasExtId) return false;
                          return true;
                        });
                        if (visibleEntries.length === 0) {
                          return (
                            <div className="text-sm text-muted-foreground text-center py-6 bg-background rounded-lg border border-dashed">
                              {isNew ? "Selecione um cargo para adicionar o salário" : "Nenhum lançamento fixo cadastrado"}
                            </div>
                          );
                        }
                        return (
                          <div className="space-y-1.5">
                            {visibleEntries.map((entry: any) => (
                            <div
                              key={entry.id}
                              className="px-2.5 py-2 rounded-lg bg-background border hover:border-primary/30 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium truncate pr-2">
                                      {toTitleCase(entry.description) || getEntryTypeLabel(entry.type)}
                                    </span>
                                    <span className={`font-mono text-xs font-semibold shrink-0 ${
                                      ["inss", "irpf", "despesa", "custo", "fgts", "desconto"].includes(entry.type)
                                        ? "text-destructive"
                                        : "text-success"
                                    }`}>
                                      {["inss", "irpf", "despesa", "custo", "fgts", "desconto"].includes(entry.type) ? "- " : "+ "}
                                      {formatCurrency(entry.value)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Badge variant={getEntryTypeVariant(entry.type)} className="text-[10px] h-4 px-1.5">
                                      {getEntryTypeLabel(entry.type)}
                                    </Badge>
                                    {entry.is_fixed && (
                                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">Fixo</Badge>
                                    )}
                                    {entry._synthetic && (
                                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">do cadastro</Badge>
                                    )}
                                    {entry.installment_number && (
                                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                        {entry.installment_number}/{entry.installment_total}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                {canManage && (entry._fixed || entry.type === "salario_base" || isNew) && (
                                  <div className="flex shrink-0">
                                    {entry.type === "salario_base" && !isNew && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          setEditingSalary(true);
                                          setEditSalaryValue(formatNumberAsCurrency(Number(entry.value)));
                                        }}
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                    )}
                                    {entry._fixed && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          setEditingFixedEntry(entry);
                                          setEditEntryValue(formatNumberAsCurrency(Number(entry.value)));
                                          setEditEntryDescription(entry.description ?? "");
                                        }}
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                    )}
                                    {(entry._fixed || isNew) && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                        onClick={() => setDeletingEntry(entry)}
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Benefits */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                          <Gift className="w-4 h-4 text-muted-foreground" />
                          Benefícios
                        </h4>
                        {canManage && unassignedBenefits.length > 0 && (
                          <Button size="sm" variant="outline" onClick={() => setAddBenefitOpen(true)} className="h-7 text-xs">
                            <Plus className="w-3 h-3 mr-1" />
                            Adicionar
                          </Button>
                        )}
                      </div>
                      
                      {(isNew ? pendingBenefits : benefitAssignments).length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-6 bg-background rounded-lg border border-dashed">
                          Nenhum benefício atribuído
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {isNew
                            ? pendingBenefits.map((b) => {
                                const description = getBenefitCalculationDescription(
                                  b.value,
                                  b.value_type,
                                  b.applicable_days as DayAbbrev[],
                                  currentMonth,
                                  currentYear,
                                  holidayDates,
                                );
                                return (
                                  <div
                                    key={b.id}
                                    className="px-2.5 py-2 rounded-lg bg-background border hover:border-primary/30 transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-xs font-medium truncate pr-2">{toTitleCase(b.benefit_name)}</span>
                                          <span className="font-mono text-xs font-semibold shrink-0">
                                            {formatCurrency(b.monthly_value)}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">{description}</p>
                                      </div>
                                      {canManage && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                          onClick={() => setDeletingAssignment(b)}
                                        >
                                          <X className="w-3 h-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            : benefitAssignments.map((assignment: any) => {
                                const benefit = assignment.benefit;
                                if (!benefit) return null;

                                const valueType = benefit.value_type || "monthly";
                                const isMonthly = valueType === "monthly";
                                const hasCustom = isMonthly && assignment.custom_value != null;
                                const baseValue = hasCustom
                                  ? Number(assignment.custom_value)
                                  : benefit.value || 0;

                                const monthlyValue = calculateMonthlyBenefitValue(
                                  baseValue,
                                  valueType,
                                  (benefit.applicable_days || ["mon", "tue", "wed", "thu", "fri"]) as DayAbbrev[],
                                  currentMonth,
                                  currentYear,
                                  holidayDates,
                                );
                                const description = getBenefitCalculationDescription(
                                  baseValue,
                                  valueType,
                                  (benefit.applicable_days || ["mon", "tue", "wed", "thu", "fri"]) as DayAbbrev[],
                                  currentMonth,
                                  currentYear,
                                  holidayDates,
                                );

                                return (
                                  <div
                                    key={assignment.id}
                                    className="px-2.5 py-2 rounded-lg bg-background border hover:border-primary/30 transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-xs font-medium truncate pr-2">
                                            {toTitleCase(benefit.name)}
                                          </span>
                                          <span className="font-mono text-xs font-semibold shrink-0">
                                            {formatCurrency(monthlyValue)}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">{description}</p>
                                      </div>
                                      {canManage && (
                                        <div className="flex items-center gap-0.5 shrink-0">
                                          {isMonthly && (
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                                              title="Editar valor pra esse colaborador"
                                              onClick={() =>
                                                setEditingAssignmentValue({
                                                  assignment,
                                                  // baseValue pode ser número (custom_value) ou string
                                                  // (benefit.value do banco) — normaliza pra number.
                                                  inputValue: formatNumberAsCurrency(Number(baseValue)),
                                                })
                                              }
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </Button>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                            onClick={() => setDeletingAssignment(assignment)}
                                          >
                                            <X className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                        </div>
                      )}
                    </div>
                    </div>{/* fim grid 2-cols Lançamentos + Benefícios */}

                    {/* Vacation History - only for existing collaborators */}
                    {!isNew && (
                      <div className="rounded-lg border bg-card p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-medium text-sm flex items-center gap-2">
                            <Palmtree className="w-4 h-4 text-muted-foreground" />
                            Férias
                          </h4>
                        </div>

                        {/* Vacation Balance */}
                        {vacationPeriods.length > 0 && (
                          <div className="mb-3 p-3 rounded-lg bg-background border">
                            <p className="text-xs text-muted-foreground mb-2">Saldo de Períodos Aquisitivos</p>
                            <div className="space-y-1.5">
                              {vacationPeriods.slice(0, 3).map((period: any) => (
                                <div key={period.id} className="flex items-center justify-between text-sm gap-2">
                                  <span className="text-muted-foreground flex-1 min-w-0 truncate">
                                    {new Date(period.start_date).toLocaleDateString("pt-BR")} - {new Date(period.end_date).toLocaleDateString("pt-BR")}
                                    {period.manual_adjustment_at && (
                                      <span className="ml-1 text-[10px] uppercase tracking-wide text-warning">· ajuste manual</span>
                                    )}
                                  </span>
                                  <Badge variant={
                                    period.status === "available" ? "default" :
                                    period.status === "partially_used" ? "secondary" :
                                    period.status === "used" ? "outline" : "destructive"
                                  } className="h-5 px-1.5 shrink-0">
                                    {period.days_remaining}d restantes
                                  </Badge>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0"
                                    onClick={() => setAdjustingPeriod(period)}
                                    title="Ajustar saldo manualmente"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Vacation Requests History */}
                        {vacationRequests.length === 0 ? (
                          <div className="text-sm text-muted-foreground text-center py-6 bg-background rounded-lg border border-dashed">
                            Nenhum registro de férias
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {vacationRequests.map((request: any) => {
                              const statusLabels: Record<string, string> = {
                                approved: "Aprovada",
                                in_progress: "Em Gozo",
                                completed: "Concluída",
                              };
                              const statusColors: Record<string, "default" | "secondary" | "outline"> = {
                                approved: "default",
                                in_progress: "secondary",
                                completed: "outline",
                              };
                              return (
                                <div key={request.id} className="p-3 rounded-lg bg-background border hover:border-primary/30 transition-colors">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium">
                                      {new Date(request.start_date).toLocaleDateString("pt-BR")} - {new Date(request.end_date).toLocaleDateString("pt-BR")}
                                    </span>
                                    <Badge variant={statusColors[request.status] || "outline"} className="h-5 px-1.5">
                                      {statusLabels[request.status] || request.status}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{request.days_count} dias</span>
                                    {request.sell_days > 0 && (
                                      <span>• {request.sell_days} dias abono</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* 13º Salário + Pensão — agrupados no final da aba Financeiro */}
                {collaboratorId && (
                  <div className="px-6 pb-6 space-y-4 border-t pt-4">
                    <details className="rounded-lg border bg-card p-4">
                      <summary className="cursor-pointer select-none font-semibold text-foreground flex items-center gap-2">
                        <Gift className="w-4 h-4 text-primary" />
                        13º Salário
                        <span className="text-xs text-muted-foreground font-normal ml-auto">clique pra abrir</span>
                      </summary>
                      <div className="mt-4">
                        <SubResourceTab
                          kind="decimo-terceiro"
                          collaboratorId={collaboratorId}
                          table="bonus_entries"
                          orderBy={{ column: "created_at", ascending: false }}
                          titleSingular="13º"
                          icon={<Gift className="w-6 h-6 text-primary" />}
                          emptyTitle="Sem lançamentos de 13º"
                          emptyDescription="Nenhum lançamento de 13º registrado."
                          canManage={canManage}
                          fields={DECIMO_FIELDS}
                          renderRow={(row: any) => ({
                            title: `13º ${row.year ?? "—"}`,
                            meta: `${row.is_paid ? "Pago" : "Pendente"}${row.value_paid ? ` · ${formatCurrency(row.value_paid)}` : ""}${row.notes ? " · " + toTitleCase(row.notes) : ""}`,
                          })}
                        />
                      </div>
                    </details>

                    {canManage && (
                      <details className="rounded-lg border bg-card p-4">
                        <summary className="cursor-pointer select-none font-semibold text-foreground flex items-center gap-2">
                          <Scales className="w-4 h-4 text-primary" />
                          Pensão alimentícia
                          <span className="text-xs text-muted-foreground font-normal ml-auto">clique pra abrir</span>
                        </summary>
                        <div className="mt-4">
                          <CollaboratorAlimonyTab
                            collaboratorId={collaboratorId}
                            companyId={currentCompany?.id || ""}
                            canEdit={canManage}
                          />
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
              </TabsContent>

              {["validacao_pendente", "reprovado"].includes(formData.status) && collaboratorId && (
                <TabsContent value="validacao" className="flex-1 min-h-0 overflow-auto m-0 p-4">
                  <CollaboratorValidationTab
                    collaboratorId={collaboratorId}
                    companyId={currentCompany?.id || ""}
                    collaboratorStatus={formData.status}
                    onStatusChange={() => {
                      queryClient.invalidateQueries({ queryKey: ["collaborators"] });
                      onOpenChange(false);
                    }}
                  />
                </TabsContent>
              )}

              {collaboratorId && (
                <>
                  {/* Saúde & Ausências — 3 sub-tabs horizontais (Atestados removido, não existe na agenda) */}
                  <TabsContent value="saude" className="flex-1 min-h-0 overflow-auto m-0 p-4">
                    <Tabs defaultValue="afastamentos" className="w-full">
                      <TabsList className="grid grid-cols-3 w-full max-w-xl mb-4">
                        <TabsTrigger value="afastamentos">Afastamentos</TabsTrigger>
                        <TabsTrigger value="absenteismos">Absenteísmo</TabsTrigger>
                        <TabsTrigger value="planos">Planos</TabsTrigger>
                      </TabsList>

                      <TabsContent value="afastamentos" className="mt-0">
                        <SubResourceTab
                          kind="afastamentos"
                          collaboratorId={collaboratorId}
                          table="collaborator_leaves"
                          orderBy={{ column: "start_date", ascending: false }}
                          titleSingular="Afastamento"
                          icon={<Bandaids className="w-6 h-6 text-primary" />}
                          emptyTitle="Sem afastamentos"
                          emptyDescription="Nenhum afastamento registrado pra esse colaborador."
                          canManage={canManage}
                          fields={AFASTAMENTO_FIELDS}
                          renderRow={(row: any) => ({
                            title: toTitleCase(row.description) || `Motivo ${row.reason_code ?? "—"}`,
                            meta: `${formatDateBR(row.start_date)} → ${row.end_date ? formatDateBR(row.end_date) : "em aberto"}${row.has_certificate ? " · com atestado" : ""}`,
                          })}
                        />
                      </TabsContent>

                      <TabsContent value="absenteismos" className="mt-0">
                        <SubResourceTab
                          kind="absenteismos"
                          collaboratorId={collaboratorId}
                          table="collaborator_absences"
                          orderBy={{ column: "occurred_on", ascending: false }}
                          titleSingular="Absenteísmo"
                          icon={<CalendarX className="w-6 h-6 text-primary" />}
                          emptyTitle="Sem absenteísmos"
                          emptyDescription="Nenhuma ocorrência de absenteísmo registrada."
                          canManage={canManage}
                          fields={ABSENTEISMO_FIELDS}
                          renderRow={(row: any) => ({
                            title: toTitleCase(row.reason) || "Sem motivo registrado",
                            meta: `${formatDateBR(row.occurred_on)} · ${row.days ?? 0} dia(s)${row.has_certificate ? " · com atestado" : ""}`,
                          })}
                        />
                      </TabsContent>

                      <TabsContent value="planos" className="mt-0">
                        <SubResourceTab
                          kind="planos"
                          collaboratorId={collaboratorId}
                          table="collaborator_health_plans"
                          orderBy={{ column: "start_date", ascending: false }}
                          titleSingular="Plano"
                          icon={<Stethoscope className="w-6 h-6 text-primary" />}
                          emptyTitle="Sem planos"
                          emptyDescription="Nenhum plano de saúde ou odontológico registrado."
                          canManage={canManage}
                          fields={PLANO_FIELDS}
                          renderRow={(row: any) => ({
                            title: toTitleCase(row.plan_name) || "Plano sem nome",
                            meta: `${toTitleCase(row.beneficiary_type) || "—"}${row.beneficiary_name ? " · " + toTitleCase(row.beneficiary_name) : ""}${row.plan_value ? ` · ${formatCurrency(row.plan_value)}` : ""}`,
                          })}
                        />
                      </TabsContent>
                    </Tabs>
                  </TabsContent>

                  <TabsContent value="ferias" className="flex-1 min-h-0 overflow-auto m-0 p-4">
                    <SubResourceTab
                      kind="ferias"
                      collaboratorId={collaboratorId}
                      table="vacation_periods"
                      orderBy={{ column: "start_date", ascending: false }}
                      titleSingular="Férias"
                      icon={<Palmtree className="w-6 h-6 text-primary" />}
                      emptyTitle="Sem períodos de férias"
                      emptyDescription="Nenhum período de férias registrado."
                      canManage={canManage}
                      fields={FERIAS_FIELDS}
                      onEditOverride={(row: any) => setAdjustingPeriod(row)}
                      renderRow={(row: any) => ({
                        title: `${formatDateBR(row.start_date)} → ${formatDateBR(row.end_date)}`,
                        meta: `${VACATION_STATUS_LABEL[row.status] ?? row.status ?? "—"}${row.notes ? " · " + toTitleCase(row.notes) : ""}`,
                      })}
                    />
                  </TabsContent>

                  <TabsContent value="lotacao" className="flex-1 min-h-0 overflow-auto m-0 p-4">
                    <SubResourceTab
                      kind="pdvs"
                      collaboratorId={collaboratorId}
                      table="collaborator_pdvs"
                      orderBy={{ column: "created_at", ascending: false }}
                      titleSingular="PDV"
                      icon={<Storefront className="w-6 h-6 text-primary" />}
                      emptyTitle="Sem PDVs"
                      emptyDescription="Esse colaborador não atende nenhum PDV ainda."
                      canManage={canManage}
                      fields={PDV_FIELDS}
                      renderRow={(row: any) => ({
                        title: toTitleCase(row.pdv_name) || "PDV sem nome",
                      })}
                    />
                  </TabsContent>
                </>
              )}
            </Tabs>
          )}

          {/* Footer - Always Visible */}
          <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t bg-background">
            <div className="flex items-center gap-2">
              {!isNew && canManage && formData.status !== "inativo" && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={isDeactivating || isDeleting}
                >
                  <Power className="w-4 h-4 mr-2" />
                  Desativar
                </Button>
              )}
              {!isNew && canManage && formData.status === "inativo" && (
                <Button
                  variant="outline"
                  className="text-success border-success/25 hover:bg-success/15 hover:text-success dark:text-success dark:border-success/25 dark:hover:bg-success/15"
                  onClick={handleReactivate}
                  disabled={isDeactivating || isDeleting}
                >
                  {isDeactivating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Power className="w-4 h-4 mr-2" />
                  )}
                  Reativar
                </Button>
              )}
              {!isNew && canManage && (
                // Excluir colaborador FOI DESATIVADO. Cadastros são sensíveis
                // (FK em folha, férias, 13º, vínculo com user/auth, agenda
                // legada). Pra "remover" use o botão Desativar — colab fica
                // com status='inativo' + termination_date, e sincroniza
                // como `desativado: true` na agenda. Histórico preservado.
                <Button
                  variant="outline"
                  className="text-muted-foreground border-muted"
                  disabled
                  title="Não é possível excluir colaborador. Use Desativar — preserva histórico e sincroniza com a agenda."
                >
                  <Trash className="w-4 h-4 mr-2" />
                  Excluir
                </Button>
              )}
              {!isNew && collaboratorId && (
                <Button
                  variant="outline"
                  onClick={() => setIsHistoryOpen(true)}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Ver histórico
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Deactivate */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              {formData.name} fica marcado como <strong>inativo</strong> e a
              data de hoje vira a data de desligamento. O histórico (folha,
              férias, exames) é preservado. Você pode reativar editando o
              status no modal depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeactivating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              disabled={isDeactivating}
            >
              {isDeactivating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Power className="w-4 h-4 mr-2" />
              )}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Delete */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação <strong>não pode ser desfeita</strong>. Vai remover{" "}
              {formData.name}, todos os lançamentos de folha, benefícios,
              exames e (se houver) o acesso dele ao Portal do Colaborador.
              Para histórico, prefira <em>Desativar</em>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash className="w-4 h-4 mr-2" />
              )}
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Entry Dialog - Extended with month/year/installment */}
      <Dialog open={addEntryOpen} onOpenChange={setAddEntryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Lançamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isNew && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mês</Label>
                <Select
                  value={entryForm.month.toString()}
                  onValueChange={(v) => setEntryForm((prev) => ({ ...prev, month: parseInt(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <SelectItem key={m} value={m.toString()}>
                        {m.toString().padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ano</Label>
                <Select
                  value={entryForm.year.toString()}
                  onValueChange={(v) => setEntryForm((prev) => ({ ...prev, year: parseInt(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                      <SelectItem key={y} value={y.toString()}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            )}
            {!isNew && (
              <p className="text-xs text-muted-foreground">
                Lançamento <strong>fixo</strong> do cadastro — vale todo mês até
                ser excluído. Aparece na folha aberta/futura quando você clicar
                em <strong>Repopular</strong>.
              </p>
            )}
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={entryForm.type}
                onValueChange={(v) => setEntryForm((prev) => ({ ...prev, type: v as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auxilio_vale_transporte">Auxílio Vale Transporte</SelectItem>
                  <SelectItem value="carro_agregado">Carro Agregado</SelectItem>
                  <SelectItem value="bonificacao">Bonificação</SelectItem>
                  <SelectItem value="gratificacao">Gratificação</SelectItem>
                  <SelectItem value="hora_extra">Hora extra</SelectItem>
                  <SelectItem value="atestado">Atestado</SelectItem>
                  <SelectItem value="adiantamento">Adiantamento</SelectItem>
                  <SelectItem value="desconto">Desconto</SelectItem>
                  <SelectItem value="falta">Falta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={entryForm.description}
                onChange={(e) => setEntryForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Descrição do lançamento"
              />
            </div>
            <div className="space-y-2">
              <Label>Valor Total</Label>
              <Input
                value={entryForm.value}
                onChange={handleValueChange}
                placeholder="R$ 0,00"
              />
            </div>
            
            {/* Fixed vs Installment — só no cadastro de colaborador NOVO.
                Pra existentes, o lançamento já é fixo permanente (ficha). */}
            {isNew && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={entryForm.is_fixed}
                  onCheckedChange={(v) => setEntryForm((prev) => ({ ...prev, is_fixed: v, is_installment: v ? false : prev.is_installment }))}
                  disabled={entryForm.is_installment}
                />
                <Label>Lançamento fixo (repete mensalmente)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={entryForm.is_installment}
                  onCheckedChange={(v) => setEntryForm((prev) => ({ ...prev, is_installment: v, is_fixed: v ? false : prev.is_fixed }))}
                  disabled={entryForm.is_fixed}
                />
                <Label>Parcelado</Label>
              </div>
              {entryForm.is_installment && (
                <div className="space-y-2 pl-6">
                  <Label>Número de Parcelas</Label>
                  <Input
                    type="number"
                    min={2}
                    max={48}
                    value={entryForm.installment_count}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, installment_count: Math.max(2, parseInt(e.target.value) || 2) }))}
                  />
                  {entryForm.value && (
                    <p className="text-xs text-muted-foreground">
                      {entryForm.installment_count}x de {formatCurrency(parseCurrencyInput(entryForm.value) / entryForm.installment_count)}
                    </p>
                  )}
                </div>
              )}
            </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setAddEntryOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={isNew ? handleAddPendingEntry : handleAddEntry}>
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Benefit Dialog */}
      <Dialog open={addBenefitOpen} onOpenChange={setAddBenefitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Benefício</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Benefício</Label>
              <Select value={selectedBenefitId} onValueChange={setSelectedBenefitId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um benefício" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedBenefits.map((benefit) => (
                    <SelectItem key={benefit.id} value={benefit.id}>
                      {benefit.name} - {formatCurrency(benefit.value || 0)}{" "}
                      ({benefit.value_type === "monthly" ? "mensal" : "diário"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setAddBenefitOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={isNew ? handleAddPendingBenefit : handleAddBenefit}>
                Adicionar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Store Dialog */}
      <Dialog open={createStoreOpen} onOpenChange={setCreateStoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Nova Empresa
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Empresa</Label>
              <Input
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateStoreOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => createStoreMutation.mutate(newStoreName)}
                disabled={!newStoreName.trim()}
              >
                Criar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Team Dialog */}
      <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Novo Setor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Setor</Label>
              <Input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Nome do setor"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateTeamOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => createTeamMutation.mutate(newTeamName)}
                disabled={!newTeamName.trim()}
              >
                Criar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Entry Confirmation */}
      <Dialog open={editingSalary} onOpenChange={setEditingSalary}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Salário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Atualiza o salário do cadastro e a linha de salário do mês{" "}
              <strong>aberto</strong> atual — INSS/IRPF/FGTS e desconto de VT
              recalculam na hora. Meses anteriores não mudam: pra diferença de
              competência passada, use o lançamento avulso{" "}
              <strong>Salário Retroativo</strong> na folha.
            </p>
            <div className="space-y-2">
              <Label>Salário</Label>
              <Input
                value={editSalaryValue}
                onChange={(e) => setEditSalaryValue(formatCurrencyForInput(e.target.value))}
                placeholder="R$ 0,00"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setEditingSalary(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveSalaryEdit} disabled={savingSalary}>
                {savingSalary ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingFixedEntry} onOpenChange={(open) => !open && setEditingFixedEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Lançamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {editingFixedEntry ? getEntryTypeLabel(editingFixedEntry.type) : ""} da
              ficha fixa — o novo valor vale daqui pra frente e atualiza a folha{" "}
              <strong>aberta</strong> na hora. Competência fechada não muda.
            </p>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={editEntryDescription}
                onChange={(e) => setEditEntryDescription(e.target.value)}
                placeholder="Descrição do lançamento"
              />
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input
                value={editEntryValue}
                onChange={(e) => setEditEntryValue(formatCurrencyForInput(e.target.value))}
                placeholder="R$ 0,00"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setEditingFixedEntry(null)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveFixedEntryEdit} disabled={savingFixedEdit}>
                {savingFixedEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingEntry} onOpenChange={(open) => !open && setDeletingEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Lançamento</AlertDialogTitle>
            <AlertDialogDescription>
              Remove o lançamento do cadastro e da folha em competência aberta.
              Competência fechada não muda. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteEntry}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Assignment Confirmation */}
      <AlertDialog open={!!deletingAssignment} onOpenChange={(open) => !open && setDeletingAssignment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Benefício</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este benefício do colaborador?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAssignment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Custom Benefit Value */}
      <Dialog
        open={!!editingAssignmentValue}
        onOpenChange={(open) => !open && !savingCustomValue && setEditingAssignmentValue(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Editar valor do benefício
              {editingAssignmentValue?.assignment?.benefit?.name
                ? ` — ${editingAssignmentValue.assignment.benefit.name}`
                : ""}
            </DialogTitle>
            <DialogDescription>
              Valor mensal específico pra esse colaborador. Pra voltar ao
              padrão do benefício, digite o mesmo valor cadastrado em
              Benefícios.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Valor mensal (R$)</Label>
            <Input
              autoFocus
              value={editingAssignmentValue?.inputValue ?? ""}
              onChange={(e) =>
                setEditingAssignmentValue((prev) =>
                  prev ? { ...prev, inputValue: formatCurrencyForInput(e.target.value) } : prev,
                )
              }
              placeholder="0,00"
            />
            {editingAssignmentValue?.assignment?.benefit && (
              <p className="text-xs text-muted-foreground">
                Padrão do benefício:{" "}
                {formatCurrency(
                  Number(editingAssignmentValue.assignment.benefit.value ?? 0),
                )}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setEditingAssignmentValue(null)}
              disabled={savingCustomValue}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveCustomValue}
              disabled={savingCustomValue}
            >
              {savingCustomValue && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Position Change Dialog */}
      <PositionChangeDialog
        open={positionChangeOpen}
        onOpenChange={setPositionChangeOpen}
        currentPosition={positions.find((p) => p.id === formData.position_id) || null}
        positions={positions}
        onConfirm={handlePositionChange}
      />

      {/* Vacation Period Manual Adjustment */}
      <VacationPeriodAdjustDialog
        open={!!adjustingPeriod}
        onOpenChange={(v) => !v && setAdjustingPeriod(null)}
        period={adjustingPeriod}
      />

      {/* Histórico — modal acionado pelo botão "Ver histórico" do footer */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Histórico do colaborador
            </DialogTitle>
            <DialogDescription>
              Eventos automáticos (admissão, mudanças de cargo/setor/empresa) + lançamentos sincronizados da agenda.
            </DialogDescription>
          </DialogHeader>
          {collaboratorId && <CollaboratorTimelineTab collaboratorId={collaboratorId} />}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CollaboratorModal;
