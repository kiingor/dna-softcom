# Feedback Colaborador

O painel consulta feedbacks e objetivos na Agenda por meio da Edge Function
`feedbacks`. A data de admissão vem de `collaborators.admission_date` no DNA,
associada por `external_id` e limitada à empresa autorizada. Essa consulta usa
somente os IDs presentes no painel e não altera cadastros.

## Campanhas e culturas

Em **Configurações → Feedback**, usuários com permissão de configuração podem
cadastrar campanhas e culturas em listas independentes. É possível renomear,
desativar e reativar; não há exclusão pela interface. Nomes não podem ficar
vazios, exceder 100 caracteres ou se repetir na mesma lista/empresa, mesmo entre
opções inativas (comparação sem distinguir maiúsculas).

O novo tipo **Cultura** exige uma campanha e uma cultura nos dois formulários
de feedback. Novos registros usam opções ativas. Na edição, uma opção inativa
que já estava vinculada continua disponível. O histórico mostra os nomes atuais
dos cadastros; mudar para Comentário/Objetivo remove a classificação.

Os catálogos `feedback_campaigns` e `feedback_cultures` pertencem ao DNA.
`feedback_classifications` vincula os IDs ao feedback e colaborador da Agenda,
por empresa, sem copiar comentários. O tipo, comentário e visibilidade continuam
gravados na Agenda. Campanha/cultura aparecem no DNA; não são campos nativos da
Agenda. A regra existente dos indicadores continua contando todos os tipos.

As três tabelas têm RLS e auditoria. Catálogos permitem leitura para feedback
ou configurações, e escrita conforme `configuracoes.can_create/can_edit`.
Classificações são escritas apenas pela Edge Function após autorizar o usuário
e validar as opções; FKs compostas impedem referências entre empresas.

Como Agenda e DNA não compartilham transação, a validação ocorre antes da
gravação remota. Se a Agenda confirmar e a classificação falhar, a função retorna
o sucesso remoto com aviso explícito para reparar pela edição, sem induzir a
repetição de um POST. Falha de leitura dos vínculos é tratada como erro, não como
ausência de classificação. A edição usa upsert pelo ID remoto. A remoção limpa
o vínculo local após a confirmação da Agenda e informa se essa limpeza falhar.
Detalhes da decisão: [ADR 0007](../../../docs/adr/0007-feedback-culture-settings.md).

## Filtros do painel

- Nome, setor, empresa e tempo de casa são combinados no navegador.
- **Até um ano de casa** inclui o dia do primeiro aniversário da admissão.
  **Mais de um ano de casa** começa no dia seguinte. A comparação usa a data
  local, sem converter o dia de admissão para outro fuso.
- Sem data de admissão válida, o colaborador aparece na visão geral e fica
  fora das duas faixas. Ao segmentar, a tela informa quantos não têm data válida.
- Os indicadores **Pendentes**, **Em atraso**, **Em dia** e os títulos das
  colunas filtram o Kanban. Clicar novamente no status selecionado remove esse
  filtro. **Colaboradores** e **Mostrar todos os status** restauram as colunas,
  preservando os demais filtros.
- As contagens dos indicadores respeitam a segmentação e continuam mostrando
  todos os status para permitir a alternância entre eles.
- O filtro de Guardião é aplicado pela Agenda e também define o autor de um
  novo feedback. As regras dos status permanecem as da Agenda: pendente sem
  feedback, em atraso acima de 120 dias e em dia até 120 dias.

## Validação e publicação

```sh
npm test -- src/modules/feedback __tests__/functions/feedbacks.test.ts __tests__/functions/feedback-classification.test.ts __tests__/functions/feedback-settings.sql.test.ts
npx eslint src/modules/feedback supabase/functions/feedbacks __tests__/functions/feedback*.ts
npm run build
```

Aplicar primeiro `20261027180000_feedback_culture_settings.sql`, publicar o
diretório da função `feedbacks` (incluindo `classification.ts`) e então o frontend.
Os formulários anteriores de Comentário/Objetivo permanecem compatíveis.
Após aplicar, regenerar os tipos usando o CLI ou o gerador TypeScript do pg-meta
na VPS. Em ambiente sem Docker, o CLI local não consegue iniciar seu gerador.

A produção atual fica na VPS `vm-squad-ia-02`: frontend em `dnasoftcom.com`
e API em `api.dnasoftcom.com`. O deploy automático da Vercel é um ambiente
separado e não atualiza essa VPS.

- A função fica em `/root/supabase/volumes/functions/feedbacks/index.ts`.
  Após atualizar o arquivo, reiniciar `supabase-edge-functions` e verificar
  o boot com uma requisição OPTIONS à função.
- O frontend usa o código de `/root/dna-app` e o Compose
  `deploy/frontend.yml`, com a configuração existente em `deploy/frontend.env`.
  Reconstruir a imagem com a URL da API da VPS e atualizar apenas `web`.
- Manter backup dos arquivos e da imagem anterior antes da publicação.
  Os demais serviços, segredos e o dispatcher de funções mantêm a configuração
  existente no servidor.

Em rollback de aplicação, restaurar a função e a imagem anteriores, mantendo
os catálogos e vínculos. O rollback SQL remove as tabelas e só deve ser usado
após exportar dados que já tenham sido cadastrados.
