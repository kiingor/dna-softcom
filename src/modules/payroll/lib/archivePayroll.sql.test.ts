// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const readMigration = (name: string) => readFileSync(new URL(`../../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migration = readMigration("20260917120000_archive_payroll_periods");
const rollback = migration.slice(migration.indexOf("-- BEGIN;", migration.indexOf("-- ROLLBACK")))
  .split("\n").map((line) => line.replace(/^-- ?/, "")).join("\n");
const company = randomUUID();
const collaborator = randomUUID();
const period = randomUUID();
const testEntry = randomUUID();
const discount = randomUUID();
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
    CREATE FUNCTION public.is_admin_gc(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE FUNCTION public.has_module_permission(uuid, uuid, text, text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE TYPE public.payroll_period_status AS ENUM ('open', 'aprovado_rh', 'aprovado_diretoria', 'closed', 'exported');
    CREATE FUNCTION public.payroll_period_is_locked(public.payroll_period_status) RETURNS boolean LANGUAGE sql
      AS $$ SELECT $1 IN ('aprovado_diretoria', 'closed', 'exported') $$;
    CREATE TABLE user_roles(user_id uuid, role text);
    CREATE TABLE audit_log(user_id uuid, company_id uuid, action text, table_name text, record_id uuid, before jsonb, after jsonb);
    CREATE TABLE companies(id uuid PRIMARY KEY, cnpj text, company_name text);
    CREATE TABLE collaborators(id uuid PRIMARY KEY, name text, cpf text, pix_key text, pix_key_normalized text, pix_key_type text);
    CREATE TABLE payroll_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, reference_month date, status payroll_period_status,
      CONSTRAINT payroll_periods_company_id_reference_month_key UNIQUE(company_id, reference_month));
    CREATE TABLE payroll_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, collaborator_id uuid, type text,
      value numeric, description text, is_payable boolean DEFAULT true, external_id text, created_at timestamptz DEFAULT now(), month int, year int);
    CREATE TABLE payroll_payable_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      collaborator_id uuid, entry_id uuid UNIQUE REFERENCES payroll_entries(id), kind text, gross numeric, inss numeric, irpf numeric,
      other_deductions numeric, net_amount numeric, components jsonb, discounts jsonb, payee_name text, payee_document text, payee_pix_key text,
      payee_pix_key_norm text, payee_pix_key_type text, has_alimony_block boolean, built_from_status payroll_period_status);
    CREATE TABLE payroll_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      entry_id uuid UNIQUE REFERENCES payroll_entries(id), amount numeric, paid_at timestamptz, paid_by uuid, method text, settled_transfer_id uuid);
    CREATE TABLE payroll_pix_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      collaborator_id uuid, entry_id uuid REFERENCES payroll_entries(id), payable_line_id uuid REFERENCES payroll_payable_lines(id), attempt int,
      idempotency_key text, amount numeric, payee_name text, payee_document text, payee_pix_key text, payee_pix_key_norm text, payee_pix_key_type text,
      payer_snapshot jsonb, provider text, environment text, status text, created_by uuid);
    CREATE TABLE collaborator_alimony_orders(collaborator_id uuid, company_id uuid, status text, effective_from date, effective_to date);
    ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_periods ON payroll_periods FOR ALL TO authenticated USING (company_id::text = current_setting('test.company'));
    CREATE POLICY tenant_entries ON payroll_entries FOR ALL TO authenticated USING (company_id::text = current_setting('test.company'));
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
  `);
  await db.exec(readMigration("20260908160000_consolidate_payroll_payments"));
  await db.exec(migration);
  await db.query("INSERT INTO companies(id) VALUES($1)", [company]);
  await db.query("INSERT INTO collaborators(id, name, pix_key_normalized, pix_key_type) VALUES($1, 'Pessoa fictícia', 'test@example.invalid', 'email')", [collaborator]);
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE payroll_periods, payroll_entries, payroll_payable_lines, payroll_payments, payroll_pix_transfers, audit_log CASCADE");
  await db.query("SELECT set_config('test.actor', '', false), set_config('test.company', $1, false)", [company]);
  await db.query("INSERT INTO payroll_periods(id, company_id, reference_month, status) VALUES($1, $2, '2026-09-01', 'closed')", [period, company]);
  await db.query(`INSERT INTO payroll_entries(id, company_id, collaborator_id, type, value, month, year) VALUES
    ($1, $3, $4, 'salario_retroativo', 1, 9, 2026), ($2, $3, $4, 'desconto', 112.16, 9, 2026)`, [testEntry, discount, company, collaborator]);
  await db.query(`INSERT INTO payroll_payable_lines(period_id, company_id, collaborator_id, entry_id, net_amount)
    VALUES($1, $2, $3, $4, 1)`, [period, company, collaborator, testEntry]);
  await db.query(`INSERT INTO payroll_payments(period_id, company_id, entry_id, amount, paid_at, method)
    VALUES($1, $2, $3, 1, now(), 'pix_santander')`, [period, company, testEntry]);
  await db.query(`INSERT INTO payroll_pix_transfers(period_id, company_id, entry_id, amount, status)
    VALUES($1, $2, $3, 1, 'settled')`, [period, company, testEntry]);
});

async function archive() {
  await db.query("UPDATE payroll_periods SET archived_at=now(), archive_reason='Teste autorizado' WHERE id=$1", [period]);
  await db.query("UPDATE payroll_entries SET archived_period_id=$1 WHERE id=$2", [period, testEntry]);
}
async function newPeriod() {
  const id = randomUUID();
  await db.query("INSERT INTO payroll_periods(id, company_id, reference_month, status) VALUES($1,$2,'2026-09-01','open')", [id, company]);
  return id;
}

describe("arquivo de folha com pagamentos reais", () => {
  it("libera a competência, preserva comprovantes e mantém somente o desconto nas consultas normais", async () => {
    const before = await db.query("SELECT to_jsonb(p) AS row FROM payroll_payments p UNION ALL SELECT to_jsonb(t) FROM payroll_pix_transfers t UNION ALL SELECT to_jsonb(l) FROM payroll_payable_lines l");
    await archive();
    const replacement = await newPeriod();
    expect((await db.query("SELECT to_jsonb(p) AS row FROM payroll_payments p UNION ALL SELECT to_jsonb(t) FROM payroll_pix_transfers t UNION ALL SELECT to_jsonb(l) FROM payroll_payable_lines l")).rows).toEqual(before.rows);
    await expect(newPeriod()).rejects.toThrow("payroll_periods_active_month_key");
    await db.exec("SET ROLE authenticated");
    expect((await db.query("SELECT id FROM payroll_periods")).rows).toEqual([{ id: replacement }]);
    expect((await db.query("SELECT id FROM payroll_entries")).rows).toEqual([{ id: discount }]);
    await db.query("SELECT set_config('test.company', $1, false)", [randomUUID()]);
    expect((await db.query("SELECT id FROM payroll_entries")).rows).toEqual([]);
  });

  it("ignora o teste em bloqueios, auditoria e cálculo da folha substituta", async () => {
    await archive();
    const replacement = await newPeriod();
    expect((await db.query("SELECT payroll_period_is_locked($1, '2026-09-01') AS locked", [company])).rows).toEqual([{ locked: false }]);
    await db.query("SELECT set_config('test.actor', $1, false)", [randomUUID()]);
    await db.query("SELECT log_payroll_recalc($1, '2026-09-01')", [company]);
    expect((await db.query("SELECT record_id FROM audit_log")).rows).toEqual([{ record_id: replacement }]);
    await db.query("INSERT INTO payroll_entries(company_id, collaborator_id, type, value, month, year) VALUES($1,$2,'salario_base',1000,9,2026)", [company, collaborator]);
    await db.query("UPDATE payroll_periods SET status='aprovado_diretoria' WHERE id=$1", [replacement]);
    await db.query("SELECT payroll_build_payable_lines($1)", [replacement]);
    expect((await db.query("SELECT gross, net_amount FROM payroll_payable_lines WHERE period_id=$1", [replacement])).rows).toEqual([{ gross: "1000", net_amount: "887.84" }]);
    await db.query("SELECT payroll_payment_set_manual_paid(entry_id,true,1) FROM payroll_payable_lines WHERE period_id=$1", [replacement]);
    expect((await db.query("SELECT amount FROM payroll_payments WHERE period_id=$1", [replacement])).rows).toEqual([{ amount: "887.84" }]);
    await expect(db.query("SELECT payroll_build_payable_lines($1)", [period])).rejects.toThrow("Folha não encontrada");
  });

  it("bloqueia pagamento manual, PIX e alterações diretas mesmo com bypass de RLS", async () => {
    await archive();
    const replacement = await newPeriod();
    await db.query("SELECT set_config('test.actor', $1, false)", [randomUUID()]);
    await expect(db.query("SELECT payroll_payment_set_manual_paid($1,true,1)", [testEntry])).rejects.toThrow("Lançamento não encontrado");
    await expect(db.query("SELECT payroll_pix_open_transfer($1,$2,'sandbox')", [testEntry, randomUUID()])).rejects.toThrow("não está aprovada");
    await db.exec("SET ROLE service_role");
    for (const table of ["payroll_payments", "payroll_pix_transfers", "payroll_payable_lines"]) {
      await expect(db.query(`DELETE FROM ${table} WHERE period_id=$1`, [period])).rejects.toThrow("imutáveis");
      await expect(db.query(`UPDATE ${table} SET period_id=$1 WHERE entry_id=$2`, [replacement, testEntry])).rejects.toThrow("imutáveis");
      await expect(db.query(`INSERT INTO ${table}(period_id,entry_id) VALUES($1,$2)`, [replacement, testEntry])).rejects.toThrow("novos pagamentos estão bloqueados");
    }
    await expect(db.query("UPDATE payroll_periods SET archived_at=NULL, archive_reason=NULL WHERE id=$1", [period])).rejects.toThrow("somente para consulta");
    await expect(db.query("DELETE FROM payroll_entries WHERE id=$1", [testEntry])).rejects.toThrow("somente para consulta");
    await expect(db.query("UPDATE payroll_entries SET archived_period_id=NULL WHERE id=$1", [testEntry])).rejects.toThrow("somente para consulta");
  });

  it.each(["created", "sent", "confirmed", "unknown"])("recusa arquivar com PIX %s", async (status) => {
    await db.query("UPDATE payroll_pix_transfers SET status=$1", [status]);
    await expect(archive()).rejects.toThrow("PIX pendente");
  });

  it("recusa vínculo de arquivo com empresa ou competência diferente", async () => {
    await archive();
    for (const [otherCompany, month] of [[randomUUID(), 9], [company, 8]]) {
      const id = randomUUID();
      await db.query("INSERT INTO payroll_entries(id,company_id,month,year) VALUES($1,$2,$3,2026)", [id, otherCompany, month]);
      await expect(db.query("UPDATE payroll_entries SET archived_period_id=$1 WHERE id=$2", [period, id])).rejects.toThrow("Vínculo de arquivo inválido");
    }
  });

  it("RLS impede arquivamento pelo cliente mesmo com permissão de editar a empresa", async () => {
    await db.exec("SET ROLE authenticated");
    await expect(db.query("UPDATE payroll_periods SET archived_at=now(), archive_reason='Teste' WHERE id=$1", [period])).rejects.toThrow("row-level security");
  });

  it("rollback não perde arquivo nem a folha substituta", async () => {
    await archive();
    await newPeriod();
    await expect(db.exec(rollback)).rejects.toThrow("Rollback exige revisão");
    await db.exec("ROLLBACK");
    expect((await db.query("SELECT count(*)::int AS count FROM payroll_periods")).rows).toEqual([{ count: 2 }]);
  });

  it("rollback restaura a unicidade anterior quando ainda não há arquivo", async () => {
    await db.exec(rollback);
    await expect(newPeriod()).rejects.toThrow("payroll_periods_company_id_reference_month_key");
    await db.exec(migration);
  });
});
