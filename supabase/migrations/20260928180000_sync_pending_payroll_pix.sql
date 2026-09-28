-- O PIX acompanha o cadastro enquanto não existe pagamento ou tentativa ativa.
-- Valores, nome/documento aprovado, agrupamento e transferências ficam intactos.
-- Sem backfill global: correções anteriores devem usar a função por entry_id,
-- com o mesmo filtro e a auditoria existente de payroll_payable_lines.
BEGIN;

CREATE OR REPLACE FUNCTION public.payroll_sync_pending_pix(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- Mesmo lock de payroll_pix_open_transfer: a atualização termina antes de
  -- abrir uma tentativa, ou a tentativa existente impede mudar seu destino.
  PERFORM pg_advisory_xact_lock(
    hashtext('payroll_pix_transfers'), hashtext(p_entry_id::text));

  PERFORM 1 FROM public.payroll_payments
    WHERE entry_id = p_entry_id FOR UPDATE;

  UPDATE public.payroll_payable_lines l
     SET payee_pix_key = c.pix_key,
         payee_pix_key_norm = c.pix_key_normalized,
         payee_pix_key_type = c.pix_key_type
    FROM public.collaborators c, public.payroll_periods p
   WHERE l.entry_id = p_entry_id
     AND c.id = l.collaborator_id AND c.company_id = l.company_id
     AND p.id = l.period_id AND p.company_id = l.company_id
     AND p.archived_at IS NULL
     AND p.status IN ('aprovado_diretoria', 'closed', 'exported')
     AND NOT EXISTS (
       SELECT 1 FROM public.payroll_payments pm
        WHERE pm.entry_id = l.entry_id AND pm.paid_at IS NOT NULL)
     -- Inclui created: um código 2FA já pode ter sido emitido para esse PIX.
     -- Estados futuros também bloqueiam por padrão. Só failed libera a linha.
     AND NOT EXISTS (
       SELECT 1 FROM public.payroll_pix_transfers t
        WHERE t.entry_id = l.entry_id AND t.status::text IS DISTINCT FROM 'failed')
     AND ROW(l.payee_pix_key, l.payee_pix_key_norm, l.payee_pix_key_type)
         IS DISTINCT FROM ROW(c.pix_key, c.pix_key_normalized, c.pix_key_type);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_sync_pending_pix(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_sync_pending_pix(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.collaborator_sync_pending_payroll_pix()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entry uuid;
BEGIN
  -- AFTER UPDATE enxerga as colunas geradas de tipo/normalização recalculadas.
  FOR v_entry IN
    SELECT l.entry_id FROM public.payroll_payable_lines l
     WHERE l.collaborator_id = NEW.id AND l.company_id = NEW.company_id
     ORDER BY l.entry_id
  LOOP
    PERFORM public.payroll_sync_pending_pix(v_entry);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.collaborator_sync_pending_payroll_pix() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collaborator_sync_pending_payroll_pix ON public.collaborators;
CREATE TRIGGER trg_collaborator_sync_pending_payroll_pix
  AFTER UPDATE OF pix_key, cpf ON public.collaborators
  FOR EACH ROW
  WHEN (OLD.pix_key IS DISTINCT FROM NEW.pix_key OR OLD.cpf IS DISTINCT FROM NEW.cpf)
  EXECUTE FUNCTION public.collaborator_sync_pending_payroll_pix();

-- Se a tentativa protegida falhou/foi cancelada, a próxima tentativa passa a
-- usar o cadastro atual. A tentativa anterior e seu código não são reescritos.
CREATE OR REPLACE FUNCTION public.payroll_refresh_available_pix()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.payroll_sync_pending_pix(OLD.entry_id);
    RETURN OLD;
  END IF;
  PERFORM public.payroll_sync_pending_pix(NEW.entry_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_refresh_available_pix() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payroll_failed_sync_pix ON public.payroll_pix_transfers;
CREATE TRIGGER trg_payroll_failed_sync_pix
  AFTER UPDATE OF status ON public.payroll_pix_transfers
  FOR EACH ROW WHEN (NEW.status::text = 'failed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.payroll_refresh_available_pix();

DROP TRIGGER IF EXISTS trg_payroll_unpaid_sync_pix ON public.payroll_payments;
CREATE TRIGGER trg_payroll_unpaid_sync_pix
  AFTER UPDATE OF paid_at ON public.payroll_payments
  FOR EACH ROW WHEN (NEW.paid_at IS NULL AND OLD.paid_at IS NOT NULL)
  EXECUTE FUNCTION public.payroll_refresh_available_pix();

DROP TRIGGER IF EXISTS trg_payroll_removed_payment_sync_pix ON public.payroll_payments;
CREATE TRIGGER trg_payroll_removed_payment_sync_pix
  AFTER DELETE ON public.payroll_payments
  FOR EACH ROW EXECUTE FUNCTION public.payroll_refresh_available_pix();

COMMENT ON FUNCTION public.payroll_sync_pending_pix(uuid) IS
  'Atualiza somente a chave PIX/tipo/normalização de linha não paga, não arquivada e sem tentativa ativa. Não recalcula valores nem modifica transferências. Escrita auditada.';

COMMIT;

-- ROLLBACK (não restaura chaves antigas em pagamentos já iniciados):
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_collaborator_sync_pending_payroll_pix ON public.collaborators;
-- DROP TRIGGER IF EXISTS trg_payroll_failed_sync_pix ON public.payroll_pix_transfers;
-- DROP TRIGGER IF EXISTS trg_payroll_unpaid_sync_pix ON public.payroll_payments;
-- DROP TRIGGER IF EXISTS trg_payroll_removed_payment_sync_pix ON public.payroll_payments;
-- DROP FUNCTION IF EXISTS public.collaborator_sync_pending_payroll_pix();
-- DROP FUNCTION IF EXISTS public.payroll_refresh_available_pix();
-- DROP FUNCTION IF EXISTS public.payroll_sync_pending_pix(uuid);
-- COMMIT;
