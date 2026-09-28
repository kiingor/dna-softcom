// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const readMigration = (name: string) => readFileSync(new URL(`../../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migration = readMigration("20260928180000_sync_pending_payroll_pix");
const company = randomUUID(), collaborator = randomUUID(), period = randomUUID(), entry = randomUUID();
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
    CREATE TYPE pix_key_type AS ENUM ('cpf', 'cnpj', 'email', 'phone', 'evp');
    CREATE TABLE user_roles(user_id uuid, role text);
    CREATE TABLE audit_log(user_id uuid, company_id uuid, action text, table_name text, record_id uuid, before jsonb, after jsonb);
    CREATE TABLE companies(id uuid PRIMARY KEY, cnpj text, company_name text);
    CREATE TABLE collaborators(id uuid PRIMARY KEY, company_id uuid, name text, cpf text, pix_key text);
    CREATE TABLE payroll_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, reference_month date, status payroll_period_status,
      CONSTRAINT payroll_periods_company_id_reference_month_key UNIQUE(company_id, reference_month));
    CREATE TABLE payroll_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, collaborator_id uuid, type text,
      value numeric, description text, is_payable boolean DEFAULT true, external_id text, created_at timestamptz DEFAULT now(), month int, year int);
    CREATE TABLE payroll_payable_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      collaborator_id uuid, entry_id uuid UNIQUE REFERENCES payroll_entries(id), kind text, gross numeric, inss numeric, irpf numeric,
      other_deductions numeric, net_amount numeric, components jsonb, discounts jsonb, payee_name text, payee_document text, payee_pix_key text,
      payee_pix_key_norm text, payee_pix_key_type public.pix_key_type, has_alimony_block boolean, built_from_status payroll_period_status);
    CREATE TABLE payroll_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      entry_id uuid UNIQUE REFERENCES payroll_entries(id), amount numeric, paid_at timestamptz, paid_by uuid, method text, settled_transfer_id uuid);
    CREATE TABLE payroll_pix_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      collaborator_id uuid, entry_id uuid REFERENCES payroll_entries(id), payable_line_id uuid REFERENCES payroll_payable_lines(id), attempt int,
      idempotency_key text, amount numeric, payee_name text, payee_document text, payee_pix_key text, payee_pix_key_norm text, payee_pix_key_type public.pix_key_type,
      payer_snapshot jsonb, provider text, environment text, status text, created_by uuid);
    CREATE TABLE collaborator_alimony_orders(collaborator_id uuid, company_id uuid, status text, effective_from date, effective_to date);
    ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_periods ON payroll_periods FOR ALL TO authenticated USING (company_id::text = current_setting('test.company'));
    CREATE POLICY tenant_entries ON payroll_entries FOR ALL TO authenticated USING (company_id::text = current_setting('test.company'));
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
  `);
  await db.exec(readMigration("20260818120000_pix_key_type_and_normalizer"));
  await db.exec(readMigration("20260917120000_archive_payroll_periods"));
  await db.exec(`
    CREATE FUNCTION audit_pix_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO audit_log(company_id, table_name, record_id, before, after)
      VALUES(NEW.company_id, TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
      RETURN NEW;
    END $$;
    CREATE TRIGGER audit_payroll_payable_lines AFTER UPDATE ON payroll_payable_lines
      FOR EACH ROW EXECUTE FUNCTION audit_pix_change();
  `);
  await db.exec(migration);
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE companies, collaborators, payroll_periods, payroll_entries, payroll_payable_lines, payroll_payments, payroll_pix_transfers, audit_log CASCADE");
  await db.query("SELECT set_config('test.actor', '', false)");
  await db.query("INSERT INTO companies(id) VALUES($1)", [company]);
  await db.query("INSERT INTO collaborators(id,company_id,name,cpf,pix_key) VALUES($1,$2,'Pessoa fictícia','01234567890','old@example.invalid')", [collaborator, company]);
  await db.query("INSERT INTO payroll_periods(id,company_id,reference_month,status) VALUES($1,$2,'2026-09-01','aprovado_diretoria')", [period, company]);
  await db.query("INSERT INTO payroll_entries(id,company_id,collaborator_id,type,value,month,year) VALUES($1,$2,$3,'salario_base',1000,9,2026)", [entry, company, collaborator]);
  await db.query(`INSERT INTO payroll_payable_lines(period_id,company_id,collaborator_id,entry_id,net_amount,gross,inss,irpf,other_deductions,
    kind,payee_name,payee_document,payee_pix_key,payee_pix_key_norm,payee_pix_key_type,components,discounts)
    VALUES($1,$2,$3,$4,850,1000,100,25,25,'mensal','Nome aprovado','01234567890','old@example.invalid','old@example.invalid','email','[]','[]')`,
  [period, company, collaborator, entry]);
});
async function changeKey(value: string | null = '01234567890') {
  await db.query("UPDATE collaborators SET pix_key=$1 WHERE id=$2", [value, collaborator]);
}
async function line() {
  return (await db.query<Record<string, unknown>>("SELECT * FROM payroll_payable_lines WHERE entry_id=$1", [entry])).rows[0];
}
async function openTransfer() {
  return (await db.query<Record<string, unknown>>("SELECT * FROM payroll_pix_open_transfer($1,$2,'sandbox')", [entry, randomUUID()])).rows[0];
}

describe("PIX pendente acompanha cadastro sem mudar pagamentos iniciados", () => {
  it("atualiza chave/tipo/normalização, mantém zero inicial e audita sem recalcular valores", async () => {
    const before = await line();
    await changeKey();
    expect(await line()).toEqual({ ...before, payee_pix_key: '01234567890', payee_pix_key_norm: '01234567890', payee_pix_key_type: 'cpf' });
    const audit = (await db.query<{before: Record<string, unknown>; after: Record<string, unknown>}>("SELECT before,after FROM audit_log")).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].before.payee_pix_key).toBe('old@example.invalid');
    expect(audit[0].after.payee_pix_key).toBe('01234567890');
    const transfer = await openTransfer();
    expect(transfer.payee_pix_key_norm).toBe('01234567890');
    expect(transfer.amount).toBe('850');
  });

  it.each(['closed', 'exported'])("atualiza pendentes da folha %s", async (status) => {
    await db.query("UPDATE payroll_periods SET status=$1", [status]);
    await changeKey();
    expect((await line()).payee_pix_key).toBe('01234567890');
  });

  it.each(['created', 'sent', 'confirmed', 'unknown', 'settled', 'sending'])("preserva a chave da tentativa %s e da linha", async (status) => {
    const transfer = await openTransfer();
    await db.query("UPDATE payroll_pix_transfers SET status=$1", [status]);
    const before = await line();
    await changeKey();
    expect(await line()).toEqual(before);
    expect((await db.query("SELECT payee_pix_key FROM payroll_pix_transfers WHERE id=$1", [transfer.id])).rows).toEqual([{payee_pix_key:'old@example.invalid'}]);
  });

  it("usa a chave nova ao tentar novamente após falha, preservando a tentativa antiga", async () => {
    const old = await openTransfer();
    await changeKey();
    await db.query("UPDATE payroll_pix_transfers SET status='failed' WHERE id=$1", [old.id]);
    expect((await line()).payee_pix_key).toBe('01234567890');
    const next = await openTransfer();
    expect(next.id).not.toBe(old.id);
    expect(next.attempt).toBe(2);
    expect(next.payee_pix_key_norm).toBe('01234567890');
    expect((await db.query("SELECT payee_pix_key FROM payroll_pix_transfers WHERE id=$1", [old.id])).rows[0]).toEqual({payee_pix_key:'old@example.invalid'});
  });

  it("preserva pagamento manual e só sincroniza quando ele é desmarcado", async () => {
    await db.query("INSERT INTO payroll_payments(period_id,entry_id,paid_at,method) VALUES($1,$2,now(),'manual')", [period, entry]);
    const before = await line();
    await changeKey();
    expect(await line()).toEqual(before);
    await db.query("UPDATE payroll_payments SET paid_at=NULL WHERE entry_id=$1", [entry]);
    expect((await line()).payee_pix_key).toBe('01234567890');
  });

  it("preserva folha arquivada e permite salvar o cadastro", async () => {
    await db.query("UPDATE payroll_periods SET status='closed'");
    await db.query("UPDATE payroll_periods SET archived_at=now(),archive_reason='Teste fictício'");
    const before = await line();
    await changeKey();
    expect(await line()).toEqual(before);
  });

  it.each([null, 'chave inválida'])("remove chave utilizável quando cadastro muda para %s", async (key) => {
    await changeKey(key);
    expect((await line()).payee_pix_key).toBe(key);
    expect((await line()).payee_pix_key_norm).toBeNull();
    await expect(openTransfer()).rejects.toThrow('Chave PIX');
  });

  it("reclassifica quando o CPF resolve a ambiguidade da chave numérica", async () => {
    await changeKey('11987654321');
    expect((await line()).payee_pix_key_type).toBe('phone');
    await db.query("UPDATE collaborators SET cpf='11987654321' WHERE id=$1", [collaborator]);
    expect((await line()).payee_pix_key_type).toBe('cpf');
    expect((await line()).payee_document).toBe('01234567890');
  });

  it("não altera linha de outra empresa nem expõe a função ao cliente", async () => {
    await db.query("UPDATE collaborators SET company_id=$1 WHERE id=$2", [randomUUID(),collaborator]);
    const before = await line();
    await changeKey();
    expect(await line()).toEqual(before);
    await db.exec("SET ROLE authenticated");
    await expect(db.query("SELECT payroll_sync_pending_pix($1)", [entry])).rejects.toThrow('permission denied');
  });

  it("é idempotente e não atualiza linhas antigas globalmente ao instalar", async () => {
    await db.query("UPDATE payroll_payable_lines SET payee_pix_key='legacy@example.invalid'");
    await db.exec(migration);
    expect((await line()).payee_pix_key).toBe('legacy@example.invalid');
    await db.query("SELECT payroll_sync_pending_pix($1)", [entry]);
    expect((await line()).payee_pix_key).toBe('old@example.invalid');
    expect((await db.query("SELECT payroll_sync_pending_pix($1) AS changed", [entry])).rows).toEqual([{changed:false}]);
  });

  it("reverte a sincronização automática sem restaurar destinatários antigos", async () => {
    await changeKey();
    const rollback = migration.slice(migration.indexOf('-- BEGIN;', migration.indexOf('-- ROLLBACK')))
      .split('\n').map((row) => row.replace(/^-- ?/, '')).join('\n');
    await db.exec(rollback);
    try {
      await changeKey('third@example.invalid');
      expect((await line()).payee_pix_key).toBe('01234567890');
    } finally {
      await db.exec(migration);
    }
  });
});
