import {
  isEarning,
  MANUAL_DEBIT_TYPES,
  ENTRY_TYPE_LABELS,
} from "../types";
import type { Database } from "@/integrations/supabase/types";

// ─────────────────────────────────────────────────────────────────────────────
// LINHAS DE PAGAMENTO — quanto cada colaborador recebe, e por quê.
//
// Esta é a fórmula que decide o valor de um PIX. Ela vivia inline num useMemo
// dentro de PaymentsTab.tsx; saiu de lá por dois motivos:
//
//   1. Não dava pra testar. As regras abaixo (estorno, partição de férias,
//      mescla, clamp) só existiam como comentário ao lado do código.
//   2. O servidor precisa da mesma conta. O cliente não pode ser fonte da
//      verdade de quanto pagar — quem manda o valor pro banco é o backend.
//
// O destino final desta lógica é o builder SQL de `payroll_payable_lines`,
// porque o banco é o único runtime que o browser e o Deno das edge functions
// dividem (o repo já carrega a dívida de um espelho manual em
// _shared/clt-calc.ts, e espelho que dessincroniza numa fórmula de pagamento
// produz PIX errado e irreversível). Até o cutover, este arquivo é o ORÁCULO:
// os mesmos casos rodam aqui e no SQL, e o teste de paridade falha se
// divergirem em um centavo.
//
// NÃO mude uma regra aqui sem mudar no SQL e sem atualizar os testes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pagamento mensal — o que entra na MESMA linha (mesmo PIX).
 *
 * Regra de produto: o colaborador recebe UM pagamento com salário base,
 * gratificações, veículo, hora extra, periculosidade, salário-família e demais
 * proventos pagáveis. Férias programadas também compõem esse pagamento.
 *
 * É também o recorte correto pro líquido: o INSS/IRPF do mês incide sobre essa
 * base (hora extra e periculosidade integram a base — ver
 * INSS_TAXABLE_EARNING_TYPES em ../types), então o imposto descontado aqui bate
 * com o contracheque em vez de sair todo do salário base.
 *
 * Apenas bonificação (custo de setor) fica em linha própria. Os lançamentos
 * do recibo de férias mantêm seus impostos já calculados, sem recalcular bases.
 *
 * A ordem do array é a ordem de exibição no popup de detalhe.
 */
export const MONTHLY_MERGED_TYPES = [
  "salario_base",
  "gratificacao",
  "hora_extra",
  "periculosidade",
  "salario_familia",
  "carro_agregado",
  "beneficio",
  "atestado",
  "auxilio_vale_transporte",
  "salario_retroativo",
  "ferias",
] as const;

const MONTHLY_MERGED_SET = new Set<string>(MONTHLY_MERGED_TYPES);
const MANUAL_DEBIT_SET = new Set<string>(MANUAL_DEBIT_TYPES);

/**
 * Forma mínima que a fórmula precisa de um lançamento.
 *
 * Deliberadamente estrutural em vez de `PayrollEntryWithCollaborator`: assim o
 * teste monta um caso com seis campos em vez da linha inteira do banco, e a
 * mesma função serve a qualquer chamador que tenha esses dados.
 */
export interface PayableEntryInput {
  id: string;
  collaborator_id: string;
  type: string;
  value: number | string;
  description?: string | null;
  external_id?: string | null;
  is_payable?: boolean | null;
  collaborator?: { name?: string | null } | null;
}

export interface PaymentLineComponent {
  /** Lançamento de origem — é o que amarra a linha ao que foi lançado. */
  entryId: string;
  type: string;
  label: string;
  value: number;
}

export interface PaymentLineDiscount {
  label: string;
  value: number;
}

export interface PaymentLine {
  /**
   * Lançamento âncora. O id dele identifica o pagamento em
   * `payroll_payments.entry_id`, então precisa ser o mais estável possível
   * entre recálculos — por isso preferimos o salário base.
   */
  entryId: string;
  collaboratorId: string;
  collaboratorName: string;
  kind: "mensal" | "ferias" | "avulso";
  /** Tipos que a linha somou — viram as tags na listagem. */
  types: string[];
  /** Rótulo da linha na tela. */
  description: string;
  gross: number;
  inss: number;
  irpf: number;
  /** Débitos manuais (falta, adiantamento, desconto, empréstimo). */
  otherDeductions: number;
  /** `gross - inss - irpf - otherDeductions`. Sempre > 0. */
  amount: number;
  components: PaymentLineComponent[];
  discounts: PaymentLineDiscount[];
}

