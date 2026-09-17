/**
 * Embeddings compartilhados — TODA geração de embedding de candidato passa por
 * aqui, batendo DIRETO na API da OpenAI (`api.openai.com/v1/embeddings`).
 *
 * Modelo: `text-embedding-3-small` @ 1536 dims — casa com a coluna
 * `vector(1536)` e o índice ivfflat (`vector_cosine_ops`) já existentes, sem
 * migração de schema. É o modelo pro qual a tabela foi desenhada originalmente.
 *
 * Histórico da rota de embeddings:
 *   OpenAI (original) → iarouter/gemini-embedding-001 (PR #46, quando a
 *   OPENAI_API_KEY estava inválida) → OpenAI direto de novo (o iarouter ficou
 *   sem credencial de provider de embeddings: `/v1/embeddings` respondia
 *   `400 "No credentials for embedding provider"` pra gemini E openai, enquanto
 *   `/v1/messages` seguia OK). Como o espaço vetorial gemini ≠ openai, cada
 *   troca de modelo exige RE-BACKFILL de todo o corpus (scripts/backfill-*).
 *
 * CRÍTICO: a query (recruiter-search) e o corpus (cv-process, recruitment-apply)
 * DEVEM usar o MESMO modelo + dims. Se divergir, a busca compara espaços
 * vetoriais diferentes e o ranking vira lixo. Por isso fica centralizado aqui.
 *
 * Secret necessário: `OPENAI_API_KEY` (Supabase Edge Functions).
 */

/** Modelo de embedding da OpenAI. 1536 dims é o nativo do `-3-small`. */
export const EMBED_MODEL = "text-embedding-3-small";

/** Dimensões pedidas — casa com a coluna vector(1536) e o índice ivfflat. */
export const EMBED_DIMENSIONS = 1536;

/** Valor gravado em candidate_embeddings.model (rastreabilidade do que indexou). */
export const EMBED_MODEL_LABEL = "text-embedding-3-small";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/**
 * Gera o embedding de um texto via OpenAI. Lança em erro de rede/HTTP ou se o
 * shape vier inesperado (deixa o chamador decidir se é fatal).
 */
export async function embedText(
  input: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("[embeddings] OPENAI_API_KEY ausente");

  const resp = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input,
      dimensions: EMBED_DIMENSIONS,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI embeddings ${resp.status}: ${await resp.text()}`);
  }

  const j = await resp.json();
  const embedding = j?.data?.[0]?.embedding;
  // text-embedding-3-small @ dimensions=1536 já devolve exatamente 1536 (nativo),
  // então não precisa truncar como no gemini (Matryoshka).
  if (!Array.isArray(embedding) || embedding.length !== EMBED_DIMENSIONS) {
    throw new Error(
      `OpenAI embeddings: shape inesperado (len=${embedding?.length ?? "null"})`,
    );
  }
  return embedding as number[];
}
