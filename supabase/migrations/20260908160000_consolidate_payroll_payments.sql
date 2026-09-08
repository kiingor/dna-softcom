-- Consolida salário, adicionais e férias programadas; apenas custo setor fica separado.
-- Espelho de buildPaymentLines.ts. Não regenera pagamentos já aprovados:
-- PaymentsTab lê os snapshots existentes, inclusive sob a regra anterior.
BEGIN;

CREATE OR REPLACE FUNCTION public.payroll_entry_label(p_type text, p_description text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(
    p_description,
    CASE p_type
      WHEN 'salario_base'            THEN 'Salário base'
      WHEN 'salario_retroativo'      THEN 'Salário Retroativo'
      WHEN 'hora_extra'              THEN 'Hora extra'
      WHEN 'falta'                   THEN 'Falta'
      WHEN 'atestado'                THEN 'Atestado'
      WHEN 'beneficio'               THEN 'Benefício'
      WHEN 'adiantamento'            THEN 'Adiantamento'
      WHEN 'bonificacao'             THEN 'Bonificação'
      WHEN 'gratificacao'            THEN 'Gratificação'
      WHEN 'carro_agregado'          THEN 'Veículo'
      WHEN 'periculosidade'          THEN 'Periculosidade'
      WHEN 'auxilio_vale_transporte' THEN 'Auxílio Vale Transporte'
      WHEN 'desconto'                THEN 'Desconto'
      WHEN 'emprestimo'              THEN 'Empréstimo'
      WHEN 'ferias'                  THEN 'Férias'
      WHEN 'salario_familia'         THEN 'Salário-Família'
      WHEN 'custo'                   THEN 'Custo (legacy)'
      WHEN 'despesa'                 THEN 'Despesa (legacy)'
      WHEN 'inss'                    THEN 'INSS'
      WHEN 'fgts'                    THEN 'FGTS'
      WHEN 'irpf'                    THEN 'IRPF'
    END,
    p_type
  );
$$;

CREATE OR REPLACE FUNCTION public.payroll_monthly_merged_rank(p_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_type
    WHEN 'salario_base'    THEN 1
    WHEN 'salario_retroativo' THEN 2
    WHEN 'gratificacao'    THEN 3
    WHEN 'hora_extra'      THEN 4
    WHEN 'periculosidade'  THEN 5
    WHEN 'salario_familia' THEN 6
    WHEN 'carro_agregado' THEN 7
    WHEN 'beneficio' THEN 8
    WHEN 'atestado' THEN 9
    WHEN 'auxilio_vale_transporte' THEN 10
    WHEN 'ferias' THEN 11
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
   WHERE id = p_period_id;

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

COMMENT ON FUNCTION public.payroll_build_payable_lines(uuid) IS
  'Congela salário, adicionais e férias em um pagamento; custo setor separado. Preserva os valores de folhas com PIX ou pagamento manual registrado ao reaprovar.';
COMMIT;

-- ROLLBACK — restaura as funções vigentes na VPS, incluindo os hotfixes
-- de salário retroativo (20260827120000) e reaprovação com PIX (20260828120000).
-- BEGIN;
--
-- CREATE OR REPLACE FUNCTION public.payroll_entry_label(p_type text, p_description text)
--  RETURNS text
--  LANGUAGE sql
--  IMMUTABLE
--  SET search_path TO 'public'
-- AS $function$
--   SELECT coalesce(
--     p_description,
--     CASE p_type
--       WHEN 'salario_base'            THEN 'Salário base'
--       WHEN 'salario_retroativo'      THEN 'Salário Retroativo'
--       WHEN 'hora_extra'              THEN 'Hora extra'
--       WHEN 'falta'                   THEN 'Falta'
--       WHEN 'atestado'                THEN 'Atestado'
--       WHEN 'beneficio'               THEN 'Benefício'
--       WHEN 'adiantamento'            THEN 'Adiantamento'
--       WHEN 'bonificacao'             THEN 'Bonificação'
--       WHEN 'gratificacao'            THEN 'Gratificação'
--       WHEN 'carro_agregado'          THEN 'Carro Agregado'
--       WHEN 'periculosidade'          THEN 'Periculosidade'
--       WHEN 'auxilio_vale_transporte' THEN 'Auxílio Vale Transporte'
--       WHEN 'desconto'                THEN 'Desconto'
--       WHEN 'emprestimo'              THEN 'Empréstimo'
--       WHEN 'ferias'                  THEN 'Férias'
--       WHEN 'salario_familia'         THEN 'Salário-Família'
--       WHEN 'custo'                   THEN 'Custo (legacy)'
--       WHEN 'despesa'                 THEN 'Despesa (legacy)'
--       WHEN 'inss'                    THEN 'INSS'
--       WHEN 'fgts'                    THEN 'FGTS'
--       WHEN 'irpf'                    THEN 'IRPF'
--     END,
--     p_type
--   );
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.payroll_monthly_merged_rank(p_type text)
--  RETURNS integer
--  LANGUAGE sql
--  IMMUTABLE
--  SET search_path TO 'public'
-- AS $function$
--   SELECT CASE p_type
--     WHEN 'salario_base'       THEN 1
--     WHEN 'salario_retroativo' THEN 2
--     WHEN 'gratificacao'       THEN 3
--     WHEN 'hora_extra'         THEN 4
--     WHEN 'periculosidade'     THEN 5
--     WHEN 'salario_familia'    THEN 6
--   END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.payroll_build_payable_lines(p_period_id uuid)
--  RETURNS integer
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
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
--       -- Já há PIX vivo no período. Antes isto ERRAVA (RAISE) e, como o freeze
--       -- roda no trigger da transição de status, travava a PRÓPRIA aprovação:
--       -- devolver a folha pra rascunho e reaprovar ficava impossível quando já
--       -- havia pagamento. Agora só PULA a regeração: as linhas congeladas ficam
--       -- INTACTAS (nenhum valor recalculado — o dinheiro já saiu) e a folha muda
--       -- de status livremente. Regerar valor de quem já tem PIX continua vetado
--       -- por design; o que sai é o veto sobre a TRANSIÇÃO.
--       RAISE NOTICE 'Folha % já tem % PIX vivo(s): mantendo os valores congelados, sem regerar.', p_period_id, v_pending;
--       RETURN 0;
--     END IF;
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
--   -- (e) Mescla mensal: um pagamento só com salário base, gratificação, hora
--   -- extra, periculosidade e salário-família. É também o recorte correto do
--   -- líquido — o INSS/IRPF do mês incide sobre essa base, então o imposto sai
--   -- daqui em vez de sair todo do salário base.
--   merged AS (
--     SELECT s.*, public.payroll_monthly_merged_rank(s.type) AS rk
--       FROM survivors s
--      WHERE NOT s.is_vac
--        AND public.payroll_monthly_merged_rank(s.type) IS NOT NULL
--   ),
--   merged_agg AS (
--     SELECT collaborator_id,
--            sum(value) AS gross,
--            jsonb_agg(
--              jsonb_build_object(
--                'entryId',  id,
--                'type',     type,
--                -- Salário base tem rótulo fixo; os adicionais mostram a
--                -- descrição do lançamento (é onde o RH escreve o motivo).
--                'label',    CASE WHEN type = 'salario_base' THEN 'Salário Base'
--                                 ELSE public.payroll_entry_label(type, description) END,
--                'value',    value
--              )
--              ORDER BY rk, created_at DESC, id
--            ) AS components,
--            -- ÂNCORA: o salário base quando existe. É o lançamento mais estável
--            -- entre recálculos (todo mês tem um, e ele não nasce/some conforme o
--            -- RH lança hora extra), então a marcação de "pago" sobrevive à
--            -- regeração. Sem salário base, cai no primeiro da ordem da mescla.
--            (array_agg(id ORDER BY (type = 'salario_base') DESC, rk, created_at DESC, id))[1] AS anchor_id
--       FROM merged
--      GROUP BY collaborator_id
--   ),
--   monthly AS (
--     SELECT m.collaborator_id,
--            m.anchor_id,
--            'mensal'::text            AS kind,
--            m.gross,
--            coalesce(t.inss, 0)       AS inss,
--            coalesce(t.irpf, 0)       AS irpf,
--            coalesce(d.total, 0)      AS other_deductions,
--            m.components,
--            -- Só o mensal tem desconto manual (regra (d)); sem débito no mês, o
--            -- array é vazio e não NULL — a coluna é NOT NULL.
--            coalesce(d.items, '[]'::jsonb) AS discounts
--       FROM merged_agg m
--       LEFT JOIN taxes  t ON t.collaborator_id = m.collaborator_id AND t.is_vac = false
--       LEFT JOIN debits d ON d.collaborator_id = m.collaborator_id
--   ),
--
--   -- Fora da mescla (bonificação/custo de setor, carro agregado, benefício
--   -- pagável, atestado, VT, salário retroativo): cada um em sua linha, SEM
--   -- imposto e SEM desconto. A diretoria confere esses à parte, e o imposto do
--   -- mês já foi consumido pela linha mensal.
--   avulsos AS (
--     SELECT s.collaborator_id,
--            s.id            AS anchor_id,
--            'avulso'::text  AS kind,
--            s.value         AS gross,
--            0::numeric      AS inss,
--            0::numeric      AS irpf,
--            0::numeric      AS other_deductions,
--            jsonb_build_array(jsonb_build_object(
--              'entryId',  s.id,
--              'type',     s.type,
--              'label',    public.payroll_entry_label(s.type, s.description),
--              'value',    s.value
--            ))             AS components,
--            -- Avulso não sofre desconto manual (regra (e)): o débito do mês já
--            -- foi consumido pela linha mensal, descontar de novo pagaria a menos.
--            '[]'::jsonb    AS discounts
--       FROM survivors s
--      WHERE NOT s.is_vac
--        AND public.payroll_monthly_merged_rank(s.type) IS NULL
--   ),
--
--   -- Cheque de férias: férias + 1/3 + gratificação s/ férias numa linha, menos o
--   -- INSS/IRRF de férias. Âncora: o provento principal ('ferias'); se não vier,
--   -- o primeiro do grupo.
--   vacation AS (
--     SELECT s.collaborator_id,
--            (array_agg(s.id ORDER BY (s.type = 'ferias') DESC, s.created_at DESC, s.id))[1] AS anchor_id,
--            'ferias'::text AS kind,
--            sum(s.value)   AS gross,
--            jsonb_agg(
--              jsonb_build_object(
--                'entryId',  s.id,
--                'type',     s.type,
--                'label',    public.payroll_entry_label(s.type, s.description),
--                'value',    s.value
--              )
--              ORDER BY s.created_at DESC, s.id
--            ) AS components
--       FROM survivors s
--      WHERE s.is_vac
--      GROUP BY s.collaborator_id
--   ),
--   vacation_lines AS (
--     SELECT v.collaborator_id,
--            v.anchor_id,
--            v.kind,
--            v.gross,
--            coalesce(t.inss, 0)  AS inss,
--            coalesce(t.irpf, 0)  AS irpf,
--            0::numeric           AS other_deductions,
--            v.components,
--            -- Regra (d): débito manual nunca reduz o cheque de férias, logo não
--            -- há o que listar aqui.
--            '[]'::jsonb          AS discounts
--       FROM vacation v
--       LEFT JOIN taxes t ON t.collaborator_id = v.collaborator_id AND t.is_vac = true
--   ),
--
--   all_lines AS (
--     SELECT * FROM monthly
--     UNION ALL
--     SELECT * FROM avulsos
--     UNION ALL
--     SELECT * FROM vacation_lines
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
-- $function$;
--
-- COMMIT;
