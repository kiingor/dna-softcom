import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import PermissionGuard from "@/components/dashboard/PermissionGuard";
import { useExams, type OccupationalExam } from "@/hooks/useExams";
import { usePermissions } from "@/hooks/usePermissions";
import { EXAM_TYPE_LABELS, EXAM_STATUS_LABELS, EXAM_STATUS_COLORS } from "@/lib/riskGroupDefaults";
import { getExamStatus, isExamOpen } from "@/lib/examStatus";
import { exportExamsToPDF, exportExamsToExcel } from "@/lib/examExportUtils";
import { ExamRequestModal } from "@/components/exames/ExamRequestModal";
import { ExamUploadModal } from "@/components/exames/ExamUploadModal";
import { ExamEditModal } from "@/components/exames/ExamEditModal";
import { ExamDateModal } from "@/components/exames/ExamDateModal";
import { Pencil } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { ClipboardText as ClipboardCheck, Plus, FileArrowDown as FileDown, Printer, MagnifyingGlass as Search, Calendar, Warning as AlertTriangle, CheckCircle, Clock, Upload, DotsThree as MoreHorizontal, XCircle } from "@phosphor-icons/react";
import { format, parseISO, addDays, isBefore, differenceInCalendarDays } from "date-fns";

export default function ExamesPage() {
  const { currentCompany } = useDashboard();
  const { exams, isLoading, updateExam } = useExams();
  const { canEdit } = usePermissions("exames");

  const [newExamOpen, setNewExamOpen] = useState(false);
  const [uploadExam, setUploadExam] = useState<OccupationalExam | null>(null);
  const [editExam, setEditExam] = useState<OccupationalExam | null>(null);
  const [dateAction, setDateAction] = useState<
    { exam: OccupationalExam; mode: "realizar" | "agendar" | "limite" } | null
  >(null);

  // Sem período inicial para manter os exames vencidos antigos acessíveis.
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const today = parseISO(todayIso);

  // Check if exam has documents
  const { data: examDocCounts = {} } = useQuery({
    queryKey: ["exam-doc-counts", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return {};
      const { data, error } = await supabase
        .from("exam_documents")
        .select("exam_id")
        .eq("company_id", currentCompany.id);
      if (error) return {};
      const counts: Record<string, boolean> = {};
      data.forEach((d) => { counts[d.exam_id] = true; });
      return counts;
    },
    enabled: !!currentCompany?.id,
  });

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      if (searchTerm && !exam.collaborator?.name?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (statusFilter !== "all" && getExamStatus(exam, todayIso) !== statusFilter) return false;
      if (typeFilter !== "all" && exam.exam_type !== typeFilter) return false;
      if (dateFrom) {
        const from = parseISO(dateFrom);
        const examDate = parseISO(exam.due_date);
        if (isBefore(examDate, from)) return false;
      }
      if (dateTo) {
        const to = addDays(parseISO(dateTo), 1);
        const examDate = parseISO(exam.due_date);
        if (!isBefore(examDate, to)) return false;
      }
      return true;
    });
  }, [exams, searchTerm, statusFilter, typeFilter, dateFrom, dateTo, todayIso]);

  // Summary cards
  const pendingCount = exams.filter((e) => getExamStatus(e, todayIso) === "pendente").length;
  const overdueCount = exams.filter((e) => getExamStatus(e, todayIso) === "vencido").length;
  const next30Count = exams.filter((e) => {
    if (!isExamOpen(e)) return false;
    const daysLeft = differenceInCalendarDays(parseISO(e.due_date), today);
    return daysLeft >= 0 && daysLeft <= 30;
  }).length;
  const doneThisMonth = exams.filter((e) => {
    if (e.status !== "realizado" || !e.completed_date) return false;
    const d = parseISO(e.completed_date);
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  }).length;

  const handleExport = (type: "pdf" | "excel" | "print") => {
    const entries = filteredExams.map((e) => ({
      collaborator_name: e.collaborator?.name || "-",
      exam_type: e.exam_type,
      status: getExamStatus(e, todayIso),
      risk_group: e.risk_group_at_time,
      due_date: e.due_date,
      scheduled_date: e.scheduled_date,
      completed_date: e.completed_date,
      has_aso: !!examDocCounts[e.id],
    }));

    const data = {
      companyName: currentCompany?.company_name || "",
      entries,
    };

    if (type === "pdf" || type === "print") exportExamsToPDF(data);
    else exportExamsToExcel(data);
  };

  const renderDeadlineButton = (exam: OccupationalExam) => {
    if (!canEdit || exam.exam_type !== "periodico" || !isExamOpen(exam)) return null;

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDateAction({ exam, mode: "limite" })}
        aria-label={`Alterar data limite de ${exam.collaborator?.name || "exame periódico"}`}
      >
        <Pencil className="w-4 h-4 mr-2" />
        Alterar data limite
      </Button>
    );
  };

  return (
    <PermissionGuard module="exames">
      <div className="space-y-6 page-content">
        <div className="flex items-center justify-between animate-fade-in">
          <div>
            <p className="text-muted-foreground">Controle de exames ASO e vencimentos</p>
          </div>
          <Button onClick={() => setNewExamOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Exame
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10"><Clock className="w-5 h-5 text-warning" /></div>
              <div>
                <p className="text-2xl font-bold">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Pendentes</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-2xl font-bold">{overdueCount}</p>
                <p className="text-xs text-muted-foreground">Vencidos</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10"><Calendar className="w-5 h-5 text-info" /></div>
              <div>
                <p className="text-2xl font-bold">{next30Count}</p>
                <p className="text-xs text-muted-foreground">Próx. 30 dias</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10"><CheckCircle className="w-5 h-5 text-success" /></div>
              <div>
                <p className="text-2xl font-bold">{doneThisMonth}</p>
                <p className="text-xs text-muted-foreground">Realizados (mês)</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="todos">
          <TabsList>
            <TabsTrigger value="todos">Todos os Exames</TabsTrigger>
            <TabsTrigger value="vencimentos">Vencimentos</TabsTrigger>
          </TabsList>

          <TabsContent value="todos" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar colaborador..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px]" aria-label="Filtrar por status"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pendente">Pendente</SelectItem>
                      <SelectItem value="agendado">Agendado</SelectItem>
                      <SelectItem value="realizado">Realizado</SelectItem>
                      <SelectItem value="vencido">Vencido</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="admissional">Admissional</SelectItem>
                      <SelectItem value="periodico">Periódico</SelectItem>
                      <SelectItem value="mudanca_funcao">Mudança de Função</SelectItem>
                      <SelectItem value="retorno_trabalho">Retorno ao Trabalho</SelectItem>
                      <SelectItem value="demissional">Demissional</SelectItem>
                      <SelectItem value="avulso">Avulso</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="date" aria-label="Data limite a partir de" className="w-[140px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <Input type="date" aria-label="Data limite até" className="w-[140px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  <div className="flex gap-1">
                    <Button variant="outline" size="icon" onClick={() => handleExport("pdf")} title="Exportar PDF">
                      <FileDown className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => handleExport("excel")} title="Exportar Excel">
                      <FileDown className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => handleExport("print")} title="Imprimir">
                      <Printer className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4"><TableSkeleton columns={7} rows={5} /></div>
                ) : filteredExams.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ClipboardCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum exame encontrado</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Colaborador</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Grupo Risco</TableHead>
                        <TableHead>Data Limite</TableHead>
                        <TableHead>Realizado</TableHead>
                        <TableHead>ASO</TableHead>
                        <TableHead className="w-[60px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExams.map((exam) => {
                        const status = getExamStatus(exam, todayIso);
                        const isOverdue = status === "vencido";
                        return (
                          <TableRow key={exam.id} className={isOverdue ? "bg-destructive/15" : ""}>
                            <TableCell className="font-medium">{exam.collaborator?.name || "-"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" >
                                {EXAM_TYPE_LABELS[exam.exam_type] || exam.exam_type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={EXAM_STATUS_COLORS[status]} >
                                {EXAM_STATUS_LABELS[status] || status}
                              </Badge>
                            </TableCell>
                            <TableCell>{exam.risk_group_at_time || "-"}</TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-2">
                                <span>{format(parseISO(exam.due_date), "dd/MM/yyyy")}</span>
                                {renderDeadlineButton(exam)}
                              </div>
                            </TableCell>
                            <TableCell>{exam.completed_date ? format(parseISO(exam.completed_date), "dd/MM/yyyy") : "-"}</TableCell>
                            <TableCell>
                              {examDocCounts[exam.id] ? (
                                <Badge variant="outline" className="text-success"><CheckCircle className="w-3 h-3 mr-1" />Sim</Badge>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setEditExam(exam)}>
                                    <Pencil className="w-4 h-4 mr-2" />Editar
                                  </DropdownMenuItem>
                                  {exam.status === "pendente" && (
                                    <DropdownMenuItem onClick={() => setDateAction({ exam, mode: "agendar" })}>
                                      <Calendar className="w-4 h-4 mr-2" />Agendar
                                    </DropdownMenuItem>
                                  )}
                                  {["pendente", "agendado"].includes(exam.status) && (
                                    <DropdownMenuItem onClick={() => setDateAction({ exam, mode: "realizar" })}>
                                      <CheckCircle className="w-4 h-4 mr-2" />Marcar Realizado
                                    </DropdownMenuItem>
                                  )}
                                  {exam.status !== "cancelado" && (
                                    <DropdownMenuItem onClick={() => setUploadExam(exam)}>
                                      <Upload className="w-4 h-4 mr-2" />Enviar ASO
                                    </DropdownMenuItem>
                                  )}
                                  {exam.status !== "cancelado" && exam.status !== "realizado" && (
                                    <DropdownMenuItem onClick={() => updateExam({ id: exam.id, status: "cancelado" })} className="text-destructive">
                                      <XCircle className="w-4 h-4 mr-2" />Cancelar
                                    </DropdownMenuItem>
                                  )}
                                  {exam.status === "cancelado" && (
                                    <DropdownMenuItem onClick={() => updateExam({ id: exam.id, status: "arquivado" })}>
                                      <XCircle className="w-4 h-4 mr-2" />Arquivar
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vencimentos" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                {(() => {
                  const urgentExams = exams
                    .filter(isExamOpen)
                    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

                  if (urgentExams.length === 0) {
                    return (
                      <div className="text-center py-12 text-muted-foreground">
                        <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>Nenhum exame pendente</p>
                      </div>
                    );
                  }

                  return (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Colaborador</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Data Limite</TableHead>
                          <TableHead>Urgência</TableHead>
                          {canEdit && <TableHead>Ações</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {urgentExams.map((exam) => {
                          const dueDate = parseISO(exam.due_date);
                          const daysLeft = differenceInCalendarDays(dueDate, today);
                          let urgencyBadge;
                          if (daysLeft < 0) urgencyBadge = <Badge variant="destructive">Vencido ({Math.abs(daysLeft)}d)</Badge>;
                          else if (daysLeft <= 7) urgencyBadge = <Badge variant="destructive">Urgente ({daysLeft}d)</Badge>;
                          else if (daysLeft <= 30) urgencyBadge = <Badge variant="secondary">Próximo ({daysLeft}d)</Badge>;
                          else urgencyBadge = <Badge variant="outline">{daysLeft} dias</Badge>;

                          return (
                            <TableRow key={exam.id}>
                              <TableCell className="font-medium">{exam.collaborator?.name || "-"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" >
                                  {EXAM_TYPE_LABELS[exam.exam_type] || exam.exam_type}
                                </Badge>
                              </TableCell>
                              <TableCell>{format(dueDate, "dd/MM/yyyy")}</TableCell>
                              <TableCell>{urgencyBadge}</TableCell>
                              {canEdit && <TableCell>{renderDeadlineButton(exam)}</TableCell>}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <ExamRequestModal open={newExamOpen} onOpenChange={setNewExamOpen} />
        <ExamUploadModal open={!!uploadExam} onOpenChange={(o) => !o && setUploadExam(null)} exam={uploadExam} />
        <ExamEditModal open={!!editExam} onOpenChange={(o) => !o && setEditExam(null)} exam={editExam} />
        <ExamDateModal
          open={!!dateAction}
          onOpenChange={(o) => !o && setDateAction(null)}
          exam={dateAction?.exam ?? null}
          mode={dateAction?.mode ?? "realizar"}
        />
      </div>
    </PermissionGuard>
  );
}