export type FrozenPaymentLine = Pick<Database["public"]["Tables"]["payroll_payable_lines"]["Row"],
  "entry_id" | "collaborator_id" | "kind" | "gross" | "inss" | "irpf" |
  "other_deductions" | "net_amount" | "components" | "discounts" |
  "payee_name" | "payee_document" | "payee_pix_key"
>;

/** Adapta o pagamento aprovado sem recalcular valores ou reagrupar suas linhas. */
export function paymentLineFromSnapshot(row: FrozenPaymentLine): PaymentLine {
  const components = row.components as unknown as PaymentLineComponent[];
  return {
    entryId: row.entry_id,
    collaboratorId: row.collaborator_id,
    collaboratorName: row.payee_name,
    kind: row.kind as PaymentLine["kind"],
    types: row.kind === "ferias" ? ["ferias"] : [...new Set(components.map((component) => component.type))],
    description: row.kind === "ferias" ? "Pagamento de Férias" : components.map((component) => component.label).join(" · "),
    gross: Number(row.gross),
    inss: Number(row.inss),
    irpf: Number(row.irpf),
    otherDeductions: Number(row.other_deductions),
    amount: Number(row.net_amount),
    components,
    discounts: row.discounts as unknown as PaymentLineDiscount[],
  };
}

const num = (v: number | string): number => Number(v);

/** Lançamento veio do fluxo de férias? (`external_id` = `ferias-<reqId>-<kind>`) */
const isVacEntry = (e: PayableEntryInput): boolean =>
  (e.external_id ?? "").startsWith("ferias-");

const labelOf = (e: PayableEntryInput): string =>
  e.description ?? ENTRY_TYPE_LABELS[e.type] ?? e.type;

/**
 * Monta as linhas pagáveis a partir dos lançamentos do período.
 *
 * Recebe **todos** os lançamentos, não só os proventos: INSS, IRPF e os débitos
 * manuais precisam ser vistos para serem subtraídos.
 */
