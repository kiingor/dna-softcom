# Recrutador e Analista IA

Os dois chats compartilham sessão, execução de ferramentas, transporte e interface. As especialidades ficam nos prompts e nas ferramentas de cada domínio.

## Conversa e contexto

- `AgentChatPage` isola estado e cache por usuário, empresa e agente. Trocar de empresa aborta a requisição local e desmonta a conversa anterior.
- O pedido aparece imediatamente e é persistido antes de chamar o modelo. `requestId` identifica reenvios da mesma mensagem.
- `agent_begin_turn` valida novamente dono/empresa/tipo da sessão, serializa turnos e recupera respostas já concluídas. `agent_finish_turn` grava resposta, contexto e conclusão em uma transação.
- O histórico usa as 80 mensagens mais recentes, com orçamento de 32 mil caracteres. O briefing/seleção ou os últimos filtros ficam em `task_context`, com limites de tamanho. Dados mutáveis são consultados novamente.
- A execução tem limite de rodadas, limite de tempo e síntese final após o orçamento de ferramentas. Erros de consulta, resultados vazios e cobertura parcial são distintos.

## Ferramentas

**Recrutador:** localizar vagas; buscar candidatos ativos com recuperação textual e vetorial; recuperar candidatos por ID para comparação/entrevista; selecionar a ordem final dos cards com trechos verificáveis do currículo. A busca vetorial considera somente embeddings do modelo compatível. Similaridade não aparece como percentual de aptidão.

**Analista:** resolver lojas/times; composição atual do quadro; admissões e tempo conhecido na etapa; retrato de vagas/candidaturas; marcos de jornada. Filtros passam por validação e consultas são limitadas/paginadas. Agrupamentos sobre dados incompletos informam que são parciais. Vagas e admissões não têm filtro de loja nesta implementação; histórico de quadro e conversão histórica não são fabricados a partir do retrato atual.

As ferramentas usam o JWT do usuário e RLS, além do escopo de empresa. Cada módulo consultado exige sua permissão de leitura. `service_role` é usado somente para persistência autorizada da conversa e telemetria. Não há ferramenta de alteração de cadastros, aprovação, movimentação ou envio de mensagens.

## Interface e evidências

A interface oferece progresso, interrupção, reenvio, cópia, avaliação útil/não útil, fontes, tabelas e cards de candidatos. O histórico recarrega candidatos ainda ativos sob RLS. Imagens e links externos do texto do modelo não são renderizados; links do DNA seguem uma lista de rotas permitidas.

O transporte usa SSE para progresso e conclusão. Streaming de tokens do provedor é opcional: o roteador atual precisa comprovar compatibilidade antes de ativá-lo. Com streaming de tokens desativado, o usuário acompanha as etapas e recebe a resposta completa ao final.

## Configuração no backend

| Variável | Padrão | Uso |
|---|---|---|
| `AGENT_MODEL_BASE_URL` | não definido | Base dedicada do OmniRouter, aceita URL terminada em `/v1`. |
| `AGENT_MODEL_API_KEY` | não definido | Secret exclusivo dos dois chats, usado junto da base dedicada. |
| `AGENT_ANALYST_MODEL` | `cx/gpt-5.5-low` no OmniRouter; `dna-model` no legado | Modelo/alias do Analista. |
| `AGENT_RECRUITER_MODEL` | `cx/gpt-5.5-low` no OmniRouter; `dna-model` no legado | Modelo/alias do Recrutador. |
| `AGENT_MODEL_STREAMING` | desativado | Ativar com `true` após validar o roteador. |

Modelo escolhido em 17/09/2026: **GPT‑5.5 Low**, rota explícita `cx/gpt-5.5-low` no OmniRouter indicado pelo usuário. Ver [comparação com Sonnet/Gemini e limitações](../../../docs/avaliacao-omnirouter-agentes-2026-09-17.md) e [configuração de referência](../../../deploy/agents.env.example).

Base e chave dedicadas devem ser configuradas juntas nos secrets das Edge Functions, nunca no frontend. O SDK usa `/v1/messages`; a normalização da base evita `/v1/v1/messages`. Configuração incompleta falha sem reutilizar a chave de outro provedor. Sem essas duas variáveis, permanece a conexão legada `ANTHROPIC_*`, permitindo publicar o código antes de ativar o novo provedor. Os demais fluxos de IA mantêm sua conexão existente.

Embeddings de candidatos continuam usando `OPENAI_API_KEY` e `text-embedding-3-small`, compatíveis com o índice existente. O catálogo consultado do OmniRouter não anunciou embeddings; a chave do OmniRouter não deve substituir `OPENAI_API_KEY`. Se essa integração estiver indisponível, a busca textual continua e o agente informa a cobertura parcial.

A resposta registra modelo solicitado e campo `model` devolvido pelo provedor. Se o roteador devolver apenas o alias, o provedor/modelo físico continua desconhecido. Tokens registrados são os informados pela resposta do LLM; custo financeiro depende do preço real da rota e ainda não é calculado. O limite atual é de 60 pedidos por usuário/agente/hora; avaliações maiores devem ser divididas em lotes.

Logs técnicos guardam IDs de execução, versões, nomes de ferramentas, duração e falhas. Texto de perguntas e payloads de candidatos não são copiados para esses logs. As mensagens da conversa continuam no histórico existente, protegido por suas policies.

