// Cliente mTLS do Santander — transporte, token e contrato do provedor.
//
// POR QUE ISTO NÃO É UMA EDGE FUNCTION (ver ADR 0006)
// O edge-runtime da VPS é `deno_core` com um subconjunto de ops, e
// `Deno.createHttpClient` — a única forma de fazer mTLS em Deno — é API instável
// cuja flag não controlamos lá dentro. Um bump de imagem poderia removê-la em
// silêncio, no dia do pagamento. Além disso a chave privada como variável de
// ambiente aparece em `docker inspect` e no backup do `functions-secrets.env`,
// num runtime que roda outras 40 funções. Aqui a chave é arquivo em volume
// read-only, e o processo faz uma coisa só.
//
// SEM CERTIFICADO NÃO EXISTE NEM ERRO DE APLICAÇÃO: o Akamai devolve 403 (HTML
// "Access Denied") antes de a request chegar no Santander. Se aparecer HTML no
// `provider_body` de um erro, o problema é certificado/rede, não credencial.
// Roteiro de diagnóstico completo na tabela da ADR 0006.
//
// A CLASSIFICAÇÃO DE ERRO É A PARTE QUE VALE DINHEIRO
// Todo erro sai daqui com `indeterminate`, que responde a única pergunta que
// importa pro chamador: "dá pra afirmar que o dinheiro NÃO saiu?".
//   indeterminate = false → recusa provada. O chamador pode marcar failed.
//   indeterminate = true  → não sabemos. O chamador marca 'unknown' e chama
//                           gente (payroll_pix_mark_unknown).
// Na dúvida a resposta é `true`. Errar pra "trava e chama gente" custa um
// pagamento atrasado; errar pra "falhou, tenta de novo" custa um pagamento em
// dobro, e PIX não tem estorno unilateral.

import { log, maskDoc, maskName, maskPixKey } from "./mask.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de transporte
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout por operação. O PATCH é o mais generoso porque é ele que move dinheiro:
 *  desistir cedo demais de uma confirmação em voo só cria estado 'unknown' à toa. */
const TIMEOUT_TOKEN_MS = 10_000;
const TIMEOUT_POST_MS = 10_000;
const TIMEOUT_PATCH_MS = 30_000;
const TIMEOUT_GET_MS = 15_000;

/** Retry SÓ nestes status, e SÓ em token e GET (ver `retry` em CallOpts). */
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 3;
/** Retry-After do provedor é respeitado, mas com teto: um `Retry-After: 600`
 *  seguraria a request muito além do budget de quem chamou o gateway. */
const RETRY_AFTER_CAP_MS = 8_000;

/** Corpo do provedor no texto do erro. 300 chars pegam o JSON de erro inteiro do
 *  Santander e cortam a página HTML do Akamai antes de ela poluir o log. */
const PROVIDER_BODY_MAX = 300;

/** Limite do POST por chave DICT no contrato do Santander. */
const REMITTANCE_MAX = 138;

const DEFAULT_BASE_URL = "https://trust-sandbox.api.santander.com.br";
// O comprovante NÃO tem sandbox: a doc só publica trust-open (produção) e
// trust-open-h (homologação). Por isso ele tem host próprio, separado do de
// pagamento — e o default acompanha o ambiente derivado do host de pagamento.
const DEFAULT_RECEIPTS_BASE_URL_PROD = "https://trust-open.api.santander.com.br";
const DEFAULT_RECEIPTS_BASE_URL_HOMOLOG = "https://trust-open-h.api.santander.com.br";
const DEFAULT_CERT_PATH = "/certs/client.crt";
const DEFAULT_KEY_PATH = "/certs/client.key";

/** Vencimento do e-CNPJ A1 da Softcom (AC SAFEWEB RFB v5). Certificado vencido em
 *  dia de folha é o incidente clássico — a ADR 0006 exige alerta 30 dias antes. */
const DEFAULT_CERT_NOT_AFTER = "2027-08-12";
export const CERT_EXPIRY_WARN_DAYS = 30;

export type DictCodeType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

/** O enum do nosso banco é minúsculo (public.pix_key_type); o do Santander, MAIÚSCULO. */
export const DICT_CODE_TYPES: ReadonlySet<string> = new Set([
  "CPF",
  "CNPJ",
  "EMAIL",
  "PHONE",
  "EVP",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Erro tipado
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorKind =
  /** Falta env var / certificado ilegível. Nada foi enviado. */
  | "config"
  /** Kill-switch ligado. Nada foi enviado. */
  | "disabled"
  /** Corpo inválido, barrado por nós. Nada foi enviado. */
  | "bad_request"
  /** O banco disse não (4xx de negócio). Recusa PROVADA. */
  | "provider_rejected"
  /** 5xx / 429 / 408 do provedor. Pode ter processado antes de falhar. */
  | "provider_unavailable"
  /** Estourou o AbortController. O caso caro: a resposta se perde, o dinheiro não. */
  | "timeout"
  /** TLS/DNS/conexão. Só é seguro chamar de "não saiu" antes do primeiro byte — e não dá pra saber. */
  | "network";

/**
 * INVARIANTE: 4xx ⇔ indeterminate=false, 5xx ⇔ indeterminate=true.
 *
 * Não é estética de REST. A payroll-pix-pay classifica pela FAIXA do status
 * (>=500, 408 e 429 viram 'unknown'; o resto vira 'failed'), então o status é o
 * contrato de verdade — o campo `indeterminate` é a documentação dele.
 *
 * Daí `config` ser 424 e `disabled` ser 423, e não os 500/503 que a semântica
 * HTTP pediria: os dois são PROVADAMENTE pré-voo (nenhum fetch aconteceu). Um
 * 503 no kill-switch prenderia a folha inteira em 'unknown' — 300 transferências
 * exigindo resolução humana escrita porque alguém desligou os pagamentos, que é
 * justamente a ação segura e reversível. Pior: transformaria o estado 'unknown'
 * em ruído, e ruído é como uma trava de segurança vira clique automático.
 */
const KIND_HTTP_STATUS: Record<ErrorKind, number> = {
  // 424 Failed Dependency: falta env/certificado. Nada foi enviado.
  config: 424,
  // 423 Locked: kill-switch. Nada foi enviado.
  disabled: 423,
  bad_request: 400,
  provider_rejected: 422,
  provider_unavailable: 502,
  timeout: 504,
  network: 502,
};

/** Status do kill-switch, exportado pra que o main.ts não repita o número —
 *  dois lugares com o mesmo status é como um dos dois muda sozinho. */
export const DISABLED_STATUS = KIND_HTTP_STATUS.disabled;

/** Só estes três deixam dúvida sobre onde o dinheiro parou. */
const INDETERMINATE_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
  "provider_unavailable",
  "timeout",
  "network",
]);

