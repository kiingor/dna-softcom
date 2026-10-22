import { FunctionsHttpError } from "@supabase/supabase-js";

/** Lê a mensagem da aplicação sem expor detalhes de banco ou payloads. */
export async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const failure = await error.context.clone().json().catch(() => null);
    if (typeof failure?.error === "string" && failure.error.trim()) return failure.error;
  }
  return error instanceof Error ? error.message : fallback;
}
