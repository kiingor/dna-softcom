import { Storefront } from "@phosphor-icons/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";
import { getPayrollReportTypeValue, type StorePayrollSummary } from "../lib/buildStorePayrollSummary";

interface Props {
  summary: StorePayrollSummary;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function StorePayrollSummaryTable({ summary, isLoading, isError, onRetry }: Props) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Storefront className="h-5 w-5" />
          Resumo por PDV e tipo de pagamento
        </CardTitle>
        <CardDescription>
          Valores da competência por PDV. Descontos aparecem com sinal negativo.
          O custo total corresponde aos proventos mais FGTS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">Carregando resumo por PDV...</p>
        ) : isError ? (
          <div role="alert" className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Não foi possível carregar o resumo por PDV.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>
          </div>
        ) : summary.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento encontrado para esta competência e os filtros selecionados.
          </p>
        ) : (
          <Table aria-label="Resumo da folha por PDV">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="sticky left-0 z-10 min-w-[180px] bg-card">PDV</TableHead>
                {summary.columns.map((column) => (
                  <TableHead key={column.type} scope="col" className="whitespace-nowrap px-3 text-right">{column.label}</TableHead>
                ))}
                <TableHead scope="col" className="whitespace-nowrap px-3 text-right">Líquido</TableHead>
                <TableHead scope="col" className="whitespace-nowrap px-3 text-right">Custo total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.map((row) => (
                <TableRow key={row.storeId ?? "without-store"}>
                  <TableHead scope="row" className="sticky left-0 z-10 bg-card text-sm font-medium normal-case tracking-normal text-foreground">
                    {row.storeName}
                  </TableHead>
                  {summary.columns.map((column) => {
                    const value = getPayrollReportTypeValue(row, column.type);
                    return (
                      <TableCell key={column.type} className={`mono whitespace-nowrap px-3 text-right ${value < 0 ? "text-destructive" : ""}`}>
                        {formatCurrency(value)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="mono whitespace-nowrap px-3 text-right font-semibold">{formatCurrency(row.net)}</TableCell>
                  <TableCell className="mono whitespace-nowrap px-3 text-right font-semibold">{formatCurrency(row.companyCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableHead scope="row" className="sticky left-0 z-10 bg-muted text-sm font-semibold normal-case tracking-normal text-foreground">Total geral</TableHead>
                {summary.columns.map((column) => (
                  <TableCell key={column.type} className="mono whitespace-nowrap px-3 text-right font-bold">
                    {formatCurrency(getPayrollReportTypeValue(summary.totals, column.type))}
                  </TableCell>
                ))}
                <TableCell className="mono whitespace-nowrap px-3 text-right font-bold">{formatCurrency(summary.totals.net)}</TableCell>
                <TableCell className="mono whitespace-nowrap px-3 text-right font-bold">{formatCurrency(summary.totals.companyCost)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
