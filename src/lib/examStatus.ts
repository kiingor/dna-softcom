import { format } from "date-fns";

interface ExamStatusInput {
  status: string;
  due_date: string;
  scheduled_date: string | null;
}

export function isExamOpen(exam: Pick<ExamStatusInput, "status">): boolean {
  return ["pendente", "agendado", "vencido"].includes(exam.status);
}

export function getExamStatus(
  exam: ExamStatusInput,
  today = format(new Date(), "yyyy-MM-dd"),
): string {
  if (!isExamOpen(exam)) return exam.status;

  // Datas ISO sem horário: o exame só vence no dia seguinte à data limite.
  if (exam.due_date < today) return "vencido";
  if (exam.status === "vencido") {
    return exam.scheduled_date ? "agendado" : "pendente";
  }
  return exam.status;
}
