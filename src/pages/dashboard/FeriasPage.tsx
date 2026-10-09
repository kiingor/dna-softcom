import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PermissionGuard from "@/components/dashboard/PermissionGuard";
import { useDashboard } from "@/contexts/DashboardContext";
import { usePermissions } from "@/hooks/usePermissions";
import { VacationPaymentDialog } from "@/modules/ferias/components/VacationPaymentDialog";
import { VACATION_PAYMENT_STATUSES } from "@/modules/ferias/services/vacation-payment.service";
import { formatCurrency } from "@/lib/formatters";
import { useVacationRequests, useVacationPeriods, useUpdateVacationRequest, useDeleteVacationRequest, useApproveVacationRequest, vacationRequestStatusLabels, vacationRequestStatusColors, vacationPeriodStatusLabels, vacationPeriodStatusColors, VacationRequest, VacationPeriod } from "@/hooks/useVacations";
import VacationRequestModal from "@/components/ferias/VacationRequestModal";
import VacationCalendar from "@/components/ferias/VacationCalendar";
import { VacationBalanceBulkImportDialog } from "@/modules/core/components/ferias/VacationBalanceBulkImportDialog";
import { VacationPeriodAdjustDialog } from "@/modules/core/components/collaborators/VacationPeriodAdjustDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Clock, Users, CalendarCheck, Warning as AlertTriangle, MagnifyingGlass as Search, Check, X, CircleNotch as Loader2, Calendar, Trash as Trash2, Eye, UserCheck, UploadSimple, DotsThreeVertical, Pencil, FilePdf } from "@phosphor-icons/react";
import { downloadVacationReceiptPdf } from "@/modules/ferias/services/vacation-receipt.service";
import { format, parseISO, isAfter, addDays } from "date-fns";
import { toast } from "sonner";

