// Tipos da tela Feedback Colaborador (Guardião da Cultura).
// DTOs da API legada, com data de admissão complementada pelo cadastro do DNA.

export type FeedbackStatus = "Pendente" | "Em dia" | "Em Atraso";
export type FeedbackStatusFilter = "all" | FeedbackStatus;
export type TempoDeCasaFilter = "all" | "ate-um-ano" | "mais-de-um-ano";

/** Um colaborador no painel `/v1/feedbacks`. */
export interface FeedbackColaborador {
  id: number;
  nome: string | null;
  feedbacks: number;
  dataUltimoFeedback: string | null;
  status: FeedbackStatus;
  setor?: string | null;
  empresa?: string | null;
  /** Data de admissão do cadastro local, vinculada pelo ID da Agenda. */
  dataAdmissao?: string | null;
}

/** KPIs agregados do painel (respeitam o filtro de Guardião). */
export interface FeedbacksTotais {
  colaboradores: number;
  pendente: number;
  emDia: number;
  emAtraso: number;
  feedbacks: number;
}

export interface FeedbacksResponse {
  totais: FeedbacksTotais;
  colaboradores: FeedbackColaborador[];
}

/** Resultado do typeahead `/v1/busca-colaborador`. */
export interface BuscaColaborador {
  id: number;
  nomeSuporte: string | null;
  nome: string | null;
  telefones: string | null;
  telefones2: string | null;
  email: string | null;
  setor: string | null;
  desativado: boolean | null;
}

/** Um objetivo/feedback de um colaborador. */
export interface Objetivo {
  id: number;
  tipo: string | null;
  datas: string | null;
  comentario: string | null;
  mostrarSuporte: boolean;
  lancamentoUsuarioId: number;
  lancamentoDatas: string | null;
}

/** Guardião(ã) da Cultura selecionado — quem lança os feedbacks. */
export interface Guardiao {
  id: number;
  nome: string;
}

/**
 * Opções fixas do Select de tipo no form. O legado guarda `Tipo` como texto
 * livre; o RH só lança "Comentário" ou "Objetivo". Se a agenda esperar
 * "Comentario" sem acento, basta trocar o `value` aqui (o label permanece).
 */
export const OBJETIVO_TIPOS = [
  { value: "Comentário", label: "Comentário" },
  { value: "Objetivo", label: "Objetivo" },
] as const;

/** Ordem das colunas: ação primeiro, saudável por último. */
export const FEEDBACK_STATUS_ORDER: FeedbackStatus[] = [
  "Pendente",
  "Em Atraso",
  "Em dia",
];

/** Aparência por status (cores via Tailwind). */
export const FEEDBACK_STATUS_META: Record<
  FeedbackStatus,
  { label: string; description: string; dotClass: string; headerClass: string; countClass: string }
> = {
  Pendente: {
    label: "Pendente",
    description: "Nunca recebeu feedback",
    dotClass: "bg-warning",
    headerClass: "text-warning dark:text-warning",
    countClass: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
  },
  "Em Atraso": {
    label: "Em atraso",
    description: "Último feedback há mais de 120 dias",
    dotClass: "bg-destructive",
    headerClass: "text-destructive dark:text-destructive",
    countClass: "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
  },
  "Em dia": {
    label: "Em dia",
    description: "Feedback nos últimos 120 dias",
    dotClass: "bg-success",
    headerClass: "text-success dark:text-success",
    countClass: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
  },
};
