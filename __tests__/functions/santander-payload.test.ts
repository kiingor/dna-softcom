import { afterAll, describe, expect, it, vi } from "vitest";
import {
  buildPaymentPayload,
  type DictCodeType,
  type GwConfig,
  type PixTransferInput,
} from "../../santander-gw/santander.ts";

// O módulo detecta createHttpClient no carregamento; o builder é puro.
vi.hoisted(() => vi.stubGlobal("Deno", {}));
afterAll(() => vi.unstubAllGlobals());

// Dados sintéticos; nenhum teste acessa o banco ou o Santander.
const config: GwConfig = {
  baseUrl: "https://trust-sandbox.api.santander.com.br",
  receiptsBaseUrl: "https://trust-open-h.api.santander.com.br",
  clientId: "test-client",
  clientSecret: "test-secret",
  workspaceId: "test-workspace",
  debitBranch: "0001",
  debitAccount: "123456789",
  environment: "sandbox",
};
const input: PixTransferInput = {
  idempotencyKey: "sh-0123456789abcdef0123456789abcdef-1",
  amount: "1234.56",
  dictCode: "teste@example.invalid",
  dictCodeType: "EMAIL",
  payeeName: "Pessoa de Teste",
  description: "Salário 10/2026",
  payer: { documentNumber: "00000000000000", documentType: "CNPJ", name: "Empresa de Teste" },
};

describe("contrato Santander — criação de PIX por chave DICT", () => {
  it("envia apenas campos aceitos pelo POST, mesmo recebendo o snapshot do pagador", () => {
    expect(buildPaymentPayload(config, input)).toEqual({
      debitAccount: { branch: "0001", number: "123456789" },
      tags: ["sh-0123456789abcdef0"],
      dictCodeType: "EMAIL",
      dictCode: "teste@example.invalid",
      remittanceInformation: `Salário 10/2026 ${input.idempotencyKey}`,
      paymentValue: "1234.56",
    });
  });

  it("preserva a conta específica da transferência e os centavos do valor", () => {
    const payload = buildPaymentPayload(config, {
      ...input,
      amount: "9999999999.99",
      debitAccount: { branch: "0002", number: "987654321" },
    });
    expect(payload.debitAccount).toEqual({ branch: "0002", number: "987654321" });
    expect(payload.paymentValue).toBe("9999999999.99");
  });

  it.each<[DictCodeType, string]>([
    ["CPF", "CPF"], ["CNPJ", "CNPJ"], ["EMAIL", "EMAIL"],
    ["PHONE", "CELULAR"], ["EVP", "EVP"],
  ])("traduz o tipo %s para %s", (internal, provider) => {
    expect(buildPaymentPayload(config, { ...input, dictCodeType: internal }).dictCodeType)
      .toBe(provider);
  });

  it("limita a informação a 138 caracteres sem perder a chave de reconciliação", () => {
    const key = "a".repeat(80); // máximo aceito pelo gateway
    const payload = buildPaymentPayload(config, {
      ...input, idempotencyKey: key, description: "Descrição longa ".repeat(20),
    });
    expect(String(payload.remittanceInformation)).toHaveLength(138);
    expect(String(payload.remittanceInformation).endsWith(` ${key}`)).toBe(true);
    expect(payload.tags).toEqual(["a".repeat(20)]);
  });

  it("mantém a chave inteira quando não há descrição", () => {
    expect(buildPaymentPayload(config, { ...input, description: null }).remittanceInformation)
      .toBe(input.idempotencyKey);
  });
});
