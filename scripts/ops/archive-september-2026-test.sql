-- Operação pontual autorizada: arquivar o teste e liberar setembro/2026.
-- Requer backup privado dos registros afetados e a migration 20260917120000.
-- Executar com psql -X -v ON_ERROR_STOP=1; nenhuma chamada ao provedor PIX.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.payroll_periods, public.payroll_entries, public.payroll_payments,
  public.payroll_payable_lines, public.payroll_pix_transfers, public.payment_2fa_challenges
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_period constant uuid := '189f439f-044c-4614-b1d2-90a4301047d5';
  v_company constant uuid := 'a68d59ed-e511-4bac-bda2-2c8aff718d71';
  v_entries uuid[];
  v_hash_before text;
  v_hash_after text;
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payroll_periods WHERE id=v_period AND company_id=v_company
      AND reference_month='2026-09-01' AND status='closed' AND archived_at IS NULL
      AND notes='FOLHA TESTE PIX — R$1 por colaborador. Apagar após o teste.'
      AND created_at='2026-08-20T15:12:26.844849+00'
  ) THEN RAISE EXCEPTION 'A folha não corresponde ao teste revisado'; END IF;

  SELECT array_agg(id ORDER BY id) INTO v_entries FROM public.payroll_entries
    WHERE company_id=v_company AND month=9 AND year=2026 AND value=1
      AND description ILIKE '%teste%' AND type::text='salario_retroativo'
      AND NOT is_fixed AND is_payable AND external_id IS NOT NULL
      AND created_at='2026-08-20T15:12:26.844849+00' AND archived_period_id IS NULL;
  IF cardinality(v_entries) IS DISTINCT FROM 277 OR
     (SELECT count(*) FROM public.payroll_entries WHERE company_id=v_company AND month=9 AND year=2026) <> 281 OR
     (SELECT sum(value) FROM public.payroll_entries WHERE company_id=v_company AND month=9 AND year=2026 AND NOT(id=ANY(v_entries))) <> 493.81 OR
     (SELECT count(*) FROM public.payroll_payable_lines WHERE period_id=v_period) <> 277 OR
     EXISTS (SELECT 1 FROM public.payroll_payable_lines WHERE period_id=v_period AND (NOT(entry_id=ANY(v_entries)) OR net_amount<>1))
  THEN RAISE EXCEPTION 'Lançamentos divergiram: nada foi arquivado'; END IF;

  IF (SELECT count(*) FROM public.payroll_payments WHERE period_id=v_period AND paid_at IS NOT NULL AND amount=1) <> 20 OR
     (SELECT count(*) FROM public.payroll_pix_transfers WHERE period_id=v_period AND status='settled' AND amount=1) <> 19 OR
     (SELECT count(*) FROM public.payroll_pix_transfers WHERE period_id=v_period AND status='failed') <> 4 OR
     (SELECT count(*) FROM public.payroll_pix_transfers WHERE period_id=v_period) <> 24 OR
     EXISTS (SELECT 1 FROM public.payroll_pix_transfers WHERE period_id=v_period AND status='created'
               AND (provider_payment_id IS NOT NULL OR sent_at IS NOT NULL OR next_check_at IS NOT NULL OR created_at>now()-interval '1 day')) OR
     EXISTS (SELECT 1 FROM public.payroll_pix_transfers WHERE period_id=v_period AND status NOT IN ('created','failed','settled')) OR
     EXISTS (SELECT 1 FROM public.payment_2fa_challenges c WHERE expires_at>now() AND
               (c.transfer_id IN (SELECT id FROM public.payroll_pix_transfers WHERE period_id=v_period)
                OR c.batch_transfer_ids && ARRAY(SELECT id FROM public.payroll_pix_transfers WHERE period_id=v_period)))
  THEN RAISE EXCEPTION 'Pagamentos ou autorizações divergiram: nada foi arquivado'; END IF;

  -- Hash integral dos comprovantes, linhas congeladas e descontos reais.
  SELECT md5(string_agg(row_data::text, E'\n' ORDER BY row_data::text)) INTO v_hash_before FROM (
    SELECT jsonb_build_object('table','payments','row',to_jsonb(p)) row_data FROM public.payroll_payments p WHERE period_id=v_period
    UNION ALL SELECT jsonb_build_object('table','lines','row',to_jsonb(l)) FROM public.payroll_payable_lines l WHERE period_id=v_period
    UNION ALL SELECT jsonb_build_object('table','transfers','row',to_jsonb(t)) FROM public.payroll_pix_transfers t WHERE period_id=v_period AND status<>'created'
    UNION ALL SELECT jsonb_build_object('table','discounts','row',to_jsonb(e)) FROM public.payroll_entries e
      WHERE company_id=v_company AND month=9 AND year=2026 AND NOT(id=ANY(v_entries))
  ) preserved;

  -- A única tentativa ainda "created" nunca foi enviada; encerra-a para que
  -- nenhum código antigo possa voltar a executá-la. Preserva a própria linha.
  UPDATE public.payroll_pix_transfers SET status='failed', failed_at=now(),
    error_code='TEST_PAYROLL_ARCHIVED', error_message='Teste arquivado por solicitação do responsável; tentativa nunca enviada.'
    WHERE period_id=v_period AND status='created' AND provider_payment_id IS NULL AND sent_at IS NULL AND next_check_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'A tentativa pendente divergiu'; END IF;

  UPDATE public.payroll_periods SET archived_at=now(),
    archive_reason='Teste PIX arquivado por solicitação do responsável para liberar setembro/2026. Pagamentos e comprovantes preservados; quatro descontos reais permanecem ativos.'
    WHERE id=v_period;
  UPDATE public.payroll_entries SET archived_period_id=v_period WHERE id=ANY(v_entries);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>277 THEN RAISE EXCEPTION 'Quantidade arquivada divergente'; END IF;

  SELECT md5(string_agg(row_data::text, E'\n' ORDER BY row_data::text)) INTO v_hash_after FROM (
    SELECT jsonb_build_object('table','payments','row',to_jsonb(p)) row_data FROM public.payroll_payments p WHERE period_id=v_period
    UNION ALL SELECT jsonb_build_object('table','lines','row',to_jsonb(l)) FROM public.payroll_payable_lines l WHERE period_id=v_period
    UNION ALL SELECT jsonb_build_object('table','transfers','row',to_jsonb(t)) FROM public.payroll_pix_transfers t WHERE period_id=v_period AND error_code IS DISTINCT FROM 'TEST_PAYROLL_ARCHIVED'
    UNION ALL SELECT jsonb_build_object('table','discounts','row',to_jsonb(e)) FROM public.payroll_entries e
      WHERE company_id=v_company AND month=9 AND year=2026 AND NOT(id=ANY(v_entries))
  ) preserved;
  IF v_hash_before IS DISTINCT FROM v_hash_after THEN RAISE EXCEPTION 'Dados preservados divergiram'; END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_periods WHERE company_id=v_company AND reference_month='2026-09-01' AND archived_at IS NULL)
     OR (SELECT count(*) FROM public.payroll_entries WHERE company_id=v_company AND month=9 AND year=2026 AND archived_period_id IS NULL)<>4 THEN
    RAISE EXCEPTION 'Setembro não ficou livre com os quatro descontos';
  END IF;
  RAISE NOTICE 'Arquivo validado: 277 lançamentos; 20 pagamentos e 277 linhas preservados; quatro descontos ativos; setembro livre.';
END $$;
COMMIT;
