-- Arquivo administrativo de folhas de teste. Nenhum registro é apagado.
-- A operação de arquivar exige conexão DBA e seleção explícita dos lançamentos.
BEGIN;

ALTER TABLE public.payroll_periods
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT payroll_periods_archive_reason_check CHECK (
    (archived_at IS NULL AND archive_reason IS NULL) OR
    (archived_at IS NOT NULL AND nullif(btrim(archive_reason), '') IS NOT NULL)
  );
ALTER TABLE public.payroll_entries
  ADD COLUMN archived_period_id uuid REFERENCES public.payroll_periods(id) ON DELETE RESTRICT;
CREATE INDEX payroll_entries_archived_period_idx ON public.payroll_entries(archived_period_id)
  WHERE archived_period_id IS NOT NULL;

ALTER TABLE public.payroll_periods DROP CONSTRAINT payroll_periods_company_id_reference_month_key;
CREATE UNIQUE INDEX payroll_periods_active_month_key
  ON public.payroll_periods(company_id, reference_month) WHERE archived_at IS NULL;

COMMENT ON COLUMN public.payroll_periods.archived_at IS
  'Arquivo administrativo imutável, preservado para auditoria; fora da folha operacional.';
COMMENT ON COLUMN public.payroll_entries.archived_period_id IS
  'Vínculo explícito dos lançamentos arquivados. NULL continua na competência operacional.';

-- Restritivas: combinam com todas as policies atuais, inclusive admin e MFA.
-- Arquivo permanece disponível à conexão DBA, sem aparecer em cálculos/telas.
CREATE POLICY payroll_periods_active_only ON public.payroll_periods AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (archived_at IS NULL) WITH CHECK (archived_at IS NULL);
CREATE POLICY payroll_entries_active_only ON public.payroll_entries AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (archived_period_id IS NULL) WITH CHECK (archived_period_id IS NULL);

