// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const company = randomUUID(),
  other = randomUUID(),
  active = randomUUID(),
  inactive = randomUUID(),
  wrongModel = randomUUID(),
  foreign = randomUUID();
const embedding = JSON.stringify([1, ...Array(1535).fill(0)]);
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`CREATE EXTENSION vector;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE candidates(id uuid PRIMARY KEY,company_id uuid,is_active boolean,source text);
 CREATE TABLE candidate_embeddings(candidate_id uuid,company_id uuid,embedding vector(1536),model text);
 ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;ALTER TABLE candidate_embeddings ENABLE ROW LEVEL SECURITY;
 CREATE POLICY candidate_company ON candidates TO authenticated USING (company_id=current_setting('test.company')::uuid);
 CREATE POLICY embedding_company ON candidate_embeddings TO authenticated USING (company_id=current_setting('test.company')::uuid);
 GRANT SELECT ON candidates,candidate_embeddings TO authenticated;`);
  for (const [id, cid, enabled, model] of [
    [active, company, true, "compatible"],
    [inactive, company, false, "compatible"],
    [wrongModel, company, true, "old-model"],
    [foreign, other, true, "compatible"],
  ] as const) {
    await db.query("INSERT INTO candidates VALUES($1,$2,$3,$4)", [
      id,
      cid,
      enabled,
      "site",
    ]);
    await db.query(
      "INSERT INTO candidate_embeddings VALUES($1,$2,$3::vector,$4)",
      [id, cid, embedding, model],
    );
  }
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20260917140200_agent_candidate_search.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("SELECT set_config('test.company',$1,false)", [company]);
  await db.exec("SET ROLE authenticated");
});
afterAll(async () => {
  await db?.close();
});
it("busca vetorial real exclui inativos, outra empresa e modelo incompatível", async () => {
  const { rows } = await db.query<{ candidate_id: string }>(
    "SELECT * FROM agent_match_candidates($1::vector,$2,$3)",
    [embedding, company, "compatible"],
  );
  expect(rows.map((r) => r.candidate_id)).toEqual([active]);
});
it("RLS bloqueia consulta mesmo passando company_id alheio", async () => {
  const { rows } = await db.query(
    "SELECT * FROM agent_match_candidates($1::vector,$2,$3)",
    [embedding, other, "compatible"],
  );
  expect(rows).toHaveLength(0);
});
it("respeita elegibilidade da vaga e origem", async () => {
  const empty = await db.query(
    "SELECT * FROM agent_match_candidates($1::vector,$2,$3,$4::uuid[],$5)",
    [embedding, company, "compatible", [], null],
  );
  expect(empty.rows).toHaveLength(0);
  const filtered = await db.query(
    "SELECT * FROM agent_match_candidates($1::vector,$2,$3,$4::uuid[],$5)",
    [embedding, company, "compatible", [active], "linkedin"],
  );
  expect(filtered.rows).toHaveLength(0);
});
