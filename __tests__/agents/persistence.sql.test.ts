// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
let db: PGlite;
const user = randomUUID(),
  other = randomUUID(),
  company = randomUUID(),
  otherCompany = randomUUID();
const migration = (name: string) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.user',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.companies(id uuid PRIMARY KEY);CREATE TABLE public.profiles(user_id uuid,company_id uuid);CREATE TABLE public.user_roles(user_id uuid,role text);
 CREATE FUNCTION public.user_belongs_to_company(a uuid,b uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=a AND company_id=b OR user_id=b AND company_id=a)$$;
 CREATE FUNCTION public.handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now();RETURN NEW;END$$;
 CREATE FUNCTION public.audit_log_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;`);
  await db.exec(migration("20260429160000_create_agent_tables.sql"));
  await db.exec(migration("20260917140000_agent_turns.sql"));
  await db.query("INSERT INTO auth.users VALUES ($1),($2)", [user, other]);
  await db.query("INSERT INTO companies VALUES ($1),($2)", [
    company,
    otherCompany,
  ]);
  await db.query("INSERT INTO profiles VALUES ($1,$2),($3,$4)", [
    user,
    company,
    other,
    otherCompany,
  ]);
  await db.exec(`CREATE TABLE admission_journeys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,status text,regime text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 INSERT INTO admission_journeys(company_id,status,regime,created_at) VALUES('${company}','docs_in_review','clt','2026-01-01');`);
  await db.exec(migration("20260917140100_agent_admission_metrics.sql"));
});
afterAll(async () => {
  await db?.close();
});
async function begin(
  requestId = randomUUID(),
  sessionId: string | null = null,
  uid = user,
  cid = company,
  kind = "recruiter",
  query = "Suporte SQL",
) {
  const { rows } = await db.query<{
    result: {
      run: { id: string; lease_id: string; user_message_id: string };
      session: { id: string };
      replayed: boolean;
    };
  }>("SELECT agent_begin_turn($1,$2,$3,$4,$5,$6) result", [
    uid,
    cid,
    kind,
    sessionId,
    requestId,
    query,
  ]);
  return rows[0].result;
}
async function finish(run: { id: string; lease_id: string }) {
  return db.query("SELECT agent_finish_turn($1,$2,$3,$4,$5,$6,$7,$8)", [
    run.id,
    run.lease_id,
    "Resposta",
    {},
    { brief: "Suporte SQL" },
    "test",
    10,
    20,
  ]);
}
describe("persistência transacional real no Postgres", () => {
  it("salva o pedido antes da resposta e impede dois turnos simultâneos", async () => {
    const result = await begin();
    const messages = await db.query(
      "SELECT * FROM agent_messages WHERE session_id=$1",
      [result.session.id],
    );
    expect(messages.rows).toHaveLength(1);
    await expect(begin(randomUUID(), result.session.id)).rejects.toThrow(
      "turn_running",
    );
    await finish(result.run);
  });
  it("reenvia uma resposta pronta sem duplicar mensagens", async () => {
    const id = randomUUID(),
      first = await begin(id);
    await finish(first.run);
    const second = await begin(id);
    expect(second.replayed).toBe(true);
    expect(second.session.id).toBe(first.session.id);
    const { rows } = await db.query(
      "SELECT * FROM agent_messages WHERE session_id=$1",
      [first.session.id],
    );
    expect(rows).toHaveLength(2);
  });
  it("retry de falha reutiliza mensagem e invalida execução anterior", async () => {
    const id = randomUUID(),
      first = await begin(id);
    await db.query("UPDATE agent_runs SET status='failed' WHERE id=$1", [
      first.run.id,
    ]);
    const retry = await begin(id, first.session.id);
    expect(retry.run.user_message_id).toBe(first.run.user_message_id);
    expect(retry.run.lease_id).not.toBe(first.run.lease_id);
    await expect(finish(first.run)).rejects.toThrow("stale_run");
    await finish(retry.run);
  });
  it("não aceita a mesma chave para outro pedido", async () => {
    const id = randomUUID(),
      result = await begin(id);
    await finish(result.run);
    await expect(
      begin(id, null, user, company, "recruiter", "Outro pedido"),
    ).rejects.toThrow("request_conflict");
  });
  it.each(["user", "company", "kind"])(
    "nega sessão com %s diferente",
    async (field) => {
      const first = await begin();
      await finish(first.run);
      await expect(
        begin(
          randomUUID(),
          first.session.id,
          field === "user" ? other : user,
          field === "company" ? otherCompany : company,
          field === "kind" ? "analyst" : "recruiter",
        ),
      ).rejects.toThrow("session_not_found");
    },
  );
  it("não reutiliza conversa arquivada", async () => {
    const first = await begin();
    await finish(first.run);
    await db.query("UPDATE agent_sessions SET archived_at=now() WHERE id=$1", [
      first.session.id,
    ]);
    await expect(begin(randomUUID(), first.session.id)).rejects.toThrow(
      "session_not_found",
    );
  });
  it("não deixa retry antigo ultrapassar conversa mais recente", async () => {
    const id = randomUUID(),
      first = await begin(id);
    await db.query("UPDATE agent_runs SET status='failed' WHERE id=$1", [
      first.run.id,
    ]);
    const next = await begin(randomUUID(), first.session.id);
    await finish(next.run);
    await expect(begin(id, first.session.id)).rejects.toThrow("stale_request");
  });
  it("RPC de execução não pode ser chamada por authenticated", async () => {
    await db.exec("SET ROLE authenticated");
    try {
      await expect(begin()).rejects.toThrow("permission denied");
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});
describe("tempo de etapa com dados legados", () => {
  it("mantém tempo desconhecido em registro anterior à migration", async () => {
    const { rows } = await db.query<{ avg_days_in_status: number | null }>(
      "SELECT avg_days_in_status FROM agent_admission_funnel",
    );
    expect(rows[0].avg_days_in_status).toBeNull();
  });
  it("registra transição real e não reinicia em edição comum", async () => {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM admission_journeys LIMIT 1",
    );
    const id = rows[0].id;
    await db.query(
      "UPDATE admission_journeys SET status='docs_approved' WHERE id=$1",
      [id],
    );
    const before = await db.query(
      "SELECT status_entered_at FROM admission_journeys WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE admission_journeys SET regime='pj',status_entered_at='2020-01-01' WHERE id=$1",
      [id],
    );
    const after = await db.query(
      "SELECT status_entered_at FROM admission_journeys WHERE id=$1",
      [id],
    );
    expect(after.rows).toEqual(before.rows);
  });
});
