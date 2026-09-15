# Exportação de exames para Segurança do Trabalho

A tela **Exames** exporta Excel, PDF e impressão com os 11 campos abaixo, na mesma ordem do modelo informado. O Excel começa pelos cabeçalhos na primeira linha, com um exame por linha e sem títulos extras antes dos dados.

| Coluna | Origem |
| --- | --- |
| `NomeCompleto` | Nome do colaborador. |
| `cnpj_cont` | Nome da unidade contratante; usa a unidade de trabalho quando não há contratante vinculada. O cabeçalho segue o modelo, cujo exemplo contém o nome de uma unidade. |
| `exame` | Tipo do exame em maiúsculas e sem acentos, por exemplo `PERIODICO`. |
| `funcao` | Cargo vinculado ao exame; na ausência, cargo atual vinculado ao colaborador ou cargo em texto. |
| `Setor` | Local interno do cadastro (`internal_location`), como `INTERNO`, `EXTERNO` ou `COMERCIAL`, conforme o exemplo recebido. |
| `cpf` | CPF sem pontuação, mantido como texto para preservar zeros à esquerda. |
| `rg` | RG e órgão emissor cadastrado, sem repetir o órgão quando já estiver no RG. |
| `Sexo` | Sexo cadastrado (`M` ou `F`). |
| `data_nasc` | Data de nascimento. |
| `data_prev` | Data limite prevista do exame (`due_date`). |
| `ult_exame` | Data do último exame realizado da mesma pessoa e empresa, excluindo o exame da própria linha. |

As datas seguem `DD/MM/AAAA`, sem conversão de fuso para campos de calendário. Dados ausentes ficam vazios. Os textos cadastrais ficam em maiúsculas e preservam os acentos.

A exportação respeita os filtros da tela. A busca de `ult_exame` usa todo o histórico carregado, inclusive registros fora desses filtros, e considera apenas exames com status `realizado` e data de realização preenchida. Para cada linha, a data encontrada deve ser anterior ou igual à realização do exame exportado, ou à sua data limite se ainda não foi realizado. Não é inferida uma data pela periodicidade do cargo.

A consulta carrega o histórico em páginas, com ordenação por data limite e ID, preservando os filtros de empresa e colaborador ativo. Os botões de exportação aguardam esse carregamento.

## Referências

- Mapeamento: `src/lib/examExportData.ts`.
- Geração dos arquivos: `src/lib/examExportUtils.ts`.
- Consulta: `src/hooks/useExams.ts`.
- Integração e filtros: `src/pages/dashboard/ExamesPage.tsx`.

## Verificação local

```sh
TZ=America/Fortaleza npm test -- src/lib/examExportData.test.ts src/lib/examExportUtils.test.ts src/lib/examStatus.test.ts src/pages/dashboard/ExamesPage.test.tsx
npm run build
```

Os testes usam dados fictícios e verificam os cabeçalhos, o conteúdo do XLSX após reabertura, zeros à esquerda, datas, histórico, paginação e filtros nos três botões de exportação.
