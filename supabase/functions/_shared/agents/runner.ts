import {
  AgentError,
  safeError,
  type Message,
  type ModelReply,
  type ModelRequest,
  type Tool,
} from "./contracts.ts";

export interface RunnerOptions {
  system: string;
  messages: Message[];
  tools: Tool[];
  callModel: (request: ModelRequest) => Promise<ModelReply>;
  execute: (name: string, input: unknown) => Promise<unknown>;
  signal: AbortSignal;
  onProgress?: (label: string) => void;
  maxRounds?: number;
}
export async function runAgent(options: RunnerOptions) {
  const messages = [...options.messages];
  const calls: { tool: string; ok: boolean; durationMs: number }[] = [];
  let tokensInput = 0,
    tokensOutput = 0,
    model = "";
  const rounds = options.maxRounds ?? 5;
  for (let round = 0; round <= rounds; round++) {
    options.signal.throwIfAborted();
    const finalRound = round === rounds;
    const reply = await options.callModel({
      system:
        options.system +
        (finalRound
          ? "\nO orçamento de consultas terminou. Responda com os dados já obtidos e informe limitações. Não solicite mais ferramentas."
          : ""),
      messages,
      tools: finalRound ? undefined : options.tools,
      signal: options.signal,
    });
    tokensInput += reply.usage?.input_tokens ?? 0;
    tokensOutput += reply.usage?.output_tokens ?? 0;
    model = reply.model;
    const toolCalls = reply.content.filter((b) => b.type === "tool_use");
    if (!toolCalls.length) {
      let text = reply.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!text)
        throw new AgentError(
          502,
          "empty_reply",
          "A resposta veio vazia. Tente novamente.",
        );
      const truncated = reply.stop_reason === "max_tokens";
      if (truncated)
        text +=
          "\n\nA resposta atingiu o limite de tamanho. Posso continuar a partir daqui.";
      return { text, calls, model, tokensInput, tokensOutput, truncated };
    }
    if (finalRound || toolCalls.length > 8)
      throw new AgentError(
        502,
        "tool_limit",
        "A consulta ficou extensa demais. Tente dividir o pedido em duas partes.",
      );
    messages.push({ role: "assistant", content: reply.content });
    const results = [];
    for (const tool of toolCalls) {
      options.signal.throwIfAborted();
      const start = Date.now();
      let output: unknown,
        failed = false;
      try {
        if (!options.tools.some((t) => t.name === tool.name))
          throw new AgentError(400, "unknown_tool", "Consulta não disponível.");
        options.onProgress?.(tool.name);
        output = await options.execute(tool.name, tool.input);
      } catch (error) {
        options.signal.throwIfAborted();
        failed = true;
        output = { status: "error", ...safeError(error) };
      }
      calls.push({
        tool: tool.name,
        ok: !failed,
        durationMs: Date.now() - start,
      });
      results.push({
        type: "tool_result" as const,
        tool_use_id: tool.id,
        content: JSON.stringify(output),
        is_error: failed,
      });
    }
    messages.push({ role: "user", content: results });
  }
  throw new AgentError(
    502,
    "tool_limit",
    "Não consegui concluir as consultas. Tente um pedido mais específico.",
  );
}
