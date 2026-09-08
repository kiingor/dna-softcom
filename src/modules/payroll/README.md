# `payroll/` — Folha (Controle, NÃO Cálculo)

**Fase 4** (2-3 semanas no plano).

## Princípio não-negociável

> **Não calculamos folha CLT.** Nada de INSS, IRRF, FGTS, encargos, eSocial. Cálculo CLT = projeto de 9-15 meses, fora do escopo.

O que fazemos: **controle de lançamentos** + **exportação organizada pro contador** que faz o cálculo.

## Escopo

Cada CNPJ tem o próprio fechamento de folha. Lançamentos são alimentados ao longo do mês (alguns automatizados, outros manuais), e no fechamento exportamos o pacote pro escritório contábil.

## Tabelas

- `payroll_periods` — um período por (CNPJ × mês). Status: aberto/fechado/exportado.
- `payroll_entries` — lançamentos do período (referência a colaborador + tipo + valor + observação)
- `payroll_alerts` — alertas pendentes que precisam atenção do RH (atraso, divergência, falta de aprovação)

## Tipos de lançamento (v1)

| Tipo | Origem | Quem cria |
|---|---|---|
| Salário base | Cadastro do colaborador | Automático |
| Hora extra | Manual ou integração ponto | RH/Gestor |
| Falta | Manual | RH/Gestor |
| Atestado | Manual | RH |
| Benefício (VR/VA) | Cadastro de benefícios | Automático |
| Adiantamento | Manual | RH |
| Bonificação | Manual | Gestor (com aprovação) |
| Desconto | Manual | RH (com justificativa) |

## Funcionalidades v1

- Listagem de períodos por CNPJ
- CRUD de lançamentos no período aberto
- Alertas: colaborador sem lançamento, divergência de valor, falta sem atestado
- Fechamento de período (vira read-only)
- Exportação Excel por regime/CNPJ pro contador
- Histórico de exportações (quem, quando, hash do arquivo)

## Diferenciação por regime

| | CLT | PJ | Estagiário |
|---|---|---|---|
| Salário | Base + HE + faltas + benefícios | Valor NF mensal | Bolsa + recesso |
| Lançamentos | Todos | NF + reembolso | Bolsa + auxílio |
| Exportação | Por regime separado | Por regime separado | Por regime separado |

## Edge Functions

- `payroll-export` — gera Excel do período pro contador (formato negociado)

## Relatórios por PDV

A tela **Relatórios** reúne os lançamentos da empresa e competência selecionadas
numa tabela por PDV e tipo de pagamento, acima do extrato por colaborador.
Salário base, FGTS, Agregado (`carro_agregado`), Custo setor (`bonificacao`) e
Gratificação são colunas permanentes. Outros tipos aparecem quando têm lançamentos
nos filtros atuais; valores ausentes aparecem como zero.

O agrupamento e o filtro usam primeiro o PDV do lançamento (`store_id`), com o PDV
atual do colaborador como alternativa para registros sem essa informação.
Lançamentos sem nenhum vínculo aparecem em **Sem PDV**. Os filtros de competência,
PDV e colaborador também se aplicam aos totais e às exportações.

Os totais seguem a classificação do módulo: líquido = proventos − descontos;
custo total = proventos + FGTS, com custo setor já incluído nos proventos.
Estornos compensam os respectivos tipos. O resumo usa valores já lançados, sem
recalcular encargos. Excel inclui a aba **Resumo por PDV** e PDF começa com a mesma
tabela, em paisagem, antes dos extratos individuais.

## Pagamentos e férias programadas

O pagamento mensal soma salário base, gratificação, veículo (`carro_agregado`),
salário-família, periculosidade e demais proventos pagáveis, incluindo o recibo de
férias programado para a competência. Apenas custo setor (`bonificacao` fora do
recibo) fica separado. Os impostos já calculados do mês e das férias são
descontados uma vez, com os componentes discriminados no detalhe.

Ao abrir ou repopular, férias aprovadas pendentes são incluídas sem duplicação.
Vale a competência escolhida no adiantamento ou, quando não informada, o mês do
gozo. O snapshot aprovado preserva o valor; solicitações antigas sem snapshot
consideram também a gratificação e a bonificação cadastradas.

Folhas já aprovadas usam os pagamentos congelados pelo servidor, preservando
valores, favorecidos e agrupamento anteriores. As migrations
`20260908160000_consolidate_payroll_payments.sql` e
`20260908160100_reclassify_vehicle_entries.sql` devem ser aplicadas antes da
publicação do frontend. A segunda corrige bonificações explicitamente descritas
como veículo nas folhas editáveis sem pagamentos/congelamento e na ficha fixa;
não recalcula encargos. Seus identificadores são guardados em tabela privada
para rollback. Ambas incluem o SQL de reversão comentado.

Validação: `npm test -- src/modules/payroll src/lib/payroll`. Os testes com
PGlite executam as funções SQL e comparam os valores com o agrupamento do
frontend, além de verificar reclassificação e rollback, sem acessar produção.