## Banco e publicação

Aplicar, nesta ordem, as migrations:

1. `20260917140000_agent_turns.sql`: contexto da sessão, execuções e RPCs transacionais.
2. `20260917140100_agent_admission_metrics.sql`: entrada rastreada em etapa e correção da média. Registros antigos ficam com tempo desconhecido até uma nova transição; não há backfill especulativo.
3. `20260917140200_agent_candidate_search.sql`: busca vetorial com elegibilidade e modelo compatível, respeitando RLS.

A primeira publicação deve ocorrer em homologação com dados sintéticos. Publicar `analyst-chat`, `recruiter-search`, os módulos `_shared/agents`, `_shared/claude.ts`, `_shared/claude-protocol.ts`, `_shared/embeddings.ts` e a correção de `cv-process`, junto do frontend correspondente. Na instalação própria, copiar os arquivos compartilhados também; publicar só `index.ts` não basta. Validar o runtime efetivo antes de promover.

Os tipos de `src/integrations/supabase/types.ts` foram sincronizados com as mudanças. A tentativa de regeneração integral com `supabase gen types typescript --local` nesta máquina falhou por ausência de Docker/Podman. Conferir a geração integral no ambiente de homologação antes da publicação. As migrations foram executadas em PostgreSQL/PGlite nos testes, incluindo pgvector.

Reversão operacional: restaurar as versões anteriores de frontend e funções. As adições de schema podem permanecer para preservar o histórico. Cada migration inclui rollback explícito; remoção de `agent_runs` exige preservar backup, pois contém o histórico das execuções. Não aplicar rollback destrutivo como primeira medida de reversão.

## Validação

Testes específicos:

```bash
npm test -- __tests__/agents src/modules/agents
```

Na máquina desta implementação, Node 26 expõe um `localStorage` incompatível com alguns testes existentes de sessão. A suíte completa passa com a opção de processo:

```bash
NODE_OPTIONS=--no-experimental-webstorage npm test
```

As fixtures SQL testam persistência, replay, concorrência lógica, rejeição de sessão incorreta, permissões das RPCs, tempo na etapa e busca vetorial com RLS. Os testes de interface verificam resposta otimista, reenvio, mudança de empresa, ordem dos cards e renderização segura. Eles não comprovam a utilidade de um modelo real.

`evals/agents/scenarios.json` contém 40 conversas: 20 por agente. Para listar sem chamadas de API:

```bash
node scripts/evaluate-agents.mjs --list --agent recruiter --limit 20
```

Para executar em homologação, configurar `AGENT_EVAL_STAGING=true`, `AGENT_EVAL_BASE_URL`, `AGENT_EVAL_TOKEN` (JWT de usuário de teste), `AGENT_EVAL_ANON_KEY` e `AGENT_EVAL_COMPANY_ID` no ambiente. Não colocar credenciais no comando ou no repositório.

```bash
node scripts/evaluate-agents.mjs --agent recruiter --limit 3 --label configuracao-atual
node scripts/evaluate-agents.mjs --case recruiter-comparacao --label configuracao-candidata
```

O relatório padrão fica em `/tmp`, com acesso restrito ao usuário. Ele registra respostas, ferramentas, tempo e tokens, sem credenciais. Deve conter somente dados sintéticos do ambiente de teste. Para comparar modelos, executar os mesmos casos e dados após alterar a configuração do backend; o cliente não pode sobrescrever o modelo.

Avaliação humana: nota 1–5 para cumprimento do pedido, continuidade, evidência e utilidade do próximo passo. Meta inicial: ao menos 85% dos casos com nota 4/5, 95% de fidelidade factual e todos os casos críticos aprovados. Execução bem-sucedida de API não equivale a resposta útil.

## Estado da entrega

Implementação local, testes automatizados e comparação inicial com modelos reais no OmniRouter concluídos. A amostra com modelo real usa dados sintéticos e banco simulado; geração integral dos tipos, validação no Supabase real, avaliação completa com RH e publicação ainda dependem do ambiente de homologação. Nenhum resultado de publicação ou piloto foi presumido a partir dos testes locais.

A integração dedicada passou em 63 testes específicos, ESLint e Deno check. Na comparação inicial, os três modelos completaram nove turnos cada. Na repetição com o prompt ajustado, o OmniRouter apresentou HTTP 429 por limite global de 50 conexões ativas, inclusive em modelos diferentes; a retomada após o tempo indicado permaneceu intermitente. O chat trata esse caso como indisponibilidade temporária, mas a capacidade do gateway ainda precisa ser confirmada para o piloto.

Verificações em 17/09/2026: build aprovado; suíte completa com 378 testes aprovados e 13 testes de integração externa ignorados; 55 testes específicos dos agentes aprovados; ESLint dos arquivos dos agentes e checagem Deno das duas funções, `cv-process` e `admission-document-validate` aprovados. O lint global apresenta os mesmos 119 erros e 21 avisos da `main`; a checagem TypeScript global continua com erros preexistentes, sem novos diagnósticos nas alterações. A revisão visual local usou componentes reais com dados sintéticos em desktop e celular, sem validar autenticação ou chamadas ao modelo.
