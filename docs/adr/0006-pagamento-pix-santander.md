# ADR 0006 — Pagamento PIX da folha via Santander

**Data:** 2026-08-18
**Status:** Aceito (Fase 0 concluída — transporte e contrato provados no sandbox)

## Contexto

A aba Pagamentos da folha era controle manual: mostrava a chave PIX, deixava
copiar, e um checkbox gravava `payroll_payments.paid_at`. O dinheiro saía pelo
internet banking, à mão. A decisão é fechar o ciclo dentro do sistema, com um
botão **Pagar** por colaborador protegido por 2FA.

É a operação mais irreversível do sistema. Um PIX enviado não volta.

## Transporte: mTLS é obrigatório, inclusive no sandbox

Confirmado empiricamente, não por documentação. Sem certificado cliente, os dois
ambientes devolvem **403 do Akamai** — bloqueio na borda, antes da aplicação:

| Cenário | Resultado |
|---|---|
| Credenciais certas, **sem** certificado | HTML "Access Denied" do Akamai |
| Certificado, client_id inventado | `{"error":"unauthorized_client"}` |
| Certificado + credenciais, **cert não vinculado** | `{"httpStatus":"Unauthorized hash","errorCode":403}` |
| Certificado + credenciais, **cert vinculado** | `access_token` |

A sequência acima é o roteiro de diagnóstico. Cada erro identifica uma causa
distinta, e `Unauthorized hash` significa especificamente **certificado não
associado ao ClientId no portal** — não é problema de credencial nem de rede.

**Certificado:** e-CNPJ A1 da SOFTCOM TECNOLOGIA LTDA (CNPJ 06.220.266/0001-26),
emitido pela AC SAFEWEB RFB v5, válido até **12/08/2027**. O `.pfx` usa PKCS#12
antigo — a conversão exige `openssl pkcs12 -legacy`.

A cadeia completa (`CADEIA_COMPLETA.pem`, 4 certificados: folha → AC SAFEWEB →
AC Raiz Brasileira v5 → ITI) e o certificado folha sozinho **funcionam os dois**.
A cadeia é a opção segura.

**Alerta de vencimento é obrigatório**, 30 dias antes de 12/08/2027: certificado
vencido em dia de folha é o incidente clássico.

## Ambientes

| | Host | Credenciais atuais |
|---|---|---|
| Sandbox | `trust-sandbox.api.santander.com.br` | funcionam |
| Produção | `trust-open.api.santander.com.br` | `invalid_client` |

As credenciais que temos são **exclusivas de sandbox**. Isso é uma proteção
acidental e bem-vinda: não há como pagar de verdade por engano com elas.

**Token:** OAuth `client_credentials` em `/auth/oauth/v2/token`, `Bearer`,
**expira em 900 s (15 min)**. Curto o bastante para exigir cache com renovação —
não dá para pegar um token por processo.

## Contrato, extraído do próprio sandbox

`GET|POST /management_payments_partners/v1/workspaces/{workspaceId}/pix_payments`

Headers: `Authorization: Bearer <token>` e `X-Application-Key: <client_id>`.

### Workspace

O workspace carrega a conta pagadora e as permissões. No sandbox há três
(`DIGITAL_CORBAN`, `PHYSICAL_CORBAN`, `PAYMENTS`) e **só o `PAYMENTS` tem
`pixPaymentsActive: true`** — os outros dois recusariam PIX. Campos relevantes:
`mainDebitAccount {branch, number}`, `additionalDebitAccounts[]`, `webhookURL`,
e as flags `*PaymentsActive`.

Escolher o workspace errado é um erro silencioso de configuração — por isso ele
é dado de configuração por empresa, não constante no código.

