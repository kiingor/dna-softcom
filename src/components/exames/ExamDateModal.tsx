import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateFieldBR } from "@/components/ui/date-field-br";
import { useExams, type OccupationalExam } from "@/hooks/useExams";
import { getExamStatus } from "@/lib/examStatus";

type Mode = "realizar" | "agendar" | "limite";

const MODE_LABELS = {
  realizar: { title: "Realizar exame", label: "Data de realização", submit: "Confirmar realização" },
  agendar: { title: "Agendar exame", label: "Data agendada", submit: "Agendar" },
  limite: { title: "Alterar data limite", label: "Nova data limite", submit: "Salvar data limite" },
};

interface ExamDateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: OccupationalExam | null;
  mode: Mode;
}

const todayIso = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

export function ExamDateModal({ open, onOpenChange, exam, mode }: ExamDateModalProps) {
  const { updateExam, isUpdating } = useExams();
  const [date, setDate] = useState("");

  useEffect(() => {
    if (open) {
      setDate(
        mode === "realizar"
          ? exam?.completed_date ?? todayIso()
          : mode === "limite"
            ? exam?.due_date ?? ""
            : exam?.scheduled_date ?? "",
      );
    }
  }, [open, mode, exam]);

  const handleSave = () => {
    if (!exam || !date || isUpdating) return;
    if (mode === "realizar") {
      updateExam(
        { id: exam.id, status: "realizado", completed_date: date },
        { onSuccess: () => onOpenChange(false) },
      );
    } else if (mode === "agendar") {
      updateExam(
        { id: exam.id, status: "agendado", scheduled_date: date },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      updateExam(
        {
          id: exam.id,
          due_date: date,
          ...(exam.status === "vencido" && {
            status: getExamStatus({ ...exam, due_date: date }),
          }),
        },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  const { title, label, submit } = MODE_LABELS[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{exam?.collaborator?.name ?? "Informe a data do exame."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="exam-action-date">{label}</Label>
          <DateFieldBR id="exam-action-date" value={date} onChange={setDate} disabled={isUpdating} />
          {mode === "limite" && (
            <p className="text-xs text-muted-foreground pt-1">
              O vencimento será atualizado conforme a nova data limite.
            </p>
          )}
          {mode === "realizar" && (
            <p className="text-xs text-muted-foreground pt-1">
              O próximo exame periódico é criado automaticamente pela
              periodicidade do cargo.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isUpdating || !date}>
            {isUpdating ? "Salvando..." : submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
