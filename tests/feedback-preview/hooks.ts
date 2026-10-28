import type { Objetivo } from '../../src/modules/feedback/types';
const base: Objetivo = { id: 42, tipo: 'Cultura', comentario: 'Contribuição original do colaborador, preservada na Agenda.', datas: '2026-10-28', mostrarSuporte: true, lancamentoUsuarioId: 10, lancamentoDatas: '2026-10-28' };
export const objetivos: Objetivo[] = [
  { ...base, campanhaId: 'local', campanhaNome: 'Campanha local do DNA', culturaId: 'local', culturaNome: 'Cultura local do DNA', origemPainel: { campanhaNome: 'Campanha original do Hub', culturaNome: 'Cooperação original do Hub', percentual: 0, objetivo: 'Compartilhar aprendizado com a equipe.', prazo: '2026-11-30' } },
  { ...base, id: 43, comentario: 'Origem com todos os metadados nulos.', origemPainel: { campanhaNome: null, culturaNome: null, percentual: null, objetivo: null, prazo: null } },
  { ...base, id: 44, comentario: 'Feedback antigo, sem origem do painel.' },
  { ...base, id: 45, comentario: 'Teste de nomes sem espaços no limite de tamanho.', origemPainel: { campanhaNome: 'Campanha'.repeat(15), culturaNome: 'Cultura'.repeat(20), percentual: 85.2, objetivo: 'Objetivo'.repeat(20), prazo: '2026-11-30' } },
];
export const useObjetivos = () => ({ data: objetivos, isLoading: false, isError: false, refetch: async () => undefined });
export const useLancadorNames = () => new Map([[10, 'Autor QA sintético']]);
export const useObjetivoMutations = () => ({ create: { isPending: false }, update: { isPending: false }, remove: { isPending: false } });
export const useFeedbackOptions = () => ({ data: { campaigns: [], cultures: [] }, isSuccess: true, isError: false, isLoading: false });
export const usePermissions = () => ({ canView: false });
