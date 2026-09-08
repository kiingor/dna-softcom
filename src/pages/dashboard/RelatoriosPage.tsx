import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useDashboard } from "@/contexts/DashboardContext";
import { useClosedPeriods } from "@/hooks/useClosedPeriods";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  TableFooter,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChartBar as BarChart3, FileText, FileXls as FileSpreadsheet, Lock, LockOpen, CaretLeft as ChevronLeft, CaretRight as ChevronRight, Users, Receipt } from "@phosphor-icons/react";
import { toast } from "sonner";
import PermissionGuard from "@/components/dashboard/PermissionGuard";
import { exportToPDF, exportToExcel, groupEntriesByCollaborator } from "@/lib/exportUtils";
import { formatCurrency, getMonthName } from "@/lib/formatters";
import { generatePayslipPDF, convertEntriesToPayslipData } from "@/lib/payslipPdfGenerator";
import { StorePayrollSummaryTable } from "@/modules/payroll/components/StorePayrollSummaryTable";
import { isDeduction } from "@/modules/payroll/types";
import {
  buildStorePayrollSummary,
  calculatePayrollReportTotals,
  getPayrollReportStoreId,
  PAYROLL_REPORT_TYPE_LABELS as typeLabels,
} from "@/modules/payroll/lib/buildStorePayrollSummary";

