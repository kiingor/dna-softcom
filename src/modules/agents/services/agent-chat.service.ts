import { supabase } from "@/integrations/supabase/client";
import type { AgentChatResponse, ChatAgentKind } from "../types";

export interface ChatRequest {
  sessionId: string | null;
  companyId: string;
  query: string;
  requestId: string;
}
export type StreamEvent = { event: string; data: Record<string, unknown> };
export class ChatError extends Error {
  constructor(
    message: string,
    public code?: string,
    public sessionId?: string,
  ) {
    super(message);
  }
}

// SSE pode dividir JSON, caracteres UTF-8 ou separadores entre chunks.
export async function readAgentStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<AgentChatResponse> {
  if (!response.body)
    throw new ChatError("A resposta veio vazia. Tente novamente.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    completed: AgentChatResponse | undefined;
  function consume() {
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = frame.split("\n"),
        event =
          lines
            .find((l) => l.startsWith("event:"))
            ?.slice(6)
            .trim() ?? "message";
      const raw = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!raw) continue;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (event === "error")
        throw new ChatError(
          String(data.error ?? "Não consegui concluir o pedido."),
          String(data.code ?? ""),
          data.sessionId as string | undefined,
        );
      onEvent({ event, data });
      if (event === "complete")
        completed = data as unknown as AgentChatResponse;
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
    buffer += decoder.decode();
    consume();
    if (!completed?.success)
      throw new ChatError(
        "A conexão foi interrompida. Tente novamente para recuperar a resposta.",
        "interrupted",
      );
    return completed;
  } finally {
    reader.releaseLock();
  }
}

export async function sendAgentMessage(
  kind: ChatAgentKind,
  body: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    throw new ChatError(
      "Entre novamente para continuar.",
      "authentication_required",
    );
  const endpoint = kind === "analyst" ? "analyst-chat" : "recruiter-search";
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Não consegui enviar o pedido. Tente novamente.",
    }));
    throw new ChatError(error.error, error.code, error.sessionId);
  }
  // Compatível com replay JSON e com versões que não oferecem SSE.
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return (await response.json()) as AgentChatResponse;
  return readAgentStream(response, onEvent);
}
export async function rateAgentMessage(
  kind: ChatAgentKind,
  companyId: string,
  messageId: string,
  rating: 1 | -1,
) {
  const { data, error } = await supabase.functions.invoke(
    kind === "analyst" ? "analyst-chat" : "recruiter-search",
    { body: { action: "feedback", companyId, messageId, rating } },
  );
  if (error || !data?.success)
    throw new Error("Não consegui salvar sua avaliação. Tente novamente.");
}
