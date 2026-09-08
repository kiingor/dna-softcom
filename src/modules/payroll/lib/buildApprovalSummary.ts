import {
  isEarning,
  isDeduction,
  isEmployerCost,
  type PayrollEntryWithCollaborator,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Resumo da folha POR COLABORADOR — o que a diretoria aprova.
//
// QUAL FÓRMULA É ESSA (decisão explícita, porque o módulo tem mais de uma):
//   • A aba Pagamentos monta LINHAS DE PAGAMENTO (soma salário, adicionais e
//     férias; separa custo setor) e descarta quem fica com líquido ≤ 0. Isso faz
//     sentido pra operacionalizar pagamento, mas ESCONDE colaborador — o que é
//     inaceitável numa tela de aprovação: a diretoria assina o total.
//   • Aqui a conta é a íntegra do que está lançado, por pessoa, sem clamp e sem
//     mesclagem: todo mundo que tem lançamento no mês aparece, inclusive com
//     líquido negativo (sinalizado). Por isso o total desta tela pode divergir
//     um pouco do total da aba Pagamentos — a diferença é exatamente quem o
//     clamp de lá remove.
//
// Classificação (fonte única em types.ts):
//   bruto     = Σ proventos (isEarning), bonificação INCLUÍDA
//   descontos = Σ deduções (isDeduction: INSS, IRPF, falta, adiantamento,
//               desconto, empréstimo)
//   líquido   = bruto − descontos
//   fgts      = custo do EMPREGADOR (isEmployerCost) — nunca sai do salário de
//               quem recebe, então fica fora do líquido e é somado à parte
//
// BONIFICAÇÃO ("CUSTO SETOR", vinda da agenda): entra no bruto e no líquido como
// provento normal — decisão do PO em 27/07/2026. O campo `bonificacao` continua
// existindo, mas como SUBTOTAL informativo de quanto do bruto veio daí; não
// somar de novo em cima do bruto, sob risco de contar em dobro.
// Nota: a aba Lançamentos esconde bonificação (PR #37, "custo interno de
// setor"), então os totais das duas telas divergem de propósito.
// ─────────────────────────────────────────────────────────────────────────────

export interface CollaboratorApprovalSummary {
  collaboratorId: string;
  name: string;
  bruto: number;
  descontos: number;
  liquido: number;
  fgts: number;
  bonificacao: number;
  /** Custo total pra empresa: bruto (já com bonificação) + FGTS. */
  custoTotal: number;
  entries: PayrollEntryWithCollaborator[];
}

export interface ApprovalTotals {
  pessoas: number;
  bruto: number;
  descontos: number;
  liquido: number;
  fgts: number;
  bonificacao: number;
  custoTotal: number;
  /** Quantos ficaram com líquido ≤ 0 — a diretoria precisa olhar esses. */
  liquidoNaoPositivo: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildApprovalSummary(
  entries: PayrollEntryWithCollaborator[],
): CollaboratorApprovalSummary[] {
  const byCollab = new Map<string, CollaboratorApprovalSummary>();

  for (const e of entries) {
    const cid = e.collaborator_id;
    let row = byCollab.get(cid);
    if (!row) {
      row = {
        collaboratorId: cid,
        name: e.collaborator?.name ?? "Sem nome",
        bruto: 0,
        descontos: 0,
        liquido: 0,
        fgts: 0,
        bonificacao: 0,
        custoTotal: 0,
        entries: [],
      };
      byCollab.set(cid, row);
    }
    row.entries.push(e);

    const value = Number(e.value) || 0;
    if (isEmployerCost(e.type)) {
      row.fgts += value;
    } else if (isEarning(e.type)) {
      row.bruto += value;
      // Subtotal informativo — já contabilizado no bruto acima.
      if (e.type === "bonificacao") row.bonificacao += value;
    } else if (isDeduction(e.type)) {
      row.descontos += value;
    }
  }

  for (const row of byCollab.values()) {
    row.bruto = round2(row.bruto);
    row.descontos = round2(row.descontos);
    row.fgts = round2(row.fgts);
    row.bonificacao = round2(row.bonificacao);
    row.liquido = round2(row.bruto - row.descontos);
    row.custoTotal = round2(row.bruto + row.fgts);
    // Dentro da pessoa: proventos primeiro, maior valor no topo.
    row.entries.sort((a, b) => {
      const ea = isEarning(a.type) ? 0 : 1;
      const eb = isEarning(b.type) ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return Number(b.value) - Number(a.value);
    });
  }

  return Array.from(byCollab.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function sumApprovalTotals(
  rows: CollaboratorApprovalSummary[],
): ApprovalTotals {
  const t: ApprovalTotals = {
    pessoas: rows.length,
    bruto: 0,
    descontos: 0,
    liquido: 0,
    fgts: 0,
    bonificacao: 0,
    custoTotal: 0,
    liquidoNaoPositivo: 0,
  };
  for (const r of rows) {
    t.bruto += r.bruto;
    t.descontos += r.descontos;
    t.liquido += r.liquido;
    t.fgts += r.fgts;
    t.bonificacao += r.bonificacao;
    t.custoTotal += r.custoTotal;
    if (r.liquido <= 0) t.liquidoNaoPositivo += 1;
  }
  t.bruto = round2(t.bruto);
  t.descontos = round2(t.descontos);
  t.liquido = round2(t.liquido);
  t.fgts = round2(t.fgts);
  t.bonificacao = round2(t.bonificacao);
  t.custoTotal = round2(t.custoTotal);
  return t;
}
