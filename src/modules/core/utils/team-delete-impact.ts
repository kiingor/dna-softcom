// Exclusão de setor: o que acontece com quem aponta para ele.
//
// collaborators.team_id, positions.team_id e job_openings.team_id usam
// ON DELETE SET NULL. O banco não barra a exclusão: quem estiver no setor fica
// sem setor, sem aviso. Por isso a tela confere os vínculos antes de excluir:
//   - colaborador ativo ou em admissão bloqueia (precisa trocar de setor antes);
//   - inativo/reprovado, cargo e vaga não bloqueiam, mas o diálogo avisa que
//     vão ficar sem setor.
//
// Só os status listados em NON_BLOCKING_COLLABORATOR_STATUSES liberam a
// exclusão. Um status novo no enum conta como bloqueante, para que a omissão
// nunca deixe alguém do quadro sem setor.

export const NON_BLOCKING_COLLABORATOR_STATUSES: ReadonlySet<string> = new Set([
  "inativo",
  // Admissão reprovada: a pessoa nunca entrou no quadro.
  "reprovado",
]);

export interface TeamDeleteImpact {
  /** Colaboradores ativos ou em admissão: impedem a exclusão. */
  blockingCollaborators: number;
  /** Inativos ou reprovados: ficam sem setor. */
  detachedCollaborators: number;
  /** Cargos vinculados ao setor: ficam sem setor. */
  detachedPositions: number;
  /** Vagas vinculadas ao setor: ficam sem setor. */
  detachedJobOpenings: number;
}

export function summarizeTeamDeleteImpact(input: {
  collaborators: ReadonlyArray<{ status: string | null }>;
  positionsCount: number | null;
  jobOpeningsCount: number | null;
}): TeamDeleteImpact {
  let blockingCollaborators = 0;
  let detachedCollaborators = 0;
  for (const { status } of input.collaborators) {
    if (status && NON_BLOCKING_COLLABORATOR_STATUSES.has(status)) {
      detachedCollaborators++;
    } else {
      blockingCollaborators++;
    }
  }
  return {
    blockingCollaborators,
    detachedCollaborators,
    detachedPositions: Math.max(0, input.positionsCount ?? 0),
    detachedJobOpenings: Math.max(0, input.jobOpeningsCount ?? 0),
  };
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinWithE(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** Ex.: "3 colaboradores ativos ou em admissão". */
export function describeBlockingCollaborators(count: number): string {
  return countLabel(
    count,
    "colaborador ativo ou em admissão",
    "colaboradores ativos ou em admissão",
  );
}

/** Ex.: "2 colaboradores inativos, 1 cargo e 3 vagas". `null` se nada fica sem setor. */
export function describeDetached(impact: TeamDeleteImpact): string | null {
  const parts: string[] = [];
  if (impact.detachedCollaborators > 0) {
    parts.push(
      countLabel(impact.detachedCollaborators, "colaborador inativo", "colaboradores inativos"),
    );
  }
  if (impact.detachedPositions > 0) {
    parts.push(countLabel(impact.detachedPositions, "cargo", "cargos"));
  }
  if (impact.detachedJobOpenings > 0) {
    parts.push(countLabel(impact.detachedJobOpenings, "vaga", "vagas"));
  }
  return parts.length > 0 ? joinWithE(parts) : null;
}
