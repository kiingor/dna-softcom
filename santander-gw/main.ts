// santander-gw — terminador mTLS do PIX da folha.
//
// É o ÚNICO processo do sistema que enxerga a chave privada do e-CNPJ e o único
// que fala com o Santander. Roda em rede docker interna dedicada (bank_net),
// sem Traefik, sem porta publicada: quem alcança este serviço já está dentro.
// A justificativa completa está na ADR 0006 (docs/adr/0006-pagamento-pix-santander.md).
//
// A API É ESTREITA DE PROPÓSITO, NUNCA PASS-THROUGH
// Um proxy genérico com certificado de e-CNPJ é uma chave do cofre com um bilhete
// dizendo "faça o que quiser". Aqui existem quatro operações, cada uma com corpo
// validado campo a campo, e o payload que vai pro banco é montado por NÓS — nada
// do que o chamador manda atravessa sem passar por validação.
//
//   POST   /pix/transfer              cria o pagamento (READY_TO_PAY, NÃO move dinheiro)
//   PATCH  /pix/transfer/{id}/confirm confirma (é aqui que o dinheiro anda)
//   GET    /pix/transfer/{id}         consulta (reconciliação)
//   GET    /pix/search?idempotency_key=…  acha o pagamento quando o id se perdeu
//   GET    /health                    liveness + vencimento do certificado
//
// COMO O CHAMADOR DEVE LER OS ERROS
// Todo erro sai com `indeterminate`, e é ELE que decide o que gravar no banco:
//   indeterminate=false → recusa provada, nada saiu  → payroll_pix_fail
//   indeterminate=true  → não sabemos onde parou     → payroll_pix_mark_unknown
// Nunca reenvie um POST/PATCH automaticamente por causa de erro indeterminado:
// se a primeira tentativa tinha vingado, a segunda paga o colaborador duas vezes
// e PIX não tem estorno unilateral. O estado 'unknown' existe exatamente pra
// devolver essa decisão pra uma pessoa.

import { log, maskDoc } from "./mask.ts";
import {
  CERT_EXPIRY_WARN_DAYS,
  certDaysLeft,
  certPaths,
  confirmPayment,
  createPayment,
  createWorkspace,
  deleteWorkspace,
  DICT_CODE_TYPES,
  type DictCodeType,
  createReceiptFileRequest,
  DISABLED_STATUS,
  getBalance,
  getPayment,
  getReceiptFileRequest,
  getStatement,
  type GwConfig,
  type GwCredsInput,
  hasHttpClientSupport,
  isPixPaymentsDisabled,
  listAccounts,
  listReceipts,
  listWorkspaces,
  patchWorkspace,
  type PixDocument,
  readConfig,
  SantanderError,
  searchByIdempotencyKey,
} from "./santander.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8080");
/**
 * IPv4 explícito: o healthcheck do Dockerfile bate em 127.0.0.1 justamente
 * porque `localhost` resolve pra ::1 no /etc/hosts da imagem — a pegadinha que
 * já derrubou o healthcheck do frontend (ver Dockerfile da raiz).
 *
 * A variável se chama HOSTNAME_BIND, e não HOSTNAME, porque o Docker já define
 * HOSTNAME com o id do container: ler aquela faria o servidor tentar escutar
 * num hostname aleatório e o container subiria sem atender ninguém.
 */
const HOSTNAME = Deno.env.get("HOSTNAME_BIND") ?? "0.0.0.0";

/** Corpo maior que isso não é pagamento, é abuso. Nenhuma request legítima
 *  daqui passa de 2 KB. */
const MAX_BODY_BYTES = 16 * 1024;

/** Segredo curto é segredo adivinhável, e este é o único portão do serviço. */
const MIN_SECRET_LENGTH = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Autenticação
// ─────────────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Comparação em tempo constante.
 *
 * Compara os SHA-256, não as strings: além de eliminar o early-return do `===`,
 * o digest tem tamanho fixo, então o tempo não vaza nem o COMPRIMENTO do
 * segredo. Comparar strings de tamanhos diferentes num loop ingênuo entregaria
 * essa informação de graça.
 */