### Pagamento

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "debitAccount": { "branch": "0001", "number": "130375431" },
  "status": "READY_TO_PAY",
  "tags": [],
  "dictCodeType": "EMAIL",
  "dictCode": "nozes@gmail.com",
  "remittanceInformation": "ConsultivaTeste",
  "nominalValue": "1.10", "deductedValue": "0.00",
  "addedValue": "0.00",  "totalValue": "1.10",
  "payer":       { "documentNumber": "...", "documentType": "CNPJ", "name": "..." },
  "beneficiary": { "bankCode": "0033", "ispb": "90400888", "type": "CONTA_CORRENTE",
                   "documentNumber": "549*******4", "documentType": "CPF", "name": "..." },
  "transaction": { "value": 1.1, "code": "VX76A42608181059490682",
                   "date": "2026-08-18T13:59:49Z",
                   "endToEnd": "E9040088820230301134000011790591" }
}
```

Status observados: **`READY_TO_PAY` → `PAYED`**.

## Consequências para o desenho

O contrato **confirmou três apostas** que o plano tinha assumido sem prova:

1. **`tags` é um array de texto livre.** É onde a nossa `idempotency_key` viaja e
   volta — sem isso, um pagamento em estado `unknown` (timeout) seria
   irrecuperável, porque não haveria como achar no banco o que enviamos. Era a
   dependência mais frágil do plano.
2. **`dictCodeType` é obrigatório e tipado** (EMAIL/CPF/CNPJ/PHONE/EVP). Isso
   valida a migration que dá tipo e normalização a `collaborators.pix_key`, hoje
   texto livre — o Santander não aceita chave sem tipo declarado.
3. **`transaction.endToEnd` volta na resposta.** É o número que prova a
   liquidação e permite conciliar com o extrato, justificando o
   `CHECK (status <> 'settled' OR end_to_end_id IS NOT NULL)`.

E o fluxo de dois passos (`READY_TO_PAY` → `PAYED`) casa com os estados
`sent`/`confirmed` do modelo: **o POST não move dinheiro**, só o confirma move.
Isso torna um timeout no POST barato e um timeout na confirmação o caso caro —
que é exatamente onde o estado `unknown` e a reconciliação por consulta atuam.

## Decisão de transporte: gateway em container, não edge function

O edge-runtime da VPS roda Deno 2.1.4, mas é `deno_core` com um subconjunto de
ops — `Deno.createHttpClient` é API instável cuja flag não controlamos dentro do
container, e um bump de imagem poderia removê-la silenciosamente, no dia do
pagamento. Além disso, chave privada como variável de ambiente aparece em
`docker inspect` e no backup do `functions-secrets.env`, num runtime que roda
outras 40 funções com dependências de `esm.sh`.

O serviço `santander-gw` roda em rede docker interna dedicada, sem exposição pelo
Traefik, com o certificado em volume read-only e API estreita (nunca
pass-through). A chave privada nunca vira variável de ambiente.

## Alternativas descartadas

- **Edge function com `Deno.createHttpClient`**: instabilidade da API e chave
  privada no mesmo runtime de 40 outras funções.
- **nginx/stunnel como terminador mTLS**: zero código, mas vira proxy genérico
  para qualquer coisa que alcance a rede, e não sobra onde colocar idempotência,
  cache de token e log por linha.
- **Webhook para reconciliação**: exigiria endpoint público com assinatura
  verificável; o repo já tem essa dívida aberta com o `whatsapp-webhook`.
  Reconciliação começa por polling.

## Extensão (2026-08-19): saldo, extrato, comprovante e webhook

Mesma arquitetura de transporte (o `santander-gw` com o mTLS), estendida com três
APIs novas e um webhook.

**Saldo e extrato** (`bank_account_information/v1`, GET, mesmo host de pagamento):
- `GET /banks/{bank_id}/accounts` — lista contas (bank_id 33 = Santander)
- `GET /banks/{bank_id}/balances/{agência.conta}` — saldo
- `GET /banks/{bank_id}/statements?branchCode=&accountNumber=&initialDate=&finalDate=` — extrato

Expostos pelo gateway como `/account/accounts|balance|statement` e consumidos
pela edge `payroll-pix-account` (gate papel+módulo, sem dispositivo — leitura não
move dinheiro). UI: card no topo da aba Pagamentos, saldo oculto por padrão.

**Comprovante** (`consult_payment_receipts/v2`) — fluxo assíncrono de 3 passos
(lista por data/valor/beneficiário → POST cria arquivo → GET consulta até
`AVAILABLE` → PDF numa `location` do Azure). Orquestrado pela edge
`payroll-pix-voucher` (casa o comprovante com a transferência por valor +
beneficiário). **Só existe em `trust-open`/`trust-open-h` — sem sandbox**, então o
token OAuth passou a ser **por host** (o de um host não vale no outro) e há uma
`SANTANDER_RECEIPTS_BASE_URL` separada. Montado agora, verificado na produção.

**Webhook** (`payroll-pix-webhook`, pública) — o `webhookURL` do workspace aponta
pra ela e ela ACELERA a reconciliação. **Nunca liquida pelo corpo**: extrai o
identificador, acha a transferência em voo e dispara o `payroll-pix-reconcile`,
que só liquida com identidade provada. Assim, mesmo com autenticação de webhook
fraca, o pior que um webhook forjado consegue é uma consulta a mais — a segurança
do dinheiro não depende de confiar no chamador. O polling continua de rede de
segurança.

## Pendências

### Incidente de saldo em 29/10/2026: listagem não é pré-requisito

O gateway em produção consultava `GET /accounts` antes de ler o saldo e
escolhia a primeira conta retornada. Essa listagem passou a devolver HTTP 422
(`Erro na Consulta`), interrompendo o fluxo antes de `GET /balances`.

O diagnóstico somente de leitura confirmou que consultar diretamente o saldo
da conta pagadora configurada devolve HTTP 200, valor disponível e moeda BRL
com as mesmas credenciais. Portanto, o erro da listagem não comprova falta de
habilitação da consulta de saldo. Saldo/extrato passam a resolver a conta
configurada, sem depender da listagem nem selecionar `accounts[0]`.

O identificador usa agência de 4 dígitos, ponto e conta com dígito de 12
dígitos; entradas menores são completadas com zeros, sem truncar ou acrescentar
outro dígito. O identificador do banco é o CNPJ Santander de 14 dígitos,
conforme o [guia oficial de contas, saldo e extrato, página 31](https://developer.santander.com.br/sites/default/files/2024-02/user_guide_contas_saldo_extrato_api_v6.pdf).
Esse CNPJ já estava aplicado na produção e agora fica também versionado.
Nenhuma configuração bancária, permissão ou rota de pagamento foi alterada.

A rota de listagem continua independente. A investigação também identificou
divergências do endpoint/paginação de extrato com o guia; não fazem parte desta
correção de saldo e precisam de validação própria antes de mudar o contrato.

### Incidente de 29/10/2026: contrato do POST por chave DICT

O Santander recusou todas as 44 tentativas do dia com HTTP 400, código `10302`
(conteúdo inválido), antes de criar o pagamento. Nenhuma tinha identificador do
provedor, envio ou confirmação registrados. O gateway e o certificado estavam
saudáveis; os pagamentos anteriores haviam sido liquidados em 01/10.

Um diagnóstico sem pagamento (CPF deliberadamente inválido e valor zero,
sem PATCH de autorização) isolou a diferença: o corpo antigo recebia `10302`;
o corpo com `tags`, `dictCodeType`, `dictCode`, `remittanceInformation` e
`paymentValue` chegava à validação de chave (`40002`, campo `dictCode`).
Adicionar `debitAccount` preservava esse resultado; adicionar individualmente
`nominalValue`, `deductedValue`, `addedValue`, `totalValue` ou `payer` reproduzia
`10302`. Esses cinco campos pertencem à resposta e foram removidos do POST.

A conta de débito explícita, o valor em string, a chave de reconciliação e o
fluxo de confirmação permanecem preservados. O snapshot do pagador continua
no banco interno. A informação adicional respeita o limite de 138 caracteres
do [guia oficial, seção 4.2.3.1.1](https://developer.santander.com.br/sites/default/files/2023-10/user_guide_hub_de_pagamentos_api_v1_1_pt_10_10_23.pdf).
O diagnóstico comprova a correção da estrutura; a liquidação depende de uma
nova autorização normal do operador no sistema.

### Histórico de pendências da implantação inicial

- Vincular o certificado ao ClientId **de produção** quando for a hora (o de
  sandbox já está vinculado — foi o que destravou a Fase 0).
- Descobrir o verbo exato de confirmação (`READY_TO_PAY` → `PAYED`): a
  documentação indica `PATCH` no recurso do pagamento.
- Definir o workspace de produção e a conta pagadora por empresa.
