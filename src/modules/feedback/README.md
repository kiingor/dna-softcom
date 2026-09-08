# Feedback Colaborador

O painel consulta feedbacks e objetivos na Agenda por meio da Edge Function
`feedbacks`. A data de admissão vem de `collaborators.admission_date` no DNA,
associada por `external_id` e limitada à empresa autorizada. Essa consulta usa
somente os IDs presentes no painel e não altera cadastros.

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
npm test -- src/modules/feedback __tests__/functions/feedbacks.test.ts
npx eslint src/modules/feedback supabase/functions/feedbacks/index.ts __tests__/functions/feedbacks.test.ts
npm run build
```

Publicar a função `feedbacks` junto com o frontend para disponibilizar
`dataAdmissao` no painel. A função continua compatível com o frontend anterior.
Não há migration.

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