async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const expected = (Deno.env.get("GW_SHARED_SECRET") ?? "").trim();
  // Sem segredo configurado NADA é autorizado. O boot já recusa subir nesse
  // estado; este segundo teste existe pro caso de a variável sumir em runtime.
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return await constantTimeEquals(header.slice(prefix.length).trim(), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação de entrada
// ─────────────────────────────────────────────────────────────────────────────

class BadRequest extends Error {}

/**
 * decodeURIComponent que não explode em 500.
 *
 * Um `%` solto ou escape inválido (`%GG`) no path faz o decodeURIComponent
 * lançar URIError — que, fora de BadRequest/SantanderError, virava um 500
 * `indeterminate: true` (semanticamente errado: nada foi enviado ao banco, e é
 * rota de leitura). Aqui vira o mesmo 400 `bad_request` que a validação de
 * formato daria.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new BadRequest("identificador na URL com codificação inválida");
  }
}

function requireString(
  body: Record<string, unknown>,
  field: string,
  opts: { max: number; pattern?: RegExp },
): string {
  const raw = body[field];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new BadRequest(`campo obrigatório ausente ou vazio: ${field}`);
  }
  const value = raw.trim();
  if (value.length > opts.max) {
    throw new BadRequest(`campo ${field} passa de ${opts.max} caracteres`);
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    throw new BadRequest(`campo ${field} tem formato inválido`);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new BadRequest(`campo ${field} precisa ser texto`);
  return raw.trim().slice(0, max);
}

/**
 * Valor em string "1234.56", SEM passar por float.
 *
 * O valor nasce de numeric(12,2) no Postgres e o Santander quer string. Se o
 * chamador manda string, ela é só normalizada no dígito — converter pra Number e
 * voltar é exatamente onde centavo se perde, e centavo perdido em folha é
 * divergência de conciliação que alguém vai caçar no mês seguinte.
 */
function normalizeAmount(raw: unknown): string {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) throw new BadRequest("amount precisa ser > 0");
    // Aceito por conveniência, mas o chamador deve mandar string.
    text = raw.toFixed(2);
  } else if (typeof raw === "string") {
    text = raw.trim().replace(",", ".");
  } else {
    throw new BadRequest("campo obrigatório ausente: amount");
  }

  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new BadRequest("amount precisa ser um valor positivo com até 2 casas");
  const cents = (match[2] ?? "").padEnd(2, "0");
  if (match[1] === "0" && cents === "00") throw new BadRequest("amount precisa ser > 0");
  return `${match[1]}.${cents}`;
}

/** Nosso enum é minúsculo (public.pix_key_type); o dictCodeType do Santander é
 *  MAIÚSCULO. A conversão é upper() e a validação é contra a lista fechada — um
 *  tipo desconhecido faz o banco recusar o pagamento inteiro. */
function toDictCodeType(raw: unknown): DictCodeType {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!DICT_CODE_TYPES.has(value)) {
    throw new BadRequest(
      `pix_key_type inválido (esperado cpf|cnpj|email|phone|evp): ${value || "vazio"}`,
    );
  }
  return value as DictCodeType;
}

/** Pagador opcional por request — o sistema é multi-CNPJ e cada empresa paga com
 *  o próprio documento. O par de env só cobre smoke test de empresa única. */
function parsePayer(raw: unknown): PixDocument | null {
  const fallbackDoc = (Deno.env.get("SANTANDER_PAYER_DOCUMENT") ?? "").replace(/\D+/g, "");
  const fallbackName = (Deno.env.get("SANTANDER_PAYER_NAME") ?? "").trim();

  if (raw === undefined || raw === null) {
    if (!fallbackDoc || !fallbackName) return null;
    return {
      documentNumber: fallbackDoc,
      documentType: fallbackDoc.length === 11 ? "CPF" : "CNPJ",
      name: fallbackName,
    };
  }
  if (typeof raw !== "object") throw new BadRequest("payer precisa ser objeto");

  const p = raw as Record<string, unknown>;
  const doc = String(p.documentNumber ?? "").replace(/\D+/g, "");
  const name = String(p.name ?? "").trim();
  if (!doc || !name) throw new BadRequest("payer precisa de documentNumber e name");
  if (doc.length !== 11 && doc.length !== 14) {
    throw new BadRequest("payer.documentNumber precisa ter 11 (CPF) ou 14 (CNPJ) dígitos");
  }
  return {
    documentNumber: doc,
    documentType: doc.length === 11 ? "CPF" : "CNPJ",
    name: name.slice(0, 120),
  };
}

function parseDebitAccount(raw: unknown): { branch: string; number: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") throw new BadRequest("debit_account precisa ser objeto");
  const d = raw as Record<string, unknown>;
  const branch = String(d.branch ?? "").trim();
  const number = String(d.number ?? "").trim();
  if (!/^\d{1,6}$/.test(branch) || !/^\d{1,20}$/.test(number)) {
    throw new BadRequest("debit_account.branch/number precisam ser numéricos");
  }
  return { branch, number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resposta
// ─────────────────────────────────────────────────────────────────────────────

function json(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
      // Não é browser que chama isto, mas cabeçalho barato é cabeçalho barato.
      "cache-control": "no-store",
    },
  });
}

