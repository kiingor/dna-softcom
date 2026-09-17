/**
 * Claude API wrapper for SoftHouse — Deno (Edge Functions) edition.
 *
 * Mirror of `src/lib/claude.ts` adapted for the Supabase Edge Functions
 * runtime (Deno). Key differences from the Node/Vite version:
 *  - Imports the SDK from `esm.sh` (no npm available in Deno deploy).
 *  - Reads the API key from `Deno.env.get("ANTHROPIC_API_KEY")` (not from
 *    `import.meta.env.VITE_*`).
 *
 * Otherwise the surface and semantics match: same defaults (`dna-model` via
 * iarouter, 4096 max tokens), same automatic prompt caching on the last system
 * block + last user message, same `extractTextFromResponse` helper.
 *
 * Used by:
 *  - admission-document-validate
 *  - recruitment-cv-screen
 *  - agent-mcp-bridge
 *  - any future Edge Function that calls Claude.
 */

// SDK pinned to a known version. Bump deliberately; changing the URL is the
// equivalent of a version bump in package.json for the Node side.
//
// `?no-dts` é obrigatório: o edge-runtime self-hosted resolve os tipos do
// pacote ao montar o grafo de módulos, e o `.d.mts` do SDK tem um import
// relativo inválido ("node-fetch.js"), o que derruba o worker no boot com
// "failed to create the graph: Failed resolving types". A Supabase Cloud não
// resolve tipos e por isso não sofria com isso. O parâmetro só suprime as
// declarações de tipo — o JavaScript entregue é idêntico.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.91.1?no-dts";

/** Default model used by every SoftHouse agent unless explicitly overridden.
 * `dna-model` é o alias/combo do iarouter (ANTHROPIC_BASE_URL custom da Softcom):
 * fala o protocolo Anthropic (/v1/messages) mas roteia o request pro backend
 * que ele escolher (Gemini, GPT, etc.). Sem prefixo. */
export const DEFAULT_CLAUDE_MODEL = "dna-model";

/** Default max output tokens. Bump per-call for long extractions / reports. */
export const DEFAULT_MAX_TOKENS = 4096;

// Re-exported types so callers can stay decoupled from the SDK URL.
import type * as Protocol from "./claude-protocol.ts";
type ClaudeClient = InstanceType<typeof Anthropic>;

export type ClaudeMessage = Protocol.MessageParam;
export type ClaudeTool = Protocol.Tool;
export type ClaudeToolChoice = Protocol.ToolChoice;
export type ClaudeResponse = Protocol.Message;
export type ClaudeContentBlock = Protocol.Message["content"][number];
export type ClaudeTextBlock = Protocol.TextBlockParam;
export type ClaudeToolUseBlock = Protocol.ToolUseBlock;

let _client: ClaudeClient | null = null;
let _directClient: ClaudeClient | null = null;

/**
 * Returns a singleton Anthropic client. Reads `ANTHROPIC_API_KEY` from the
 * Edge Function environment (set via `supabase secrets set`).
 *
 * @example
 *   const client = getClaudeClient();
 *   const res = await client.messages.create({ ... });
 */
export function getClaudeClient(): ClaudeClient {
  if (_client) return _client;

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "[claude] ANTHROPIC_API_KEY is not set in the Edge Function environment.",
    );
  }

  // Optional custom router endpoint (e.g. omnirouter via softcom).
  const baseURL = Deno.env.get("ANTHROPIC_BASE_URL") || undefined;

  _client = new Anthropic({ apiKey, baseURL });
  return _client;
}

/**
 * Cliente Anthropic "direto". Antes batia em api.anthropic.com pra bypassar o
 * omnirouter; com a migração pro iarouter (que já é o gateway único) ele aponta
 * pro MESMO router — `dna-model` não existe em api.anthropic.com, então o
 * "direto" agora só significa um cliente/sessão separado, mesma baseURL.
 * Lê `ANTHROPIC_DIRECT_API_KEY` (ou cai pra `ANTHROPIC_API_KEY` se não houver).
 */
export function getDirectClaudeClient(): ClaudeClient {
  if (_directClient) return _directClient;

  const apiKey =
    Deno.env.get("ANTHROPIC_DIRECT_API_KEY") ??
    Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "[claude] ANTHROPIC_DIRECT_API_KEY/ANTHROPIC_API_KEY ausente.",
    );
  }

  // Mesmo router do cliente padrão (iarouter). Fallback pra api.anthropic.com
  // só se ANTHROPIC_BASE_URL não estiver setada.
  const baseURL =
    Deno.env.get("ANTHROPIC_BASE_URL") || "https://api.anthropic.com";
  _directClient = new Anthropic({ apiKey, baseURL });
  return _directClient;
}

