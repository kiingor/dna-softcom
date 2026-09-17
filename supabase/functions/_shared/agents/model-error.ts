import { AgentError } from "./contracts.ts";

/** Traduz saturação do gateway sem expor o corpo/credenciais do upstream. */
export function rethrowAgentModelError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    error.status === 429
  ) {
    throw new AgentError(
      503,
      "provider_busy",
      "A IA está ocupada no momento. Aguarde pelo menos 30 segundos e tente novamente. Seu pedido foi preservado.",
    );
  }
  throw error;
}
