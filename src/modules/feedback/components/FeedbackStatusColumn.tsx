import { cn } from "@/lib/utils";
import { ColaboradorFeedbackCard } from "./ColaboradorFeedbackCard";
import { FEEDBACK_STATUS_META, type FeedbackColaborador, type FeedbackStatus } from "../types";

export function FeedbackStatusColumn({
  status,
  colaboradores,
  onSelect,
  active,
  onStatusSelect,
}: {
  status: FeedbackStatus;
  colaboradores: FeedbackColaborador[];
  onSelect: (c: FeedbackColaborador) => void;
  active: boolean;
  onStatusSelect: (status: FeedbackStatus) => void;
}) {
  const meta = FEEDBACK_STATUS_META[status];

  return (
    <section aria-label={meta.label} className="flex flex-col min-w-[280px] flex-1 rounded-lg bg-muted/40 p-2">
      <h3 className="mb-1">
        <button
          type="button"
          onClick={() => onStatusSelect(status)}
          aria-pressed={active}
          aria-controls="feedback-kanban"
          className="flex w-full items-center justify-between rounded-md px-2 py-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", meta.dotClass)} />
            <span className={cn("text-xs font-semibold uppercase tracking-wide", meta.headerClass)}>
              {meta.label}
            </span>
          </span>
          <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", meta.countClass)}>
            {colaboradores.length}
          </span>
        </button>
      </h3>
      <p className="text-[11px] text-muted-foreground px-2 mb-2">{meta.description}</p>
      <div className="flex-1 space-y-2 overflow-y-auto min-h-[160px] max-h-[60vh] pr-1">
        {colaboradores.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">Ninguém por aqui</div>
        ) : (
          colaboradores.map((c) => (
            <ColaboradorFeedbackCard key={c.id} colaborador={c} onClick={() => onSelect(c)} />
          ))
        )}
      </div>
    </section>
  );
}
