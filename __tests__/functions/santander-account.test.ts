// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (request: Request) => Promise<Response>;
const BASE_URL = "https://bank.example.invalid";
const SHARED_SECRET = "test-gateway-secret-with-32-characters";
const BALANCE_PATH = "/bank_account_information/v1/banks/90400888000142/balances/";

let handler: Handler;
let env: Record<string, string>;
const httpClient = { close: vi.fn() };
const fetchMock = vi.fn<typeof fetch>();

function request(query = "", extraHeaders: Record<string, string> = {}): Request {
  return new Request(`http://gateway.example.invalid/account/balance${query}`, {
    headers: { Authorization: `Bearer ${SHARED_SECRET}`, ...extraHeaders },
  });
}

function providerCalls() {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/auth/oauth/v2/token"));
}

beforeEach(async () => {
  // Cada import inicia o gateway com cache de token/cliente vazio. Nenhum socket
  // é aberto: Deno.serve captura o handler e fetch nunca delega à rede real.
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
      // Reprodução do incidente: listar contas falha, mas saldo está habilitado.
      return Response.json({ _errorCode: "422", _message: "Erro na Consulta" }, { status: 422 });
    }
    if (path.startsWith(BALANCE_PATH) && init?.method === "GET") {
      return Response.json({
        availableAmount: "1234.56",
        blockedAmount: 0,
        automaticallyInvestedAmount: "0.00",
        availableAmountCurrency: "BRL",
      });
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

describe("GET /account/balance — conta pagadora configurada", () => {
  it("consulta saldo diretamente mesmo quando a listagem de contas recusaria a consulta", async () => {
    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: "1234.56", blocked: "0", invested: "0.00", currency: "BRL",
      branch: "0001", account: "000000123456",
    });
    expect(providerCalls()).toHaveLength(1);
    expect(providerCalls()[0]).toEqual([
      `${BASE_URL}${BALANCE_PATH}0001.000000123456`,
      expect.objectContaining({
        method: "GET", client: httpClient,
        headers: expect.objectContaining({ authorization: "Bearer test-token", "X-Application-Key": "env-client" }),
      }),
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/accounts"))).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("completa agência e conta com zeros sem acrescentar outro dígito verificador", async () => {
    env.SANTANDER_DEBIT_BRANCH = "1";
    env.SANTANDER_DEBIT_ACCOUNT = "123456";

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(providerCalls()[0][0]).toBe(`${BASE_URL}${BALANCE_PATH}0001.000000123456`);
  });

  it("usa credenciais e conta do header da request em vez do fallback do ambiente", async () => {
    const credentials = {
      client_id: "request-client", client_secret: "request-secret",
      base_url: "https://request-bank.example.invalid",
      debit_branch: "23", debit_account: "987654321",
    };
    const response = await handler(request("", {
      "X-Gw-Credentials": btoa(JSON.stringify(credentials)),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ branch: "0023", account: "000987654321" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${credentials.base_url}/auth/oauth/v2/token`);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get("client_id"))
      .toBe("request-client");
    expect(providerCalls()[0]).toEqual([
      `${credentials.base_url}${BALANCE_PATH}0023.000987654321`,
      expect.objectContaining({ headers: expect.objectContaining({ "X-Application-Key": "request-client" }) }),
    ]);
  });

  it.each([
    "?branch=12345", "?account=1234567890123", "?branch=abc",
    "?account=123-4", "?branch=", "?account=",
  ])("recusa formato inválido (%s) antes de qualquer chamada ao banco", async (query) => {
    const response = await handler(request(query));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ kind: "bad_request", indeterminate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer incorrect-secret"])("recusa autenticação ausente/incorreta (%s)", async (authorization) => {
    const response = await handler(new Request("http://gateway.example.invalid/account/balance", {
      headers: authorization ? { authorization } : {},
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ kind: "unauthorized", indeterminate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