function errorResponse(err: unknown, requestId: string, context: Record<string, unknown>): Response {
  if (err instanceof BadRequest) {
    // Recusa nossa: a request nunca saiu do container.
    log("warn", "request.bad_request", { request_id: requestId, reason: err.message, ...context });
    return json(400, {
      error: err.message,
      kind: "bad_request",
      indeterminate: false,
    }, requestId);
  }

  if (err instanceof SantanderError) {
    log(err.indeterminate ? "error" : "warn", "provider.error", {
      request_id: requestId,
      kind: err.kind,
      gw_status: err.status,
      provider_status: err.providerStatus,
      indeterminate: err.indeterminate,
      // baseMessage, não message: o corpo de erro do provedor ecoa o que
      // mandamos (inclusive a chave PIX) e não pode cair no docker logs.
      message: err.baseMessage,
      ...context,
    });
    return json(err.status, {
      error: err.message,
      kind: err.kind,
      provider_status: err.providerStatus ?? null,
      provider_body: err.providerBody ?? null,
      // O campo que o chamador precisa ler antes de decidir failed vs unknown.
      indeterminate: err.indeterminate,
    }, requestId);
  }

  // Bug nosso. Assumimos o pior: se estourou depois do fetch, pode ter saído.
  log("error", "request.unhandled", {
    request_id: requestId,
    message: (err as Error)?.message ?? String(err),
    ...context,
  });
  return json(500, {
    error: "Erro interno do gateway",
    kind: "internal",
    indeterminate: true,
  }, requestId);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  // Content-Length ANTES de ler: recusar depois de bufferizar 1 GB não protege
  // memória nenhuma. O segundo teste cobre quem não manda o header.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BadRequest("corpo grande demais");
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequest("corpo grande demais");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadRequest("corpo precisa ser um objeto JSON");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadRequest) throw err;
    throw new BadRequest("corpo não é JSON válido");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotas
// ─────────────────────────────────────────────────────────────────────────────

/** A chave viaja em `tags` e é por ela que a busca acha o pagamento perdido.
 *  Vírgula, espaço ou acento aqui tornariam o casamento ambíguo — melhor
 *  recusar a chave do que devolver um match errado sobre dinheiro. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

/**
 * Normaliza o corpo do POST para os nomes canônicos.
 *
 * O contrato canônico é o do README (`pix_key`, `payee_name`, `description`),
 * mas a edge function payroll-pix-pay manda o corpo com os nomes do PROVEDOR
 * (`dict_code`, `remittance_information`, `payee: {name, document}`). Aceitar os
 * dois aqui custa vinte linhas; deixar o gateway recusar o único cliente que ele
 * tem custaria a folha inteira. O gateway é o lado estável da integração — é
 * dele o trabalho de tolerar o apelido.
 *
 * Tolerância é só de NOME: todo valor continua passando pela mesma validação.
 * `tags` mandada pelo chamador é IGNORADA de propósito — quem monta tags é o
 * gateway, a partir da idempotency_key. Aceitar tag arbitrária seria abrir uma
 * fresta de pass-through justamente no campo que a reconciliação usa como prova.
 */
function canonicalizeCreateBody(body: Record<string, unknown>): Record<string, unknown> {
  const payee = (body.payee && typeof body.payee === "object" && !Array.isArray(body.payee))
    ? body.payee as Record<string, unknown>
    : {};

  return {
    ...body,
    pix_key: body.pix_key ?? body.dict_code,
    pix_key_type: body.pix_key_type ?? body.dict_code_type,
    payee_name: body.payee_name ?? payee.name,
    payee_document: body.payee_document ?? payee.document,
    description: body.description ?? body.remittance_information,
  };
}

/**
 * Se o chamador declarou o ambiente, ele TEM que bater com o host configurado.
 *
 * O banco grava `environment` na tentativa e é por ele que se distingue
 * "ensaiei" de "paguei". Um gateway apontado pro sandbox recebendo uma
 * tentativa marcada como 'production' (ou o contrário, muito pior) é
 * configuração errada em algum dos dois lados — e o momento de descobrir isso é
 * ANTES de mandar, não na conciliação do mês seguinte.
 */
function assertEnvironmentMatches(body: Record<string, unknown>, cfg: GwConfig): void {
  const declared = String(body.environment ?? "").trim().toLowerCase();
  if (!declared) return;
  if (declared !== cfg.environment) {
    throw new BadRequest(
      `ambiente divergente: o chamador pediu '${declared}' e as credenciais usadas apontam pra '${cfg.environment}'`,
    );
  }
}

