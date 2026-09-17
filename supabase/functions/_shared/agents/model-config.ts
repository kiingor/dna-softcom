import { AgentError, type AgentKind } from "./contracts.ts";

export const DEFAULT_AGENT_ROUTER_MODEL = "cx/gpt-5.5-low";

/** O SDK Anthropic acrescenta /v1/messages; aceita a URL /v1 entregue pelo router. */
export function normalizeAgentBaseURL(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("invalid_url");
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new AgentError(
      503,
      "model_configuration",
      "A conexão deste agente precisa ser configurada pela equipe responsável.",
    );
  }
}

export function getAgentModelConfig(
  kind: AgentKind,
  env: (name: string) => string | undefined,
) {
  const baseURL = env("AGENT_MODEL_BASE_URL")?.trim();
  const apiKey = env("AGENT_MODEL_API_KEY")?.trim();
  const override = env(
    kind === "analyst" ? "AGENT_ANALYST_MODEL" : "AGENT_RECRUITER_MODEL",
  )?.trim();
  if (baseURL || apiKey) {
    if (!baseURL || !apiKey)
      throw new AgentError(
        503,
        "model_configuration",
        "A conexão deste agente precisa ser configurada pela equipe responsável.",
      );
    return {
      model: override || DEFAULT_AGENT_ROUTER_MODEL,
      client: { baseURL: normalizeAgentBaseURL(baseURL), apiKey },
    };
  }
  return { model: override || "dna-model", client: undefined };
}
