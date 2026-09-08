// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPaymentLines, paymentLineFromSnapshot, type FrozenPaymentLine, type PayableEntryInput } from "./buildPaymentLines";

const migration = readFileSync(new URL("../../../../supabase/migrations/20260908160000_consolidate_payroll_payments.sql", import.meta.url), "utf8");
const vehicleMigration = readFileSync(new URL("../../../../supabase/migrations/20260908160100_reclassify_vehicle_entries.sql", import.meta.url), "utf8");
const companyId = randomUUID();
const collaboratorId = randomUUID();
const periodId = randomUUID();
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // Estrutura mínima para executar as funções reais da migration sem acessar
  // dados de produção. Cada teste compara o resultado do Postgres com a tela.
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_gc(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.has_module_permission(uuid, uuid, text, text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE TYPE public.payroll_period_status AS ENUM ('open', 'aprovado_diretoria');
    CREATE TABLE public.user_roles (user_id uuid, role text);
    CREATE TABLE public.companies (id uuid PRIMARY KEY);
    CREATE FUNCTION public.audit_log_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END;';
    CREATE TABLE public.collaborator_fixed_entries (id uuid, company_id uuid, collaborator_id uuid, type text, description text, is_active boolean);
    CREATE UNIQUE INDEX uq_fixed_entries_active ON public.collaborator_fixed_entries (collaborator_id, type, (coalesce(lower(description), ''))) WHERE is_active;
    CREATE TABLE public.payroll_periods (id uuid, company_id uuid, reference_month date, status public.payroll_period_status);
    CREATE TABLE public.collaborators (id uuid, name text, cpf text, pix_key text, pix_key_normalized text, pix_key_type text);
    CREATE TABLE public.payroll_entries (id uuid, company_id uuid, collaborator_id uuid, type text, value numeric(12,2),
      description text, is_payable boolean, external_id text, created_at timestamptz, month integer, year integer);
    CREATE TABLE public.payroll_payments (period_id uuid, paid_at timestamptz);
    CREATE TABLE public.payroll_pix_transfers (period_id uuid, status text);
    CREATE TABLE public.collaborator_alimony_orders (collaborator_id uuid, company_id uuid, status text, effective_from date, effective_to date);
    CREATE TABLE public.payroll_payable_lines (
      period_id uuid, company_id uuid, collaborator_id uuid, entry_id uuid, kind text,
      gross numeric(12,2), inss numeric(12,2), irpf numeric(12,2), other_deductions numeric(12,2), net_amount numeric(12,2),
      components jsonb, discounts jsonb, payee_name text, payee_document text, payee_pix_key text,
      payee_pix_key_norm text, payee_pix_key_type text, has_alimony_block boolean, built_from_status public.payroll_period_status
    );
  `);
  await db.exec(migration);
  await db.query("INSERT INTO companies VALUES ($1)", [companyId]);
  await db.query("INSERT INTO payroll_periods VALUES ($1, $2, '2026-09-01', 'aprovado_diretoria')", [periodId, companyId]);
  await db.query("INSERT INTO collaborators (id, name) VALUES ($1, 'Ana')", [collaboratorId]);
});

afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE payroll_entries, payroll_payable_lines, payroll_payments, payroll_pix_transfers");
  await db.query("UPDATE payroll_periods SET status = 'aprovado_diretoria' WHERE id = $1", [periodId]);
});

async function compare(entries: PayableEntryInput[]) {
  for (const [index, entry] of entries.entries()) {
    await db.query(`INSERT INTO payroll_entries VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 9, 2026)`, [
      entry.id, companyId, entry.collaborator_id, entry.type, entry.value, entry.description ?? null,
      entry.is_payable ?? null, entry.external_id ?? null, new Date(Date.UTC(2026, 8, 1, 0, 0, entries.length - index)).toISOString(),
    ]);
  }
  await db.query("SELECT payroll_build_payable_lines($1)", [periodId]);
  const { rows } = await db.query<FrozenPaymentLine>("SELECT * FROM payroll_payable_lines");
  const actual = rows.map(paymentLineFromSnapshot).sort((a, b) => a.entryId.localeCompare(b.entryId));
  const expected = buildPaymentLines(entries).sort((a, b) => a.entryId.localeCompare(b.entryId));
  expect(actual).toHaveLength(expected.length);
  for (const [index, line] of actual.entries()) {
    const wanted = expected[index];
    expect(line.entryId).toBe(wanted.entryId);
    expect(line.kind).toBe(wanted.kind);
    expect(line.amount).toBeCloseTo(wanted.amount, 2);
    expect(line.gross).toBeCloseTo(wanted.gross, 2);
    expect(line.inss).toBeCloseTo(wanted.inss, 2);
    expect(line.irpf).toBeCloseTo(wanted.irpf, 2);
    expect(line.otherDeductions).toBeCloseTo(wanted.otherDeductions, 2);
    expect(line.components).toEqual(wanted.components);
    expect(line.discounts).toEqual(wanted.discounts);
  }
  return actual;
}

function entry(type: string, value: number, extra: Partial<PayableEntryInput> = {}): PayableEntryInput {
  return { id: randomUUID(), collaborator_id: collaboratorId, collaborator: { name: "Ana" }, type, value, ...extra };
}

describe("pagamentos — paridade entre TypeScript e Postgres", () => {
  it("consolida todos os adicionais e o recibo, mantendo apenas custo setor separado", async () => {
    const lines = await compare([
      entry("salario_base", 3000), entry("carro_agregado", 800), entry("gratificacao", 500),
      entry("salario_familia", 60), entry("periculosidade", 900), entry("hora_extra", 200),
      entry("beneficio", 300, { is_payable: true }), entry("beneficio", 900, { is_payable: false }),
      entry("atestado", 100), entry("auxilio_vale_transporte", 200), entry("salario_retroativo", 300),
      entry("bonificacao", 400, { description: "CUSTO SETOR" }),
      entry("inss", 500), entry("irpf", 400), entry("fgts", 240), entry("desconto", 150),
      entry("ferias", 2000, { external_id: "ferias-request-provento" }),
      entry("ferias", 666.67, { external_id: "ferias-request-terco" }),
      entry("gratificacao", 300, { external_id: "ferias-request-gratificacao" }),
      entry("bonificacao", 100, { external_id: "ferias-request-bonificacao" }),
      entry("inss", 200, { external_id: "ferias-request-inss" }),
      entry("irpf", 66.67, { external_id: "ferias-request-irrf" }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.kind === "avulso")?.amount).toBe(400);
    expect(lines.find((line) => line.kind === "mensal")?.amount).toBe(8110);
  });

  it("não perde o débito mensal quando férias tornam o líquido positivo", async () => {
    const lines = await compare([
      entry("salario_base", 1000), entry("adiantamento", 1200),
      entry("ferias", 2000, { external_id: "ferias-request-provento" }),
      entry("inss", 200, { external_id: "ferias-request-inss" }),
    ]);
    expect(lines[0].amount).toBe(1600);
  });

  it("mantém o recibo sem salário base e sua âncora original", async () => {
    const lines = await compare([
      entry("gratificacao", 300, { external_id: "ferias-request-gratificacao" }),
      entry("ferias", 2000, { external_id: "ferias-request-provento" }),
      entry("inss", 200, { external_id: "ferias-request-inss" }),
      entry("inss", 100), entry("desconto", 100),
    ]);
    expect(lines[0].kind).toBe("ferias");
    expect(lines[0].amount).toBe(2100);
  });

  it("preserva estornos e não gera pagamento de valor zero", async () => {
    await compare([entry("gratificacao", 500), entry("gratificacao", -500)]);
    const lines = await compare([entry("salario_base", 1000), entry("adiantamento", 1000)]);
    expect(lines).toHaveLength(0);
  });

  it("mantém o retroativo na âncora mensal e desconta seus impostos sem salário base", async () => {
    const retroactive = entry("salario_retroativo", 1000);
    const lines = await compare([
      entry("gratificacao", 300), retroactive, entry("inss", 100), entry("irpf", 50),
    ]);
    expect(lines[0].entryId).toBe(retroactive.id);
    expect(lines[0].amount).toBe(1150);
  });

  it("recusa congelar antes da aprovação", async () => {
    await db.query("UPDATE payroll_periods SET status = 'open' WHERE id = $1", [periodId]);
    await expect(db.query("SELECT payroll_build_payable_lines($1)", [periodId])).rejects.toThrow("aprovada pela diretoria");
  });

  it.each(["manual", "created", "settled"])("preserva o congelamento com pagamento %s sem bloquear a reaprovação", async (payment) => {
    await compare([entry("salario_base", 3000), entry("carro_agregado", 800)]);
    const before = (await db.query("SELECT * FROM payroll_payable_lines")).rows;
    if (payment === "manual") {
      await db.query("INSERT INTO payroll_payments VALUES ($1, now())", [periodId]);
    } else {
      await db.query("INSERT INTO payroll_pix_transfers VALUES ($1, $2)", [periodId, payment]);
    }
    await db.exec("UPDATE payroll_entries SET value = value + 100");
    const { rows } = await db.query<{ rebuilt: number }>("SELECT payroll_build_payable_lines($1) AS rebuilt", [periodId]);
    expect(rows[0].rebuilt).toBe(0);
    expect((await db.query("SELECT * FROM payroll_payable_lines")).rows).toEqual(before);
  });

  it("reclassifica veículo nas folhas editáveis e na ficha, preservando histórico e custo setor", async () => {
    const openEntry = randomUUID();
    const oldEntry = randomUUID();
    const fixedEntry = randomUUID();
    await db.query("UPDATE payroll_periods SET status = 'open' WHERE id = $1", [periodId]);
    await db.query("INSERT INTO payroll_periods VALUES ($1, $2, '2026-08-01', 'aprovado_diretoria')", [randomUUID(), companyId]);
    for (const [id, month] of [[openEntry, 9], [oldEntry, 8]]) {
      await db.query("INSERT INTO payroll_entries (id, company_id, collaborator_id, type, description, month, year) VALUES ($1, $2, $3, 'bonificacao', 'Carro Agregado', $4, 2026)", [id, companyId, collaboratorId, month]);
    }
    await db.query("INSERT INTO collaborator_fixed_entries VALUES ($1, $2, $3, 'bonificacao', 'BONIFICAÇÃO — Carro Agregado', true)", [fixedEntry, companyId, collaboratorId]);
    await db.exec(vehicleMigration);
    const typeOf = async (table: string, id: string) => (await db.query<{ type: string }>(`SELECT type FROM ${table} WHERE id = $1`, [id])).rows[0].type;
    expect(await typeOf("payroll_entries", openEntry)).toBe("carro_agregado");
    expect(await typeOf("payroll_entries", oldEntry)).toBe("bonificacao");
    expect(await typeOf("collaborator_fixed_entries", fixedEntry)).toBe("carro_agregado");

    for (const [description, expected, externalId] of [
      ["Veículo", "carro_agregado", null],
      ["carro agregado — mensal", "carro_agregado", null],
      ["CUSTO SETOR — carro agregado", "bonificacao", null],
      ["Carro Agregado", "bonificacao", "ferias-request-bonificacao"],
    ]) {
      const id = randomUUID();
      await db.query("INSERT INTO payroll_entries (id, type, description, external_id) VALUES ($1, 'bonificacao', $2, $3)", [id, description, externalId]);
      expect(await typeOf("payroll_entries", id)).toBe(expected);
    }

    const rollback = vehicleMigration.slice(vehicleMigration.indexOf("-- BEGIN;", vehicleMigration.indexOf("-- ROLLBACK")))
      .split("\n").map((line) => line.replace(/^-- ?/, "")).join("\n");
    await db.exec(rollback);
    expect(await typeOf("payroll_entries", openEntry)).toBe("bonificacao");
    expect(await typeOf("collaborator_fixed_entries", fixedEntry)).toBe("bonificacao");
  });

  it("executa o rollback do agrupamento sem alterar pagamentos congelados", async () => {
    await compare([entry("salario_base", 3000), entry("carro_agregado", 800)]);
    const rollback = migration.slice(migration.indexOf("-- BEGIN;", migration.indexOf("-- ROLLBACK")))
      .split("\n").map((line) => line.replace(/^-- ?/, "")).join("\n");
    await db.exec(rollback);
    const { rows } = await db.query<{ rank: number | null }>("SELECT payroll_monthly_merged_rank('carro_agregado') AS rank");
    expect(rows[0].rank).toBeNull();
    expect((await db.query<{ rank: number }>("SELECT payroll_monthly_merged_rank('salario_retroativo') AS rank")).rows[0].rank).toBe(2);
    const frozen = await db.query<{ net_amount: string }>("SELECT net_amount FROM payroll_payable_lines");
    expect(Number(frozen.rows[0].net_amount)).toBe(3800);
    await db.query("INSERT INTO payroll_pix_transfers VALUES ($1, 'settled')", [periodId]);
    await db.exec("UPDATE payroll_entries SET value = value + 100");
    expect((await db.query<{ rebuilt: number }>("SELECT payroll_build_payable_lines($1) AS rebuilt", [periodId])).rows[0].rebuilt).toBe(0);
    expect((await db.query("SELECT net_amount FROM payroll_payable_lines")).rows).toEqual(frozen.rows);
    await db.exec(migration);
  });
});