/**
 * Credenciais vindas do edge no header X-Gw-Credentials (base64 JSON), decifradas
 * lá a partir de pix_gateway_credentials. Ausente/inválido → null, e o
 * readConfig cai no fallback do env (o que segura o sandbox durante a virada).
 *
 * O header NUNCA é logado (o log de request leva método/path/duração, não
 * headers), então o client_secret não vaza pro docker logs.
 */
function parseGwCredentials(req: Request): GwCredsInput | null {
  const raw = req.headers.get("x-gw-credentials");
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw.trim())));
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object") return null;
    return obj as GwCredsInput;
  } catch {
    // Header malformado não vira 500: só ignora e cai no env. Se as credenciais
    // do env também faltarem, o readConfig lança config (424, pré-voo).
    return null;
  }
}

async function handleCreate(req: Request, cfg: GwConfig, requestId: string): Promise<Response> {
  // Kill-switch lido AQUI, por request: desligar pagamento não pode depender de
  // redeploy nem de rebuild de imagem.
  if (isPixPaymentsDisabled()) {
    log("warn", "pix.create.blocked", { request_id: requestId, reason: "kill-switch" });
    // 423 e não 503: ver o comentário da invariante em KIND_HTTP_STATUS. Um 5xx
    // aqui faria o chamador marcar 'unknown' uma folha inteira por causa de um
    // desligamento deliberado, em que nada saiu.
    return json(DISABLED_STATUS, {
      error: "Pagamentos PIX estão desligados (PIX_PAYMENTS_DISABLED)",
      kind: "disabled",
      // Nada foi enviado: o chamador pode marcar failed com segurança.
      indeterminate: false,
    }, requestId);
  }

  const body = canonicalizeCreateBody(await readJsonBody(req));
  assertEnvironmentMatches(body, cfg);

  const idempotencyKey = requireString(body, "idempotency_key", {
    max: 80,
    pattern: IDEMPOTENCY_KEY_PATTERN,
  });
  const amount = normalizeAmount(body.amount);
  const dictCodeType = toDictCodeType(body.pix_key_type);
  const dictCode = requireString(body, "pix_key", { max: 140 });
  const payeeName = requireString(body, "payee_name", { max: 120 });
  const payeeDocument = optionalString(body, "payee_document", 20);
  const description = optionalString(body, "description", 140);

  const view = await createPayment(cfg, {
    idempotencyKey,
    amount,
    dictCode,
    dictCodeType,
    payeeName,
    payeeDocument,
    description,
    payer: parsePayer(body.payer),
    debitAccount: parseDebitAccount(body.debit_account),
  });

  return json(200, {
    provider_payment_id: view.provider_payment_id,
    // Label CRU do provedor (READY_TO_PAY). Traduzir pro nosso enum é do
    // chamador: 'sent' significa "POST aceito", não "pago".
    status: view.status,
    end_to_end_id: view.end_to_end_id,
    transaction_code: view.transaction_code,
    idempotency_key: idempotencyKey,
    // Volta inteiro pra virar response_payload em payroll_pix_transfers: quando
    // o suporte do banco perguntar, é isto que responde.
    raw: view.raw,
  }, requestId);
}

async function handleConfirm(req: Request, cfg: GwConfig, paymentId: string, requestId: string): Promise<Response> {
  if (isPixPaymentsDisabled()) {
    log("warn", "pix.confirm.blocked", { request_id: requestId, provider_payment_id: paymentId });
    return json(DISABLED_STATUS, {
      error: "Pagamentos PIX estão desligados (PIX_PAYMENTS_DISABLED)",
      kind: "disabled",
      indeterminate: false,
    }, requestId);
  }

  const body = await readJsonBody(req);
  const status = optionalString(body, "status", 40);
  // Ausente e nulo são a mesma coisa aqui: o paymentValue do PATCH é opcional, e
  // um `"amount": null` vindo de um JSON gerado por código não pode virar erro.
  const amount = body.amount === undefined || body.amount === null
    ? undefined
    : normalizeAmount(body.amount);

  const view = await confirmPayment(cfg, paymentId, {
    status: status ?? undefined,
    amount,
  });

  return json(200, {
    provider_payment_id: view.provider_payment_id ?? paymentId,
    status: view.status,
    end_to_end_id: view.end_to_end_id,
    transaction_code: view.transaction_code,
    raw: view.raw,
  }, requestId);
}