-- SECURITY DEFINER para enxergar arquivos ocultos por RLS em qualquer caminho
-- de escrita. Não há RPC de arquivo: o trigger exige sessão DBA para marcar.
CREATE FUNCTION public.payroll_archive_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_periods' THEN
    IF TG_OP <> 'INSERT' AND OLD.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Folha arquivada: histórico somente para consulta' USING ERRCODE = '55000';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.archived_at IS NOT NULL THEN
      IF session_user NOT IN ('postgres', 'supabase_admin') OR TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION 'Arquivamento exige operação administrativa revisada' USING ERRCODE = '42501';
      END IF;
      IF NEW.status NOT IN ('closed', 'exported') OR
         (to_jsonb(NEW) - ARRAY['archived_at', 'archive_reason', 'updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['archived_at', 'archive_reason', 'updated_at']) THEN
        RAISE EXCEPTION 'Arquivamento deve preservar os dados da folha encerrada';
      END IF;
      IF EXISTS (SELECT 1 FROM public.payroll_pix_transfers
                  WHERE period_id = NEW.id AND status::text NOT IN ('settled', 'failed')) THEN
        RAISE EXCEPTION 'Folha tem PIX pendente: resolva antes de arquivar';
      END IF;
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' AND OLD.archived_period_id IS NOT NULL THEN
      RAISE EXCEPTION 'Lançamento arquivado: histórico somente para consulta' USING ERRCODE = '55000';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.archived_period_id IS NOT NULL THEN
      IF session_user NOT IN ('postgres', 'supabase_admin') OR TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION 'Arquivamento exige operação administrativa revisada' USING ERRCODE = '42501';
      END IF;
      IF (to_jsonb(NEW) - ARRAY['archived_period_id', 'updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['archived_period_id', 'updated_at']) OR
         NOT EXISTS (SELECT 1 FROM public.payroll_periods p
                      WHERE p.id = NEW.archived_period_id AND p.archived_at IS NOT NULL
                        AND p.company_id = NEW.company_id
                        AND p.reference_month = make_date(NEW.year, NEW.month, 1)) THEN
        RAISE EXCEPTION 'Vínculo de arquivo inválido ou dados do lançamento alterados';
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_archive_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_payroll_archive_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.payroll_archive_guard();
CREATE TRIGGER trg_payroll_archive_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION public.payroll_archive_guard();

-- SECURITY DEFINER necessário para bloquear também escritas via service_role
-- e RPCs que ignoram RLS. Mantém os guards existentes de pagamentos liquidados.
CREATE FUNCTION public.payroll_archived_payment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.payroll_periods WHERE id = OLD.period_id AND archived_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.payroll_entries WHERE id = OLD.entry_id AND archived_period_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Folha arquivada: pagamentos e comprovantes são imutáveis' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.payroll_periods WHERE id = NEW.period_id AND archived_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.payroll_entries WHERE id = NEW.entry_id AND archived_period_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Folha arquivada: novos pagamentos estão bloqueados' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_archived_payment_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_payroll_archived_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_payments
  FOR EACH ROW EXECUTE FUNCTION public.payroll_archived_payment_guard();
CREATE TRIGGER trg_payroll_archived_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_payable_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_archived_payment_guard();
CREATE TRIGGER trg_payroll_archived_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_pix_transfers
  FOR EACH ROW EXECUTE FUNCTION public.payroll_archived_payment_guard();

-- SECURITY DEFINER: estas RPCs precisam consultar a folha sem depender das
-- policies do chamador. Mantêm as autorizações e ACLs existentes; os filtros
-- explícitos abaixo excluem o arquivo mesmo quando RLS é ignorada.

CREATE OR REPLACE FUNCTION public.payroll_period_is_locked(p_company_id uuid, p_reference_month date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.payroll_period_is_locked(status)
    FROM public.payroll_periods
   WHERE company_id = p_company_id AND reference_month = p_reference_month
     AND archived_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.log_payroll_recalc(
  p_company_id      uuid,
  p_reference_month date,
  p_scope           text DEFAULT 'periodo'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id uuid;
BEGIN
  -- Permissão: editar a folha (financeiro:can_edit) ou admin.
  IF NOT (
    public.is_admin_gc(auth.uid())
    OR public.has_module_permission(auth.uid(), p_company_id, 'financeiro', 'can_edit')
  ) THEN
    RAISE EXCEPTION 'Sem permissao';
  END IF;

  SELECT id INTO v_period_id
    FROM public.payroll_periods
   WHERE company_id = p_company_id AND reference_month = p_reference_month
     AND archived_at IS NULL;

  INSERT INTO public.audit_log (user_id, company_id, action, table_name, record_id, before, after)
  VALUES (
    auth.uid(), p_company_id, 'update', 'payroll_periods',
    v_period_id,  -- pode ser null se o período não existir (raro)
    NULL,
    jsonb_build_object(
      'acao', 'Recalculo de encargos',
      'escopo', p_scope,
      'competencia', to_char(p_reference_month, 'YYYY-MM')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_payment_set_manual_paid(
  p_entry_id uuid,
  p_paid     boolean,
  p_amount   numeric DEFAULT NULL
)
RETURNS public.payroll_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_entry    record;
  v_period   record;
  v_line     record;
  v_amount   numeric(12,2);
  v_existing public.payroll_payments%ROWTYPE;
  v_result   public.payroll_payments%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessão não identificada' USING ERRCODE = '28000';
  END IF;

  SELECT e.id, e.collaborator_id, e.company_id, e.month, e.year
    INTO v_entry
    FROM public.payroll_entries e
   WHERE e.id = p_entry_id AND e.archived_period_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  -- payroll_entries não tem period_id: o vínculo é (company_id, mês, ano),
  -- exatamente como o resto do módulo resolve.
  SELECT p.id, p.company_id
    INTO v_period
    FROM public.payroll_periods p
   WHERE p.company_id = v_entry.company_id
     AND p.archived_at IS NULL
     AND extract(month from p.reference_month)::int = v_entry.month
     AND extract(year  from p.reference_month)::int = v_entry.year;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esse lançamento não pertence a nenhuma folha aberta';
  END IF;

  -- Autorização: MESMO gate que a tela já usa hoje (PeriodDetailPage.tsx:127-130)
  -- — papel admin_gc/gestor_gc E permissão de editar 'folha_pagamentos'. Não é o
  -- gate do PIX (folha_pagamento_exec, mais estreito): endurecer a marcação
  -- manual aqui trancaria quem já opera a folha, sem ganho de segurança —
  -- marcar um checkbox não move dinheiro.
  IF NOT (
    public.is_admin_gc(v_actor)
    OR (
      EXISTS (SELECT 1 FROM public.user_roles ur
               WHERE ur.user_id = v_actor
                 AND ur.role::text IN ('admin_gc', 'gestor_gc'))
      AND public.has_module_permission(v_actor, v_period.company_id, 'folha_pagamentos', 'can_edit')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão pra marcar pagamento nesta folha'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
    FROM public.payroll_payments
   WHERE entry_id = p_entry_id
   FOR UPDATE;

  -- Pagamento que saiu por PIX não se desmarca por aqui. O trigger da 120200
  -- também barra, mas errar com mensagem clara é melhor do que errar com
  -- violação de trigger.
  IF FOUND AND v_existing.method = 'pix_santander' AND v_existing.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esse pagamento saiu por PIX e não pode ser desmarcado na mão'
      USING ERRCODE = '22023';
  END IF;

  -- Valor: a linha congelada manda, quando existe. O cliente só é ouvido em
  -- folha ainda não aprovada — ali não há linha, e a marcação é escrituração
  -- de algo que aconteceu no banco, não autorização de saída.
  SELECT * INTO v_line
    FROM public.payroll_payable_lines
   WHERE entry_id = p_entry_id;

  IF FOUND THEN
    v_amount := v_line.net_amount;
  ELSE
    v_amount := round(coalesce(p_amount, coalesce(v_existing.amount, 0))::numeric, 2);
  END IF;

  IF p_paid AND NOT (v_amount > 0) THEN
    RAISE EXCEPTION 'Valor do pagamento precisa ser maior que zero';
  END IF;

  INSERT INTO public.payroll_payments AS pp (
    company_id, period_id, entry_id, amount, paid_at, paid_by, method
  )
  VALUES (
    v_period.company_id,
    v_period.id,
    p_entry_id,
    v_amount,
    CASE WHEN p_paid THEN now() ELSE NULL END,
    CASE WHEN p_paid THEN v_actor ELSE NULL END,
    'manual'
  )
  ON CONFLICT (entry_id) DO UPDATE
     SET amount  = EXCLUDED.amount,
         paid_at = EXCLUDED.paid_at,
         paid_by = EXCLUDED.paid_by
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_pix_open_transfer(
  p_entry_id    uuid,
  p_actor       uuid,
  -- Terceiro parâmetro com DEFAULT pra que a chamada de dois argumentos siga
  -- válida. O default é 'sandbox' porque, na dúvida, o valor certo é o que não
  -- move dinheiro de verdade.
  p_environment text DEFAULT 'sandbox'
)
RETURNS public.payroll_pix_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line      public.payroll_payable_lines%ROWTYPE;
  v_transfer  public.payroll_pix_transfers%ROWTYPE;
  v_payment   public.payroll_payments%ROWTYPE;
  v_company   public.companies%ROWTYPE;
  v_attempt   int;
BEGIN
  -- coalesce porque NULL NOT IN (...) é NULL, e IF NULL passa reto: sem isso um
  -- ambiente nulo só estouraria lá na frente, no NOT NULL da coluna.
  IF coalesce(p_environment, '') NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Ambiente inválido: %', p_environment USING ERRCODE = '22023';
  END IF;

  -- Dois cliques no mesmo botão viram FILA, não corrida. O lock é por
  -- lançamento e cai sozinho no fim da transação; o segundo clique entra aqui
  -- só depois do primeiro ter inserido, e por isso enxerga a tentativa em voo
  -- lá embaixo em vez de criar uma segunda.
  PERFORM pg_advisory_xact_lock(
    hashtext('payroll_pix_transfers'), hashtext(p_entry_id::text));

  -- A linha pagável é o portão de aprovação: o builder só materializa linha de
  -- período aprovado pela diretoria. Ausência de linha = folha não liberada.
  SELECT * INTO v_line
    FROM public.payroll_payable_lines
   WHERE entry_id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esse lançamento não tem linha pagável — a folha ainda não foi aprovada pela diretoria'
      USING ERRCODE = '22023';
  END IF;

  -- Cinto e suspensório: a existência da linha JÁ deveria provar a aprovação
  -- (o builder recusa período não aprovado), mas dinheiro não sai com base numa
  -- inferência. Aqui a origem é consultada direto.
  PERFORM 1
     FROM public.payroll_periods p
    WHERE p.id = v_line.period_id
      AND p.archived_at IS NULL
      AND p.status IN ('aprovado_diretoria', 'closed', 'exported');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A folha desse lançamento não está aprovada pela diretoria'
      USING ERRCODE = '22023';
  END IF;

  -- Pensão alimentícia é ordem judicial: o líquido do colaborador não é o
  -- líquido da folha até alguém tratar o desconto. Pagar cheio aqui é
  -- descumprir decisão e mandar dinheiro que não volta.
  IF coalesce(v_line.has_alimony_block, false) THEN
    RAISE EXCEPTION 'Colaborador com pensão alimentícia ativa — esse pagamento sai fora do PIX automático'
      USING ERRCODE = '22023';
  END IF;

  -- Sem tipo de chave não há como montar o dictCodeType do Santander. Barrar
  -- aqui é melhor do que deixar o banco adivinhar o formato da chave.
  IF v_line.payee_pix_key_type IS NULL
     OR nullif(btrim(coalesce(v_line.payee_pix_key_norm, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Chave PIX do colaborador não está válida no cadastro — corrija antes de pagar'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (coalesce(v_line.net_amount, 0) > 0) THEN
    RAISE EXCEPTION 'Linha sem valor a pagar (líquido %)', coalesce(v_line.net_amount, 0)
      USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE: segura a projeção até o fim da transação. Sem isso, marcar
  -- "pago" na mão e clicar em "Pagar por PIX" ao mesmo tempo passaria pelos
  -- dois caminhos.
  SELECT * INTO v_payment
    FROM public.payroll_payments
   WHERE entry_id = p_entry_id
     FOR UPDATE;
  IF FOUND AND v_payment.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esse pagamento já está marcado como pago (%)', v_payment.method
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payroll_pix_transfers
     WHERE entry_id = p_entry_id AND status = 'settled'
  ) THEN
    RAISE EXCEPTION 'Esse lançamento já foi liquidado por PIX' USING ERRCODE = '22023';
  END IF;

  -- Clicar de novo é NO-OP: devolve a mesma tentativa. Inclui 'unknown' —
  -- enquanto não soubermos onde o dinheiro está, a resposta certa é "essa aqui,
  -- e alguém precisa resolvê-la", nunca "toma uma nova".
  SELECT * INTO v_transfer
    FROM public.payroll_pix_transfers
   WHERE entry_id = p_entry_id
     AND status IN ('created', 'sent', 'confirmed', 'unknown')
   ORDER BY attempt DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN v_transfer;
  END IF;

  SELECT coalesce(max(attempt), 0) + 1 INTO v_attempt
    FROM public.payroll_pix_transfers WHERE entry_id = p_entry_id;

  SELECT * INTO v_company FROM public.companies WHERE id = v_line.company_id;

  INSERT INTO public.payroll_pix_transfers (
    company_id, period_id, entry_id, collaborator_id, payable_line_id,
    attempt, idempotency_key, amount,
    payee_name, payee_document, payee_pix_key, payee_pix_key_norm, payee_pix_key_type,
    payer_snapshot, provider, environment, status, created_by
  ) VALUES (
    v_line.company_id, v_line.period_id, v_line.entry_id, v_line.collaborator_id, v_line.id,
    v_attempt,
    -- Sem hífens pra caber em campo curto de provedor sem virar truncamento.
    'sh-' || replace(p_entry_id::text, '-', '') || '-' || v_attempt::text,
    v_line.net_amount,
    v_line.payee_name, v_line.payee_document,
    v_line.payee_pix_key, v_line.payee_pix_key_norm, v_line.payee_pix_key_type,
    jsonb_build_object(
      'documentNumber', v_company.cnpj,
      'documentType',   'CNPJ',
      'name',           v_company.company_name
    ),
    'santander', p_environment, 'created', p_actor
  )
  RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_build_payable_lines(p_period_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company    uuid;
  v_ref        date;
  v_status     public.payroll_period_status;
  v_month      int;
  v_year       int;
  v_month_end  date;
  v_pending    bigint;
  v_rows       int;
BEGIN
  SELECT company_id, reference_month, status
    INTO v_company, v_ref, v_status
    FROM public.payroll_periods
   WHERE id = p_period_id AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada';
  END IF;

  -- ── O congelamento é CONSEQUÊNCIA da aprovação, nunca a causa dela ──────
  -- Sem esta trava, quem opera a folha fabrica a própria autorização de
  -- pagamento: bastava chamar esta função pelo PostgREST num período em
  -- 'open' pra materializar as linhas, e o payroll_pix_open_transfer trata a
  -- existência da linha como prova de que a diretoria aprovou. A aprovação
  -- humana viraria opcional — em cima do princípio 3 do CLAUDE.md.
  IF v_status <> 'aprovado_diretoria' THEN
    RAISE EXCEPTION
      'A folha precisa estar aprovada pela diretoria pra congelar os valores (status atual: %)',
      v_status
      USING ERRCODE = '22023';
  END IF;

  -- Autorização: mesmo conjunto que o guard de status já deixa aprovar a folha
  -- (20260727120100) — o caminho do trigger roda com o auth.uid() de quem
  -- aprovou (diretoria/admin_gc), então passa aqui sem exceção especial.
  -- auth.uid() NULL = service_role, job ou migração: sem sessão, sem checagem.
  IF auth.uid() IS NOT NULL
     AND NOT (
       public.is_admin_gc(auth.uid())
       OR EXISTS (SELECT 1 FROM public.user_roles ur
                   WHERE ur.user_id = auth.uid() AND ur.role::text = 'diretoria')
       OR public.has_module_permission(auth.uid(), v_company, 'financeiro', 'can_edit')
     ) THEN
    RAISE EXCEPTION 'Sem permissão pra congelar os valores da folha';
  END IF;

  -- payroll_entries não tem period_id: o recorte é (company_id, month, year),
  -- exatamente como o usePayrollEntries do front.
  v_month     := extract(month from v_ref)::int;
  v_year      := extract(year  from v_ref)::int;
  v_month_end := (v_ref + interval '1 month - 1 day')::date;

  -- ── Trava de regeneração ────────────────────────────────────────────────
  -- Regerar é DELETE + INSERT do período inteiro (recalcular linha a linha
  -- deixaria órfã a linha cujo lançamento sumiu). Isso é seguro enquanto
  -- ninguém pagou: depois que existe transferência PIX viva, apagar a linha
  -- apagaria a origem de dinheiro que já saiu.
  -- A tabela de transferências chega em outra migration — por isso a checagem
  -- é condicional e por SQL dinâmico (referência estática a tabela inexistente
  -- explodiria em tempo de execução mesmo dentro do IF).
  IF to_regclass('public.payroll_pix_transfers') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.payroll_pix_transfers t
       WHERE t.period_id = $1 AND t.status::text <> 'failed'
    $q$ INTO v_pending USING p_period_id;

    IF v_pending > 0 THEN
      -- Preserva o hotfix de produção 20260828120000: reaprovar pode mudar o
      -- status, mas nunca apagar ou recalcular a origem de pagamentos vivos.
      RAISE NOTICE 'Mantendo os valores congelados da folha com PIX registrado';
      RETURN 0;
    END IF;
  END IF;

  -- Marcação manual também representa pagamento já realizado.
  IF EXISTS (SELECT 1 FROM public.payroll_payments
              WHERE period_id = p_period_id AND paid_at IS NOT NULL) THEN
    RAISE NOTICE 'Mantendo os valores congelados da folha com pagamento registrado';
    RETURN 0;
  END IF;

  DELETE FROM public.payroll_payable_lines WHERE period_id = p_period_id;

  INSERT INTO public.payroll_payable_lines (
    period_id, company_id, collaborator_id, entry_id, kind,
    gross, inss, irpf, other_deductions, net_amount,
    components, discounts,
    payee_name, payee_document, payee_pix_key, payee_pix_key_norm, payee_pix_key_type,
    has_alimony_block, built_from_status
  )
  WITH entries AS (
    SELECT e.id,
           e.collaborator_id,
           e.type::text                                   AS type,
           e.value,
           e.description,
           e.is_payable,
           coalesce(e.external_id, '') LIKE 'ferias-%'     AS is_vac,
           e.created_at
      FROM public.payroll_entries e
     WHERE e.company_id = v_company
       AND e.archived_period_id IS NULL
       AND e.month      = v_month
       AND e.year       = v_year
  ),

  -- (a) EARNINGS_TYPES de ../types.ts.
  earnings AS (
    SELECT * FROM entries
     WHERE type IN (
             'salario_base', 'salario_retroativo', 'hora_extra', 'beneficio',
             'bonificacao', 'gratificacao', 'carro_agregado', 'periculosidade',
             'atestado', 'auxilio_vale_transporte', 'ferias', 'salario_familia'
           )
       AND (type <> 'beneficio' OR is_payable IS TRUE)
  ),

  -- (b) Estorno. O RH lança o valor e depois o mesmo valor negativo; o par se
  -- anula. Saldo <= 0 no grupo (colaborador, tipo) → nada daquele tipo entra.
  group_sum AS (
    SELECT collaborator_id, type, sum(value) AS total
      FROM earnings
     GROUP BY collaborator_id, type
  ),
  survivors AS (
    SELECT e.*
      FROM earnings e
      JOIN group_sum g
        ON g.collaborator_id = e.collaborator_id
       AND g.type            = e.type
     WHERE g.total > 0
       AND e.value > 0   -- num grupo que sobreviveu, a perna negativa é descartada
  ),

  -- (c) INSS/IRPF por colaborador, separando mês de férias pelo mesmo prefixo.
  taxes AS (
    SELECT collaborator_id,
           is_vac,
           coalesce(sum(value) FILTER (WHERE type = 'inss'), 0) AS inss,
           coalesce(sum(value) FILTER (WHERE type = 'irpf'), 0) AS irpf
      FROM entries
     WHERE type IN ('inss', 'irpf')
     GROUP BY collaborator_id, is_vac
  ),

  -- (d) MANUAL_DEBIT_TYPES. O `NOT is_vac` é defensivo: férias não tem débito
  -- manual, e se tiver, ele não pode reduzir o cheque de férias.
  --     Agrega o TOTAL e os RÓTULOS na mesma passada: o total é o que entra na
  --     conta do líquido, e a lista é o que a tela mostra item a item. Somar sem
  --     guardar os nomes é o que fazia o congelado dizer "− R$ 150" sem dizer
  --     de quê.
  debits AS (
    SELECT collaborator_id,
           sum(value) AS total,
           jsonb_agg(
             jsonb_build_object(
               'label', public.payroll_entry_label(type, description),
               'value', value
             )
             ORDER BY created_at DESC, id
           ) AS items
      FROM entries
     WHERE type IN ('falta', 'adiantamento', 'desconto', 'emprestimo')
       AND NOT is_vac
       AND value > 0
     GROUP BY collaborator_id
  ),

  -- Um pagamento por colaborador: proventos mensais + recibo de férias.
  -- Custo setor (bonificacao fora do recibo) é o único avulso.
  merged AS (
    SELECT s.*, public.payroll_monthly_merged_rank(s.type) AS rk
      FROM survivors s
     WHERE s.is_vac OR public.payroll_monthly_merged_rank(s.type) IS NOT NULL
  ),
  merged_agg AS (
    SELECT collaborator_id,
           bool_or(NOT is_vac) AS has_monthly,
           bool_or(is_vac) AS has_vacation,
           sum(value) AS gross,
           jsonb_agg(
             jsonb_build_object(
               'entryId', id,
               'type', type,
               'label', CASE WHEN type = 'salario_base' THEN 'Salário Base'
                             ELSE public.payroll_entry_label(type, description) END,
               'value', value
             )
             ORDER BY is_vac, CASE WHEN NOT is_vac THEN rk END, created_at DESC, id
           ) AS components,
           (array_agg(id ORDER BY is_vac,
             CASE WHEN NOT is_vac THEN rk ELSE CASE WHEN type = 'ferias' THEN 0 ELSE 1 END END,
             created_at DESC, id))[1] AS anchor_id
      FROM merged
     GROUP BY collaborator_id
  ),
  monthly AS (
    SELECT m.collaborator_id,
           m.anchor_id,
           CASE WHEN m.has_monthly THEN 'mensal' ELSE 'ferias' END AS kind,
           m.gross,
           coalesce(mt.inss, 0) + coalesce(vt.inss, 0) AS inss,
           coalesce(mt.irpf, 0) + coalesce(vt.irpf, 0) AS irpf,
           coalesce(d.total, 0) AS other_deductions,
           m.components,
           coalesce(d.items, '[]'::jsonb) AS discounts
      FROM merged_agg m
      LEFT JOIN taxes mt ON mt.collaborator_id = m.collaborator_id AND NOT mt.is_vac AND m.has_monthly
      LEFT JOIN taxes vt ON vt.collaborator_id = m.collaborator_id AND vt.is_vac AND m.has_vacation
      LEFT JOIN debits d ON d.collaborator_id = m.collaborator_id AND m.has_monthly
  ),
  avulsos AS (
    SELECT s.collaborator_id,
           s.id AS anchor_id,
           'avulso'::text AS kind,
           s.value AS gross,
           0::numeric AS inss,
           0::numeric AS irpf,
           0::numeric AS other_deductions,
           jsonb_build_array(jsonb_build_object(
             'entryId', s.id,
             'type', s.type,
             'label', public.payroll_entry_label(s.type, s.description),
             'value', s.value
           )) AS components,
           '[]'::jsonb AS discounts
      FROM survivors s
     WHERE NOT s.is_vac AND public.payroll_monthly_merged_rank(s.type) IS NULL
  ),
  all_lines AS (
    SELECT * FROM monthly
    UNION ALL
    SELECT * FROM avulsos
  ),

  -- Pensão alimentícia vigente no mês de referência (vigência que cobre
  -- qualquer dia do mês).
  alimony AS (
    SELECT DISTINCT collaborator_id
      FROM public.collaborator_alimony_orders
     WHERE company_id = v_company
       AND status = 'active'
       AND effective_from <= v_month_end
       AND (effective_to IS NULL OR effective_to >= v_ref)
  )

  SELECT p_period_id,
         v_company,
         l.collaborator_id,
         l.anchor_id,
         l.kind,
         l.gross,
         l.inss,
         l.irpf,
         l.other_deductions,
         l.gross - l.inss - l.irpf - l.other_deductions,
         l.components,
         l.discounts,
         -- Snapshot do favorecido no instante da aprovação. As colunas geradas
         -- pix_key_type/pix_key_normalized vêm da migration 20260818120000 —
         -- aqui elas viram payee_pix_key_type/payee_pix_key_norm.
         c.name,
         c.cpf,
         c.pix_key,
         c.pix_key_normalized,
         c.pix_key_type,
         (a.collaborator_id IS NOT NULL),
         v_status
    FROM all_lines l
    JOIN public.collaborators c ON c.id = l.collaborator_id
    LEFT JOIN alimony a ON a.collaborator_id = l.collaborator_id
   -- CLAMP. Líquido zero ou negativo NÃO vira pagamento: não existe PIX de zero,
   -- e um valor negativo viraria cobrança. Quem cai aqui (adiantamento que comeu
   -- o mês inteiro, por exemplo) continua aparecendo na tela de aprovação — some
   -- só da lista de quem recebe, de propósito, pra o acerto ser feito na mão.
   WHERE l.gross - l.inss - l.irpf - l.other_deductions > 0;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$fn$;

COMMIT;

-- ROLLBACK
-- Recusa rollback enquanto houver arquivo: não apaga nem reativa histórico.
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.payroll_periods WHERE archived_at IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.payroll_entries WHERE archived_period_id IS NOT NULL) THEN
--     RAISE EXCEPTION 'Rollback exige revisão do arquivo e da folha substituta; nenhum histórico foi alterado';
--   END IF;
-- END $$;
-- DROP TRIGGER trg_payroll_archived_payment_guard ON public.payroll_pix_transfers;
-- DROP TRIGGER trg_payroll_archived_payment_guard ON public.payroll_payable_lines;
-- DROP TRIGGER trg_payroll_archived_payment_guard ON public.payroll_payments;
-- DROP FUNCTION public.payroll_archived_payment_guard();
-- DROP TRIGGER trg_payroll_archive_guard ON public.payroll_entries;
-- DROP TRIGGER trg_payroll_archive_guard ON public.payroll_periods;
-- DROP FUNCTION public.payroll_archive_guard();
-- DROP POLICY payroll_entries_active_only ON public.payroll_entries;
-- DROP POLICY payroll_periods_active_only ON public.payroll_periods;
-- ALTER TABLE public.payroll_entries DROP COLUMN archived_period_id;
-- ALTER TABLE public.payroll_periods DROP CONSTRAINT payroll_periods_archive_reason_check;
-- DROP INDEX public.payroll_periods_active_month_key;
-- ALTER TABLE public.payroll_periods DROP COLUMN archived_at, DROP COLUMN archive_reason;
-- ALTER TABLE public.payroll_periods ADD CONSTRAINT payroll_periods_company_id_reference_month_key UNIQUE(company_id, reference_month);
--
--
-- CREATE OR REPLACE FUNCTION public.payroll_period_is_locked(p_company_id uuid, p_reference_month date)
-- RETURNS boolean
-- LANGUAGE sql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
--   SELECT public.payroll_period_is_locked(status)
--     FROM public.payroll_periods
--    WHERE company_id = p_company_id AND reference_month = p_reference_month;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.log_payroll_recalc(
--   p_company_id      uuid,
--   p_reference_month date,
--   p_scope           text DEFAULT 'periodo'
-- )
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_period_id uuid;
-- BEGIN
--   -- Permissão: editar a folha (financeiro:can_edit) ou admin.
--   IF NOT (
--     public.is_admin_gc(auth.uid())
--     OR public.has_module_permission(auth.uid(), p_company_id, 'financeiro', 'can_edit')
--   ) THEN
--     RAISE EXCEPTION 'Sem permissao';
--   END IF;
--
--   SELECT id INTO v_period_id
--     FROM public.payroll_periods
--    WHERE company_id = p_company_id AND reference_month = p_reference_month;
--
--   INSERT INTO public.audit_log (user_id, company_id, action, table_name, record_id, before, after)
--   VALUES (
--     auth.uid(), p_company_id, 'update', 'payroll_periods',
--     v_period_id,  -- pode ser null se o período não existir (raro)
--     NULL,
--     jsonb_build_object(
--       'acao', 'Recalculo de encargos',
--       'escopo', p_scope,
--       'competencia', to_char(p_reference_month, 'YYYY-MM')
--     )
--   );
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.payroll_payment_set_manual_paid(
--   p_entry_id uuid,
--   p_paid     boolean,
--   p_amount   numeric DEFAULT NULL
-- )
-- RETURNS public.payroll_payments
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_actor    uuid := auth.uid();
--   v_entry    record;
--   v_period   record;
--   v_line     record;
--   v_amount   numeric(12,2);
--   v_existing public.payroll_payments%ROWTYPE;
--   v_result   public.payroll_payments%ROWTYPE;
-- BEGIN
--   IF v_actor IS NULL THEN
--     RAISE EXCEPTION 'Sessão não identificada' USING ERRCODE = '28000';
--   END IF;
--
--   SELECT e.id, e.collaborator_id, e.company_id, e.month, e.year
--     INTO v_entry
--     FROM public.payroll_entries e
--    WHERE e.id = p_entry_id;
--
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Lançamento não encontrado';
--   END IF;
--
--   -- payroll_entries não tem period_id: o vínculo é (company_id, mês, ano),
--   -- exatamente como o resto do módulo resolve.
--   SELECT p.id, p.company_id
--     INTO v_period
--     FROM public.payroll_periods p
--    WHERE p.company_id = v_entry.company_id
--      AND extract(month from p.reference_month)::int = v_entry.month
--      AND extract(year  from p.reference_month)::int = v_entry.year;
--
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Esse lançamento não pertence a nenhuma folha aberta';
--   END IF;
--
--   -- Autorização: MESMO gate que a tela já usa hoje (PeriodDetailPage.tsx:127-130)
--   -- — papel admin_gc/gestor_gc E permissão de editar 'folha_pagamentos'. Não é o
--   -- gate do PIX (folha_pagamento_exec, mais estreito): endurecer a marcação
--   -- manual aqui trancaria quem já opera a folha, sem ganho de segurança —
--   -- marcar um checkbox não move dinheiro.
--   IF NOT (
--     public.is_admin_gc(v_actor)
--     OR (
--       EXISTS (SELECT 1 FROM public.user_roles ur
--                WHERE ur.user_id = v_actor
--                  AND ur.role::text IN ('admin_gc', 'gestor_gc'))
--       AND public.has_module_permission(v_actor, v_period.company_id, 'folha_pagamentos', 'can_edit')
--     )
--   ) THEN
--     RAISE EXCEPTION 'Sem permissão pra marcar pagamento nesta folha'
--       USING ERRCODE = '42501';
--   END IF;
--
--   SELECT * INTO v_existing
--     FROM public.payroll_payments
--    WHERE entry_id = p_entry_id
--    FOR UPDATE;
--
--   -- Pagamento que saiu por PIX não se desmarca por aqui. O trigger da 120200
--   -- também barra, mas errar com mensagem clara é melhor do que errar com
--   -- violação de trigger.
--   IF FOUND AND v_existing.method = 'pix_santander' AND v_existing.paid_at IS NOT NULL THEN
--     RAISE EXCEPTION 'Esse pagamento saiu por PIX e não pode ser desmarcado na mão'
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- Valor: a linha congelada manda, quando existe. O cliente só é ouvido em
--   -- folha ainda não aprovada — ali não há linha, e a marcação é escrituração
--   -- de algo que aconteceu no banco, não autorização de saída.
--   SELECT * INTO v_line
--     FROM public.payroll_payable_lines
--    WHERE entry_id = p_entry_id;
--
--   IF FOUND THEN
--     v_amount := v_line.net_amount;
--   ELSE
--     v_amount := round(coalesce(p_amount, coalesce(v_existing.amount, 0))::numeric, 2);
--   END IF;
--
--   IF p_paid AND NOT (v_amount > 0) THEN
--     RAISE EXCEPTION 'Valor do pagamento precisa ser maior que zero';
--   END IF;
--
--   INSERT INTO public.payroll_payments AS pp (
--     company_id, period_id, entry_id, amount, paid_at, paid_by, method
--   )
--   VALUES (
--     v_period.company_id,
--     v_period.id,
--     p_entry_id,
--     v_amount,
--     CASE WHEN p_paid THEN now() ELSE NULL END,
--     CASE WHEN p_paid THEN v_actor ELSE NULL END,
--     'manual'
--   )
--   ON CONFLICT (entry_id) DO UPDATE
--      SET amount  = EXCLUDED.amount,
--          paid_at = EXCLUDED.paid_at,
--          paid_by = EXCLUDED.paid_by
--   RETURNING * INTO v_result;
--
--   RETURN v_result;
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.payroll_pix_open_transfer(
--   p_entry_id    uuid,
--   p_actor       uuid,
--   -- Terceiro parâmetro com DEFAULT pra que a chamada de dois argumentos siga
--   -- válida. O default é 'sandbox' porque, na dúvida, o valor certo é o que não
--   -- move dinheiro de verdade.
--   p_environment text DEFAULT 'sandbox'
-- )
-- RETURNS public.payroll_pix_transfers
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_line      public.payroll_payable_lines%ROWTYPE;
--   v_transfer  public.payroll_pix_transfers%ROWTYPE;
--   v_payment   public.payroll_payments%ROWTYPE;
--   v_company   public.companies%ROWTYPE;
--   v_attempt   int;
-- BEGIN
--   -- coalesce porque NULL NOT IN (...) é NULL, e IF NULL passa reto: sem isso um
--   -- ambiente nulo só estouraria lá na frente, no NOT NULL da coluna.
--   IF coalesce(p_environment, '') NOT IN ('sandbox', 'production') THEN
--     RAISE EXCEPTION 'Ambiente inválido: %', p_environment USING ERRCODE = '22023';
--   END IF;
--
--   -- Dois cliques no mesmo botão viram FILA, não corrida. O lock é por
--   -- lançamento e cai sozinho no fim da transação; o segundo clique entra aqui
--   -- só depois do primeiro ter inserido, e por isso enxerga a tentativa em voo
--   -- lá embaixo em vez de criar uma segunda.
--   PERFORM pg_advisory_xact_lock(
--     hashtext('payroll_pix_transfers'), hashtext(p_entry_id::text));
--
--   -- A linha pagável é o portão de aprovação: o builder só materializa linha de
--   -- período aprovado pela diretoria. Ausência de linha = folha não liberada.
--   SELECT * INTO v_line
--     FROM public.payroll_payable_lines
--    WHERE entry_id = p_entry_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Esse lançamento não tem linha pagável — a folha ainda não foi aprovada pela diretoria'
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- Cinto e suspensório: a existência da linha JÁ deveria provar a aprovação
--   -- (o builder recusa período não aprovado), mas dinheiro não sai com base numa
--   -- inferência. Aqui a origem é consultada direto.
--   PERFORM 1
--      FROM public.payroll_periods p
--     WHERE p.id = v_line.period_id
--       AND p.status IN ('aprovado_diretoria', 'closed', 'exported');
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'A folha desse lançamento não está aprovada pela diretoria'
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- Pensão alimentícia é ordem judicial: o líquido do colaborador não é o
--   -- líquido da folha até alguém tratar o desconto. Pagar cheio aqui é
--   -- descumprir decisão e mandar dinheiro que não volta.
--   IF coalesce(v_line.has_alimony_block, false) THEN
--     RAISE EXCEPTION 'Colaborador com pensão alimentícia ativa — esse pagamento sai fora do PIX automático'
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- Sem tipo de chave não há como montar o dictCodeType do Santander. Barrar
--   -- aqui é melhor do que deixar o banco adivinhar o formato da chave.
--   IF v_line.payee_pix_key_type IS NULL
--      OR nullif(btrim(coalesce(v_line.payee_pix_key_norm, '')), '') IS NULL THEN
--     RAISE EXCEPTION 'Chave PIX do colaborador não está válida no cadastro — corrija antes de pagar'
--       USING ERRCODE = '22023';
--   END IF;
--
--   IF NOT (coalesce(v_line.net_amount, 0) > 0) THEN
--     RAISE EXCEPTION 'Linha sem valor a pagar (líquido %)', coalesce(v_line.net_amount, 0)
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- FOR UPDATE: segura a projeção até o fim da transação. Sem isso, marcar
--   -- "pago" na mão e clicar em "Pagar por PIX" ao mesmo tempo passaria pelos
--   -- dois caminhos.
--   SELECT * INTO v_payment
--     FROM public.payroll_payments
--    WHERE entry_id = p_entry_id
--      FOR UPDATE;
--   IF FOUND AND v_payment.paid_at IS NOT NULL THEN
--     RAISE EXCEPTION 'Esse pagamento já está marcado como pago (%)', v_payment.method
--       USING ERRCODE = '22023';
--   END IF;
--
--   IF EXISTS (
--     SELECT 1 FROM public.payroll_pix_transfers
--      WHERE entry_id = p_entry_id AND status = 'settled'
--   ) THEN
--     RAISE EXCEPTION 'Esse lançamento já foi liquidado por PIX' USING ERRCODE = '22023';
--   END IF;
--
--   -- Clicar de novo é NO-OP: devolve a mesma tentativa. Inclui 'unknown' —
--   -- enquanto não soubermos onde o dinheiro está, a resposta certa é "essa aqui,
--   -- e alguém precisa resolvê-la", nunca "toma uma nova".
--   SELECT * INTO v_transfer
--     FROM public.payroll_pix_transfers
--    WHERE entry_id = p_entry_id
--      AND status IN ('created', 'sent', 'confirmed', 'unknown')
--    ORDER BY attempt DESC
--    LIMIT 1;
--   IF FOUND THEN
--     RETURN v_transfer;
--   END IF;
--
--   SELECT coalesce(max(attempt), 0) + 1 INTO v_attempt
--     FROM public.payroll_pix_transfers WHERE entry_id = p_entry_id;
--
--   SELECT * INTO v_company FROM public.companies WHERE id = v_line.company_id;
--
--   INSERT INTO public.payroll_pix_transfers (
--     company_id, period_id, entry_id, collaborator_id, payable_line_id,
--     attempt, idempotency_key, amount,
--     payee_name, payee_document, payee_pix_key, payee_pix_key_norm, payee_pix_key_type,
--     payer_snapshot, provider, environment, status, created_by
--   ) VALUES (
--     v_line.company_id, v_line.period_id, v_line.entry_id, v_line.collaborator_id, v_line.id,
--     v_attempt,
--     -- Sem hífens pra caber em campo curto de provedor sem virar truncamento.
--     'sh-' || replace(p_entry_id::text, '-', '') || '-' || v_attempt::text,
--     v_line.net_amount,
--     v_line.payee_name, v_line.payee_document,
--     v_line.payee_pix_key, v_line.payee_pix_key_norm, v_line.payee_pix_key_type,
--     jsonb_build_object(
--       'documentNumber', v_company.cnpj,
--       'documentType',   'CNPJ',
--       'name',           v_company.company_name
--     ),
--     'santander', p_environment, 'created', p_actor
--   )
--   RETURNING * INTO v_transfer;
--
--   RETURN v_transfer;
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.payroll_build_payable_lines(p_period_id uuid)
-- RETURNS integer
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $fn$
-- DECLARE
--   v_company    uuid;
--   v_ref        date;
--   v_status     public.payroll_period_status;
--   v_month      int;
--   v_year       int;
--   v_month_end  date;
--   v_pending    bigint;
--   v_rows       int;
-- BEGIN
--   SELECT company_id, reference_month, status
--     INTO v_company, v_ref, v_status
--     FROM public.payroll_periods
--    WHERE id = p_period_id;
--
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Folha não encontrada';
--   END IF;
--
--   -- ── O congelamento é CONSEQUÊNCIA da aprovação, nunca a causa dela ──────
--   -- Sem esta trava, quem opera a folha fabrica a própria autorização de
--   -- pagamento: bastava chamar esta função pelo PostgREST num período em
--   -- 'open' pra materializar as linhas, e o payroll_pix_open_transfer trata a
--   -- existência da linha como prova de que a diretoria aprovou. A aprovação
--   -- humana viraria opcional — em cima do princípio 3 do CLAUDE.md.
--   IF v_status <> 'aprovado_diretoria' THEN
--     RAISE EXCEPTION
--       'A folha precisa estar aprovada pela diretoria pra congelar os valores (status atual: %)',
--       v_status
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- Autorização: mesmo conjunto que o guard de status já deixa aprovar a folha
--   -- (20260727120100) — o caminho do trigger roda com o auth.uid() de quem
--   -- aprovou (diretoria/admin_gc), então passa aqui sem exceção especial.
--   -- auth.uid() NULL = service_role, job ou migração: sem sessão, sem checagem.
--   IF auth.uid() IS NOT NULL
--      AND NOT (
--        public.is_admin_gc(auth.uid())
--        OR EXISTS (SELECT 1 FROM public.user_roles ur
--                    WHERE ur.user_id = auth.uid() AND ur.role::text = 'diretoria')
--        OR public.has_module_permission(auth.uid(), v_company, 'financeiro', 'can_edit')
--      ) THEN
--     RAISE EXCEPTION 'Sem permissão pra congelar os valores da folha';
--   END IF;
--
--   -- payroll_entries não tem period_id: o recorte é (company_id, month, year),
--   -- exatamente como o usePayrollEntries do front.
--   v_month     := extract(month from v_ref)::int;
--   v_year      := extract(year  from v_ref)::int;
--   v_month_end := (v_ref + interval '1 month - 1 day')::date;
--
--   -- ── Trava de regeneração ────────────────────────────────────────────────
--   -- Regerar é DELETE + INSERT do período inteiro (recalcular linha a linha
--   -- deixaria órfã a linha cujo lançamento sumiu). Isso é seguro enquanto
--   -- ninguém pagou: depois que existe transferência PIX viva, apagar a linha
--   -- apagaria a origem de dinheiro que já saiu.
--   -- A tabela de transferências chega em outra migration — por isso a checagem
--   -- é condicional e por SQL dinâmico (referência estática a tabela inexistente
--   -- explodiria em tempo de execução mesmo dentro do IF).
--   IF to_regclass('public.payroll_pix_transfers') IS NOT NULL THEN
--     EXECUTE $q$
--       SELECT count(*) FROM public.payroll_pix_transfers t
--        WHERE t.period_id = $1 AND t.status::text <> 'failed'
--     $q$ INTO v_pending USING p_period_id;
--
--     IF v_pending > 0 THEN
--       -- Preserva o hotfix de produção 20260828120000: reaprovar pode mudar o
--       -- status, mas nunca apagar ou recalcular a origem de pagamentos vivos.
--       RAISE NOTICE 'Mantendo os valores congelados da folha com PIX registrado';
--       RETURN 0;
--     END IF;
--   END IF;
--
--   -- Marcação manual também representa pagamento já realizado.
--   IF EXISTS (SELECT 1 FROM public.payroll_payments
--               WHERE period_id = p_period_id AND paid_at IS NOT NULL) THEN
--     RAISE NOTICE 'Mantendo os valores congelados da folha com pagamento registrado';
--     RETURN 0;
--   END IF;
--
--   DELETE FROM public.payroll_payable_lines WHERE period_id = p_period_id;
--
--   INSERT INTO public.payroll_payable_lines (
--     period_id, company_id, collaborator_id, entry_id, kind,
--     gross, inss, irpf, other_deductions, net_amount,
--     components, discounts,
--     payee_name, payee_document, payee_pix_key, payee_pix_key_norm, payee_pix_key_type,
--     has_alimony_block, built_from_status
--   )
--   WITH entries AS (
--     SELECT e.id,
--            e.collaborator_id,
--            e.type::text                                   AS type,
--            e.value,
--            e.description,
--            e.is_payable,
--            coalesce(e.external_id, '') LIKE 'ferias-%'     AS is_vac,
--            e.created_at
--       FROM public.payroll_entries e
--      WHERE e.company_id = v_company
--        AND e.month      = v_month
--        AND e.year       = v_year
--   ),
--
--   -- (a) EARNINGS_TYPES de ../types.ts.
--   earnings AS (
--     SELECT * FROM entries
--      WHERE type IN (
--              'salario_base', 'salario_retroativo', 'hora_extra', 'beneficio',
--              'bonificacao', 'gratificacao', 'carro_agregado', 'periculosidade',
--              'atestado', 'auxilio_vale_transporte', 'ferias', 'salario_familia'
--            )
--        AND (type <> 'beneficio' OR is_payable IS TRUE)
--   ),
--
--   -- (b) Estorno. O RH lança o valor e depois o mesmo valor negativo; o par se
--   -- anula. Saldo <= 0 no grupo (colaborador, tipo) → nada daquele tipo entra.
--   group_sum AS (
--     SELECT collaborator_id, type, sum(value) AS total
--       FROM earnings
--      GROUP BY collaborator_id, type
--   ),
--   survivors AS (
--     SELECT e.*
--       FROM earnings e
--       JOIN group_sum g
--         ON g.collaborator_id = e.collaborator_id
--        AND g.type            = e.type
--      WHERE g.total > 0
--        AND e.value > 0   -- num grupo que sobreviveu, a perna negativa é descartada
--   ),
--
--   -- (c) INSS/IRPF por colaborador, separando mês de férias pelo mesmo prefixo.
--   taxes AS (
--     SELECT collaborator_id,
--            is_vac,
--            coalesce(sum(value) FILTER (WHERE type = 'inss'), 0) AS inss,
--            coalesce(sum(value) FILTER (WHERE type = 'irpf'), 0) AS irpf
--       FROM entries
--      WHERE type IN ('inss', 'irpf')
--      GROUP BY collaborator_id, is_vac
--   ),
--
--   -- (d) MANUAL_DEBIT_TYPES. O `NOT is_vac` é defensivo: férias não tem débito
--   -- manual, e se tiver, ele não pode reduzir o cheque de férias.
--   --     Agrega o TOTAL e os RÓTULOS na mesma passada: o total é o que entra na
--   --     conta do líquido, e a lista é o que a tela mostra item a item. Somar sem
--   --     guardar os nomes é o que fazia o congelado dizer "− R$ 150" sem dizer
--   --     de quê.
--   debits AS (
--     SELECT collaborator_id,
--            sum(value) AS total,
--            jsonb_agg(
--              jsonb_build_object(
--                'label', public.payroll_entry_label(type, description),
--                'value', value
--              )
--              ORDER BY created_at DESC, id
--            ) AS items
--       FROM entries
--      WHERE type IN ('falta', 'adiantamento', 'desconto', 'emprestimo')
--        AND NOT is_vac
--        AND value > 0
--      GROUP BY collaborator_id
--   ),
--
--   -- Um pagamento por colaborador: proventos mensais + recibo de férias.
--   -- Custo setor (bonificacao fora do recibo) é o único avulso.
--   merged AS (
--     SELECT s.*, public.payroll_monthly_merged_rank(s.type) AS rk
--       FROM survivors s
--      WHERE s.is_vac OR public.payroll_monthly_merged_rank(s.type) IS NOT NULL
--   ),
--   merged_agg AS (
--     SELECT collaborator_id,
--            bool_or(NOT is_vac) AS has_monthly,
--            bool_or(is_vac) AS has_vacation,
--            sum(value) AS gross,
--            jsonb_agg(
--              jsonb_build_object(
--                'entryId', id,
--                'type', type,
--                'label', CASE WHEN type = 'salario_base' THEN 'Salário Base'
--                              ELSE public.payroll_entry_label(type, description) END,
--                'value', value
--              )
--              ORDER BY is_vac, CASE WHEN NOT is_vac THEN rk END, created_at DESC, id
--            ) AS components,
--            (array_agg(id ORDER BY is_vac,
--              CASE WHEN NOT is_vac THEN rk ELSE CASE WHEN type = 'ferias' THEN 0 ELSE 1 END END,
--              created_at DESC, id))[1] AS anchor_id
--       FROM merged
--      GROUP BY collaborator_id
--   ),
--   monthly AS (
--     SELECT m.collaborator_id,
--            m.anchor_id,
--            CASE WHEN m.has_monthly THEN 'mensal' ELSE 'ferias' END AS kind,
--            m.gross,
--            coalesce(mt.inss, 0) + coalesce(vt.inss, 0) AS inss,
--            coalesce(mt.irpf, 0) + coalesce(vt.irpf, 0) AS irpf,
--            coalesce(d.total, 0) AS other_deductions,
--            m.components,
--            coalesce(d.items, '[]'::jsonb) AS discounts
--       FROM merged_agg m
--       LEFT JOIN taxes mt ON mt.collaborator_id = m.collaborator_id AND NOT mt.is_vac AND m.has_monthly
--       LEFT JOIN taxes vt ON vt.collaborator_id = m.collaborator_id AND vt.is_vac AND m.has_vacation
--       LEFT JOIN debits d ON d.collaborator_id = m.collaborator_id AND m.has_monthly
--   ),
--   avulsos AS (
--     SELECT s.collaborator_id,
--            s.id AS anchor_id,
--            'avulso'::text AS kind,
--            s.value AS gross,
--            0::numeric AS inss,
--            0::numeric AS irpf,
--            0::numeric AS other_deductions,
--            jsonb_build_array(jsonb_build_object(
--              'entryId', s.id,
--              'type', s.type,
--              'label', public.payroll_entry_label(s.type, s.description),
--              'value', s.value
--            )) AS components,
--            '[]'::jsonb AS discounts
--       FROM survivors s
--      WHERE NOT s.is_vac AND public.payroll_monthly_merged_rank(s.type) IS NULL
--   ),
--   all_lines AS (
--     SELECT * FROM monthly
--     UNION ALL
--     SELECT * FROM avulsos
--   ),
--
--   -- Pensão alimentícia vigente no mês de referência (vigência que cobre
--   -- qualquer dia do mês).
--   alimony AS (
--     SELECT DISTINCT collaborator_id
--       FROM public.collaborator_alimony_orders
--      WHERE company_id = v_company
--        AND status = 'active'
--        AND effective_from <= v_month_end
--        AND (effective_to IS NULL OR effective_to >= v_ref)
--   )
--
--   SELECT p_period_id,
--          v_company,
--          l.collaborator_id,
--          l.anchor_id,
--          l.kind,
--          l.gross,
--          l.inss,
--          l.irpf,
--          l.other_deductions,
--          l.gross - l.inss - l.irpf - l.other_deductions,
--          l.components,
--          l.discounts,
--          -- Snapshot do favorecido no instante da aprovação. As colunas geradas
--          -- pix_key_type/pix_key_normalized vêm da migration 20260818120000 —
--          -- aqui elas viram payee_pix_key_type/payee_pix_key_norm.
--          c.name,
--          c.cpf,
--          c.pix_key,
--          c.pix_key_normalized,
--          c.pix_key_type,
--          (a.collaborator_id IS NOT NULL),
--          v_status
--     FROM all_lines l
--     JOIN public.collaborators c ON c.id = l.collaborator_id
--     LEFT JOIN alimony a ON a.collaborator_id = l.collaborator_id
--    -- CLAMP. Líquido zero ou negativo NÃO vira pagamento: não existe PIX de zero,
--    -- e um valor negativo viraria cobrança. Quem cai aqui (adiantamento que comeu
--    -- o mês inteiro, por exemplo) continua aparecendo na tela de aprovação — some
--    -- só da lista de quem recebe, de propósito, pra o acerto ser feito na mão.
--    WHERE l.gross - l.inss - l.irpf - l.other_deductions > 0;
--
--   GET DIAGNOSTICS v_rows = ROW_COUNT;
--   RETURN v_rows;
-- END;
-- $fn$;
-- COMMIT;
