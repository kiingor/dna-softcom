import { format, isValid, parseISO } from "date-fns";
import type { OccupationalExam } from "@/hooks/useExams";
import { EXAM_TYPE_LABELS } from "./riskGroupDefaults";

// Nomes e ordem exigidos pelo modelo de Segurança do Trabalho.
export const EXAM_EXPORT_COLUMNS = [
  "NomeCompleto", "cnpj_cont", "exame", "funcao", "Setor", "cpf", "rg",
  "Sexo", "data_nasc", "data_prev", "ult_exame",
] as const;

export type ExamExportRow = Record<typeof EXAM_EXPORT_COLUMNS[number], string>;

export interface ExamExportData {
  companyName: string;
  companyCnpj?: string;
  logoUrl?: string;
  entries: ExamExportRow[];
}

const uppercase = (value?: string | null) => value?.trim().toLocaleUpperCase("pt-BR") || "";

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = parseISO(value);
  return isValid(date) ? format(date, "dd/MM/yyyy") : "";
};

const formatRg = (number?: string | null, issuer?: string | null) => {
  const rg = uppercase(number);
  const issuingAgency = uppercase(issuer);
  if (!rg || !issuingAgency || rg.endsWith(issuingAgency)) return rg;
  return `${rg} ${issuingAgency}`;
};

export function buildExamExportRows(
  exams: OccupationalExam[],
  history: OccupationalExam[] = exams,
): ExamExportRow[] {
  return exams.map((exam) => {
    const collaborator = exam.collaborator;
    // O histórico completo é independente dos filtros aplicados à exportação.
    // Para registros históricos, não usar exames realizados depois deles.
    const referenceDate = exam.completed_date || exam.due_date;
    const lastExamDate = history.reduce<string | null>((latest, previous) => {
      if (
        previous.id === exam.id ||
        previous.company_id !== exam.company_id ||
        previous.collaborator_id !== exam.collaborator_id ||
        previous.status !== "realizado" ||
        !previous.completed_date ||
        previous.completed_date > referenceDate
      ) return latest;
      return !latest || previous.completed_date > latest ? previous.completed_date : latest;
    }, null);

    return {
      NomeCompleto: uppercase(collaborator?.name),
      // O modelo usa o cabeçalho legado cnpj_cont para o nome da unidade.
      cnpj_cont: uppercase(collaborator?.contracted_store?.store_name || collaborator?.store?.store_name),
      exame: uppercase(EXAM_TYPE_LABELS[exam.exam_type] || exam.exam_type)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      funcao: uppercase(exam.position?.name || collaborator?.job_position?.name || collaborator?.position),
      Setor: uppercase(collaborator?.internal_location),
      cpf: collaborator?.cpf?.replace(/\D/g, "") || "",
      rg: formatRg(collaborator?.rg, collaborator?.rg_issuer),
      Sexo: uppercase(collaborator?.gender),
      data_nasc: formatDate(collaborator?.birth_date),
      data_prev: formatDate(exam.due_date),
      ult_exame: formatDate(lastExamDate),
    };
  });
}
