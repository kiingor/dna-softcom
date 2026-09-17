// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rethrowAgentModelError } from "../../supabase/functions/_shared/agents/model-error";
import {
  DEFAULT_AGENT_ROUTER_MODEL,
  getAgentModelConfig,
  normalizeAgentBaseURL,
} from "../../supabase/functions/_shared/agents/model-config";

describe("configuração do provedor dos chats", () => {
  it("trata saturação como temporária sem expor a mensagem do gateway", () => {
    expect(() =>
      rethrowAgentModelError({ status: 429, message: "private upstream data" }),
    ).toThrow("30 segundos");
    try {
      rethrowAgentModelError({ status: 429, message: "private upstream data" });
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: "provider_busy" });
      expect((error as Error).message).not.toContain("private");
    }
    const abort = new DOMException("Abortado", "AbortError");
    expect(() => rethrowAgentModelError(abort)).toThrow(abort);
  });
  const env = (values: Record<string, string>) => (name: string) =>
    values[name];
  it("preserva o roteador legado quando a conexão dedicada não está configurada", () => {
    expect(getAgentModelConfig("analyst", env({}))).toEqual({
      model: "dna-model",
      client: undefined,
    });
  });
  it("usa credencial dedicada e aceita a base com /v1 sem duplicar o caminho", () => {
    expect(
      getAgentModelConfig(
        "recruiter",
        env({
          AGENT_MODEL_BASE_URL: "https://router.example/v1/",
          AGENT_MODEL_API_KEY: "fixture-key",
        }),
      ),
    ).toEqual({
      model: DEFAULT_AGENT_ROUTER_MODEL,
      client: { baseURL: "https://router.example", apiKey: "fixture-key" },
    });
  });
  it("permite modelo diferente por agente", () => {
    const read = env({
      AGENT_MODEL_BASE_URL: "https://router.example/v1",
      AGENT_MODEL_API_KEY: "fixture-key",
      AGENT_ANALYST_MODEL: "analysis-model",
      AGENT_RECRUITER_MODEL: "recruiter-model",
    });
    expect(getAgentModelConfig("analyst", read).model).toBe("analysis-model");
    expect(getAgentModelConfig("recruiter", read).model).toBe(
      "recruiter-model",
    );
  });
  it("não reutiliza credencial legada em uma conexão parcialmente configurada", () => {
    expect(() =>
      getAgentModelConfig(
        "analyst",
        env({
          AGENT_MODEL_BASE_URL: "https://router.example",
          ANTHROPIC_API_KEY: "legacy-key",
        }),
      ),
    ).toThrow();
    expect(() =>
      getAgentModelConfig(
        "analyst",
        env({ AGENT_MODEL_API_KEY: "fixture-key" }),
      ),
    ).toThrow();
  });
  it("recusa URL que poderia expor credenciais ou enviar por HTTP", () => {
    for (const url of [
      "http://router.example",
      "https://user:pass@router.example",
      "https://router.example?key=value",
      "https://router.example#fragment",
      "invalid",
    ])
      expect(() => normalizeAgentBaseURL(url)).toThrow();
    expect(normalizeAgentBaseURL("https://router.example/prefix/v1/")).toBe(
      "https://router.example/prefix",
    );
  });
});
