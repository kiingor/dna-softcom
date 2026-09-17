// Contrato local do protocolo usado pelas Edge Functions. O SDK remoto usa
// ?no-dts para evitar o grafo de tipos incompatível do runtime self-hosted.
// Tipos locais são apagados no build e não acrescentam imports npm no servidor.
export interface TextBlockParam {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: { type: "ephemeral" };
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: { type: "ephemeral" };
}
export interface FileBlock {
  type: "document" | "image";
  source: { type: "base64"; media_type: string; data: string };
  cache_control?: { type: "ephemeral" };
}
export type ContentBlockParam =
  | TextBlockParam
  | ToolUseBlock
  | ToolResultBlock
  | FileBlock;
export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}
export interface Tool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}
export type ToolChoice =
  | { type: "auto" | "any" | "none" }
  | { type: "tool"; name: string };
export interface Message {
  model: string;
  content: (
    | TextBlockParam
    | ToolUseBlock
    | { type: "thinking"; thinking: string; signature: string }
  )[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
}
export interface MessageCreateParamsNonStreaming {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | TextBlockParam[];
  tools?: Tool[];
  tool_choice?: ToolChoice;
}
