export type AgentKind = "analyst" | "recruiter";
export type JsonRecord = Record<string, unknown>;
export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };
export interface Tool {
  name: string;
  description: string;
  input_schema: JsonRecord;
}
export interface ModelReply {
  content: Block[];
  model: string;
  stop_reason?: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}
export interface ModelRequest {
  system: string;
  messages: Message[];
  tools?: Tool[];
  signal: AbortSignal;
}
export interface Source {
  label: string;
  href: string;
  consultedAt: string;
  detail?: string;
}
export interface Selection {
  id: string;
  reason: string;
  evidence: string[];
  gaps: string[];
}
export interface TaskContext {
  brief?: string;
  selection?: Selection[];
  jobId?: string;
  analysis?: { tool: string; filters: JsonRecord };
}
export interface Candidate {
  id: string;
  name: string;
  cv_summary: string | null;
  source: string | null;
  cv_url?: string | null;
  is_active: boolean;
  similarity?: number;
  reason?: string;
  evidence?: string[];
  gaps?: string[];
}
export class AgentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentError(400, "invalid_input", "Confira os dados do pedido.");
  return value as JsonRecord;
}
export function textField(
  value: unknown,
  max = 2000,
  optional = false,
): string | undefined {
  if (optional && (value === undefined || value === null || value === ""))
    return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new AgentError(
      400,
      "invalid_input",
      `Use um texto de até ${max} caracteres.`,
    );
  return value.trim();
}
export function uuid(value: unknown, optional = false): string | undefined {
  if (optional && (value === undefined || value === null || value === ""))
    return undefined;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new AgentError(
      400,
      "invalid_id",
      "A referência do pedido é inválida. Atualize a página.",
    );
  return value;
}
export function enumField(
  value: unknown,
  values: readonly string[],
): string | undefined {
  const result = textField(value, 80, true);
  if (result && !values.includes(result))
    throw new AgentError(400, "invalid_filter", "Filtro inválido.");
  return result;
}
export function dateField(value: unknown): string | undefined {
  const date = textField(value, 10, true);
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    throw new AgentError(
      400,
      "invalid_date",
      "Use uma data válida no formato AAAA-MM-DD.",
    );
  return date;
}
export function stringList(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value) || value.length > maxItems)
    throw new AgentError(400, "invalid_list", "Lista inválida.");
  return value.map((v) => textField(v, 500)!);
}
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentError)
    return { code: error.code, message: error.message };
  return {
    code: "temporarily_unavailable",
    message:
      "Não consegui concluir agora. Seu pedido foi preservado; tente novamente.",
  };
}
