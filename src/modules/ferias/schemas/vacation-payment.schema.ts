import { z } from "zod";

export const vacationPaidValueSchema = z.number()
  .finite()
  .min(0, "O valor pago não pode ser negativo.")
  .max(9999999999.99, "O valor informado é muito alto.")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001,
    "Informe no máximo duas casas decimais.");

// Formato pt-BR: aceita 1234,56 e 1.234,56, inclusive valores colados com R$.
export const vacationPaymentSchema = z.object({
  paidValue: z.string().trim().min(1, "Informe o valor pago.")
    .transform((value) => value.replace(/^R\$\s*/, ""))
    .pipe(z.string().regex(/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/,
      "Informe um valor válido, como 1.234,56."))
    .transform((value) => Number(value.replace(/\./g, "").replace(",", ".")))
    .pipe(vacationPaidValueSchema),
});
