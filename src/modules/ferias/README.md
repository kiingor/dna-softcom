# Férias — valor pago por solicitação

Em **Férias → Solicitações**, o RH pode usar **Registrar valor pago** ou
**Editar valor pago** em solicitações aprovadas, em gozo ou concluídas. O campo
aceita reais no formato pt-BR (por exemplo, `1.234,56`) e até duas casas decimais.
Zero é um valor explícito; ausência aparece como **Não informado**.

O total fica em `vacation_requests.paid_value` e quem registrou em `paid_by`.
São colunas existentes desde a migration `20260512100300_add_vacation_paid_value.sql`.
O registro manual não executa pagamentos, altera o cálculo da folha ou presume
uma data de pagamento em `paid_at`. Listagem e detalhes mostram o valor salvo.

O formulário exige o papel de gestão já usado na página e permissão de edição
do módulo Férias. A atualização filtra solicitação, empresa selecionada e status;
as policies RLS e a auditoria existentes continuam controlando a gravação.
Erros mantêm o formulário aberto e preservam o valor para nova tentativa.

Os testes em `schemas/vacation-payment.schema.test.ts`,
`components/VacationPaymentDialog.test.tsx` e
`src/pages/dashboard/FeriasPage.payment.test.tsx` cobrem entrada monetária,
gravação pelo serviço, erros, permissões e exibição. O Supabase é simulado nesses
testes; a validação no navegador e com banco de homologação é uma etapa separada.