const FeriasPage = () => {
  const { hasAnyRole, user, currentCompany } = useDashboard();
  const canManage = hasAnyRole(["admin_gc", "gestor_gc", "gestor"]);
  const vacationPermissions = usePermissions("ferias");
  const canRecordPayment = canManage && vacationPermissions.canEdit && !vacationPermissions.isLoading;

  const { data: requests = [], isLoading: loadingRequests } = useVacationRequests();
  const { data: periods = [], isLoading: loadingPeriods } = useVacationPeriods();
  const updateRequest = useUpdateVacationRequest();
  const deleteRequest = useDeleteVacationRequest();
  const approveRequest = useApproveVacationRequest();

  // Fetch all active collaborators for overview tab
  const { data: allCollaborators = [] } = useQuery({
    queryKey: ["collaborators-vacation-overview", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, name, position, admission_date")
        .eq("company_id", currentCompany.id)
        .eq("status", "ativo")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentCompany?.id,
  });

  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestModalCollaboratorId, setRequestModalCollaboratorId] = useState<string | undefined>();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodStatusFilter, setPeriodStatusFilter] = useState("all");
  const [situationFilter, setSituationFilter] = useState("all");
  const [rejectingRequest, setRejectingRequest] = useState<VacationRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [deletingRequest, setDeletingRequest] = useState<VacationRequest | null>(null);
  const [viewingRequest, setViewingRequest] = useState<VacationRequest | null>(null);
  const [payingRequest, setPayingRequest] = useState<VacationRequest | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [adjustingPeriod, setAdjustingPeriod] = useState<VacationPeriod | null>(null);

  // Summary cards
  const pendingCount = useMemo(() => requests.filter(r => r.status === "pending").length, [requests]);
  const inProgressCount = useMemo(() => requests.filter(r => r.status === "in_progress").length, [requests]);
  const approvedCount = useMemo(() => requests.filter(r => r.status === "approved").length, [requests]);
  const expiringPeriods = useMemo(() => {
    const in60Days = addDays(new Date(), 60);
    return periods.filter(p => {
      if (p.status !== "available" && p.status !== "partially_used") return false;
      const concessiveEnd = addDays(parseISO(p.end_date), 365);
      return concessiveEnd <= in60Days;
    }).length;
  }, [periods]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      const matchSearch = !searchTerm || r.collaborator?.name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [requests, searchTerm, statusFilter]);

  // Filtered periods
  const filteredPeriods = useMemo(() => {
    return periods.filter(p => {
      const matchSearch = !searchTerm || p.collaborator?.name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = periodStatusFilter === "all" || p.status === periodStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [periods, searchTerm, periodStatusFilter]);

  // Collaborators overview: merge collaborators with their vacation periods
  const collaboratorsOverview = useMemo(() => {
    const now = new Date();
    return allCollaborators
      .filter(c => !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(collab => {
        const collabPeriods = periods.filter(p => p.collaborator_id === collab.id);
        const activePeriod = collabPeriods.find(p => p.status === "available" || p.status === "partially_used");
        const pendingPeriod = collabPeriods.find(p => p.status === "pending");
        const currentPeriod = activePeriod || pendingPeriod;
        const totalRemaining = collabPeriods
          .filter(p => p.status === "available" || p.status === "partially_used" || p.status === "pending")
          .reduce((sum, p) => sum + p.days_remaining, 0);
        const activeRequest = requests.find(r => r.collaborator_id === collab.id && (r.status === "approved" || r.status === "in_progress"));

        // Vencimento concessivo: usa a Data Limite oficial da agenda quando
        // disponível; senão aproxima (12 meses após o fim da competência).
        let concessiveDeadline: Date | null = null;
        if (activePeriod) {
          concessiveDeadline = activePeriod.data_limite
            ? parseISO(activePeriod.data_limite)
            : addDays(parseISO(activePeriod.end_date), 365);
        }

        // Situação exibida na coluna (e base do filtro de Situação). Calculada
        // aqui — não no render — pra que o dropdown consiga filtrar por ela.
        const isExpiring = !!concessiveDeadline && concessiveDeadline <= addDays(now, 60);
        const isOverdue = !!concessiveDeadline && concessiveDeadline < now;
        let situationLabel = "Sem período";
        let situationClass = "bg-muted text-muted-foreground";
        if (activeRequest?.status === "in_progress") {
          situationLabel = "Em Gozo";
          situationClass = "bg-success/10 text-success border-success/25";
        } else if (activeRequest?.status === "approved") {
          situationLabel = "Férias Agendadas";
          situationClass = "bg-info/10 text-info border-info/25";
        } else if (isOverdue) {
          situationLabel = "Vencido!";
          situationClass = "bg-destructive/10 text-destructive border-destructive/25";
        } else if (isExpiring) {
          situationLabel = "Vencendo";
          situationClass = "bg-warning/10 text-warning border-warning/25";
        } else if (currentPeriod?.status === "pending") {
          situationLabel = "Adquirindo";
          situationClass = "bg-info/5 text-info border-info/25";
        } else if (currentPeriod?.status === "available") {
          situationLabel = "Disponível";
          situationClass = "bg-success/5 text-success border-success/25";
        }

        return {
          ...collab,
          periods: collabPeriods,
          currentPeriod,
          totalRemaining,
          activeRequest,
          concessiveDeadline,
          isExpiring,
          isOverdue,
          situationLabel,
          situationClass,
        };
      })
      .filter(c => situationFilter === "all" || c.situationLabel === situationFilter);
  }, [allCollaborators, periods, requests, searchTerm, situationFilter]);

  const handleApprove = async (request: VacationRequest) => {
    if (!user?.id) return;
    // useApproveVacationRequest faz snapshot do cálculo + lança na folha
    // (se já aberta) ou marca como pendente (lança quando folha do mês abrir).
    // Toast com o detalhamento sai do próprio hook.
    await approveRequest.mutateAsync({ requestId: request.id, approvedBy: user.id });
  };

  const handleReject = async () => {
    if (!rejectingRequest || !rejectionReason.trim()) return;
    await updateRequest.mutateAsync({
      id: rejectingRequest.id,
      status: "rejected",
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
    });
    setRejectingRequest(null);
    setRejectionReason("");
    toast.success("Solicitação rejeitada.");
  };

  const handleComplete = async (request: VacationRequest) => {
    await updateRequest.mutateAsync({ id: request.id, status: "completed" });
    toast.success("Férias concluídas!");
  };

  const handleStartVacation = async (request: VacationRequest) => {
    await updateRequest.mutateAsync({ id: request.id, status: "in_progress" });
    toast.success("Férias iniciadas!");
  };

  const handleGenerateReceipt = async (request: VacationRequest) => {
    try {
      await downloadVacationReceiptPdf({ requestId: request.id });
      toast.success("Recibo gerado ✓");
    } catch (e) {
      toast.error("Erro ao gerar recibo: " + (e as Error).message);
    }
  };

  const isLoading = loadingRequests || loadingPeriods;

  return (
    <PermissionGuard module="ferias">
      <div className="space-y-6 page-content">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-muted-foreground">
              {canManage ? "Gerencie solicitações de férias dos colaboradores" : "Acompanhe suas férias e ausências"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
                <UploadSimple className="w-4 h-4 mr-2" />
                Importar saldos
              </Button>
            )}
            <Button variant="hero" onClick={() => { setRequestModalCollaboratorId(undefined); setRequestModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              {canManage ? "Nova Solicitação" : "Solicitar Férias"}
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Pendentes</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inProgressCount}</p>
                <p className="text-xs text-muted-foreground">Em Gozo</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
                <CalendarCheck className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-2xl font-bold">{approvedCount}</p>
                <p className="text-xs text-muted-foreground">Agendadas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{expiringPeriods}</p>
                <p className="text-xs text-muted-foreground">Vencendo</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Colaboradores</TabsTrigger>
            <TabsTrigger value="requests">Solicitações</TabsTrigger>
            <TabsTrigger value="periods">Períodos Aquisitivos</TabsTrigger>
            <TabsTrigger value="calendar">Calendário</TabsTrigger>
          </TabsList>

          {/* Collaborators Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Buscar colaborador..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <Select value={situationFilter} onValueChange={setSituationFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="Adquirindo">Adquirindo</SelectItem>
                  <SelectItem value="Disponível">Disponível</SelectItem>
                  <SelectItem value="Em Gozo">Em Gozo</SelectItem>
                  <SelectItem value="Férias Agendadas">Férias Agendadas</SelectItem>
                  <SelectItem value="Vencendo">Vencendo</SelectItem>
                  <SelectItem value="Vencido!">Vencido</SelectItem>
                  <SelectItem value="Sem período">Sem período</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              {isLoading ? (
                <CardContent className="p-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </CardContent>
              ) : collaboratorsOverview.length === 0 ? (
                <CardContent className="p-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-muted-foreground">Nenhum colaborador encontrado.</p>
                </CardContent>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Admissão</TableHead>
                      <TableHead>Período Atual</TableHead>
                      <TableHead className="text-center">Saldo (dias)</TableHead>
                      <TableHead>Vencimento Concessivo</TableHead>
                      <TableHead>Situação</TableHead>
                      {canManage && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="stagger-animation">
                    {collaboratorsOverview.map(c => (
                        <TableRow key={c.id} className="table-row-animate">
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>
                            {c.admission_date ? format(parseISO(c.admission_date), "dd/MM/yyyy") : <span className="text-muted-foreground italic">Não informada</span>}
                          </TableCell>
                          <TableCell>
                            {c.currentPeriod ? (
                              <span className="text-sm">
                                {format(parseISO(c.currentPeriod.start_date), "dd/MM/yy")} - {format(parseISO(c.currentPeriod.end_date), "dd/MM/yy")}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-center font-bold">{c.totalRemaining}</TableCell>
                          <TableCell>
                            {c.concessiveDeadline ? (
                              <span className={c.isOverdue ? "text-destructive font-semibold" : c.isExpiring ? "text-warning font-semibold" : ""}>
                                {format(c.concessiveDeadline, "dd/MM/yyyy")}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`whitespace-nowrap ${c.situationClass}`}
                            >
                              {c.situationLabel}
                            </Badge>
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={!c.admission_date}
                                  >
                                    <DotsThreeVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setRequestModalCollaboratorId(c.id);
                                      setRequestModalOpen(true);
                                    }}
                                  >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Solicitar férias
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!c.currentPeriod}
                                    onClick={() => {
                                      if (c.currentPeriod) setAdjustingPeriod(c.currentPeriod);
                                    }}
                                  >
                                    <Pencil className="w-4 h-4 mr-2" />
                                    Editar período
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="requests" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Buscar colaborador..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="approved">Aprovada</SelectItem>
                  <SelectItem value="in_progress">Em Gozo</SelectItem>
                  <SelectItem value="completed">Concluída</SelectItem>
                  <SelectItem value="rejected">Rejeitada</SelectItem>
                  <SelectItem value="cancelled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              {isLoading ? (
                <CardContent className="p-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </CardContent>
              ) : filteredRequests.length === 0 ? (
                <CardContent className="p-12 text-center">
                  <Calendar className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-muted-foreground">Nenhuma solicitação encontrada.</p>
                </CardContent>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Início</TableHead>
                      <TableHead>Fim</TableHead>
                      <TableHead className="text-center">Dias</TableHead>
                      <TableHead className="text-center">Abono</TableHead>
                      <TableHead className="text-right">Valor pago</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="stagger-animation">
                    {filteredRequests.map(r => (
                      <TableRow key={r.id} className="table-row-animate">
                        <TableCell className="font-medium">{r.collaborator?.name || "—"}</TableCell>
                        <TableCell>{format(parseISO(r.start_date), "dd/MM/yyyy")}</TableCell>
                        <TableCell>{format(parseISO(r.end_date), "dd/MM/yyyy")}</TableCell>
                        <TableCell className="text-center">{r.days_count}</TableCell>
                        <TableCell className="text-center">{r.sell_days > 0 ? r.sell_days : "—"}</TableCell>
                        <TableCell className="text-right mono">{r.paid_value == null ? "Não informado" : formatCurrency(r.paid_value)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={vacationRequestStatusColors[r.status] || ""}>
                            {vacationRequestStatusLabels[r.status] || r.status}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ver detalhes da solicitação" onClick={() => setViewingRequest(r)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              {canRecordPayment && VACATION_PAYMENT_STATUSES.includes(r.status) && (
                                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setPayingRequest(r)}>
                                  {r.paid_value == null ? "Registrar valor pago" : "Editar valor pago"}
                                </Button>
                              )}
                              {r.status === "pending" && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:text-success" onClick={() => handleApprove(r)}>
                                    <Check className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { setRejectingRequest(r); setRejectionReason(""); }}>
                                    <X className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              {r.status === "approved" && (
                                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => handleStartVacation(r)}>
                                  Iniciar
                                </Button>
                              )}
                              {r.status === "in_progress" && (
                                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => handleComplete(r)}>
                                  Concluir
                                </Button>
                              )}
                              {(r.status === "approved" || r.status === "in_progress" || r.status === "completed") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-primary"
                                  title="Gerar recibo de férias (PDF)"
                                  onClick={() => handleGenerateReceipt(r)}
                                >
                                  <FilePdf className="w-4 h-4" />
                                </Button>
                              )}
                              {(r.status === "pending" || r.status === "approved") && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeletingRequest(r)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          {/* Periods Tab */}
          <TabsContent value="periods" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Buscar colaborador..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <Select value={periodStatusFilter} onValueChange={setPeriodStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Adquirindo</SelectItem>
                  <SelectItem value="available">Disponível</SelectItem>
                  <SelectItem value="partially_used">Parcialmente Usado</SelectItem>
                  <SelectItem value="used">Utilizado</SelectItem>
                  <SelectItem value="expired">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              {isLoading ? (
                <CardContent className="p-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </CardContent>
              ) : filteredPeriods.length === 0 ? (
                <CardContent className="p-12 text-center">
                  <Calendar className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-muted-foreground">Nenhum período aquisitivo encontrado.</p>
                </CardContent>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Período de Competência</TableHead>
                      <TableHead>Período de Gozo</TableHead>
                      <TableHead>Data Limite</TableHead>
                      <TableHead className="text-center">Direito</TableHead>
                      <TableHead className="text-center">Gozados</TableHead>
                      <TableHead className="text-center">Vendidos</TableHead>
                      <TableHead className="text-center">Saldo</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="stagger-animation">
                    {filteredPeriods.map(p => (
                      <TableRow key={p.id} className="table-row-animate">
                        <TableCell className="font-medium">{p.collaborator?.name || "—"}</TableCell>
                        <TableCell>
                          {format(parseISO(p.start_date), "dd/MM/yyyy")} - {format(parseISO(p.end_date), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell>
                          {p.gozo_start_date && p.gozo_end_date
                            ? `${format(parseISO(p.gozo_start_date), "dd/MM/yyyy")} - ${format(parseISO(p.gozo_end_date), "dd/MM/yyyy")}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {p.data_limite ? format(parseISO(p.data_limite), "dd/MM/yyyy") : "—"}
                        </TableCell>
                        <TableCell className="text-center">{p.days_entitled}</TableCell>
                        <TableCell className="text-center">{p.days_taken}</TableCell>
                        <TableCell className="text-center">{p.days_sold}</TableCell>
                        <TableCell className="text-center font-bold">{p.days_remaining}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={vacationPeriodStatusColors[p.status] || ""}>
                            {vacationPeriodStatusLabels[p.status] || p.status}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Editar período aquisitivo"
                              onClick={() => setAdjustingPeriod(p)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          {/* Calendar Tab */}
          <TabsContent value="calendar">
            <VacationCalendar requests={requests} />
          </TabsContent>
        </Tabs>

        {/* Request Modal */}
        {payingRequest && payingRequest.company_id === currentCompany?.id && canRecordPayment && (
          <VacationPaymentDialog key={payingRequest.id} request={payingRequest} onClose={() => setPayingRequest(null)} />
        )}
        <VacationRequestModal open={requestModalOpen} onOpenChange={setRequestModalOpen} preSelectedCollaboratorId={requestModalCollaboratorId} />

        {/* Bulk Import Saldos */}
        <VacationBalanceBulkImportDialog open={bulkImportOpen} onOpenChange={setBulkImportOpen} />

        {/* Manual Adjust Period */}
        <VacationPeriodAdjustDialog
          open={!!adjustingPeriod}
          onOpenChange={(v) => !v && setAdjustingPeriod(null)}
          period={adjustingPeriod}
        />

        {/* Reject Dialog */}
        <Dialog open={!!rejectingRequest} onOpenChange={() => setRejectingRequest(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Rejeitar Solicitação</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Informe o motivo da rejeição para {rejectingRequest?.collaborator?.name}:
              </p>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="Descreva o motivo..." rows={3} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setRejectingRequest(null)}>Cancelar</Button>
                <Button variant="destructive" onClick={handleReject} disabled={!rejectionReason.trim() || updateRequest.isPending}>
                  Rejeitar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={!!deletingRequest} onOpenChange={() => setDeletingRequest(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar solicitação?</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja cancelar a solicitação de férias de {deletingRequest?.collaborator?.name}?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Não</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (deletingRequest) deleteRequest.mutate(deletingRequest.id); setDeletingRequest(null); }}>
                Sim, cancelar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* View Dialog */}
        <Dialog open={!!viewingRequest} onOpenChange={() => setViewingRequest(null)}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Detalhes da Solicitação</DialogTitle>
            </DialogHeader>
            {viewingRequest && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-muted-foreground">Colaborador</p>
                    <p className="font-medium">{viewingRequest.collaborator?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant="outline" className={vacationRequestStatusColors[viewingRequest.status]}>
                      {vacationRequestStatusLabels[viewingRequest.status]}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Início</p>
                    <p className="font-medium">{format(parseISO(viewingRequest.start_date), "dd/MM/yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fim</p>
                    <p className="font-medium">{format(parseISO(viewingRequest.end_date), "dd/MM/yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Dias</p>
                    <p className="font-medium">{viewingRequest.days_count}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Abono Pecuniário</p>
                    <p className="font-medium">{viewingRequest.sell_days > 0 ? `${viewingRequest.sell_days} dias` : "Não"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Valor pago</p>
                    <p className="font-medium mono">{viewingRequest.paid_value == null ? "Não informado" : formatCurrency(viewingRequest.paid_value)}</p>
                  </div>
                </div>
                {viewingRequest.notes && (
                  <div>
                    <p className="text-muted-foreground">Observações</p>
                    <p className="font-medium">{viewingRequest.notes}</p>
                  </div>
                )}
                {viewingRequest.rejection_reason && (
                  <div>
                    <p className="text-muted-foreground">Motivo da Rejeição</p>
                    <p className="font-medium text-destructive">{viewingRequest.rejection_reason}</p>
                  </div>
                )}
                {viewingRequest.approved_at && (
                  <div>
                    <p className="text-muted-foreground">Data da decisão</p>
                    <p className="font-medium">{format(parseISO(viewingRequest.approved_at), "dd/MM/yyyy HH:mm")}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PermissionGuard>
  );
};

export default FeriasPage;
