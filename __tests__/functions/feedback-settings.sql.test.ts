// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherCompany = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const campaign = "11111111-1111-4111-8111-111111111111";
const culture = "22222222-2222-4222-8222-222222222222";
const otherCulture = "33333333-3333-4333-8333-333333333333";
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${user}'::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE user_roles(user_id uuid, role text);
    CREATE TABLE user_permissions(user_id uuid, company_id uuid, module text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean);
    CREATE FUNCTION is_company_admin(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION user_belongs_to_company(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${user}');
    INSERT INTO companies VALUES ('${company}'), ('${otherCompany}');
  `);
  const helper = migration("20261014173000_fix_vacation_edit_permissions.sql");
  await db.exec(helper.slice(helper.indexOf("CREATE OR REPLACE FUNCTION public.has_module_permission("), helper.indexOf("CREATE OR REPLACE FUNCTION public.can_manage_company_vacations(")));
  await db.exec(migration("20260427130200_create_audit_log.sql"));
  await db.exec(migration("20261027180000_feedback_culture_settings.sql"));
  await db.exec(`
    INSERT INTO feedback_campaigns (id, company_id, name) VALUES ('${campaign}', '${company}', 'Integração');
    INSERT INTO feedback_cultures (id, company_id, name) VALUES ('${culture}', '${company}', 'Cooperação'), ('${otherCulture}', '${otherCompany}', 'Inovação');
    INSERT INTO feedback_classifications (company_id, agenda_objective_id, agenda_collaborator_id, campaign_id, culture_id, updated_by)
      VALUES ('${company}', 42, 7, '${campaign}', '${culture}', '${user}');
  `);
});
beforeEach(() => db.exec("BEGIN"));
afterEach(() => db.exec("ROLLBACK; RESET ROLE"));
afterAll(() => db.close());

async function permissions(module: string, create = false, edit = false) {
  await db.query("INSERT INTO user_permissions VALUES ($1,$2,$3,true,$4,$5,false)", [user, company, module, create, edit]);
  await db.exec("SET ROLE authenticated");
}

describe("catálogos e classificação de feedback: migration e RLS", () => {
  it("permite configurar apenas a empresa autorizada", async () => {
    await permissions("configuracoes", true, true);
    await db.query("INSERT INTO feedback_campaigns (company_id, name) VALUES ($1, $2)", [company, "Boas-vindas"]);
    expect((await db.query("SELECT name FROM feedback_cultures")).rows).toEqual([{ name: "Cooperação" }]);
    await expect(db.query("INSERT INTO feedback_cultures (company_id, name) VALUES ($1, $2)", [otherCompany, "Outra"])).rejects.toThrow(/row-level security/);
  });
  it("permite ler opções para lançar feedback, sem permitir administrar cadastros", async () => {
    await permissions("feedback", true, true);
    expect((await db.query("SELECT id FROM feedback_campaigns")).rows).toHaveLength(1);
    await expect(db.query("INSERT INTO feedback_campaigns (company_id, name) VALUES ($1, $2)", [company, "Negada"])).rejects.toThrow(/row-level security/);
  });
  it("não permite que a permissão de visualização altere cadastros", async () => {
    await permissions("configuracoes");
    const updated = await db.query("UPDATE feedback_campaigns SET name='Alterado' RETURNING id");
    expect(updated.rows).toHaveLength(0);
  });
  it("desativa opções preservando referências e impede troca de empresa", async () => {
    await permissions("configuracoes", false, true);
    await db.exec("UPDATE feedback_campaigns SET is_active=false");
    await db.exec("RESET ROLE");
    expect((await db.query("SELECT campaign_id FROM feedback_classifications")).rows).toEqual([{ campaign_id: campaign }]);
    await db.exec("SET ROLE authenticated");
    await expect(db.query("UPDATE feedback_campaigns SET company_id=$1", [otherCompany])).rejects.toThrow(/permission denied/);
  });
  it("impede exclusão pelo cliente e escrita direta nas classificações", async () => {
    await permissions("configuracoes", true, true);
    await expect(db.exec("DELETE FROM feedback_campaigns")).rejects.toThrow(/permission denied/);
  });
  it("impede burlar a validação da Agenda gravando classificação pelo navegador", async () => {
    await permissions("feedback", true, true);
    await expect(db.exec("UPDATE feedback_classifications SET agenda_objective_id=43")).rejects.toThrow(/permission denied/);
  });
  it("bloqueia nomes duplicados mesmo após desativar", async () => {
    await db.exec("UPDATE feedback_campaigns SET is_active=false");
    await expect(db.query("INSERT INTO feedback_campaigns (company_id,name) VALUES ($1,$2)", [company, "INTEGRAÇÃO"])).rejects.toThrow(/unique constraint/);
  });
  it("impede vincular uma cultura de outra empresa, inclusive no backend", async () => {
    await db.exec("SET ROLE service_role");
    await expect(db.query("UPDATE feedback_classifications SET culture_id=$1", [otherCulture])).rejects.toThrow(/foreign key constraint/);
  });
  it("audita metadados e os mantém invisíveis para outro módulo", async () => {
    const audit = await db.query("SELECT after->>'agenda_objective_id' AS objective FROM audit_log WHERE table_name='feedback_classifications'");
    expect(audit.rows).toEqual([{ objective: "42" }]);
    await permissions("configuracoes", true, true);
    expect((await db.query("SELECT id FROM feedback_classifications")).rows).toHaveLength(0);
  });
  it("não permite leitura anônima", async () => {
    await db.exec("SET ROLE anon");
    await expect(db.exec("SELECT * FROM feedback_cultures")).rejects.toThrow(/permission denied/);
  });
});
