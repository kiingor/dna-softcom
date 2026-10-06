# Instruções para agentes — DNA Softcom

Identidade Git: `github.com/kiingor/dna-softcom`. Produto: DNA Softcom.
As referências a SoftHouse nos documentos pertencem a este mesmo repositório.

## Fontes obrigatórias

Leia integralmente [CLAUDE.md](CLAUDE.md) e [CONTRIBUTING.md](CONTRIBUTING.md)
antes de alterar o projeto. Elas mantêm as regras de arquitetura, dados, Git,
verificação e entrega. Consulte [README.md](README.md) para preparação e
[docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md) e os ADRs em `docs/adr/` conforme o
escopo. Preserve alterações existentes de outras tarefas.

Para UI, siga [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) e os componentes e
tokens da branch: a identidade do DNA tem regras próprias. Reutilize os padrões,
mantenha temas/estados, microcopy pt-BR e cores semânticas por tokens. Não copiar
a paleta de outro produto sobre este Design System.

<!-- BRAINHUB:BEGIN -->
## Memória do projeto

Em trabalho substancial, consulte a skill `brainhub-projects` e a configuração
local da máquina. Execute `context --cwd` pelo utilitário da skill na worktree
atual; leia o painel do produto e as notas pertinentes à tarefa. Confira as notas
contra a branch e o código atuais; identifique clones pela origem Git, não pelo
nome da pasta.

Ao concluir uma mudança ou investigação relevante, use `record --cwd` para criar
um registro independente da sessão com decisões, solução, verificações reais,
versão e pendências. Preserve o histórico. Não grave credenciais, `.env`, dados
pessoais de clientes ou logs completos. Se o cofre estiver indisponível, preserve
o resumo local e informe a pendência. A memória não concede autorização adicional
para entrega ou publicação.
<!-- BRAINHUB:END -->

## Implementação e dados

- Conferir versões e scripts no [package.json](package.json) e no lockfile atual;
  descrições históricas não substituem o ambiente da branch.
- Respeitar separação por módulo, React Query para dados e os padrões de formulários
  existentes descritos no CLAUDE. Consultar o código relevante antes de criar outra
  abstração ou fonte de dados.
- Preservar RLS, isolamento por empresa/papel, auditoria e proteção de dados pessoais.
  Migrations seguem CONTRIBUTING: arquivo novo, rollback e tipos regenerados;
  não editar migrations já incorporadas. Conferir o destino real dos tipos no código.
- Manter o escopo funcional e as políticas de autorização do produto descritos nas
  fontes. Não inferir acesso nem alterar dados operacionais como teste de documentação.

## Verificação e entrega

O manifesto declara `npm run build`, `npm run lint`, `npm test` e `npm run test:rls`.
O checklist antes de merge está no CONTRIBUTING. Para alterações de RLS/dados,
conferir os pré-requisitos da suíte em `__tests__/rls` e o ambiente usado. Relatar
comandos executados, resultado e limitações; comando encontrado não é teste aprovado.

Entrega segue branch por tarefa, PR e squash, com Conventional Commits em pt-BR.
CONTRIBUTING descreve publicação automática do frontend pela Vercel após merge;
confirmar o resultado efetivo, sem confundir merge com publicação verificada.
`deploy:fns`, `deploy:fn`, `supabase db push` e reset do banco têm efeitos próprios;
não são checagens de leitura nem substituem o fluxo autorizado de entrega.
