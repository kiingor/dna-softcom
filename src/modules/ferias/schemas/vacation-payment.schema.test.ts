import { describe, expect, it } from "vitest";
import { vacationPaidValueSchema, vacationPaymentSchema } from "./vacation-payment.schema";

describe("valor pago nas férias", () => {
  it.each([
    ["1.234,56", 1234.56], ["1234,56", 1234.56], ["R$ 2.500,75", 2500.75],
    ["0,00", 0], ["3000", 3000], ["10,5", 10.5], ["9.999.999.999,99", 9999999999.99],
  ])("converte %s preservando os centavos", (input, expected) => {
    expect(vacationPaymentSchema.parse({ paidValue: input }).paidValue).toBe(expected);
  });

  it.each(["", " ", "-1,00", "1,234", "1.23,45", "1e3", "abc", "Infinity", "10.000.000.000,00"])(
    "rejeita o valor inválido %s", (paidValue) => {
      expect(vacationPaymentSchema.safeParse({ paidValue }).success).toBe(false);
    },
  );

  it.each([-1, NaN, Infinity, 1.001, 10000000000])("rejeita %s também na camada de gravação", (value) => {
    expect(vacationPaidValueSchema.safeParse(value).success).toBe(false);
  });
});
