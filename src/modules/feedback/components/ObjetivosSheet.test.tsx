import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjetivosSheet } from './ObjetivosSheet';
import type { FeedbackColaborador, Objetivo } from '../types';

const hooks = vi.hoisted(() => ({ objetivos: vi.fn(), names: vi.fn(), mutations: vi.fn() }));
vi.mock('../hooks/use-feedbacks', () => ({ useObjetivos: hooks.objetivos, useLancadorNames: hooks.names, useObjetivoMutations: hooks.mutations }));
// O formulário é um fluxo separado; esta suíte valida o detalhe e seus metadados.
vi.mock('./ObjetivoForm', () => ({ ObjetivoForm: () => null }));
const pessoa: FeedbackColaborador = { id: 20, nome: 'Pessoa sintética', feedbacks: 1, dataUltimoFeedback: '2026-10-28', status: 'Em dia' };
const objetivo: Objetivo = { id: 42, tipo: 'Cultura', comentario: 'Apoiou a equipe na entrega.', datas: '2026-10-28', mostrarSuporte: true, lancamentoUsuarioId: 10, lancamentoDatas: '2026-10-28' };
const origem = { campanhaNome: 'Campanha original do Hub', culturaNome: 'Cultura original do Hub', percentual: 0, objetivo: 'Compartilhar aprendizado\ncom o time', prazo: '2026-11-30' };
function montar(item: Objetivo) {
  hooks.objetivos.mockReturnValue({ data: [item], isLoading: false, isError: false, refetch: vi.fn() });
  render(<ObjetivosSheet colaborador={pessoa} guardiao={null} perms={{ canCreate: false, canEdit: false, canDelete: false }} onOpenChange={vi.fn()} />);
}
beforeEach(() => {
  hooks.names.mockReturnValue(new Map([[10, 'Autor sintético']]));
  hooks.mutations.mockReturnValue({ create: { isPending: false }, update: { isPending: false }, remove: { isPending: false } });
});
afterEach(cleanup);

describe('origem do painel no detalhe do DNA', () => {
  it('distingue o catálogo local dos dados originais e preserva índice zero e prazo', () => {
    montar({ ...objetivo, campanhaId: 'dna-campanha', campanhaNome: 'Campanha local DNA', culturaId: 'dna-cultura', culturaNome: 'Cultura local DNA', origemPainel: origem });
    expect(screen.getByText('Campanha: Campanha local DNA')).toBeVisible();
    expect(screen.getByText('Cultura: Cultura local DNA')).toBeVisible();
    const bloco = screen.getByText('Enviado pelo painel do colaborador').parentElement!;
    expect(within(bloco).getByText('Campanha do envio: Campanha original do Hub')).toBeVisible();
    expect(within(bloco).getByText('Cultura do envio: Cultura original do Hub')).toBeVisible();
    expect(within(bloco).getByText('0%')).toBeVisible();
    expect(bloco).toHaveTextContent(/Objetivo: Compartilhar aprendizado com o time/);
    expect(bloco).toHaveTextContent(/Data combinada: 30 de nov. de 2026/);
    expect(screen.getByText('Apoiou a equipe na entrega.')).toBeVisible();
    expect(screen.queryByText('Campanha e cultura ainda não definidas.')).not.toBeInTheDocument();
  });
  it('não cria valores para metadados nulos e mantém a identificação da origem', () => {
    montar({ ...objetivo, origemPainel: { campanhaNome: null, culturaNome: null, percentual: null, objetivo: null, prazo: null } });
    expect(screen.getByText('Enviado pelo painel do colaborador')).toBeVisible();
    expect(screen.queryByText(/Campanha do envio:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cultura do envio:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Índice na ocasião:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Data combinada:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Campanha e cultura ainda não definidas.')).not.toBeInTheDocument();
  });
  it('mantém o aviso de classificação e a UI antiga quando não existe origem do painel', () => {
    montar(objetivo);
    expect(screen.getByText('Campanha e cultura ainda não definidas.')).toBeVisible();
    expect(screen.getByText('Apoiou a equipe na entrega.')).toBeVisible();
    expect(screen.queryByText('Enviado pelo painel do colaborador')).not.toBeInTheDocument();
    expect(screen.getByText(/Autor sintético/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
  });
  it('exibe a origem de um Objetivo sem convertê-lo em Cultura', () => {
    montar({ ...objetivo, tipo: 'Objetivo', origemPainel: origem });
    expect(screen.getByText('Objetivo', { selector: '[data-slot="badge"], div.inline-flex, span' })).toBeVisible();
    expect(screen.getByText('Enviado pelo painel do colaborador')).toBeVisible();
    expect(screen.queryByText(/^Campanha:/)).not.toBeInTheDocument();
  });
  it('fecha por Escape mantendo a ação de fechamento do Sheet', () => {
    const fechar = vi.fn();
    hooks.objetivos.mockReturnValue({ data: [objetivo], isLoading: false, isError: false, refetch: vi.fn() });
    render(<ObjetivosSheet colaborador={pessoa} guardiao={null} perms={{ canCreate: false, canEdit: false, canDelete: false }} onOpenChange={fechar} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(fechar).toHaveBeenCalledWith(false);
  });
});
