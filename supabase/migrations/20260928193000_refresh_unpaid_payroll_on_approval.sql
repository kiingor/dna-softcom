-- Reaprovação reflete os lançamentos vigentes dos pagamentos pendentes.
-- Não calcula encargos, não altera pagamentos/transferências e não faz backfill.
-- Assinaturas públicas e permissões existentes permanecem iguais.
BEGIN;

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

  -- Mesmo lock do PIX e da reaprovação, inclusive sem projeção existente.
  PERFORM pg_advisory_xact_lock(
    hashtext('payroll_pix_transfers'), hashtext(p_entry_id::text));

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
  v_entry      uuid;
  v_protected  uuid[];
  v_protected_monthly uuid[];
  v_rebuilt    uuid[];
  v_rows       int;
BEGIN
  SELECT company_id, reference_month, status
    INTO v_company, v_ref, v_status
    FROM public.payroll_periods
   WHERE id = p_period_id AND archived_at IS NULL
   FOR NO KEY UPDATE;

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

  -- Serializa com abertura de PIX, marcação manual e atualização de chave.
  -- Inclui lançamentos novos (ainda sem snapshot) e âncoras anteriores.
  FOR v_entry IN
    SELECT e.id FROM public.payroll_entries e
     WHERE e.company_id = v_company AND e.month = v_month AND e.year = v_year
       AND e.archived_period_id IS NULL
    UNION
    SELECT l.entry_id FROM public.payroll_payable_lines l WHERE l.period_id = p_period_id
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('payroll_pix_transfers'), hashtext(v_entry::text));
    PERFORM 1 FROM public.payroll_payments WHERE entry_id = v_entry FOR UPDATE;
  END LOOP;

  -- Protege a origem de dinheiro já pago/em processamento, sem congelar as
  -- demais pessoas. Mensal e férias compartilham o mesmo pagamento; custo
  -- setor continua independente, inclusive quando o mensal já foi pago.
  SELECT coalesce(array_agg(l.entry_id), '{}'::uuid[]),
         coalesce(array_agg(l.collaborator_id) FILTER (WHERE l.kind IN ('mensal', 'ferias')), '{}'::uuid[])
    INTO v_protected, v_protected_monthly
    FROM (
      SELECT l.entry_id, l.collaborator_id, l.kind
        FROM public.payroll_payable_lines l
       WHERE l.period_id = p_period_id
         AND (EXISTS (SELECT 1 FROM public.payroll_payments p
                       WHERE p.entry_id = l.entry_id AND p.paid_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM public.payroll_pix_transfers t
                       WHERE t.entry_id = l.entry_id AND t.status::text IS DISTINCT FROM 'failed'))
      UNION
      -- Marcação manual pode anteceder o primeiro snapshot da competência.
      SELECT e.id, e.collaborator_id,
             CASE WHEN coalesce(e.external_id, '') LIKE 'ferias-%'
                       OR public.payroll_monthly_merged_rank(e.type::text) IS NOT NULL
                  THEN 'mensal' ELSE 'avulso' END
        FROM public.payroll_entries e
       WHERE e.company_id = v_company AND e.month = v_month AND e.year = v_year
         AND e.archived_period_id IS NULL
         AND (EXISTS (SELECT 1 FROM public.payroll_payments p
                       WHERE p.entry_id = e.id AND p.paid_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM public.payroll_pix_transfers t
                       WHERE t.entry_id = e.id AND t.status::text IS DISTINCT FROM 'failed'))
    ) l;

  WITH rebuilt AS (
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
       AND NOT (e.id = ANY(v_protected))
       -- Um componente já pago não pode reaparecer em outra âncora/tipo.
       AND NOT EXISTS (
         SELECT 1 FROM public.payroll_payable_lines paid
          WHERE paid.entry_id = ANY(v_protected)
            AND (paid.entry_id = e.id OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(paid.components) component
               WHERE component->>'entryId' = e.id::text)))
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
     WHERE (s.is_vac OR public.payroll_monthly_merged_rank(s.type) IS NOT NULL)
       AND NOT (s.collaborator_id = ANY(v_protected_monthly))
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
   WHERE l.gross - l.inss - l.irpf - l.other_deductions > 0
  ON CONFLICT (entry_id) DO UPDATE SET
    kind = EXCLUDED.kind,
    gross = EXCLUDED.gross,
    inss = EXCLUDED.inss,
    irpf = EXCLUDED.irpf,
    other_deductions = EXCLUDED.other_deductions,
    net_amount = EXCLUDED.net_amount,
    components = EXCLUDED.components,
    discounts = EXCLUDED.discounts,
    payee_name = EXCLUDED.payee_name,
    payee_document = EXCLUDED.payee_document,
    payee_pix_key = EXCLUDED.payee_pix_key,
    payee_pix_key_norm = EXCLUDED.payee_pix_key_norm,
    payee_pix_key_type = EXCLUDED.payee_pix_key_type,
    has_alimony_block = EXCLUDED.has_alimony_block,
    built_from_status = EXCLUDED.built_from_status,
    built_at = now()
  RETURNING entry_id
  )
  SELECT coalesce(array_agg(entry_id), '{}'::uuid[]), count(*)::int
    INTO v_rebuilt, v_rows FROM rebuilt;

  -- Remove só pagamentos pendentes que deixaram de existir/ter líquido.
  -- Tentativas failed mantêm seus próprios snapshots; FK SET NULL preserva
  -- o histórico quando a origem não é mais pagável.
  DELETE FROM public.payroll_payable_lines
   WHERE period_id = p_period_id
     AND NOT (entry_id = ANY(v_protected))
     AND NOT (entry_id = ANY(v_rebuilt));
  RETURN v_rows;
END;
$fn$;

COMMIT;

-- ROLLBACK: restaura as funções anteriores. Snapshots já aprovados permanecem.
-- BEGIN;
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
--    WHERE e.id = p_entry_id AND e.archived_period_id IS NULL;
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
--      AND p.archived_at IS NULL
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
--    WHERE id = p_period_id AND archived_at IS NULL;
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
--        AND e.archived_period_id IS NULL
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
-- 
-- COMMIT;
