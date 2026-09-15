# `admission/` — Admissão

**Fase 2** (4 semanas no plano). Maior volume de horas.

## Escopo

Workflow completo: coleta de docs → validação IA → guia de exame → envio empacotado pra contábil/SST → conclusão. Diferenciação por regime CLT/PJ/Estagiário.

## Tabelas

- `admission_journeys` — uma jornada por candidato/admissão. State machine.
- `admission_documents` — docs enviados, status (pendente/aprovado/ajuste), validação IA
- `admission_events` — timeline auditável de cada passo

## State machine

```
created → docs_pending → docs_in_review → docs_approved
                                       └→ docs_needs_adjustment → docs_pending
        → exam_scheduled → exam_done
        → contract_signed → admitted
                          → cancelled
```

## Funcionalidades v1

- Form público com link único token (sem login)
- Upload de docs no Storage com RLS
- Validação IA via Edge Function `admission-document-validate` (Claude lê doc, devolve JSON estruturado)
- Aprovação manual de G&C
- Geração de guia de exame (PDF)
- Empacotamento de docs pra contábil (zip)
- Notificações por email
- Timeline auditável

## Visualização de anexos pelo G&C

`admission_documents.file_url` armazena o caminho do objeto no bucket privado
`admission-docs`. O botão `ViewAdmissionDocumentButton`, usado nos documentos e
nos exames ocupacionais, solicita uma URL assinada com validade de cinco minutos
a cada clique e abre o arquivo em outra aba. A assinatura usa a sessão do G&C e
as políticas de acesso do Storage na API configurada no cliente Supabase.

Não use esse caminho diretamente em `href`: o navegador o interpreta como uma
rota do frontend e exibe 404. Falhas ao gerar o link fecham a aba provisória e
exibem uma mensagem com opção de tentar novamente pelo botão.

## Diferenciação por regime

| | CLT | PJ | Estagiário |
|---|---|---|---|
| Docs | RG, CPF, CTPS, comprovante, foto, exame | RG, CPF, contrato social, CNPJ | RG, CPF, comprovante matrícula, TCE |
| Exame | Sim | Não | Sim |
| Supervisor instituição | Não | Não | Sim |

## Edge Functions necessárias

- `admission-document-validate` — Claude valida cada doc submetido
- `admission-guide-generator` — gera PDF do guia de exame
- `admission-send-to-contabil` — empacota e envia
