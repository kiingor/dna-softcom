// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const readMigration = (name: string) => readFileSync(new URL(`../../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migration = readMigration("20260928193000_refresh_unpaid_payroll_on_approval");
const company = randomUUID();
const period = randomUUID();
const person = randomUUID();
const paidPerson = randomUUID();
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
      payee_pix_key_norm text, payee_pix_key_type text, has_alimony_block boolean, built_from_status payroll_period_status, built_at timestamptz DEFAULT now());
    CREATE TABLE payroll_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      entry_id uuid UNIQUE REFERENCES payroll_entries(id), amount numeric, paid_at timestamptz, paid_by uuid, method text, settled_transfer_id uuid);
    CREATE TABLE payroll_pix_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid REFERENCES payroll_periods(id), company_id uuid,
      collaborator_id uuid, entry_id uuid REFERENCES payroll_entries(id), payable_line_id uuid REFERENCES payroll_payable_lines(id) ON DELETE SET NULL, attempt int,
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
  await db.exec(readMigration("20260917120000_archive_payroll_periods"));
  await db.exec(migration);
  // Gatilho real da aprovação: a regressão ocorre na transição de status.
  const original = readMigration("20260818120100_payroll_payable_lines");
  const start = original.indexOf("CREATE OR REPLACE FUNCTION public.payroll_period_freeze_payable_lines()");
  const end = original.indexOf("FOR EACH ROW EXECUTE FUNCTION public.payroll_period_freeze_payable_lines();", start);
  await db.exec(original.slice(start, end + "FOR EACH ROW EXECUTE FUNCTION public.payroll_period_freeze_payable_lines();".length));
  await db.query("INSERT INTO companies(id) VALUES($1)", [company]);
  for (const id of [person, paidPerson]) {
    await db.query("INSERT INTO collaborators(id,name,pix_key_normalized,pix_key_type) VALUES($1,'Pessoa fictícia','test@example.invalid','email')", [id]);
  }
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE payroll_periods, payroll_entries, payroll_payable_lines, payroll_payments, payroll_pix_transfers CASCADE");
  await db.query("SELECT set_config('test.actor', '', false)");
  await db.query("INSERT INTO payroll_periods(id,company_id,reference_month,status) VALUES($1,$2,'2026-09-01','aprovado_rh')", [period, company]);
});
async function entry(type: string, value: number, collaborator = person, externalId: string | null = null) {
  const id = randomUUID();
  await db.query("INSERT INTO payroll_entries(id,company_id,collaborator_id,type,value,month,year,external_id) VALUES($1,$2,$3,$4,$5,9,2026,$6)", [id, company, collaborator, type, value, externalId]);
  return id;
}
async function approve() {
  await db.query("UPDATE payroll_periods SET status='aprovado_diretoria' WHERE id=$1", [period]);
}
async function reopen() {
  await db.query("UPDATE payroll_periods SET status='aprovado_rh' WHERE id=$1", [period]);
}
async function protect(id: string, status: string) {
  if (status === 'manual') {
    await db.query("SELECT set_config('test.actor', $1, false)", [randomUUID()]);
    await db.query("SELECT payroll_payment_set_manual_paid($1,true,1)", [id]);
  } else {
    await db.query(`INSERT INTO payroll_pix_transfers(period_id,company_id,collaborator_id,entry_id,payable_line_id,status,amount)
      SELECT period_id,company_id,collaborator_id,entry_id,id,$2,net_amount FROM payroll_payable_lines WHERE entry_id=$1`, [id, status]);
  }
}
const lines = () => db.query("SELECT * FROM payroll_payable_lines ORDER BY entry_id");

