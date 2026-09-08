// Helpers da tela Feedback Colaborador.
import { addYears, isValid, parseISO } from "date-fns";
import type { TempoDeCasaFilter } from "./types";

/** O aniversário de um ano ainda pertence a "até um ano", sem deslocar o fuso. */
export function getTempoDeCasa(
  dataAdmissao: string | null | undefined,
  referenceDate = todayISO(),
): Exclude<TempoDeCasaFilter, "all"> | null {
  if (!dataAdmissao || !/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(dataAdmissao)) return null;

  const admissao = parseISO(dataAdmissao.slice(0, 10));
  const hoje = parseISO(referenceDate);
  if (!isValid(admissao) || !isValid(hoje) || admissao > hoje) return null;

  return hoje <= addYears(admissao, 1) ? "ate-um-ano" : "mais-de-um-ano";
}

/**
 * Formata uma data vinda da agenda pra exibição pt-BR, **sem shift de fuso**.
 * Aceita `YYYY-MM-DD` ou ISO com hora (`YYYY-MM-DDThh:mm:ssZ`) — em ambos os
 * casos usa só a parte da data tal como escrita (o legado guarda date-only
 * num campo datetime, então a data escrita é a verdade).
 */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Data de hoje em `YYYY-MM-DD` (local). */
export function todayISO(): string {
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${day}`;
}
