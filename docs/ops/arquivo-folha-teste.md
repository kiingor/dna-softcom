# Arquivo da folha de teste de setembro/2026

O período de teste continha 277 lançamentos de R$ 1, 19 PIX liquidados e um
pagamento manual. A exclusão destruiria a origem dos comprovantes. O responsável
autorizou arquivar o teste e liberar a competência, mantendo quatro descontos
reais (R$ 493,81) disponíveis para a folha correta.

## Comportamento

- `payroll_periods.archived_at/archive_reason` preservam competência e metadados.
- `payroll_entries.archived_period_id` vincula somente os lançamentos do teste.
- A unicidade de empresa/competência considera apenas períodos ativos.
- Policies restritivas retiram o arquivo das consultas operacionais, inclusive
  relatórios e cálculos no cliente. As permissões e o MFA existentes continuam.
- RPCs que ignoram RLS filtram o arquivo explicitamente. Triggers impedem
  reabertura, alteração/exclusão e novos pagamentos sobre registros arquivados,
  inclusive por `service_role`. As proteções anteriores de PIX continuam ativas.
- O histórico permanece nas tabelas originais, com os mesmos IDs e vínculos,
  acessível para auditoria pela conexão administrativa. Não há tela de arquivo
  nesta mudança. Nenhuma folha substituta é criada automaticamente.
- A remoção de descontos de plano de saúde via `collaborator-subresource` também
  ignora arquivos: usa `service_role` e não deve tratar o teste encerrado como
  bloqueio para a competência nova.

## Aplicação

1. Criar backup privado no servidor dos registros do período, lançamentos da
   competência, linhas, pagamentos, transferências, aprovações, revisões e
   desafios vinculados. Guardar também schema e funções antes da migration.
2. Validar a migration `20260917120000_archive_payroll_periods.sql` e a operação
   `scripts/ops/archive-september-2026-test.sql` dentro de transação com rollback.
3. Aplicar a migration e registrar a versão em `supabase_migrations`.
4. Executar a operação com `psql -X -v ON_ERROR_STOP=1`. Ela trava brevemente as
   tabelas, confere identidade/contagens, recusa PIX em andamento ou desafios
   válidos e encerra somente a tentativa criada que nunca foi enviada ao banco.
5. A operação compara hashes integrais antes/depois dos comprovantes, linhas
   congeladas e descontos. Qualquer divergência aborta a transação.
6. Verificar zero períodos ativos para setembro, 277 lançamentos arquivados,
   quatro descontos ativos, 19 PIX liquidados e um pagamento manual intactos.
   Validar abertura e inclusão de lançamento na competência em transação
   descartável, sem executar pagamentos.

## Reversão

O rollback comentado da migration restaura o schema anterior se nenhum arquivo
foi criado. Após o arquivamento, ele recusa a execução para evitar reativar
lançamentos de teste ou colidir com a folha correta. Restaurar dados exige uma
operação revisada a partir do backup, considerando uma eventual folha substituta;
nunca desabilitar os guards de PIX para apagar histórico pago.

## Validação automatizada

`archivePayroll.sql.test.ts` executa SQL real em PGlite: unicidade da competência,
isolamento por empresa/RLS, preservação dos comprovantes, exclusão do teste no
cálculo, RPCs manuais/PIX, bloqueios por bypass de RLS, PIX pendentes, vínculo do
arquivo e rollback. Os testes usam dados fictícios e não chamam serviços bancários.

Os tipos das duas tabelas foram regenerados pelo `postgres-meta` do servidor,
com a migration dentro de transação descartada ao final. O comando local
`supabase gen types --local` não funciona nesta máquina sem Docker/Podman.
