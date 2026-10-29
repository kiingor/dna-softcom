// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (request: Request) => Promise<Response>;
const BASE_URL = "https://bank.example.invalid";
const SHARED_SECRET = "test-gateway-secret-with-32-characters";
const STATEMENT_PATH = "/bank_account_information/v1/banks/90400888000142/statements/";
const RANGE = "?initial_date=2026-10-01&final_date=2026-10-29";

let handler: Handler;
let env: Record<string, string>;
let providerBody: Record<string, unknown>;
let providerStatus: number;
const httpClient = { close: vi.fn() };
const fetchMock = vi.fn<typeof fetch>();

function request(query = RANGE, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`http://gateway.example.invalid/account/statement${query}`, {
    headers: { Authorization: `Bearer ${SHARED_SECRET}`, ...extraHeaders },
  });
}

function providerCalls() {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/auth/oauth/v2/token"));
}

beforeEach(async () => {
  // Reinicia caches do gateway. Deno.serve não abre socket e fetch nunca usa rede.
  vi.resetModules();
  fetchMock.mockReset();
  env = {
    GW_SHARED_SECRET: SHARED_SECRET,
    SANTANDER_BASE_URL: BASE_URL,
    SANTANDER_CLIENT_ID: "env-client",
    SANTANDER_CLIENT_SECRET: "env-secret",
    SANTANDER_WORKSPACE_ID: "test-workspace",
    SANTANDER_DEBIT_BRANCH: "0001",
    SANTANDER_DEBIT_ACCOUNT: "000000123456",
    SANTANDER_CERT_NOT_AFTER: "2099-12-31",
  };
  providerStatus = 200;
  providerBody = {
    _content: [{
      transactionId: "synthetic-entry", transactionDate: "2026-10-29", type: "PIX",
      creditDebitType: "CREDITO", transactionName: "Entrada de teste", amount: "1234.56",
      transactionCurrency: "BRL", partieCnpjCpf: "00000000000",
    }],
    _pageable: { totalPages: "1", totalRecords: "1" },
  };
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => env[name] },
    createHttpClient: vi.fn(() => httpClient),
    statSync: vi.fn(() => ({ isFile: true })),
    readTextFileSync: vi.fn((path: string) => path.endsWith(".crt")
      ? "-----BEGIN CERTIFICATE-----\nTEST ONLY\n-----END CERTIFICATE-----"
      : "-----BEGIN PRIVATE KEY-----\nTEST ONLY\n-----END PRIVATE KEY-----"),
    stdout: { writeSync: vi.fn() },
    exit: vi.fn(() => { throw new Error("Gateway não deveria encerrar no teste"); }),
    serve: vi.fn((_options: unknown, serveHandler: Handler) => { handler = serveHandler; }),
  });
  fetchMock.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/auth/oauth/v2/token" && init?.method === "POST") {
      return Response.json({ access_token: "test-token", expires_in: 900 });
    }
    if (path.endsWith("/accounts")) {
      return Response.json({ _errorCode: "422", _message: "Erro na Consulta" }, { status: 422 });
    }
    if (path.startsWith(STATEMENT_PATH) && init?.method === "GET") {
      return Response.json(providerBody, { status: providerStatus });
    }
    throw new Error(`Requisição inesperada no mock: ${init?.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  await import("../../santander-gw/main.ts");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /account/statement — contrato de extrato Santander", () => {
  it("envia identificador da conta no path e datas/paginação na query, sem listar contas", async () => {
    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(providerCalls()).toHaveLength(1);
    const [url, init] = providerCalls()[0];
    const parsed = new URL(String(url));
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${BASE_URL}${STATEMENT_PATH}0001.000000123456`);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      initialDate: "2026-10-01", finalDate: "2026-10-29", _limit: "50", _offset: "1",
    });
    expect(init).toMatchObject({
      method: "GET", client: httpClient,
      headers: { authorization: "Bearer test-token", "X-Application-Key": "env-client" },
    });
    expect(fetchMock.mock.calls.some(([calledUrl]) => String(calledUrl).endsWith("/accounts"))).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ branch: "0001", account: "000000123456" });
  });

  it("mapeia _content preservando valores zero, numéricos e textuais", async () => {
    providerBody._content = [
      {
        transactionId: "zero", transactionDate: "2026-10-27", type: "PIX",
        creditDebitType: "CREDITO", transactionName: "Zero de teste", amount: 0,
        transactionCurrency: "BRL", partieCnpjCpf: "00000000000",
      },
      { transactionId: "debit", transactionDate: "2026-10-28", creditDebitType: "DEBITO", amount: -17.35 },
      { transactionId: "credit", transactionDate: "2026-10-29", creditDebitType: "CREDITO", amount: "1234.56" },
    ];
    const response = await handler(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toEqual([
      {
        transactionId: "zero", date: "2026-10-27", type: "PIX", creditDebit: "CREDITO",
        name: "Zero de teste", amount: "0", currency: "BRL", partyDocument: "00000000000",
      },
      {
        transactionId: "debit", date: "2026-10-28", type: null, creditDebit: "DEBITO",
        name: null, amount: "-17.35", currency: "BRL", partyDocument: null,
      },
      {
        transactionId: "credit", date: "2026-10-29", type: null, creditDebit: "CREDITO",
        name: null, amount: "1234.56", currency: "BRL", partyDocument: null,
      },
    ]);
  });

  it.each([
    { metadata: { totalPages: "13", totalRecords: "241" }, more: true },
    { metadata: { totalPages: "1", totalRecords: "1" }, more: false },
    { metadata: { totalRecords: "2" }, more: true },
    { metadata: { _moreElements: true }, more: true },
    { metadata: { _moreElements: false }, more: false },
  ])("repassa paginação $metadata para hasMore=$more", async ({ metadata, more }) => {
    providerBody._pageable = metadata;

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hasMore: more });
  });

  it("aceita período sem lançamentos quando o banco devolve _content vazio", async () => {
    providerBody._content = [];
    providerBody._pageable = { totalPages: "0", totalRecords: "0" };

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entries: [], hasMore: false });
  });

  it("mantém a recusa 422 do banco como erro, sem transformá-la em extrato vazio", async () => {
    providerStatus = 422;
    providerBody = {
      _errorCode: "422", _message: "Erro na Consulta",
      _errors: [{ _code: "422", _field: "Conta Corrente", _message: "Consulta recusada" }],
    };

    const response = await handler(request());

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ kind: "provider_rejected", provider_status: 422, indeterminate: false });
    expect(body).not.toHaveProperty("entries");
    expect(providerCalls()).toHaveLength(1);
  });

  it("preserva credenciais por request e normaliza sua conta para o identificador", async () => {
    const credentials = {
      client_id: "request-client", client_secret: "request-secret",
      base_url: "https://request-bank.example.invalid",
      debit_branch: "23", debit_account: "987654321",
    };

    const response = await handler(request(RANGE, {
      "X-Gw-Credentials": btoa(JSON.stringify(credentials)),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ branch: "0023", account: "000987654321" });
    const [url, init] = providerCalls()[0];
    expect(String(url).split("?")[0]).toBe(`${credentials.base_url}${STATEMENT_PATH}0023.000987654321`);
    expect(init?.headers).toMatchObject({ "X-Application-Key": "request-client" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${credentials.base_url}/auth/oauth/v2/token`);
  });

  it.each([
    "", "?initial_date=2026-10-01", "?initial_date=01/10/2026&final_date=2026-10-29",
    "?initial_date=2026-10-01&final_date=2026-10-xx",
  ])("recusa datas ausentes ou com formato inválido (%s) antes de fetch", async (query) => {
    const response = await handler(request(query));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ kind: "bad_request", indeterminate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer incorrect-secret"])("exige autenticação antes da consulta (%s)", async (authorization) => {
    const response = await handler(new Request(`http://gateway.example.invalid/account/statement${RANGE}`, {
      headers: authorization ? { authorization } : {},
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ kind: "unauthorized", indeterminate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
