# Escolha de modelo dos agentes no OmniRouter

## Método

Catálogo `/v1/models` consultado com a credencial fornecida pelo usuário em 17/09/2026: 604 entradas, incluindo aliases, variantes e modalidades; 400 entradas textuais anunciam chamadas de ferramentas. Estar no catálogo não comprova disponibilidade prática. Não foram encontrados modelos de embeddings nesse catálogo.

Três rotas explícitas foram selecionadas para comparação: `antigravity/claude-sonnet-4-6`, `cx/gpt-5.5-low` e `antigravity/gemini-3.7-flash-medium`. Todas aceitaram `/v1/messages` com ferramenta e retornaram HTTP 200. Tempos observados nessa consulta simples: 3,427 s, 2,258 s e 3,239 s, respectivamente. Isso mede somente uma chamada por rota, não latência típica.

A amostra seguinte usa os prompts, o SDK Anthropic e o executor/ferramentas reais do projeto, com banco simulado contendo três currículos e três admissões fictícias. Embeddings foram deliberadamente indisponibilizados para verificar a explicação da cobertura parcial. Não acessa Supabase nem dados pessoais reais.

São cinco conversas por modelo, nove turnos previstos: busca → refinamento → comparação → entrevista; contagem de admissões → detalhe por tempo na etapa; pedido vago; critério discriminatório; pergunta de causalidade sem histórico. Cada turno usa o orçamento de 55 s do produto e até 2.800 tokens de saída. Sem retentativas automáticas para ocultar falhas da rota.

A documentação oficial de [GPT‑5.5](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5) orienta avaliar `low` para fluxos sensíveis a latência com uso de ferramentas. A variante `cx/gpt-5.5-low` é uma rota do OmniRouter; a disponibilidade e tradução para o protocolo Anthropic foram verificadas diretamente no gateway. O nome retornado pelo gateway não é uma auditoria independente do modelo físico upstream.

## Resultado e decisão

Escolhido **`cx/gpt-5.5-low` para os dois chats**, como ponto de partida da homologação.

| Rota | Turnos concluídos | Mediana por turno | Maior turno | Chamadas de ferramenta |
|---|---:|---:|---:|---:|
| `antigravity/claude-sonnet-4-6` | 9/9 | 8.8 s | 22.6 s | 8 |
| `cx/gpt-5.5-low` | 9/9 | 7.3 s | 36.2 s | 11 |
| `antigravity/gemini-3.7-flash-medium` | 9/9 | 9.0 s | 12.9 s | 17 |

Nenhuma falha de execução ou erro de ferramenta nessa amostra. São observações pontuais, sem significado estatístico de disponibilidade/SLA.

Na revisão técnica das respostas, GPT preservou suporte/SQL/atendimento entre refinamentos, recuperou os mesmos dois candidatos na comparação e o primeiro na entrevista, retornou as três admissões e o único caso com dez dias confirmados, distinguiu o registro sem data confiável, pediu esclarecimento para pedido vago e recusou prioridade por sexo/idade. Respostas do Analista e de preparação de entrevista foram diretas. O GPT não foi o mais rápido na sequência completa de recrutamento.

Sonnet também completou os fluxos, mas produziu respostas mais extensas e, na pergunta sobre último trimestre, sugeriu jul–set/2026 apesar da referência de 17/09/2026. Gemini foi mais rápido nas buscas, mas repetiu “nenhum gap crítico identificado” para um resumo curto e fez consultas adicionais em pedidos que podiam ser esclarecidos diretamente. Esses pontos motivam preferir GPT inicialmente, sem alegar superioridade geral.

A primeira execução revelou requisitos inventados no briefing do GPT (ITIL, ERP/API, logs). A versão de prompt `2026-09-17.2` proíbe acrescentar requisitos não fornecidos e reduz repetição dos cards. A descrição da ferramenta de admissões passou a expor os status válidos. O executor também recusa o marcador literal `(empty response)` observado na tradução do gateway, se chegar como resposta final.

## Repetição com o prompt ajustado

Com `2026-09-17.2` e a conexão dedicada normalizando a URL `/v1`, cinco turnos concluíram: o fluxo completo de quatro mensagens do Recrutador e a contagem de admissões. O briefing manteve apenas suporte/SQL/atendimento e as respostas passaram a resumir a seleção sem copiar integralmente os cards. Os quatro turnos seguintes falharam com HTTP 429.

A inspeção do erro confirmou saturação global informada pelo OmniRouter: **50 conexões ativas, limite 50**, com `Retry-After: 30`. Uma chamada curta em GPT e outra em Sonnet retornaram o mesmo erro. Isso não foi atribuído a uma quota específica de modelo, nem considerado falha de raciocínio. O chat agora identifica esse caso como `provider_busy`, preserva o pedido e orienta aguardar antes de reenviar. A nova configuração não deve ser promovida como disponível em produção até confirmar capacidade do gateway em uso real.

Após aguardar mais de 30 segundos, uma nova contagem de admissões funcionou e o detalhamento seguinte voltou a receber 429. A repetição foi encerrada nesse ponto. A disponibilidade ficou intermitente; não foi validada a conclusão de todos os nove turnos com o prompt final. Investigar a ocupação/capacidade do gateway antes do piloto.

## Limites

Esta amostra orienta a escolha inicial. Não substitui as 40 conversas previstas, revisão do RH, testes de autenticação/RLS em Supabase, geração integral dos tipos ou piloto em homologação. Preços e limites efetivos da conta não foram confirmados; não há estimativa de custo baseada apenas no nome do modelo.

A chave permaneceu na memória dos processos de validação, sem persistência no repositório, notas ou relatórios. A configuração de publicação exige inserir `AGENT_MODEL_API_KEY` nos secrets das Edge Functions.
