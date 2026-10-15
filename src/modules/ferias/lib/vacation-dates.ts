import { addDays, format, isValid, parseISO } from "date-fns";

type VacationDate = string | Date | null | undefined;

const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/;

/** Legacy imports can contain dates such as 20236-01-31. Never format those. */
export function parseVacationDate(value: VacationDate): Date | null {
  if (!value) return null;
  if (typeof value === "string" && !ISO_DATE_PREFIX_RE.test(value.trim())) {
    return null;
  }
  const date = typeof value === "string" ? parseISO(value.trim()) : value;
  return isValid(date) ? date : null;
}

export function formatVacationDate(
  value: VacationDate,
  pattern = "dd/MM/yyyy",
): string {
  if (!value) return "—";
  const date = parseVacationDate(value);
  return date ? format(date, pattern) : "Data inválida";
}

/**
 * Normalizes a date value to `YYYY-MM-DD` for `<input type="date" />`.
 * Returns `""` when the value is absent or invalid (e.g. `20236-01-31`),
 * preventing half-sliced strings like `"20236-01-3"` from staying in form state.
 */
export function toVacationDateInputValue(value: VacationDate): string {
  const date = parseVacationDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
}

export function vacationConcessiveDeadline(period: {
  data_limite?: string | null;
  end_date: string;
}): Date | null {
  // An invalid official deadline needs correction; don't invent a replacement.
  if (period.data_limite) return parseVacationDate(period.data_limite);
  const end = parseVacationDate(period.end_date);
  return end ? parseVacationDate(addDays(end, 365)) : null;
}