export class SantanderError extends Error {
  readonly kind: ErrorKind;
  /**
   * Mensagem SEM o eco do provedor — é esta que vai pro log.
   *
   * O corpo de erro do Santander devolve o que mandamos ("dictCode inválido:
   * fulano@gmail.com"), então despejar `message` no log plantaria chave PIX em
   * texto plano no `docker logs`. O corpo cru continua indo na RESPOSTA, onde o
   * destino dele é `response_payload` de payroll_pix_transfers — tabela com RLS
   * e audit trigger, que é o lugar certo pra ele.
   */
  readonly baseMessage: string;
  /** Status que o GATEWAY devolve pro chamador. */
  readonly status: number;
  /** Status que o PROVEDOR devolveu, quando houve resposta. */
  readonly providerStatus?: number;
  /** Corpo do provedor, truncado. Nunca contém PII nossa — é o eco dele. */
  readonly providerBody?: string;
  /** true = não dá pra afirmar que o dinheiro não saiu. Ver cabeçalho. */
  readonly indeterminate: boolean;
  readonly retryAfterMs?: number;

  constructor(
    kind: ErrorKind,
    message: string,
    opts: { providerStatus?: number; providerBody?: string; retryAfterMs?: number } = {},
  ) {
    const body = opts.providerBody?.slice(0, PROVIDER_BODY_MAX);
    super(body ? `${message}: ${body}` : message);
    this.name = "SantanderError";
    this.baseMessage = message;
    this.kind = kind;
    this.status = KIND_HTTP_STATUS[kind];
    this.providerStatus = opts.providerStatus;
    this.providerBody = body;
    this.indeterminate = INDETERMINATE_KINDS.has(kind);
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/**
 * Traduz o status do provedor em kind.
 *
 * 408 e 429 caem em `provider_unavailable` (e não em `provider_rejected`) de
 * propósito: os dois significam "tenta de novo", e "tenta de novo" com dinheiro
 * é decisão humana, não do código.
 */
function kindForStatus(status: number): ErrorKind {
  if (status === 408 || status === 429) return "provider_unavailable";
  if (status >= 400 && status < 500) return "provider_rejected";
  return "provider_unavailable";
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuração — lida A CADA REQUEST, nunca no boot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kill-switch dos pagamentos PIX.
 *
 * Mesma forma do isAgendaSyncDisabled() de
 * supabase/functions/_shared/softcom-cloud.ts: lido por request (Deno.env), então
 * desligar pagamento NÃO exige redeploy nem rebuild — basta setar a variável e
 * reiniciar o container (ou trocar no env_file e `docker compose up -d`), e
 * voltar é igualmente barato.
 *
 * Default = HABILITADO (só desliga quando o valor for truthy).
 *
 * ESCOPO: bloqueia POST e PATCH — os verbos que criam e movem dinheiro. NÃO
 * bloqueia GET nem /pix/search, de propósito: quando alguém desliga o pagamento
 * é justamente quando MAIS se precisa consultar o que já foi enviado. Uma
 * reconciliação desligada junto transformaria um susto em pagamento órfão.
 */
export function isPixPaymentsDisabled(): boolean {
  const raw = (Deno.env.get("PIX_PAYMENTS_DISABLED") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export interface GwConfig {
  baseUrl: string;
  /** Host do serviço de comprovante (consult_payment_receipts). Separado porque
   *  essa API não existe no sandbox — só trust-open / trust-open-h. */
  receiptsBaseUrl: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  debitBranch: string;
  debitAccount: string;
  /** 'production' quando a base for o host trust-open. Vai pro log pra não haver dúvida depois. */
  environment: "sandbox" | "production";
}

/**
 * Credenciais vindas POR REQUEST (header X-Gw-Credentials), decifradas pelo edge
 * a partir de pix_gateway_credentials. Quando ausente, cada campo cai no env —
 * o fallback que segura o sandbox durante a virada pro banco como fonte.
 */
export interface GwCredsInput {
  client_id?: string;
  client_secret?: string;
  workspace_id?: string;
  base_url?: string;
  receipts_base_url?: string | null;
  debit_branch?: string;
  debit_account?: string;
}

/** Valor do override, senão do env; vazio nos dois = erro de config (pré-voo). */
function pickCred(overrideVal: string | null | undefined, envName: string): string {
  const value = (overrideVal ?? Deno.env.get(envName) ?? "").trim();
  if (!value) {
    throw new SantanderError("config", `Falta credencial ${envName} (nem no painel nem no env)`);
  }
  return value;
}

/** Como pickCred, mas NÃO lança se faltar. Só client_id/secret são essenciais pra
 *  QUALQUER chamada (o OAuth). Workspace e conta são exigidos só pelo pagamento —
 *  a descoberta (listar workspaces/contas) roda sem eles, então aqui são soft. */
function softCred(overrideVal: string | null | undefined, envName: string): string {
  return (overrideVal ?? Deno.env.get(envName) ?? "").trim();
}

/**
 * Config da request. Com `override` (credenciais do painel, via header), a
 * request se auto-descreve — inclusive o ambiente, derivado do base_url. Sem
 * override, tudo vem do env (o gateway continua funcionando como antes).
 *
 * O ambiente É DERIVADO do host, nunca uma fonte separada: duas verdades pro
 * ambiente é como "ensaiei no sandbox" vira "paguei de verdade". (trust-open-h é
 * host só de comprovante, então o .includes não confunde homolog com produção.)
 */
export function readConfig(override?: GwCredsInput | null): GwConfig {
  const src = override ?? null;
  const baseUrl = (src?.base_url ?? Deno.env.get("SANTANDER_BASE_URL") ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const environment: "sandbox" | "production" = baseUrl.includes("trust-open")
    ? "production"
    : "sandbox";
  // `|| default`, não `?? default`: string vazia (do env do compose, ${VAR:-})
  // não dispara o `??` e deixaria o host de comprovante em "".
  const receiptsEnv = (src?.receipts_base_url ?? Deno.env.get("SANTANDER_RECEIPTS_BASE_URL") ?? "")
    .trim();
  const receiptsBaseUrl = (receiptsEnv ||
    (environment === "production"
      ? DEFAULT_RECEIPTS_BASE_URL_PROD
      : DEFAULT_RECEIPTS_BASE_URL_HOMOLOG))
    .replace(/\/+$/, "");
  return {
    baseUrl,
    receiptsBaseUrl,
    clientId: pickCred(src?.client_id, "SANTANDER_CLIENT_ID"),
    clientSecret: pickCred(src?.client_secret, "SANTANDER_CLIENT_SECRET"),
    // Soft: a descoberta (listar workspaces/contas) não usa estes. O pagamento
    // usa, mas aí a config vem completa do banco (colunas NOT NULL) ou do env.
    workspaceId: softCred(src?.workspace_id, "SANTANDER_WORKSPACE_ID"),
    debitBranch: softCred(src?.debit_branch, "SANTANDER_DEBIT_BRANCH"),
    debitAccount: softCred(src?.debit_account, "SANTANDER_DEBIT_ACCOUNT"),
    environment,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente mTLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `Deno.createHttpClient` é API instável: dependendo da versão ela nem aparece
 * nos tipos estáveis, e o `deno cache` do build quebraria por erro de tipo numa
 * API que EXISTE em runtime. Por isso o acesso é por cast, e a existência dela
 * vira uma checagem explícita (hasHttpClientSupport) que o main.ts roda no boot.
 * Descobrir que o runtime não tem mTLS no dia do pagamento é o cenário que a
 * ADR 0006 usou pra tirar isto de dentro do edge-runtime.
 */
type HttpClientLike = { close(): void };

const createHttpClient = (Deno as unknown as {
  createHttpClient?: (opts: { cert: string; key: string }) => HttpClientLike;
}).createHttpClient;

export function hasHttpClientSupport(): boolean {
  return typeof createHttpClient === "function";
}

let httpClient: HttpClientLike | null = null;

export function certPaths(): { cert: string; key: string } {
  return {
    cert: (Deno.env.get("SANTANDER_CERT_PATH") ?? DEFAULT_CERT_PATH).trim(),
    key: (Deno.env.get("SANTANDER_KEY_PATH") ?? DEFAULT_KEY_PATH).trim(),
  };
}

/**
 * Cliente HTTP com o certificado cliente. Criado uma vez e reusado — cada
 * `createHttpClient` abre um pool próprio, e um por request esgotaria o
 * handshake TLS na primeira folha grande.
 *
 * O PEM é lido do volume read-only. Trocar o certificado exige reiniciar o
 * container (por isso o alerta de vencimento existe: renovar sem reiniciar não
 * tem efeito nenhum).
 */
function getHttpClient(): HttpClientLike {
  if (httpClient) return httpClient;

  if (!createHttpClient) {
    throw new SantanderError(
      "config",
      "Deno.createHttpClient indisponível — falta a flag --unstable-http neste runtime",
    );
  }

  const { cert: certPath, key: keyPath } = certPaths();
  let cert: string;
  let key: string;
  try {
    cert = Deno.readTextFileSync(certPath);
    key = Deno.readTextFileSync(keyPath);
  } catch (err) {
    throw new SantanderError(
      "config",
      `Não consegui ler o certificado (${certPath} / ${keyPath}): ${(err as Error).message}`,
    );
  }
  if (!cert.includes("BEGIN CERTIFICATE")) {
    throw new SantanderError("config", `${certPath} não parece um PEM de certificado`);
  }
  if (!key.includes("PRIVATE KEY")) {
    // Erro clássico da conversão: esquecer o -nodes no openssl e gerar chave
    // com senha ("ENCRYPTED PRIVATE KEY"), que o Deno não abre.
    throw new SantanderError(
      "config",
      `${keyPath} não parece uma chave privada PEM sem senha (ver README, openssl -nodes)`,
    );
  }

  httpClient = createHttpClient({ cert, key });
  return httpClient;
}

/** Dias até o vencimento do certificado. Vem de env porque parsear X.509 em Deno
 *  puro seria mais código do que o problema merece — o README manda conferir com
 *  `openssl x509 -enddate` e ajustar a variável na renovação. */
export function certDaysLeft(): number {
  const raw = (Deno.env.get("SANTANDER_CERT_NOT_AFTER") ?? DEFAULT_CERT_NOT_AFTER).trim();
  const notAfter = new Date(`${raw}T23:59:59Z`);
  if (Number.isNaN(notAfter.getTime())) return -1;
  return Math.floor((notAfter.getTime() - Date.now()) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chamada ao provedor
// ─────────────────────────────────────────────────────────────────────────────

interface CallOpts {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers: Record<string, string>;
  /** Corpo JSON. */
  body?: unknown;
  /** Corpo cru (form-urlencoded do token). */
  rawBody?: string;
  timeoutMs: number;
  /**
   * Retry automático em 429/503.
   *
   * Só `true` em token e GET. POST e PATCH NUNCA repetem sozinhos: um retry
   * automático em cima de uma request que pode ter vingado é uma aposta com o
   * dinheiro dos outros. O estado 'unknown' do banco existe exatamente pra
   * devolver essa decisão pra uma pessoa.
   */
  retry: boolean;
  label: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

async function callOnce(o: CallOpts): Promise<{ status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);
  const startedAt = Date.now();
  try {
    // `client` só existe no RequestInit do Deno com os tipos instáveis
    // carregados; o cast mantém o `deno cache` do Dockerfile type-checando.
    const init = {
      method: o.method,
      headers: o.headers,
      body: o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
      signal: ctrl.signal,
      client: getHttpClient(),
    } as RequestInit;

    const resp = await fetch(o.url, init);

    const text = await resp.text();
    const elapsed = Date.now() - startedAt;

    if (!resp.ok) {
      throw new SantanderError(
        kindForStatus(resp.status),
        `Santander ${o.label} HTTP ${resp.status} (${elapsed}ms)`,
        {
          providerStatus: resp.status,
          providerBody: text,
          retryAfterMs: parseRetryAfter(resp.headers.get("retry-after")),
        },
      );
    }

    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // 2xx com corpo não-JSON não é sucesso pra nós: pode ser página de
        // borda do Akamai devolvida com 200 em algum caminho esquisito.
        throw new SantanderError(
          "provider_unavailable",
          `Santander ${o.label} devolveu 2xx com corpo não-JSON`,
          { providerStatus: resp.status, providerBody: text },
        );
      }
    }
    return { status: resp.status, json, text };
  } catch (err) {
    if (err instanceof SantanderError) throw err;
    if ((err as Error).name === "AbortError" || (err as Error).name === "TimeoutError") {
      throw new SantanderError(
        "timeout",
        `Santander ${o.label}: timeout após ${o.timeoutMs}ms`,
      );
    }
    throw new SantanderError(
      "network",
      `Santander ${o.label}: falha de rede/TLS — ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function call(o: CallOpts): Promise<{ status: number; json: unknown; text: string }> {
  if (!o.retry) return await callOnce(o);

  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(o);
    } catch (err) {
      const retryable = err instanceof SantanderError &&
        err.providerStatus !== undefined &&
        RETRY_STATUSES.has(err.providerStatus);
      if (!retryable || attempt >= MAX_RETRIES) throw err;

      // 1s, 2s, 4s + jitter (o jitter evita que a folha inteira volte junto).
      const backoff = (err as SantanderError).retryAfterMs ??
        Math.min(1000 * 2 ** attempt, RETRY_AFTER_CAP_MS);
      const delay = backoff + Math.floor(Math.random() * 300);
      log("warn", "provider.retry", {
        label: o.label,
        attempt: attempt + 1,
        max: MAX_RETRIES,
        provider_status: (err as SantanderError).providerStatus,
        delay_ms: delay,
      });
      await sleep(delay);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token OAuth — cache em memória + mutex
// ─────────────────────────────────────────────────────────────────────────────

/** O token vive 900s. Renovamos aos ~800s: 100s de margem cobrem uma chamada
 *  lenta que pegou o token no limite e chegaria no banco já vencida — que seria
 *  um 401 no meio de um pagamento, ou seja, um 'unknown'. */
const TOKEN_SAFETY_MARGIN_MS = 100_000;
const TOKEN_DEFAULT_TTL_S = 900;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Cache e mutex por HOST.
 *
 * Pagamento e comprovante vivem em hosts diferentes (pix em trust-sandbox/
 * trust-open; comprovante só em trust-open/trust-open-h — não há sandbox). Um
 * token do host A não é aceito no host B, então o cache é keyed por baseUrl.
 * O mutex também: enquanto uma renovação de um host está em voo, todo mundo que
 * pede AQUELE host espera a MESMA promise — sem isso, uma folha de 300
 * colaboradores dispararia 300 requests de token e o Santander responderia 429.
 */
const tokenCache = new Map<string, CachedToken>();
const tokenInFlight = new Map<string, Promise<string>>();

async function fetchToken(cfg: GwConfig, baseUrl: string): Promise<string> {
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "client_credentials",
  });

  const { json } = await call({
    method: "POST",
    url: `${baseUrl}/auth/oauth/v2/token`,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    rawBody: form.toString(),
    timeoutMs: TIMEOUT_TOKEN_MS,
    // Token PODE repetir: pedir token não move dinheiro.
    retry: true,
    label: "token",
  });

  const payload = (json ?? {}) as Record<string, unknown>;
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!token) {
    throw new SantanderError("provider_unavailable", "Resposta do token sem access_token");
  }
  const ttl = Number(payload.expires_in);
  const ttlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : TOKEN_DEFAULT_TTL_S;

  tokenCache.set(baseUrl, {
    token,
    // Math.max: se o provedor um dia devolver um TTL menor que a margem, o
    // cache viraria "sempre vencido" e cada request pediria token de novo.
    expiresAtMs: Date.now() + Math.max(ttlSeconds * 1000 - TOKEN_SAFETY_MARGIN_MS, 30_000),
  });

  log("info", "token.renewed", { expires_in_s: ttlSeconds, host: baseUrl });
  return token;
}

/** Token do host pedido (default = host de pagamento do cfg). O cfg carrega as
 *  credenciais (do painel ou do env); o cache é por host. */
export async function getToken(cfg: GwConfig, baseUrl?: string): Promise<string> {
  const host = baseUrl ?? cfg.baseUrl;
  const cached = tokenCache.get(host);
  if (cached && cached.expiresAtMs > Date.now()) return cached.token;

  const inflight = tokenInFlight.get(host);
  if (inflight) return await inflight;

  const p = fetchToken(cfg, host).finally(() => {
    tokenInFlight.delete(host);
  });
  tokenInFlight.set(host, p);
  return await p;
}

/** Descarta o token em cache do host. Usado quando o provedor devolve 401 num
 *  GET — o relógio dele e o nosso podem discordar. Nunca usado em POST/PATCH:
 *  lá, 401 é resposta final e quem decide o que fazer é o chamador. */
export function invalidateToken(baseUrl: string): void {
  tokenCache.delete(baseUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrato do Santander
// ─────────────────────────────────────────────────────────────────────────────

function paymentsUrl(cfg: GwConfig, suffix = ""): string {
  return `${cfg.baseUrl}/management_payments_partners/v1/workspaces/${
    encodeURIComponent(cfg.workspaceId)
  }/pix_payments${suffix}`;
}

async function authHeaders(
  cfg: GwConfig,
  baseUrl?: string,
): Promise<Record<string, string>> {
  // baseUrl opcional: o comprovante fala com outro host e precisa do token DELE.
  const token = await getToken(cfg, baseUrl ?? cfg.baseUrl);
  return {
    authorization: `Bearer ${token}`,
    // O X-Application-Key é o client_id, e é OBRIGATÓRIO junto do Bearer — sem
    // ele a chamada morre antes da aplicação, com erro que não menciona o header.
    "X-Application-Key": cfg.clientId,
    accept: "application/json",
    "content-type": "application/json",
  };
}

export interface PixDocument {
  documentNumber: string;
  documentType: "CPF" | "CNPJ";
  name: string;
}

export interface PixTransferInput {
  idempotencyKey: string;
  /** Já normalizado como string "1234.56". Ver normalizeAmount() no main.ts. */
  amount: string;
  dictCode: string;
  dictCodeType: DictCodeType;
  payeeName: string;
  payeeDocument?: string | null;
  description?: string | null;
  /** Pagador vem do chamador porque o sistema é multi-CNPJ: matriz e filiais
   *  pagam cada uma com o próprio CNPJ (payer_snapshot da RPC). */
  payer?: PixDocument | null;
  /** Conta débito por request, mesmo motivo. Sem isso, cai no par do env. */
  debitAccount?: { branch: string; number: string } | null;
}

/**
 * remittanceInformation = descrição + idempotency_key.
 *
 * A DESCRIÇÃO é que é truncada, nunca a chave, e a chave vai no fim: é ela que
 * permite achar o pagamento quando o POST deu timeout e não temos o
 * provider_payment_id. Truncar a chave transformaria o canal de recuperação
 * secundário em enfeite. (O primário é `tags`, que a ADR 0006 provou que volta
 * inteiro no GET.)
 */
function buildRemittance(description: string | null | undefined, key: string): string {
  const room = REMITTANCE_MAX - key.length - 1;
  const desc = (description ?? "").trim().slice(0, Math.max(room, 0));
  return desc ? `${desc} ${key}`.slice(0, REMITTANCE_MAX) : key.slice(0, REMITTANCE_MAX);
}

export function buildPaymentPayload(
  cfg: GwConfig,
  input: PixTransferInput,
): Record<string, unknown> {
  const branch = input.debitAccount?.branch ?? cfg.debitBranch;
  const number = input.debitAccount?.number ?? cfg.debitAccount;

  const payload: Record<string, unknown> = {
    debitAccount: { branch, number },
    // A tag do Santander tem TETO DE 20 CARACTERES (provado contra o sandbox:
    // "Tag deve receber no máximo 20 caracteres"), e a nossa idempotency_key
    // (sh-<32hex>-<attempt>) tem 37. Então a tag leva só um prefixo — o canal de
    // recuperação de verdade, quando o provider_payment_id se perde num timeout,
    // é o remittanceInformation abaixo, que cabe a chave INTEIRA (138 chars) e é
    // onde matchesKey/searchByIdempotencyKey procuram primeiro.
    tags: [input.idempotencyKey.slice(0, 20)],
    // O Santander chama a chave de telefone de CELULAR, não PHONE (provado
    // contra o sandbox: 'PHONE' devolve "Tipo de chave Pix inválida", 'CELULAR'
    // é aceito). O nosso enum interno segue 'phone'; a tradução mora aqui, na
    // camada que fala o contrato do provedor.
    dictCodeType: input.dictCodeType === "PHONE" ? "CELULAR" : input.dictCodeType,
    dictCode: input.dictCode,
    remittanceInformation: buildRemittance(input.description, input.idempotencyKey),
    // Strings, não números: o contrato do Santander é string e o valor vem de
    // numeric(12,2) do Postgres. Passar por float no caminho é onde centavo some.
    //
    // O POST aceita paymentValue. nominalValue, deductedValue, addedValue,
    // totalValue e payer são campos da RESPOSTA, não da criação por chave.
    // Em produção, cada um desses campos causa HTTP 400 / 10302 antes da
    // validação da chave (diagnóstico de 29/10/2026; ver ADR 0006).
    paymentValue: input.amount,
  };

  // O banco resolve o pagador pelo workspace/conta. O snapshot recebido em
  // input.payer continua no registro interno da transferência para auditoria.

  // O `beneficiary` NÃO é enviado, de propósito. Este endpoint paga PELA CHAVE:
  // o DICT resolve o favorecido (banco, agência, conta, documento) a partir do
  // dictCode e devolve tudo isso na resposta. Provado contra o sandbox — um POST
  // só com dictCode/dictCodeType cria o pagamento; já um `beneficiary` PARCIAL
  // (só o nome, que era o que dava pra montar do nosso cadastro) faz a validação
  // exigir a conta inteira e recusar o pagamento. Mandar meio favorecido é pior
  // do que não mandar nenhum: quem confere que a chave é da pessoa certa é o
  // operador, na tela de confirmação, antes do código sair.
  // (input.payeeName/payeeDocument seguem no log mascarado de createPayment.)

  return payload;
}

export interface ProviderPaymentView {
  provider_payment_id: string | null;
  /** Label CRU do provedor (READY_TO_PAY, PAYED, …). A tradução pro nosso enum
   *  é do chamador de propósito: o nosso enum diz onde o DINHEIRO está, não como
   *  o banco chamou o estado, e um label novo do Santander não pode quebrar nada. */
  status: string | null;
  end_to_end_id: string | null;
  transaction_code: string | null;
  tags: string[];
  raw: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function viewOf(raw: unknown): ProviderPaymentView {
  const p = (raw ?? {}) as Record<string, unknown>;
  const tx = (p.transaction ?? {}) as Record<string, unknown>;
  return {
    provider_payment_id: str(p.id) ?? str(p.paymentId),
    status: str(p.status),
    end_to_end_id: str(tx.endToEnd) ?? str(p.endToEnd),
    transaction_code: str(tx.code),
    tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t)) : [],
    raw,
  };
}

/**
 * POST — cria o pagamento. Devolve READY_TO_PAY e **NÃO move dinheiro**.
 * Sem retry automático: ver CallOpts.retry.
 */
export async function createPayment(
  cfg: GwConfig,
  input: PixTransferInput,
): Promise<ProviderPaymentView> {
  const payload = buildPaymentPayload(cfg, input);

  log("info", "pix.create.start", {
    idempotency_key: input.idempotencyKey,
    // O VALOR não vai pro log. É o líquido da folha de uma pessoa identificável
    // (a idempotency_key leva ao entry_id, e dele ao colaborador) — salário em
    // texto plano é exatamente o que o CLAUDE.md proíbe. Quem precisa do valor
    // tem payroll_pix_transfers.amount e o request_payload no banco; o log só
    // precisa provar QUAL pagamento passou por aqui.
    dict_code_type: input.dictCodeType,
    // PII mascarada — é o que o CLAUDE.md exige e o suficiente pra conferir.
    dict_code: maskPixKey(input.dictCode, input.dictCodeType),
    payee: maskName(input.payeeName),
    payee_document: maskDoc(input.payeeDocument),
    environment: cfg.environment,
  });

  const { json } = await call({
    method: "POST",
    url: paymentsUrl(cfg),
    headers: await authHeaders(cfg),
    body: payload,
    timeoutMs: TIMEOUT_POST_MS,
    retry: false,
    label: "POST pix_payments",
  });

  const view = viewOf(json);
  log("info", "pix.create.ok", {
    idempotency_key: input.idempotencyKey,
    provider_payment_id: view.provider_payment_id,
    provider_status: view.status,
  });
  return view;
}

/**
 * PATCH — confirma. É AQUI que o dinheiro anda (READY_TO_PAY → PAYED).
 *
 * O verbo é PATCH porque PUT e DELETE devolvem 502 no sandbox (ADR 0006). O
 * CORPO é a única parte do contrato que não foi provada contra o ambiente real:
 * por isso o valor do status sai de env (SANTANDER_CONFIRM_STATUS) e pode ser
 * sobrescrito por request — descobrir o corpo certo não pode exigir rebuild.
 */
export async function confirmPayment(
  cfg: GwConfig,
  paymentId: string,
  opts: { status?: string; amount?: string } = {},
): Promise<ProviderPaymentView> {
  const body: Record<string, unknown> = {
    status: opts.status ?? (Deno.env.get("SANTANDER_CONFIRM_STATUS") ?? "AUTHORIZED").trim(),
  };
  if (opts.amount) body.paymentValue = opts.amount;

  log("info", "pix.confirm.start", {
    provider_payment_id: paymentId,
    confirm_status: body.status,
    environment: cfg.environment,
  });

  const { json } = await call({
    method: "PATCH",
    url: paymentsUrl(cfg, `/${encodeURIComponent(paymentId)}`),
    headers: await authHeaders(cfg),
    body,
    timeoutMs: TIMEOUT_PATCH_MS,
    retry: false,
    label: "PATCH pix_payments",
  });

  const view = viewOf(json);
  log("info", "pix.confirm.ok", {
    provider_payment_id: view.provider_payment_id ?? paymentId,
    provider_status: view.status,
    has_e2e: view.end_to_end_id !== null,
  });
  return view;
}

/** GET de um pagamento. Único caminho da reconciliação — e o único, junto do
 *  search, que pode repetir à vontade. */
export async function getPayment(
  cfg: GwConfig,
  paymentId: string,
): Promise<ProviderPaymentView> {
  const url = paymentsUrl(cfg, `/${encodeURIComponent(paymentId)}`);

  const run = async () => {
    const { json } = await call({
      method: "GET",
      url,
      headers: await authHeaders(cfg),
      timeoutMs: TIMEOUT_GET_MS,
      retry: true,
      label: "GET pix_payments/{id}",
    });
    return viewOf(json);
  };

  try {
    return await run();
  } catch (err) {
    // 401 num GET normalmente é token que venceu entre a checagem e o uso.
    // Repetir CONSULTA é sempre seguro — ao contrário de repetir pagamento.
    if (err instanceof SantanderError && err.providerStatus === 401) {
      invalidateToken(cfg.baseUrl);
      log("warn", "token.retry_after_401", { provider_payment_id: paymentId });
      return await run();
    }
    throw err;
  }
}

/** Lista os pagamentos do workspace. Formato de coleção do Santander varia
 *  (array cru, `_content`, `content`…), então aceitamos todos os invólucros
 *  conhecidos em vez de quebrar quando eles mudarem de release. */
function extractList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    for (const key of ["_content", "content", "items", "payments", "data", "results"]) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

/** Casa o pagamento com a nossa chave. `tags` é o canal principal;
 *  remittanceInformation é a rede de segurança (a chave vai no fim dela). */
function matchesKey(payment: Record<string, unknown>, key: string): boolean {
  const tags = Array.isArray(payment.tags) ? payment.tags.map((t) => String(t)) : [];
  // key.slice(0,20) é o prefixo que buildPaymentPayload manda na tag (teto de 20
  // do Santander). Casar por ele cobre o caso de a chave completa não ter ido
  // pra tag — a rede principal continua sendo o remittance, com a chave inteira.
  const tagPrefix = key.slice(0, 20);
  if (tags.some((t) => t === key || t === tagPrefix || t.includes(key))) return true;
  const remittance = typeof payment.remittanceInformation === "string"
    ? payment.remittanceInformation
    : "";
  return remittance.includes(key);
}

/**
 * Procura pagamentos por idempotency_key.
 *
 * Existe pro caso 'unknown': o POST deu timeout, não temos o provider_payment_id
 * e mesmo assim precisamos descobrir se o pagamento nasceu no banco.
 *
 * ATENÇÃO: no SANDBOX isso não prova nada — o ambiente é um MOCK, duas chamadas
 * ao GET devolvem ids diferentes e ele não guarda estado. Serve pra provar
 * transporte e formato. Reconciliação de verdade só em produção.
 */
export async function searchByIdempotencyKey(
  cfg: GwConfig,
  key: string,
): Promise<{ matches: ProviderPaymentView[]; scanned: number }> {
  const { json } = await call({
    method: "GET",
    url: paymentsUrl(cfg),
    headers: await authHeaders(cfg),
    timeoutMs: TIMEOUT_GET_MS,
    retry: true,
    label: "GET pix_payments",
  });

  const list = extractList(json);
  const matches = list.filter((p) => matchesKey(p, key)).map(viewOf);
  log("info", "pix.search.done", {
    idempotency_key: key,
    scanned: list.length,
    matches: matches.length,
    environment: cfg.environment,
  });
  return { matches, scanned: list.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspaces — descoberta pra configuração (SÓ LEITURA)
//
// Lista os workspaces da aplicação. Cada um carrega o mainDebitAccount
// {branch, number} e as flags *PaymentsActive (ADR 0006), então é daqui que o
// painel monta o seletor: escolher o workspace já traz a agência/conta e diz
// qual tem PIX ativo. NÃO usa workspaceId (é a listagem), então roda com só
// client_id + secret — o que permite descobrir ANTES de salvar a config.
// ─────────────────────────────────────────────────────────────────────────────

const WORKSPACES_PATH = "/management_payments_partners/v1/workspaces";

export interface WorkspaceView {
  workspaceId: string | null;
  type: string | null;
  description: string | null;
  pixPaymentsActive: boolean;
  mainDebitAccount: { branch: string | null; number: string | null } | null;
  webhookUrl: string | null;
}

function workspaceViewOf(raw: unknown): WorkspaceView {
  const w = (raw ?? {}) as Record<string, unknown>;
  const main = (w.mainDebitAccount ?? {}) as Record<string, unknown>;
  const hasMain = main.branch != null || main.number != null;
  return {
    workspaceId: str(w.id) ?? str(w.workspaceId),
    type: str(w.type),
    description: str(w.description) ?? str(w.name),
    pixPaymentsActive: w.pixPaymentsActive === true,
    mainDebitAccount: hasMain
      ? { branch: str(main.branch), number: str(main.number) }
      : null,
    webhookUrl: str(w.webhookURL) ?? str(w.webhookUrl),
  };
}

export async function listWorkspaces(cfg: GwConfig): Promise<{ workspaces: WorkspaceView[] }> {
  const { json } = await call({
    method: "GET",
    url: `${cfg.baseUrl}${WORKSPACES_PATH}`,
    headers: await authHeaders(cfg),
    timeoutMs: TIMEOUT_GET_MS,
    retry: true,
    label: "GET workspaces",
  });
  const list = extractList(json);
  log("info", "workspaces.list.done", { count: list.length, environment: cfg.environment });
  return { workspaces: list.map(workspaceViewOf) };
}

export interface CreateWorkspaceInput {
  /** 'PAYMENTS' é o que habilita PIX (os outros tipos não pagam PIX). */
  type: string;
  mainDebitAccount: { branch: string; number: string };
  additionalDebitAccounts?: { branch: string; number: string }[];
  description?: string;
}

/**
 * Cria um workspace de pagamento. Com type=PAYMENTS + a conta de débito, é isto
 * que liga o PIX no ambiente (a conta Boleto/DDA existente não paga PIX). NÃO
 * move dinheiro — só registra o workspace; é reversível (DELETE existe no
 * contrato). retry=false como todo POST (repetir criaria workspace duplicado).
 */
export async function createWorkspace(
  cfg: GwConfig,
  input: CreateWorkspaceInput,
): Promise<WorkspaceView> {
  const body: Record<string, unknown> = {
    type: input.type,
    mainDebitAccount: input.mainDebitAccount,
  };
  if (input.additionalDebitAccounts && input.additionalDebitAccounts.length > 0) {
    body.additionalDebitAccounts = input.additionalDebitAccounts;
  }
  if (input.description) body.description = input.description;

  log("info", "workspaces.create.start", {
    type: input.type,
    branch: input.mainDebitAccount.branch,
    environment: cfg.environment,
  });

  const { json } = await call({
    method: "POST",
    url: `${cfg.baseUrl}${WORKSPACES_PATH}`,
    headers: await authHeaders(cfg),
    body,
    timeoutMs: TIMEOUT_POST_MS,
    retry: false,
    label: "POST workspace",
  });
  const view = workspaceViewOf(json);
  log("info", "workspaces.create.ok", {
    workspace_id: view.workspaceId,
    pix_active: view.pixPaymentsActive,
    environment: cfg.environment,
  });
  return view;
}

/**
 * Atualiza um workspace (PATCH). Usado pra tentar LIGAR o PIX
 * (pixPaymentsActive: true) sem recriar. Se a conta não estiver habilitada pro
 * produto, o banco recusa — e o erro (422/403) é a resposta honesta de que é
 * habilitação, não configuração. Não move dinheiro.
 */
export async function patchWorkspace(
  cfg: GwConfig,
  workspaceId: string,
  patch: Record<string, unknown>,
): Promise<WorkspaceView> {
  const { json } = await call({
    method: "PATCH",
    url: `${cfg.baseUrl}${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`,
    headers: await authHeaders(cfg),
    body: patch,
    timeoutMs: TIMEOUT_POST_MS,
    retry: false,
    label: "PATCH workspace",
  });
  const view = workspaceViewOf(json);
  log("info", "workspaces.patch.ok", {
    workspace_id: workspaceId,
    pix_active: view.pixPaymentsActive,
    environment: cfg.environment,
  });
  return view;
}

/** Exclui um workspace. Reversível só recriando; não move dinheiro. */
export async function deleteWorkspace(
  cfg: GwConfig,
  workspaceId: string,
): Promise<{ status: number }> {
  const { status } = await call({
    method: "DELETE",
    url: `${cfg.baseUrl}${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`,
    headers: await authHeaders(cfg),
    timeoutMs: TIMEOUT_POST_MS,
    retry: false,
    label: "DELETE workspace",
  });
  log("info", "workspaces.delete.ok", { workspace_id: workspaceId, environment: cfg.environment });
  return { status };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank Account Information — saldo e extrato (SÓ LEITURA)
//
// Outra API do MESMO host do pagamento (base /bank_account_information/v1), então
// reusa o mesmo cliente mTLS, o mesmo token e o mesmo par de headers
// (Bearer + X-Application-Key). São todas GET: retry é seguro (consultar não move
// dinheiro), não há kill-switch e nenhum estado 'unknown' nasce daqui.
//
// bank_id é o CNPJ de 14 dígitos do Santander, conforme o contrato desta API.
// O código de compensação 33 não é o identificador usado neste endpoint.
// ─────────────────────────────────────────────────────────────────────────────

const ACCOUNT_INFO_PATH = "/bank_account_information/v1";
export const SANTANDER_BANK_ID = "90400888000142";

function accountInfoUrl(cfg: GwConfig, suffix: string): string {
  return `${cfg.baseUrl}${ACCOUNT_INFO_PATH}${suffix}`;
}

/** Number OU string viram string. O extrato devolve `amount` ora como número
 *  (-0.1 no exemplo da doc) ora como string — o `str()` acima descarta número,
 *  então o valor precisa deste caminho pra não sumir. */
function amountToStr(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return str(value);
}

export interface AccountView {
  branchCode: string | null;
  number: string | null;
  checkDigit: string | null;
  accountId: string | null;
  type: string | null;
  brandName: string | null;
}

/**
 * Lista as contas do titular. Serve pra DESCOBRIR a agência/conta certa na hora
 * de configurar — o extrato pede `accountNumber` com dígito e o saldo pede
 * `agência.conta`, e é aqui que se lê o formato exato que o banco reconhece.
 */
export async function listAccounts(
  cfg: GwConfig,
  bankId: string = SANTANDER_BANK_ID,
): Promise<{ accounts: AccountView[]; hasMore: boolean }> {
  const { json } = await call({
    method: "GET",
    url: accountInfoUrl(cfg, `/banks/${encodeURIComponent(bankId)}/accounts`),
    headers: await authHeaders(cfg),
    timeoutMs: TIMEOUT_GET_MS,
    retry: true,
    label: "GET accounts",
  });

  const p = (json ?? {}) as Record<string, unknown>;
  const content = Array.isArray(p._content) ? p._content : [];
  const pageable = (p._pageable ?? {}) as Record<string, unknown>;
  log("info", "account.list.done", { count: content.length, environment: cfg.environment });
  return {
    accounts: content.map((a) => {
      const acc = (a ?? {}) as Record<string, unknown>;
      return {
        branchCode: str(acc.branchCode),
        number: str(acc.number),
        checkDigit: str(acc.checkDigit),
        accountId: str(acc.accountId),
        type: str(acc.type),
        brandName: str(acc.brandName),
      };
    }),
    hasMore: pageable._moreElements === true,
  };
}

export interface BalanceView {
  available: string | null;
  blocked: string | null;
  invested: string | null;
  currency: string | null;
}

/**
 * Saldo da conta. `balanceId` é `agência.conta` pra conta Santander
 * (ex: `0001.000100200300`). Sem `raw`: saldo não é prova de liquidação, é
 * número de tela — e devolver o corpo cru só espalharia dado de conta.
 */
export async function getBalance(
  cfg: GwConfig,
  balanceId: string,
  bankId: string = SANTANDER_BANK_ID,
): Promise<BalanceView> {
  const { json } = await call({
    method: "GET",
    url: accountInfoUrl(
      cfg,
      `/banks/${encodeURIComponent(bankId)}/balances/${encodeURIComponent(balanceId)}`,
    ),
    headers: await authHeaders(cfg),
    timeoutMs: TIMEOUT_GET_MS,
    retry: true,
    label: "GET balance",
  });

  const p = (json ?? {}) as Record<string, unknown>;
  log("info", "account.balance.done", { environment: cfg.environment });
  return {
    available: amountToStr(p.availableAmount),
    blocked: amountToStr(p.blockedAmount),
    invested: amountToStr(p.automaticallyInvestedAmount),
    currency: str(p.availableAmountCurrency) ?? "BRL",
  };
}

export interface StatementEntry {
  transactionId: string | null;
  date: string | null;
  /** PIX, TED, DOC… (campo `type` do banco). */
  type: string | null;
  /** CREDITO / DEBITO. */
  creditDebit: string | null;
  /** "Você transferiu para…" — descrição pronta do banco. */
  name: string | null;
  amount: string | null;
  currency: string | null;
  /** Documento da contraparte. É o extrato da PRÓPRIA empresa, então mostrar o
   *  documento de quem recebeu/pagou é legítimo e é o que permite conciliar. */
  partyDocument: string | null;
}

/**
 * Extrato por intervalo. `accountNumber` é o número da conta COM dígito
 * (ex: `000000025002`). Intervalo é de datas YYYY-MM-DD; a janela grande a doc
 * limita no lado do banco (o extrato de grandes volumes é outra API, fora do
 * escopo aqui — este é o síncrono).
 */
export async function getStatement(
  cfg: GwConfig,
  params: {
    branchCode: string;
    accountNumber: string;
    initialDate: string;
    finalDate: string;
    bankId?: string;
  },
): Promise<{ entries: StatementEntry[]; hasMore: boolean }> {
  const bankId = params.bankId ?? SANTANDER_BANK_ID;
  const statementId = `${params.branchCode}.${params.accountNumber}`;
  const q = new URLSearchParams({
    initialDate: params.initialDate,
    finalDate: params.finalDate,
    _limit: "50",
    // O Santander numera páginas a partir de 1; offset 0 retorna HTTP 422.
    _offset: "1",
  });

  const { json } = await call({
    method: "GET",
    url: accountInfoUrl(
      cfg,
      `/banks/${encodeURIComponent(bankId)}/statements/${encodeURIComponent(statementId)}?${q.toString()}`,
    ),
    headers: await authHeaders(cfg),
    timeoutMs: TIMEOUT_GET_MS,
    retry: true,
    label: "GET statement",
  });

  const p = (json ?? {}) as Record<string, unknown>;
  const content = Array.isArray(p._content) ? p._content : [];
  const pageable = (p._pageable ?? {}) as Record<string, unknown>;
  log("info", "account.statement.done", {
    count: content.length,
    environment: cfg.environment,
  });
  return {
    entries: content.map((t) => {
      const tx = (t ?? {}) as Record<string, unknown>;
      return {
        transactionId: str(tx.transactionId),
        date: str(tx.transactionDate),
        type: str(tx.type),
        creditDebit: str(tx.creditDebitType),
        name: str(tx.transactionName),
        amount: amountToStr(tx.amount),
        currency: str(tx.transactionCurrency) ?? "BRL",
        partyDocument: str(tx.partieCnpjCpf),
      };
    }),
    // Produção informa totalPages/totalRecords como strings. A UI já avisa
    // quando exibe somente os primeiros lançamentos; não esconder esse limite.
    hasMore: pageable._moreElements === true ||
      Number(pageable.totalPages) > 1 || Number(pageable.totalRecords) > content.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprovantes (Consult Payment Receipts) — reemissão do recibo do PIX
//
// Outro HOST (cfg.receiptsBaseUrl) e outra base (/consult_payment_receipts/v2),
// com token PRÓPRIO (getToken(receiptsBaseUrl)) porque o token de um host não
// vale no outro. Fluxo assíncrono de 3 passos:
//   1. listReceipts        — acha o comprovante por data/categoria/beneficiário → paymentId
//   2. createFileRequest   — POST pede a geração do PDF (202, assíncrono)       → requestId
//   3. getFileRequest      — GET pergunta até statusCode AVAILABLE              → location (PDF)
//
// SEM SANDBOX: a API só existe em trust-open/-h. Com credencial de sandbox isso
// provavelmente responde 401/403 até a virada de produção — por isso o
// comprovante é "montado agora, verificado na produção". Nada aqui move dinheiro.
// ─────────────────────────────────────────────────────────────────────────────

const RECEIPTS_PATH = "/consult_payment_receipts/v2";

function receiptsUrl(cfg: GwConfig, suffix: string): string {
  return `${cfg.receiptsBaseUrl}${RECEIPTS_PATH}${suffix}`;
}

export interface ReceiptView {
  paymentId: string | null;
  payeeName: string | null;
  payerDocument: string | null;
  amount: string | null;
  dateTime: string | null;
  category: string | null;
  channel: string | null;
}

function receiptViewOf(raw: unknown): ReceiptView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const payment = (r.payment ?? {}) as Record<string, unknown>;
  const payer = (payment.payer ?? {}) as Record<string, unknown>;
  const payerPerson = (payer.person ?? {}) as Record<string, unknown>;
  const payerDoc = (payerPerson.document ?? {}) as Record<string, unknown>;
  const payee = (payment.payee ?? {}) as Record<string, unknown>;
  const amountInfo = (payment.paymentAmountInfo ?? {}) as Record<string, unknown>;
  const direct = (amountInfo.direct ?? {}) as Record<string, unknown>;
  const category = (r.category ?? {}) as Record<string, unknown>;
  const channel = (r.channel ?? {}) as Record<string, unknown>;
  return {
    paymentId: str(payment.paymentId),
    payeeName: str(payee.name),
    payerDocument: str(payerDoc.documentNumber),
    amount: amountToStr(direct.amount),
    dateTime: str(payment.requestValueDateTime),
    category: str(category.code),
    channel: str(channel.code),
  };
}

export interface ReceiptFilters {
  startDate: string;
  endDate: string;
  category?: string | null;
  beneficiaryDocument?: string | null;
  accountAgency?: string | null;
  accountNumber?: string | null;
  limit?: number;
}

/** Lista comprovantes por filtro. Janela máxima de 30 dias (limite do banco).
 *  Quem casa o comprovante com a NOSSA transferência é o chamador (por
 *  valor + beneficiário), porque a listagem não aceita endToEnd nem o nosso id. */
export async function listReceipts(
  cfg: GwConfig,
  f: ReceiptFilters,
): Promise<{ receipts: ReceiptView[] }> {
  const q = new URLSearchParams({ start_date: f.startDate, end_date: f.endDate });
  if (f.category) q.set("category", f.category);
  if (f.beneficiaryDocument) q.set("beneficiary_document", f.beneficiaryDocument);
  if (f.accountAgency) q.set("account_agency", f.accountAgency);
  if (f.accountNumber) q.set("account_number", f.accountNumber);
  q.set("_limit", String(Math.min(Math.max(f.limit ?? 50, 1), 50)));

  const { json } = await call({
    method: "GET",
    url: receiptsUrl(cfg, `/payment_receipts?${q.toString()}`),
    headers: await authHeaders(cfg, cfg.receiptsBaseUrl),
    timeoutMs: TIMEOUT_GET_MS,
    retry: true,
    label: "GET receipts",
  });

  const p = (json ?? {}) as Record<string, unknown>;
  const list = Array.isArray(p.paymentsReceipts) ? p.paymentsReceipts : [];
  log("info", "receipts.list.done", { count: list.length, environment: cfg.environment });
  return { receipts: list.map(receiptViewOf) };
}

export interface FileRequestView {
  requestId: string | null;
  /** URL de download do PDF (blob com validade). Só vem quando AVAILABLE. */
  location: string | null;
  mimeType: string | null;
  statusCode: string | null;
  expirationDate: string | null;
}

function fileRequestViewOf(raw: unknown): FileRequestView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const request = (r.request ?? {}) as Record<string, unknown>;
  const file = (r.file ?? {}) as Record<string, unknown>;
  const repo = (file.fileRepository ?? {}) as Record<string, unknown>;
  const statusInfo = (file.statusInfo ?? {}) as Record<string, unknown>;
  return {
    requestId: str(request.requestId),
    location: str(repo.location),
    mimeType: str(file.mimeType),
    statusCode: str(statusInfo.statusCode),
    expirationDate: str(file.expirationDate),
  };
}

/** POST — pede a geração do arquivo. Assíncrono (202): devolve requestId e, se já
 *  pronto, a location. `requestValueDate` é o mês do pagamento no formato YYYY-MM.
 *  retry=false como todo POST — aqui repetir só geraria outro PDF do mesmo
 *  pagamento (inofensivo), mas a regra da casa é POST nunca repetir sozinho. */
export async function createReceiptFileRequest(
  cfg: GwConfig,
  paymentId: string,
  requestValueDate: string,
): Promise<FileRequestView> {
  const { json } = await call({
    method: "POST",
    url: receiptsUrl(
      cfg,
      `/payment_receipts/${encodeURIComponent(paymentId)}/file_requests`,
    ),
    headers: await authHeaders(cfg, cfg.receiptsBaseUrl),
    body: { payment: { requestValueDate } },
    timeoutMs: TIMEOUT_POST_MS,
    retry: false,
    label: "POST receipt file_request",
  });
  return fileRequestViewOf(json);
}

/** GET — pergunta o estado do arquivo. Repetir é seguro (consulta). O chamador
 *  faz o poll até statusCode AVAILABLE (a location vem preenchida aí). */
export async function getReceiptFileRequest(
  cfg: GwConfig,
  paymentId: string,
  requestId: string,
): Promise<FileRequestView> {
  const url = receiptsUrl(
    cfg,
    `/payment_receipts/${encodeURIComponent(paymentId)}/file_requests/${
      encodeURIComponent(requestId)
    }`,
  );

  const run = async () => {
    const { json } = await call({
      method: "GET",
      url,
      headers: await authHeaders(cfg, cfg.receiptsBaseUrl),
      timeoutMs: TIMEOUT_GET_MS,
      retry: true,
      label: "GET receipt file_request",
    });
    return fileRequestViewOf(json);
  };

  try {
    return await run();
  } catch (err) {
    // 401 num GET costuma ser token vencido entre a checagem e o uso — descarta
    // o do host de comprovante e tenta uma vez. Consulta pode repetir à vontade.
    if (err instanceof SantanderError && err.providerStatus === 401) {
      invalidateToken(cfg.receiptsBaseUrl);
      log("warn", "receipts.token.retry_after_401", { payment_id: paymentId });
      return await run();
    }
    throw err;
  }
}