describe("reaprovação da folha parcialmente paga", () => {
  it.each(['manual','created','sent','confirmed','unknown','settled'])("mantém pagamento %s e aplica ajustes/avulsos de quem está pendente", async (status) => {
    const paid = await entry('salario_base',3000,paidPerson);
    const pending = await entry('salario_base',2000);
    const tax = await entry('irpf',180);
    await entry('inss',200);
    await approve();
    await protect(paid,status);
    const protectedBefore = (await db.query("SELECT * FROM payroll_payable_lines WHERE entry_id=$1", [paid])).rows;
    const transfersBefore = (await db.query("SELECT * FROM payroll_pix_transfers")).rows;
    const paymentsBefore = (await db.query("SELECT * FROM payroll_payments")).rows;
    await reopen();
    await db.query("DELETE FROM payroll_entries WHERE id=$1", [tax]);
    await entry('desconto',155.29);
    await entry('gratificacao',150);
    const separate = await entry('bonificacao',500);
    const entriesBefore = (await db.query("SELECT * FROM payroll_entries ORDER BY id")).rows;
    await approve();
    expect((await db.query("SELECT * FROM payroll_entries ORDER BY id")).rows).toEqual(entriesBefore);
    expect((await db.query("SELECT * FROM payroll_payable_lines WHERE entry_id=$1", [paid])).rows).toEqual(protectedBefore);
    expect((await db.query("SELECT * FROM payroll_pix_transfers")).rows).toEqual(transfersBefore);
    expect((await db.query("SELECT * FROM payroll_payments")).rows).toEqual(paymentsBefore);
    expect((await db.query("SELECT gross,inss,irpf,other_deductions,net_amount FROM payroll_payable_lines WHERE entry_id=$1", [pending])).rows).toEqual([
      {gross:'2150',inss:'200',irpf:'0',other_deductions:'155.29',net_amount:'1794.71'},
    ]);
    expect((await db.query("SELECT net_amount FROM payroll_payable_lines WHERE entry_id=$1", [separate])).rows).toEqual([{net_amount:'500'}]);
  });

  it("preserva remoção manual de INSS e IRPF sem calculá-los na aprovação", async () => {
    await entry('salario_base',4000);
    const inss = await entry('inss',400);
    const irpf = await entry('irpf',300);
    await entry('emprestimo',210);
    await approve();
    await reopen();
    await db.query("DELETE FROM payroll_entries WHERE id=ANY($1::uuid[])", [[inss,irpf]]);
    await approve();
    expect((await lines()).rows[0]).toMatchObject({gross:'4000',inss:'0',irpf:'0',other_deductions:'210',net_amount:'3790'});
  });

  it("preserva o mensal pago e permite um novo custo setor independente", async () => {
    const salary = await entry('salario_base',3000);
    await approve();
    await protect(salary,'settled');
    const before = (await lines()).rows;
    await reopen();
    await entry('gratificacao',500);
    const bonus = await entry('bonificacao',250);
    await approve();
    expect((await db.query("SELECT * FROM payroll_payable_lines WHERE entry_id=$1", [salary])).rows).toEqual(before);
    expect((await db.query("SELECT net_amount FROM payroll_payable_lines WHERE entry_id=$1", [bonus])).rows).toEqual([{net_amount:'250'}]);
    expect((await lines()).rows).toHaveLength(2);
  });

  it("marcação manual anterior ao primeiro snapshot não autoriza pagar novamente", async () => {
    const paid = await entry('salario_base',3000,paidPerson);
    await db.query("SELECT set_config('test.actor',$1,false)", [randomUUID()]);
    await db.query("SELECT payroll_payment_set_manual_paid($1,true,3000)", [paid]);
    await entry('salario_base',2000);
    await approve();
    expect((await lines()).rows).toHaveLength(1);
    expect((await lines()).rows[0]).toMatchObject({collaborator_id:person,net_amount:'2000'});
    expect((await db.query("SELECT amount FROM payroll_payments WHERE entry_id=$1", [paid])).rows).toEqual([{amount:'3000.00'}]);
  });

  it("custo setor pago não impede corrigir mensal pendente", async () => {
    const salary = await entry('salario_base',3000);
    const bonus = await entry('bonificacao',100);
    await approve();
    await protect(bonus,'manual');
    await reopen();
    await entry('desconto',50);
    await approve();
    expect((await db.query("SELECT net_amount FROM payroll_payable_lines WHERE entry_id=$1", [salary])).rows).toEqual([{net_amount:'2950'}]);
  });

  it("não reapresenta componente pago sob outra âncora", async () => {
    const salary = await entry('salario_base',3000);
    await approve();
    await protect(salary,'settled');
    const before = (await lines()).rows;
    await reopen();
    await db.query("UPDATE payroll_entries SET type='bonificacao' WHERE id=$1", [salary]);
    await entry('salario_base',3000);
    await approve();
    expect((await lines()).rows).toEqual(before);
  });

  it("corrige após tentativa recusada preservando identidade e histórico", async () => {
    const salary = await entry('salario_base',3000);
    await approve();
    await protect(salary,'failed');
    const before = (await lines()).rows[0];
    const transfers = (await db.query("SELECT * FROM payroll_pix_transfers")).rows;
    await reopen();
    await entry('desconto',100);
    await approve();
    expect((await lines()).rows[0]).toMatchObject({id:before.id,net_amount:'2900'});
    expect((await db.query("SELECT * FROM payroll_pix_transfers")).rows).toEqual(transfers);
  });

  it("retira líquido zero sem apagar tentativa recusada", async () => {
    const salary = await entry('salario_base',3000);
    await approve();
    await protect(salary,'failed');
    await reopen();
    await entry('adiantamento',3000);
    await approve();
    expect((await lines()).rows).toEqual([]);
    expect((await db.query("SELECT amount,status,payable_line_id FROM payroll_pix_transfers")).rows).toEqual([{amount:'3000',status:'failed',payable_line_id:null}]);
  });

  it("não permite reconstruir sem aprovação, sem permissão ou em arquivo", async () => {
    await entry('salario_base',3000);
    await expect(db.query("SELECT payroll_build_payable_lines($1)", [period])).rejects.toThrow('aprovada pela diretoria');
    await approve();
    await db.exec("CREATE OR REPLACE FUNCTION is_admin_gc(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false'");
    await db.query("SELECT set_config('test.actor',$1,false)", [randomUUID()]);
    await expect(db.query("SELECT payroll_build_payable_lines($1)", [period])).rejects.toThrow('Sem permissão');
    await db.exec("CREATE OR REPLACE FUNCTION is_admin_gc(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true'");
    await db.query("UPDATE payroll_periods SET status='closed' WHERE id=$1", [period]);
    await db.query("UPDATE payroll_periods SET archived_at=now(),archive_reason='Teste' WHERE id=$1", [period]);
    await expect(db.query("SELECT payroll_build_payable_lines($1)", [period])).rejects.toThrow('Folha não encontrada');
  });

  it("rollback restaura a função anterior sem alterar snapshots", async () => {
    await entry('salario_base',3000);
    await approve();
    const before = (await lines()).rows;
    const rollback = migration.slice(migration.indexOf('-- BEGIN;',migration.indexOf('-- ROLLBACK')))
      .split('\n').map(line => line.replace(/^-- ?/, '')).join('\n');
    await db.exec(rollback);
    expect((await lines()).rows).toEqual(before);
    await db.exec(migration);
  });
});