const RelatoriosPage = () => {
  const { currentCompany, hasAnyRole } = useDashboard();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [collaboratorFilter, setCollaboratorFilter] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);

  const { isPeriodClosed, closePeriod, reopenPeriod } = useClosedPeriods(currentCompany?.id);
  const periodClosed = isPeriodClosed(selectedMonth, selectedYear);
  const canManage = hasAnyRole(["admin_gc", "gestor_gc"]);
 
   // Fetch company details for CNPJ
   const { data: companyDetails } = useQuery({
     queryKey: ["company-details", currentCompany?.id],
     queryFn: async () => {
       if (!currentCompany?.id) return null;
       const { data, error } = await supabase
         .from("companies")
         .select("company_name, cnpj, logo_url")
         .eq("id", currentCompany.id)
         .single();
       if (error) throw error;
       return data;
     },
     enabled: !!currentCompany?.id,
   });
 
   // Fetch collaborators with position and team for payslip generation
   const { data: collaboratorsWithDetails = [] } = useQuery({
     queryKey: ["collaborators-with-details", currentCompany?.id],
     queryFn: async () => {
       if (!currentCompany?.id) return [];
       const { data, error } = await supabase
         .from("collaborators")
         .select(`
           id, name, cpf, admission_date,
           position:positions(name),
           team:teams(name)
         `)
         .eq("company_id", currentCompany.id)
         .eq("status", "ativo")
         .eq("is_temp", false)
         .order("name");
       if (error) throw error;
       return data;
     },
     enabled: !!currentCompany?.id,
   });

  // Fetch payroll entries
  const { data: entries = [], isLoading, isError: entriesError, refetch: refetchEntries } = useQuery({
    queryKey: ["payroll-entries-report", currentCompany?.id, selectedMonth, selectedYear],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      // Pagina: passa de 1000 lançamentos/mês e o PostgREST corta nesse limite.
      return await fetchAllRows(() =>
        supabase
          .from("payroll_entries")
          .select(`
          *,
          collaborator:collaborators(id, name, store_id)
        `)
          .eq("company_id", currentCompany.id)
          .eq("month", selectedMonth)
          .eq("year", selectedYear)
          .order("created_at", { ascending: false })
          .order("id"),
      );
    },
    enabled: !!currentCompany?.id,
  });

  // Fetch collaborators for filter
  const { data: collaborators = [] } = useQuery({
    queryKey: ["collaborators-filter", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, name")
        .eq("company_id", currentCompany.id)
        .eq("status", "ativo")
        .eq("is_temp", false)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!currentCompany?.id,
  });

  // Fetch stores for filter
  const { data: stores = [], isLoading: storesLoading, isError: storesError, refetch: refetchStores } = useQuery({
    queryKey: ["stores-filter", currentCompany?.id],
    queryFn: async () => {
      if (!currentCompany?.id) return [];
      return await fetchAllRows(() => supabase
        .from("stores")
        .select("id, store_name")
        .eq("company_id", currentCompany.id)
        .order("store_name")
        .order("id"));
    },
    enabled: !!currentCompany?.id,
  });

  // Filter entries
  const filteredEntries = useMemo(() => {
    let result = entries;
    if (collaboratorFilter !== "all") {
      result = result.filter((e) => e.collaborator_id === collaboratorFilter);
    }
    if (storeFilter !== "all") {
      result = result.filter((e) => (getPayrollReportStoreId(e) ?? "without-store") === storeFilter);
    }
    return result;
  }, [entries, collaboratorFilter, storeFilter]);

  // Group by collaborator
  const groupedData = useMemo(() => {
    return groupEntriesByCollaborator(filteredEntries);
  }, [filteredEntries]);

  const storeSummary = useMemo(() => buildStorePayrollSummary(filteredEntries, stores), [filteredEntries, stores]);
  const grandTotals = storeSummary.totals;
  const reportLoading = isLoading || storesLoading;
  const reportError = entriesError || storesError;
  const exportDisabled = filteredEntries.length === 0 || reportLoading || reportError;

  // Period navigation
  const navigatePeriod = (direction: "prev" | "next") => {
    if (direction === "prev") {
      if (selectedMonth === 1) {
        setSelectedMonth(12);
        setSelectedYear(selectedYear - 1);
      } else {
        setSelectedMonth(selectedMonth - 1);
      }
    } else {
      if (selectedMonth === 12) {
        setSelectedMonth(1);
        setSelectedYear(selectedYear + 1);
      } else {
        setSelectedMonth(selectedMonth + 1);
      }
    }
  };

  // Export handlers
  const handleExportPDF = async () => {
    if (!currentCompany) return;
    
    const exportData = {
      companyName: currentCompany.company_name,
      companyCnpj: companyDetails?.cnpj || undefined,
      period: `${getMonthName(selectedMonth)}/${selectedYear}`,
      entries: filteredEntries.map((e) => ({
        collaborator_name: e.collaborator?.name || "Sem colaborador",
        type: e.type,
        value: Number(e.value),
        description: e.description,
      })),
      totals: Object.entries(grandTotals.valuesByType).map(([type, total]) => ({ type, total })),
      grandTotal: grandTotals.net,
      storeSummary,
      logoUrl: companyDetails?.logo_url || undefined,
    };
    
    try {
      await exportToPDF(exportData);
      toast.success("PDF exportado com sucesso!");
    } catch {
      toast.error("Não foi possível exportar o PDF. Tente novamente.");
    }
  };

  const handleExportExcel = () => {
    if (!currentCompany) return;
    
    const exportData = {
      companyName: currentCompany.company_name,
      period: `${getMonthName(selectedMonth)}/${selectedYear}`,
      entries: filteredEntries.map((e) => ({
        collaborator_name: e.collaborator?.name || "Sem colaborador",
        type: e.type,
        value: Number(e.value),
        description: e.description,
      })),
      totals: Object.entries(grandTotals.valuesByType).map(([type, total]) => ({ type, total })),
      grandTotal: grandTotals.net,
      storeSummary,
    };
    
    exportToExcel(exportData);
    toast.success("Excel exportado com sucesso!");
  };

  const handleClosePeriod = async () => {
    await closePeriod.mutateAsync({ month: selectedMonth, year: selectedYear });
    setShowCloseDialog(false);
  };

  const handleReopenPeriod = async () => {
    await reopenPeriod.mutateAsync({ month: selectedMonth, year: selectedYear });
    setShowReopenDialog(false);
  };

   // Generate individual payslip for a collaborator
   const handleGeneratePayslip = async (collaboratorId: string) => {
     if (!currentCompany || !companyDetails) return;
 
     const collaboratorData = groupedData.get(collaboratorId);
     const collaboratorDetails = collaboratorsWithDetails.find(c => c.id === collaboratorId);
 
     if (!collaboratorData || !collaboratorDetails) {
       toast.error("Dados do colaborador não encontrados");
       return;
     }
 
     const payslipData = convertEntriesToPayslipData(
       collaboratorData.entries,
       {
         name: companyDetails.company_name,
         cnpj: companyDetails.cnpj,
         logoUrl: companyDetails.logo_url,
       },
       collaboratorDetails,
       selectedMonth,
       selectedYear
     );
 
     await generatePayslipPDF(payslipData);
     toast.success("Recibo gerado com sucesso!");
   };
 
  const periodLabel = `${getMonthName(selectedMonth)} de ${selectedYear}`;

  return (
    <PermissionGuard module="relatorios">
      <div className="min-w-0 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground">
              Visualize e exporte relatórios da folha de pagamento
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportExcel} disabled={exportDisabled}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Excel
            </Button>
            <Button variant="outline" onClick={handleExportPDF} disabled={exportDisabled}>
              <FileText className="w-4 h-4 mr-2" />
              PDF
            </Button>
            {canManage && (
              periodClosed ? (
                <Button variant="outline" onClick={() => setShowReopenDialog(true)}>
                  <LockOpen className="w-4 h-4 mr-2" />
                  Reabrir
                </Button>
              ) : (
                <Button onClick={() => setShowCloseDialog(true)} disabled={filteredEntries.length === 0}>
                  <Lock className="w-4 h-4 mr-2" />
                  Fechar Competência
                </Button>
              )
            )}
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* Period Navigation */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" aria-label="Competência anterior" onClick={() => navigatePeriod("prev")}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="min-w-[180px] text-center">
                  <span className="font-semibold">{periodLabel}</span>
                  {periodClosed && (
                    <Badge variant="destructive" className="ml-2">
                      <Lock className="w-3 h-3 mr-1" />
                      Fechado
                    </Badge>
                  )}
                </div>
                <Button variant="outline" size="icon" aria-label="Próxima competência" onClick={() => navigatePeriod("next")}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="h-8 w-px bg-border" />

              {/* Store Filter */}
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="w-[180px]" aria-label="Filtrar por PDV">
                  <SelectValue placeholder="Todos os PDVs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os PDVs</SelectItem>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.store_name}
                    </SelectItem>
                  ))}
                  <SelectItem value="without-store">Sem PDV</SelectItem>
                </SelectContent>
              </Select>

              {/* Collaborator Filter */}
              <Select value={collaboratorFilter} onValueChange={setCollaboratorFilter}>
                <SelectTrigger className="w-[200px]" aria-label="Filtrar por colaborador">
                  <SelectValue placeholder="Todos os colaboradores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os colaboradores</SelectItem>
                  {collaborators.map((collab) => (
                    <SelectItem key={collab.id} value={collab.id}>
                      {collab.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <StorePayrollSummaryTable
          summary={storeSummary}
          isLoading={reportLoading}
          isError={reportError}
          onRetry={() => { void refetchEntries(); void refetchStores(); }}
        />

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Proventos</p>
              <p className="mono text-xl font-bold text-success">{formatCurrency(grandTotals.earnings)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Descontos</p>
              <p className="mono text-xl font-bold text-destructive">{formatCurrency(grandTotals.deductions)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Líquido</p>
              <p className="mono text-xl font-bold text-foreground">{formatCurrency(grandTotals.net)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">FGTS</p>
              <p className="mono text-xl font-bold text-foreground">{formatCurrency(grandTotals.fgts)}</p>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <p className="text-sm text-primary font-medium">Custo Total Empresa</p>
              <p className="mono text-xl font-bold text-primary">{formatCurrency(grandTotals.companyCost)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Entries by Collaborator */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Extrato por Colaborador
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Carregando...</div>
            ) : groupedData.size === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="font-medium text-foreground mb-2">Nenhum lançamento encontrado</h3>
                <p className="text-muted-foreground text-sm">
                  Não há lançamentos para esta competência.
                </p>
              </div>
            ) : (
              <Accordion type="multiple" className="w-full">
                {Array.from(groupedData.entries()).map(([collabId, data]) => {
                  const collabTotals = calculatePayrollReportTotals(data.entries);
                  return (
                  <AccordionItem key={collabId} value={collabId}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <span className="font-medium">{data.collaborator.name}</span>
                        <div className="flex items-center gap-4">
                          <Badge variant="secondary">{data.entries.length} lançamentos</Badge>
                          <span className="font-bold text-primary">
                            Líq: {formatCurrency(collabTotals.net)}
                          </span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                       <div className="flex justify-end mb-4">
                         <Button
                           variant="outline"
                           size="sm"
                           onClick={() => handleGeneratePayslip(collabId)}
                         >
                           <Receipt className="w-4 h-4 mr-2" />
                           Gerar Recibo
                         </Button>
                       </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead>Fixo</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.entries.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <Badge variant="outline">{typeLabels[entry.type] || entry.type}</Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {entry.description || "-"}
                              </TableCell>
                              <TableCell>
                                {entry.is_fixed ? (
                                   <Badge variant="secondary">Fixo</Badge>
                                ) : (
                                  <Badge variant="secondary">Variável</Badge>
                                )}
                              </TableCell>
                              <TableCell className={`text-right font-medium ${
                                entry.type === "fgts"
                                  ? "text-muted-foreground"
                                  : isDeduction(entry.type)
                                  ? "text-destructive"
                                  : "text-success"
                              }`}>
                                {/* FGTS é custo da empresa — sem sinal de desconto */}
                                {entry.type === "fgts" ? "" : isDeduction(entry.type) ? "- " : "+ "}
                                {formatCurrency(entry.value)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell colSpan={3} className="text-right font-medium text-success">Proventos:</TableCell>
                            <TableCell className="mono text-right font-bold text-success">{formatCurrency(collabTotals.earnings)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell colSpan={3} className="text-right font-medium text-destructive">Descontos:</TableCell>
                            <TableCell className="mono text-right font-bold text-destructive">{formatCurrency(collabTotals.deductions)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell colSpan={3} className="text-right font-medium">Líquido:</TableCell>
                            <TableCell className="mono text-right font-bold text-primary">{formatCurrency(collabTotals.net)}</TableCell>
                          </TableRow>
                          {collabTotals.fgts > 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-right font-medium text-muted-foreground">FGTS (empresa):</TableCell>
                              <TableCell className="mono text-right font-bold text-muted-foreground">{formatCurrency(collabTotals.fgts)}</TableCell>
                            </TableRow>
                          )}
                        </TableFooter>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </CardContent>
        </Card>

        {/* Grand Total Card */}
        {groupedData.size > 0 && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-6">
              <h3 className="text-lg font-bold text-primary mb-4">Total Geral - {periodLabel}</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Colaboradores</p>
                  <p className="text-xl font-bold">{groupedData.size}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Proventos</p>
                  <p className="mono text-xl font-bold text-success">{formatCurrency(grandTotals.earnings)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Descontos</p>
                  <p className="mono text-xl font-bold text-destructive">{formatCurrency(grandTotals.deductions)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Líquido Total</p>
                  <p className="mono text-xl font-bold">{formatCurrency(grandTotals.net)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Custo Total Empresa</p>
                  <p className="mono text-xl font-bold text-primary">{formatCurrency(grandTotals.companyCost)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Close Period Dialog */}
        <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Fechar Competência</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja fechar a competência de <strong>{periodLabel}</strong>?
                <br /><br />
                Após o fechamento, não será possível adicionar, editar ou remover lançamentos
                desta competência.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleClosePeriod}>
                <Lock className="w-4 h-4 mr-2" />
                Fechar Competência
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reopen Period Dialog */}
        <AlertDialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reabrir Competência</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja reabrir a competência de <strong>{periodLabel}</strong>?
                <br /><br />
                Isso permitirá novamente a edição dos lançamentos desta competência.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleReopenPeriod}>
                <LockOpen className="w-4 h-4 mr-2" />
                Reabrir Competência
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PermissionGuard>
  );
};

export default RelatoriosPage;
