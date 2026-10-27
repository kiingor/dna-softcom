# ADR 0007 — Configurações de campanha e cultura no feedback

Data: 2026-10-27. Status: aceito.

O RH precisa cadastrar campanhas e culturas e selecioná-las ao lançar feedbacks
do novo tipo Cultura. A API Agenda aceita o tipo como texto, mas não oferece
esses catálogos nem campos próprios para os vínculos no contrato de objetivos.

Os dois catálogos são administrados no DNA, separados por empresa. São listas
independentes: qualquer campanha ativa pode ser combinada com qualquer cultura
ativa da mesma empresa. Criar e editar segue as permissões do módulo
Configurações. Desativar impede novas escolhas e preserva referências existentes.

A função `feedbacks` mantém o conteúdo do feedback na Agenda e guarda apenas
seus vínculos em `feedback_classifications`, identificados por empresa,
colaborador remoto e objetivo remoto. A leitura une os nomes atuais das opções
ao retorno da Agenda. Renomear uma opção atualiza sua apresentação no histórico;
as alterações de cadastro e classificação são auditadas.

Esta extensão não modifica o esquema SQL Server legado e não duplica o cadastro
corporativo ou o comentário. Também não codifica classificações dentro do texto
do comentário. Os campos de campanha/cultura são exibidos apenas no DNA.

Antes de gravar na Agenda, a função autoriza a ação e valida os IDs da empresa.
Uma opção desativada só é aceita se já pertencia ao mesmo feedback. O navegador
não recebe permissão de escrita direta nas classificações; FKs compostas
protegem os vínculos mesmo em chamadas com service role.

Não existe transação distribuída com a Agenda nem chave de idempotência no seu
POST. Por isso, após sucesso remoto, uma falha local devolve aviso com o ID criado
e orienta reparo pela edição. Não há retry automático de criação. A atualização
local é idempotente pelo ID do feedback. A exclusão remota confirmada também não
é repetida por uma falha de limpeza local. Esse limite é coberto pelos testes da
função e deve ser revisto se a Agenda passar a oferecer esses campos ou suporte
a idempotência.