export interface CallClaudeOptions {
  /** System prompt — string or structured blocks. */
  system?: string | Protocol.TextBlockParam[];
  /** Conversation messages (user/assistant). Required. */
  messages: ClaudeMessage[];
  /** Optional tool definitions for tool-use flows. */
  tools?: ClaudeTool[];
  /** Optional `tool_choice` directive. */
  toolChoice?: ClaudeToolChoice;
  /** Override the default model. */
  model?: string;
  /** Override the default `max_tokens` (4096). */
  maxTokens?: number;
  /** Disable automatic prompt caching. Default: false (caching ON). */
  disableCache?: boolean;
  /** Bypassa o omnirouter — chama api.anthropic.com direto. */
  direct?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  onText?: (text: string) => void;
}

/**
 * Calls Claude with sensible SoftHouse defaults. See `src/lib/claude.ts` for
 * the full doc — behavior is identical here.
 *
 * @example
 *   const res = await callClaude({
 *     system: "You are a CV screener.",
 *     messages: [{ role: "user", content: cvText }],
 *   });
 *   const summary = extractTextFromResponse(res);
 */
export async function callClaude(
  options: CallClaudeOptions,
): Promise<ClaudeResponse> {
  const {
    system,
    messages,
    tools,
    toolChoice,
    model = DEFAULT_CLAUDE_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    disableCache = false,
    direct = false,
    signal,
    timeoutMs,
    maxRetries,
    onText,
  } = options;

  const client = direct ? getDirectClaudeClient() : getClaudeClient();
  // Compat: remove prefixo legado `cc/` caso algum chamador passe model antigo.
  // Com `dna-model` (default atual) isso é no-op.
  const finalModel = model.replace(/^cc\//, "");

  const params: Protocol.MessageCreateParamsNonStreaming = {
    model: finalModel,
    max_tokens: maxTokens,
    messages: disableCache ? messages : applyCacheToLastUserMessage(messages),
  };

  if (system !== undefined) {
    params.system = disableCache ? system : applyCacheToSystem(system);
  }
  if (tools !== undefined) params.tools = tools;
  if (toolChoice !== undefined) params.tool_choice = toolChoice;

  const requestOptions = { signal, timeout: timeoutMs, maxRetries };
  if (onText) {
    const stream = client.messages.stream(params, requestOptions);
    stream.on("text", (text: string) => onText(text));
    return await stream.finalMessage();
  }
  return await client.messages.create(params, requestOptions);
}

/**
 * Extracts concatenated text from a Claude response, ignoring non-text blocks
 * (tool_use, thinking, etc.).
 *
 * @example
 *   const text = extractTextFromResponse(res);
 */
export function extractTextFromResponse(response: ClaudeResponse): string {
  return response.content
    .filter((block): block is ClaudeTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Internal helpers — caching placement (must match src/lib/claude.ts).
// ---------------------------------------------------------------------------

function applyCacheToSystem(
  system: string | Protocol.TextBlockParam[],
): Protocol.TextBlockParam[] {
  const blocks: Protocol.TextBlockParam[] =
    typeof system === "string" ? [{ type: "text", text: system }] : [...system];

  if (blocks.length === 0) return blocks;

  const lastIdx = blocks.length - 1;
  blocks[lastIdx] = {
    ...blocks[lastIdx],
    cache_control: { type: "ephemeral" },
  };
  return blocks;
}

function applyCacheToLastUserMessage(
  messages: ClaudeMessage[],
): ClaudeMessage[] {
  if (messages.length === 0) return messages;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return messages;

  const cloned = [...messages];
  const target = cloned[lastUserIdx];

  const blocks: Protocol.ContentBlockParam[] =
    typeof target.content === "string"
      ? [{ type: "text", text: target.content }]
      : [...target.content];

  if (blocks.length === 0) return messages;

  const lastBlockIdx = blocks.length - 1;
  blocks[lastBlockIdx] = {
    ...blocks[lastBlockIdx],
    cache_control: { type: "ephemeral" },
  } as Protocol.ContentBlockParam;

  cloned[lastUserIdx] = { ...target, content: blocks };
  return cloned;
}