export function buildPaymentLines(entries: PayableEntryInput[]): PaymentLine[] {
  // Só proventos. Benefício entra apenas com is_payable=true (categoria
  // 'adicional'); os demais são vouchers/serviços, pagos por outro fluxo.
  // FGTS fica de fora por não ser desconto do colaborador — é encargo do
  // empregador.
  const earningOnly = entries.filter(
    (e) => isEarning(e.type) && (e.type !== "beneficio" || e.is_payable === true),
  );

  // Estornos: quando o RH lança um valor e depois o mesmo valor negativo, o par
  // se anula. Somamos por (colaborador, tipo) e derrubamos o grupo inteiro
  // quando o saldo não é positivo.
  const groupSum = new Map<string, number>();
  for (const e of earningOnly) {
    const key = `${e.collaborator_id}::${e.type}`;
    groupSum.set(key, (groupSum.get(key) ?? 0) + num(e.value));
  }

  const survivors = earningOnly.filter((e) => {
    const sum = groupSum.get(`${e.collaborator_id}::${e.type}`) ?? 0;
    if (sum <= 0) return false;
    return num(e.value) > 0;
  });

  // Os impostos de férias já foram calculados no recibo. Mantemos os subtotais
  // separados aqui para descontá-los uma única vez ao consolidar o pagamento.
  interface CollabTaxes {
    inss: number;
    irpf: number;
  }
  const monthlyTaxes = new Map<string, CollabTaxes>();
  const vacationTaxes = new Map<string, CollabTaxes>();
  for (const e of entries) {
    if (e.type !== "inss" && e.type !== "irpf") continue;
    const target = isVacEntry(e) ? vacationTaxes : monthlyTaxes;
    const cur = target.get(e.collaborator_id) ?? { inss: 0, irpf: 0 };
    if (e.type === "inss") cur.inss += num(e.value);
    else cur.irpf += num(e.value);
    target.set(e.collaborator_id, cur);
  }

  // Débitos manuais que reduzem o líquido: desconto (plano de saúde, VT),
  // adiantamento, falta e empréstimo. Só incidem no pagamento mensal.
  const discountsByCollab = new Map<string, PaymentLineDiscount[]>();
  for (const e of entries) {
    if (!MANUAL_DEBIT_SET.has(e.type)) continue;
    if (isVacEntry(e)) continue; // defensivo: férias não tem débito manual
    const v = num(e.value);
    if (!(v > 0)) continue;
    const arr = discountsByCollab.get(e.collaborator_id) ?? [];
    arr.push({ label: labelOf(e), value: v });
    discountsByCollab.set(e.collaborator_id, arr);
  }

  const byCollab = new Map<string, PayableEntryInput[]>();
  for (const e of survivors) {
    const arr = byCollab.get(e.collaborator_id) ?? [];
    arr.push(e);
    byCollab.set(e.collaborator_id, arr);
  }

  const lines: PaymentLine[] = [];

  for (const [collabId, list] of byCollab) {
    const collaboratorName = list[0]?.collaborator?.name ?? "";
    const vacEntries = list.filter(isVacEntry);
    const monthlyList = list.filter((e) => !isVacEntry(e));

    // ─── Mensal ──────────────────────────────────────────────────────────
    // Ordena pela ordem de MONTHLY_MERGED_TYPES pra o popup sair sempre na
    // mesma sequência (salário primeiro, depois os adicionais).
    const monthlyMerged = MONTHLY_MERGED_TYPES.flatMap((t) =>
      monthlyList.filter((e) => e.type === t),
    );
    const merged = [...monthlyMerged, ...vacEntries];
    const others = monthlyList.filter((e) => !MONTHLY_MERGED_SET.has(e.type));

    if (merged.length > 0) {
      // Âncora: o salário base quando existe — o id dele é o mais estável entre
      // recálculos, então a marcação de "pago" sobrevive.
      const primary = monthlyMerged.find((e) => e.type === "salario_base")
        ?? monthlyMerged[0]
        ?? vacEntries.find((e) => e.type === "ferias")
        ?? vacEntries[0];
      const monthly = monthlyMerged.length > 0;
      const taxes = monthly ? monthlyTaxes.get(collabId) : undefined;
      const vacTaxes = vacEntries.length > 0 ? vacationTaxes.get(collabId) : undefined;
      const inss = (taxes?.inss ?? 0) + (vacTaxes?.inss ?? 0);
      const irpf = (taxes?.irpf ?? 0) + (vacTaxes?.irpf ?? 0);
      const collabDiscounts = monthly ? discountsByCollab.get(collabId) ?? [] : [];
      const totalDiscount = collabDiscounts.reduce((s, d) => s + d.value, 0);
      const components: PaymentLineComponent[] = merged.map((e) => ({
        entryId: e.id,
        type: e.type,
        // Salário base mantém rótulo fixo; os adicionais mostram a descrição do
        // lançamento (é onde o RH escreve o motivo).
        label: e.type === "salario_base" ? "Salário Base" : labelOf(e),
        value: num(e.value),
      }));
      const gross = components.reduce((s, c) => s + c.value, 0);
      const amount = gross - inss - irpf - totalDiscount;

      // Líquido não positivo não vira pagamento. A tela de aprovação mostra
      // essa pessoa (ver buildApprovalSummary), aqui ela some de propósito —
      // não existe PIX de zero ou negativo.
      if (amount > 0) {
        lines.push({
          entryId: primary.id,
          collaboratorId: collabId,
          collaboratorName,
          kind: monthly ? "mensal" : "ferias",
          types: monthly
            ? [...new Set([...monthlyMerged.map((e) => e.type), ...(vacEntries.length ? ["ferias"] : [])])]
            : ["ferias"],
          description: monthly ? components.map((c) => c.label).join(" · ") : "Pagamento de Férias",
          gross,
          inss,
          irpf,
          otherDeductions: totalDiscount,
          amount,
          components,
          discounts: collabDiscounts,
        });
      }
    }

    // ─── Avulsos ─────────────────────────────────────────────────────────
    // Custo de setor fica separado. Impostos e descontos já foram consumidos
    // pelo pagamento consolidado do colaborador.
    for (const e of others) {
      const value = num(e.value);
      lines.push({
        entryId: e.id,
        collaboratorId: collabId,
        collaboratorName,
        kind: "avulso",
        types: [e.type],
        description: labelOf(e),
        gross: value,
        inss: 0,
        irpf: 0,
        otherDeductions: 0,
        amount: value,
        components: [
          { entryId: e.id, type: e.type, label: labelOf(e), value },
        ],
        discounts: [],
      });
    }

  }

  // Ordem estável: por nome do colaborador, depois pela descrição da linha.
  lines.sort((a, b) => {
    const cmp = a.collaboratorName.localeCompare(b.collaboratorName, "pt-BR");
    if (cmp !== 0) return cmp;
    return a.description.localeCompare(b.description, "pt-BR");
  });

  return lines;
}