async function handleGet(cfg: GwConfig, paymentId: string, requestId: string): Promise<Response> {
  // Sem kill-switch: consultar nunca move dinheiro, e é justamente quando os
  // pagamentos estão desligados que mais se precisa saber o que já saiu.
  const view = await getPayment(cfg, paymentId);
  return json(200, {
    provider_payment_id: view.provider_payment_id ?? paymentId,
    status: view.status,
    end_to_end_id: view.end_to_end_id,
    transaction_code: view.transaction_code,
    tags: view.tags,
    raw: view.raw,
  }, requestId);
}

async function handleSearch(url: URL, cfg: GwConfig, requestId: string): Promise<Response> {
  const key = (url.searchParams.get("idempotency_key") ?? "").trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new BadRequest("idempotency_key ausente ou com formato inválido");
  }

  const { matches, scanned } = await searchByIdempotencyKey(cfg, key);
  return json(200, {
    idempotency_key: key,
    scanned,
    count: matches.length,
    matches,
    // Mesmo array sob `results`: o extrator da payroll-pix-reconcile procura por
    // results/items/payments/data/content e não conhece `matches` — sem este
    // apelido a busca voltaria sempre vazia, e uma busca que "não achou" é lida
    // como inconclusiva, deixando a transferência presa em 'unknown' pra sempre.
    // O apelido custa bytes; o alinhamento de nome custaria um deploy dos dois
    // lados no mesmo instante.
    results: matches,
    // Aviso no corpo, não só na doc: quem estiver resolvendo um 'unknown' às
    // duas da manhã precisa saber que sandbox é MOCK — duas chamadas devolvem
    // ids diferentes e ele não guarda estado. Aqui não se prova reconciliação.
    warning: cfg.environment === "sandbox"
      ? "Ambiente sandbox é mock: resultado prova transporte, nunca reconciliação"
      : null,
  }, requestId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Saldo e extrato (Bank Account Information) — SÓ LEITURA
//
// Sem kill-switch (consultar não move dinheiro) e sem `environment` a bater: são
// GET. A conta pagadora configurada é o default; a query pode sobrescrever
// agência/conta pra testar o formato certo (o saldo quer `agência.conta`, o
// extrato quer o número COM dígito — descobre-se com /account/accounts) sem
// redeploy.
// ─────────────────────────────────────────────────────────────────────────────

const BRANCH_PATTERN = /^\d{1,4}$/;
const ACCOUNT_PATTERN = /^\d{1,12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function resolveBranchAccount(url: URL, cfg: GwConfig): { branch: string; account: string } {
  // Consulta diretamente a conta pagadora configurada. GET /accounts é uma
  // operação independente: pode falhar mesmo quando GET /balances funciona.
  // Nunca escolher accounts[0], que pode ser outra conta do mesmo titular.
  const branch = (url.searchParams.get("branch") ?? cfg.debitBranch).trim();
  const account = (url.searchParams.get("account") ?? cfg.debitAccount).trim();
  if (!BRANCH_PATTERN.test(branch) || !ACCOUNT_PATTERN.test(account)) {
    throw new BadRequest("branch/account precisam ser numéricos (agência até 4, conta com dígito até 12 dígitos)");
  }
  // O contrato bank_account_information usa agência4.conta12. O dígito já
  // integra a conta configurada; completar zeros, sem acrescentar outro dígito.
  return { branch: branch.padStart(4, "0"), account: account.padStart(12, "0") };
}

async function handleAccounts(cfg: GwConfig, requestId: string): Promise<Response> {
  const view = await listAccounts(cfg);
  return json(200, view, requestId);
}

async function handleWorkspaces(cfg: GwConfig, requestId: string): Promise<Response> {
  const view = await listWorkspaces(cfg);
  return json(200, view, requestId);
}

// Cria um workspace (type=PAYMENTS liga o PIX). NÃO tem kill-switch: não move
// dinheiro, só registra a configuração no banco. Body:
//   { type?, mainDebitAccount: { branch, number }, description? }
async function handleCreateWorkspace(req: Request, cfg: GwConfig, requestId: string): Promise<Response> {
  const body = await readJsonBody(req);
  const type = (optionalString(body, "type", 40) ?? "PAYMENTS").toUpperCase();
  const main = parseDebitAccount(body.mainDebitAccount ?? body.main_debit_account);
  if (!main) {
    throw new BadRequest("mainDebitAccount { branch, number } (numéricos) é obrigatório");
  }
  const description = optionalString(body, "description", 120) ?? undefined;
  const view = await createWorkspace(cfg, { type, mainDebitAccount: main, description });
  return json(201, view, requestId);
}

async function handleDeleteWorkspace(cfg: GwConfig, workspaceId: string, requestId: string): Promise<Response> {
  const { status } = await deleteWorkspace(cfg, workspaceId);
  return json(200, { ok: true, provider_status: status }, requestId);
}

// PATCH de workspace — usado pra tentar LIGAR o PIX (pixPaymentsActive). Aceita
// só os campos conhecidos; nada de pass-through. Body:
//   { type?, mainDebitAccount?, pixPaymentsActive?, description? }
async function handlePatchWorkspace(req: Request, cfg: GwConfig, workspaceId: string, requestId: string): Promise<Response> {
  const body = await readJsonBody(req);
  const patch: Record<string, unknown> = {};
  const type = optionalString(body, "type", 40);
  if (type) patch.type = type.toUpperCase();
  const rawMain = body.mainDebitAccount ?? body.main_debit_account;
  if (rawMain !== undefined && rawMain !== null) {
    const acc = parseDebitAccount(rawMain);
    if (acc) patch.mainDebitAccount = acc;
  }
  if (body.pixPaymentsActive !== undefined) {
    patch.pixPaymentsActive = body.pixPaymentsActive === true;
  }
  const description = optionalString(body, "description", 120);
  if (description) patch.description = description;
  if (Object.keys(patch).length === 0) {
    throw new BadRequest("nada pra atualizar no workspace");
  }
  const view = await patchWorkspace(cfg, workspaceId, patch);
  return json(200, view, requestId);
}

async function handleBalance(url: URL, cfg: GwConfig, requestId: string): Promise<Response> {
  const { branch, account } = resolveBranchAccount(url, cfg);
  // balance_id da conta Santander é `agência.conta` (ADR 0006 / doc do banco).
  const view = await getBalance(cfg, `${branch}.${account}`);
  return json(200, { ...view, branch, account }, requestId);
}

async function handleStatement(url: URL, cfg: GwConfig, requestId: string): Promise<Response> {
  const { branch, account } = resolveBranchAccount(url, cfg);
  const initialDate = (url.searchParams.get("initial_date") ?? "").trim();
  const finalDate = (url.searchParams.get("final_date") ?? "").trim();
  if (!DATE_PATTERN.test(initialDate) || !DATE_PATTERN.test(finalDate)) {
    throw new BadRequest("initial_date/final_date obrigatórios no formato YYYY-MM-DD");
  }
  const view = await getStatement(cfg, {
    branchCode: branch,
    accountNumber: account,
    initialDate,
    finalDate,
  });
  return json(200, { ...view, branch, account }, requestId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprovante (Consult Payment Receipts) — SÓ LEITURA / reemissão
//
// Fluxo em 3 chamadas, orquestrado pela edge (que tem a data/valor/beneficiário
// da transferência): lista → cria pedido de arquivo → consulta até AVAILABLE.
// O gateway só expõe as três primitivas, validadas; a lógica de casar o
// comprovante com a NOSSA transferência fica na edge.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DOCUMENT_PATTERN = /^\d{11}$|^\d{14}$/;
// paymentId do banco (ex: BGZC6H2023-03-0116255385) e requestId (uuid): caracteres
// seguros só, pra não deixar nada escapar pra dentro do path da URL do provedor.
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

async function handleReceiptsList(url: URL, cfg: GwConfig, requestId: string): Promise<Response> {
  const startDate = (url.searchParams.get("start_date") ?? "").trim();
  const endDate = (url.searchParams.get("end_date") ?? "").trim();
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    throw new BadRequest("start_date/end_date obrigatórios no formato YYYY-MM-DD");
  }
  const category = (url.searchParams.get("category") ?? "").trim() || null;
  const beneficiaryDocument = (url.searchParams.get("beneficiary_document") ?? "")
    .replace(/\D+/g, "") || null;
  if (beneficiaryDocument && !DOCUMENT_PATTERN.test(beneficiaryDocument)) {
    throw new BadRequest("beneficiary_document precisa ter 11 (CPF) ou 14 (CNPJ) dígitos");
  }
  const accountAgency = (url.searchParams.get("account_agency") ?? "").trim() || null;
  const accountNumber = (url.searchParams.get("account_number") ?? "").trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  const view = await listReceipts(cfg, {
    startDate,
    endDate,
    category,
    beneficiaryDocument,
    accountAgency,
    accountNumber,
    limit,
  });
  return json(200, view, requestId);
}

async function handleReceiptFileCreate(
  req: Request,
  cfg: GwConfig,
  paymentId: string,
  requestId: string,
): Promise<Response> {
  if (!RECEIPT_ID_PATTERN.test(paymentId)) {
    throw new BadRequest("payment_id inválido");
  }
  const body = await readJsonBody(req);
  // Aceita tanto o formato canônico da doc ({payment:{requestValueDate}}) quanto
  // um `request_value_date` no topo, pra a edge não ter que aninhar.
  const nestedPayment = (body.payment && typeof body.payment === "object")
    ? body.payment as Record<string, unknown>
    : {};
  const requestValueDate = String(
    body.request_value_date ?? nestedPayment.requestValueDate ?? "",
  ).trim();
  if (!MONTH_PATTERN.test(requestValueDate)) {
    throw new BadRequest("request_value_date obrigatório no formato YYYY-MM");
  }
  const view = await createReceiptFileRequest(cfg, paymentId, requestValueDate);
  return json(202, view, requestId);
}

async function handleReceiptFileGet(
  cfg: GwConfig,
  paymentId: string,
  fileRequestId: string,
  requestId: string,
): Promise<Response> {
  if (!RECEIPT_ID_PATTERN.test(paymentId) || !RECEIPT_ID_PATTERN.test(fileRequestId)) {
    throw new BadRequest("payment_id/request_id inválido");
  }
  const view = await getReceiptFileRequest(cfg, paymentId, fileRequestId);
  return json(200, view, requestId);
}

function handleHealth(requestId: string): Response {
  const daysLeft = certDaysLeft();
  const { cert, key } = certPaths();
  // Existe? Não lê conteúdo: o objetivo é dizer se o volume está montado, e ler
  // chave privada dentro de um endpoint sem autenticação é pedir problema.
  const certMounted = existsSync(cert) && existsSync(key);

  if (daysLeft <= CERT_EXPIRY_WARN_DAYS) {
    log("warn", "cert.expiring", { days_left: daysLeft });
  }

  return json(200, {
    ok: true,
    service: "santander-gw",
    payments_disabled: isPixPaymentsDisabled(),
    cert_mounted: certMounted,
    cert_days_left: daysLeft,
    cert_expiry_warning: daysLeft <= CERT_EXPIRY_WARN_DAYS,
    mtls_supported: hasHttpClientSupport(),
  }, requestId);
}

function existsSync(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor
// ─────────────────────────────────────────────────────────────────────────────

const WORKSPACE_BY_ID = /^\/workspaces\/([^/]{1,80})$/;
const TRANSFER_CONFIRM = /^\/pix\/transfer\/([^/]{1,120})\/confirm$/;
const TRANSFER_BY_ID = /^\/pix\/transfer\/([^/]{1,120})$/;
const RECEIPT_FILE_REQUESTS = /^\/receipts\/([^/]{1,200})\/file_requests$/;
const RECEIPT_FILE_REQUEST_BY_ID = /^\/receipts\/([^/]{1,200})\/file_requests\/([^/]{1,200})$/;

async function handler(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const startedAt = Date.now();

  // /health fica fora da autenticação: o HEALTHCHECK do Docker roda sem
  // segredo, e a rede é interna (o serviço não tem porta publicada). A resposta
  // não expõe credencial nem PII — só estado operacional.
  if (path === "/health" && req.method === "GET") {
    return handleHealth(requestId);
  }

  if (!(await isAuthorized(req))) {
    // NADA do corpo é lido nem logado aqui: um 401 pode ser scanner, cliente
    // mal configurado ou request legítima com segredo velho — em nenhum dos
    // casos o corpo (que carrega chave PIX e valor) deve tocar o log.
    log("warn", "request.unauthorized", {
      request_id: requestId,
      method: req.method,
      path,
    });
    return json(401, { error: "Não autorizado", kind: "unauthorized", indeterminate: false }, requestId);
  }

  // Credenciais desta request: do painel (header X-Gw-Credentials, decifrado pelo
  // edge) ou fallback do env. readConfig pode lançar 'config' (424, pré-voo) se
  // faltar tudo — nada foi enviado ao banco.
  let cfg: GwConfig;
  try {
    cfg = readConfig(parseGwCredentials(req));
  } catch (err) {
    return errorResponse(err, requestId, { method: req.method, path });
  }

  try {
    if (path === "/pix/transfer" && req.method === "POST") {
      return await handleCreate(req, cfg, requestId);
    }

    const confirmMatch = TRANSFER_CONFIRM.exec(path);
    if (confirmMatch && req.method === "PATCH") {
      return await handleConfirm(req, cfg, safeDecode(confirmMatch[1]), requestId);
    }

    const byIdMatch = TRANSFER_BY_ID.exec(path);
    if (byIdMatch && req.method === "GET") {
      return await handleGet(cfg, safeDecode(byIdMatch[1]), requestId);
    }

    if (path === "/pix/search" && req.method === "GET") {
      return await handleSearch(url, cfg, requestId);
    }

    if (path === "/account/accounts" && req.method === "GET") {
      return await handleAccounts(cfg, requestId);
    }

    if (path === "/workspaces" && req.method === "GET") {
      return await handleWorkspaces(cfg, requestId);
    }

    if (path === "/workspaces" && req.method === "POST") {
      return await handleCreateWorkspace(req, cfg, requestId);
    }

    const wsByIdMatch = WORKSPACE_BY_ID.exec(path);
    if (wsByIdMatch && req.method === "DELETE") {
      return await handleDeleteWorkspace(cfg, safeDecode(wsByIdMatch[1]), requestId);
    }
    if (wsByIdMatch && req.method === "PATCH") {
      return await handlePatchWorkspace(req, cfg, safeDecode(wsByIdMatch[1]), requestId);
    }

    if (path === "/account/balance" && req.method === "GET") {
      return await handleBalance(url, cfg, requestId);
    }

    if (path === "/account/statement" && req.method === "GET") {
      return await handleStatement(url, cfg, requestId);
    }

    if (path === "/receipts" && req.method === "GET") {
      return await handleReceiptsList(url, cfg, requestId);
    }

    const fileCreateMatch = RECEIPT_FILE_REQUESTS.exec(path);
    if (fileCreateMatch && req.method === "POST") {
      return await handleReceiptFileCreate(req, cfg, safeDecode(fileCreateMatch[1]), requestId);
    }

    const fileGetMatch = RECEIPT_FILE_REQUEST_BY_ID.exec(path);
    if (fileGetMatch && req.method === "GET") {
      return await handleReceiptFileGet(
        cfg,
        safeDecode(fileGetMatch[1]),
        safeDecode(fileGetMatch[2]),
        requestId,
      );
    }

    return json(404, { error: "Rota inexistente", kind: "not_found", indeterminate: false }, requestId);
  } catch (err) {
    return errorResponse(err, requestId, { method: req.method, path });
  } finally {
    log("info", "request.done", {
      request_id: requestId,
      method: req.method,
      path,
      duration_ms: Date.now() - startedAt,
    });
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
// As checagens abaixo derrubam o CONTAINER em vez do pagamento. Descobrir que
// falta mTLS ou que o segredo é fraco no dia da folha é o cenário que a ADR 0006
// existe pra evitar.

function boot(): void {
  if (!hasHttpClientSupport()) {
    log("error", "boot.failed", {
      reason: "Deno.createHttpClient indisponível — rode com --unstable-http",
    });
    Deno.exit(1);
  }

  const secret = (Deno.env.get("GW_SHARED_SECRET") ?? "").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    log("error", "boot.failed", {
      reason: `GW_SHARED_SECRET ausente ou com menos de ${MIN_SECRET_LENGTH} caracteres`,
    });
    Deno.exit(1);
  }

  // Config e certificado: aviso, não morte. O container precisa subir pro
  // /health poder DIZER o que está faltando — um container em CrashLoop não
  // conta nada a ninguém.
  try {
    const cfg = readConfig();
    log("info", "boot.config", {
      base_url: cfg.baseUrl,
      receipts_base_url: cfg.receiptsBaseUrl,
      environment: cfg.environment,
      workspace_id: cfg.workspaceId,
      debit_branch: cfg.debitBranch,
      // Conta débito é dado da empresa, não PII de colaborador, mas mascarar
      // custa nada e log de container vai pro backup.
      debit_account: maskDoc(cfg.debitAccount),
      payments_disabled: isPixPaymentsDisabled(),
    });
  } catch (err) {
    log("error", "boot.config_incomplete", { reason: (err as Error).message });
  }

  const { cert, key } = certPaths();
  if (!existsSync(cert) || !existsSync(key)) {
    log("error", "boot.cert_missing", { cert_path: cert, key_path: key });
  }

  const daysLeft = certDaysLeft();
  if (daysLeft <= CERT_EXPIRY_WARN_DAYS) {
    log("warn", "cert.expiring", { days_left: daysLeft });
  } else {
    log("info", "cert.ok", { days_left: daysLeft });
  }
}

boot();

Deno.serve({
  port: PORT,
  hostname: HOSTNAME,
  onListen: ({ hostname, port }) => log("info", "listening", { hostname, port }),
}, handler);
