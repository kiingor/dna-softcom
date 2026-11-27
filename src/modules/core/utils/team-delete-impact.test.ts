import { describe, expect, it } from "vitest";
import {
  describeBlockingCollaborators,
  describeDetached,
  summarizeTeamDeleteImpact,
} from "./team-delete-impact";

describe("summarizeTeamDeleteImpact", () => {
  it("bloqueia ativos e admissões em andamento, e só avisa sobre inativos e reprovados", () => {
    const impact = summarizeTeamDeleteImpact({
      collaborators: [
        { status: "ativo" },
        { status: "aguardando_documentacao" },
        { status: "validacao_pendente" },
        { status: "inativo" },
        { status: "reprovado" },
      ],
      positionsCount: 2,
      jobOpeningsCount: 1,
    });

    expect(impact).toEqual({
      blockingCollaborators: 3,
      detachedCollaborators: 2,
      detachedPositions: 2,
      detachedJobOpenings: 1,
    });
  });

  it("trata status desconhecido ou ausente como bloqueante", () => {
    const impact = summarizeTeamDeleteImpact({
      collaborators: [{ status: "afastado" }, { status: null }],
      positionsCount: null,
      jobOpeningsCount: null,
    });

    expect(impact.blockingCollaborators).toBe(2);
    expect(impact.detachedCollaborators).toBe(0);
    expect(impact.detachedPositions).toBe(0);
    expect(impact.detachedJobOpenings).toBe(0);
  });

  it("libera setor vazio", () => {
    expect(
      summarizeTeamDeleteImpact({ collaborators: [], positionsCount: 0, jobOpeningsCount: 0 }),
    ).toEqual({
      blockingCollaborators: 0,
      detachedCollaborators: 0,
      detachedPositions: 0,
      detachedJobOpenings: 0,
    });
  });
});

describe("textos do diálogo de exclusão", () => {
  it("flexiona a quantidade de colaboradores que bloqueiam", () => {
    expect(describeBlockingCollaborators(1)).toBe("1 colaborador ativo ou em admissão");
    expect(describeBlockingCollaborators(3)).toBe("3 colaboradores ativos ou em admissão");
  });

  it("lista o que fica sem setor e omite o que está zerado", () => {
    expect(
      describeDetached({
        blockingCollaborators: 0,
        detachedCollaborators: 2,
        detachedPositions: 1,
        detachedJobOpenings: 3,
      }),
    ).toBe("2 colaboradores inativos, 1 cargo e 3 vagas");
    expect(
      describeDetached({
        blockingCollaborators: 0,
        detachedCollaborators: 1,
        detachedPositions: 0,
        detachedJobOpenings: 1,
      }),
    ).toBe("1 colaborador inativo e 1 vaga");
    expect(
      describeDetached({
        blockingCollaborators: 0,
        detachedCollaborators: 0,
        detachedPositions: 0,
        detachedJobOpenings: 0,
      }),
    ).toBeNull();
  });
});
