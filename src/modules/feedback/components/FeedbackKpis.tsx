import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FeedbackStatusFilter, FeedbacksTotais } from "../types";

const TONE: Record<string, string> = {
  amber: "text-warning dark:text-warning",
  emerald: "text-success dark:text-success",
  rose: "text-destructive dark:text-destructive",
  default: "text-foreground",
};

export function FeedbackKpis({
  totais,
  statusFilter,
  onStatusSelect,
}: {
  totais: FeedbacksTotais;
  statusFilter: FeedbackStatusFilter;
  onStatusSelect: (status: FeedbackStatusFilter) => void;
}) {
  const items: Array<{
    label: string;
    value: number;
    hint: string;
    tone: keyof typeof TONE;
    status?: FeedbackStatusFilter;
  }> = [
    { label: "Colaboradores", value: totais.colaboradores, hint: "disponíveis para feedback", tone: "default", status: "all" },
    { label: "Pendentes", value: totais.pendente, hint: "sem feedback", tone: "amber", status: "Pendente" },
    { label: "Em atraso", value: totais.emAtraso, hint: "+ de 120 dias", tone: "rose", status: "Em Atraso" },
    { label: "Em dia", value: totais.emDia, hint: "≤ 120 dias", tone: "emerald", status: "Em dia" },
    { label: "Feedbacks", value: totais.feedbacks, hint: "no total", tone: "default" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {items.map((it) => {
        const content = (
          <>
            <span className="block text-xs text-muted-foreground uppercase tracking-wide">{it.label}</span>
            <span className={cn("block text-3xl font-light mt-1", TONE[it.tone])}>{it.value}</span>
            <span className="block text-xs text-muted-foreground mt-1">{it.hint}</span>
          </>
        );
        const active = it.status === statusFilter;
        return (
          <Card key={it.label} className={cn(active && "border-primary ring-1 ring-primary")}>
            {it.status ? (
              <button
                type="button"
                onClick={() => onStatusSelect(it.status!)}
                aria-pressed={active}
                aria-controls="feedback-kanban"
                className="w-full h-full rounded-lg p-5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {content}
              </button>
            ) : (
              <CardContent className="p-5">{content}</CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
