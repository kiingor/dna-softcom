-- Migration: 20261014173000_fix_vacation_edit_permissions.sql
--
-- Corrige permissões de visualização e edição de períodos/solicitações de férias:
-- 1) has_module_permission passa a reconhecer is_company_admin(_user_id, _company_id)
--    (que inclui owner_id da empresa e role global admin_gc, exceto para o gate
--    explícito folha_pagamento_exec) e retorna COALESCE(..., false) quando não
--    há linha em user_permissions.
-- 2) Cria helper can_manage_company_vacations(_user_id, _company_id, _permission)
--    que autoriza:
--      - is_company_admin (owner da empresa ou admin_gc);
--      - permissão granular no módulo 'ferias' ou 'colaboradores';
--      - papéis de gestão da empresa ('admin', 'admin_gc', 'gestor_gc', 'gestor', 'rh', 'diretoria')
--        vinculados à empresa via user_belongs_to_company.
-- 3) Atualiza edit_vacation_period_manual, adjust_vacation_period_manual e as
--    policies RLS de vacation_periods e vacation_requests para usar
--    can_manage_company_vacations.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_module_permission(
  _user_id uuid,
  _company_id uuid,
  _module text,
  _permission text DEFAULT 'can_view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _module <> 'folha_pagamento_exec'
      AND public.is_company_admin(_user_id, _company_id) THEN true
    ELSE COALESCE((
      SELECT CASE _permission
        WHEN 'can_view' THEN COALESCE(can_view, false)
        WHEN 'can_create' THEN COALESCE(can_create, false)
        WHEN 'can_edit' THEN COALESCE(can_edit, false)
        WHEN 'can_delete' THEN COALESCE(can_delete, false)
        ELSE false
      END
      FROM public.user_permissions
      WHERE user_id = _user_id
        AND company_id = _company_id
        AND module = _module
      LIMIT 1
    ), false)
  END
$$;

CREATE OR REPLACE FUNCTION public.can_manage_company_vacations(
  _user_id uuid,
  _company_id uuid,
  _permission text DEFAULT 'can_edit'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_company_admin(_user_id, _company_id)
    OR public.has_module_permission(_user_id, _company_id, 'ferias', _permission)
    OR public.has_module_permission(_user_id, _company_id, 'colaboradores', _permission)
    OR (
      public.user_belongs_to_company(_user_id, _company_id)
      AND EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.role::text IN ('admin', 'admin_gc', 'gestor_gc', 'gestor', 'rh', 'diretoria')
      )
    );
$$;

COMMENT ON FUNCTION public.can_manage_company_vacations(uuid, uuid, text) IS
  'Autoriza leitura/criação/edição/exclusão de férias por permissão granular (ferias/colaboradores), '
  'admin da empresa/admin_gc, ou papéis de gestão da empresa.';

GRANT EXECUTE ON FUNCTION public.can_manage_company_vacations(uuid, uuid, text) TO authenticated;

-- Atualiza RPC de ajuste manual de saldo (dias gozados/vendidos)
CREATE OR REPLACE FUNCTION public.adjust_vacation_period_manual(
  _period_id uuid,
  _days_taken integer,
  _days_sold integer,
  _notes text DEFAULT NULL
)
RETURNS public.vacation_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _period public.vacation_periods;
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO _period FROM vacation_periods WHERE id = _period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vacation_period not found';
  END IF;

  IF NOT public.can_manage_company_vacations(_user_id, _period.company_id, 'can_edit') THEN
    RAISE EXCEPTION 'sem permissão para ajustar férias';
  END IF;

  IF _days_taken < 0 OR _days_sold < 0 THEN
    RAISE EXCEPTION 'dias não podem ser negativos';
  END IF;

  IF _days_taken + _days_sold > _period.days_entitled THEN
    RAISE EXCEPTION 'soma de dias tirados e vendidos excede o direito (%)', _period.days_entitled;
  END IF;

  UPDATE vacation_periods
  SET
    days_taken = _days_taken,
    days_sold = _days_sold,
    manual_adjustment_at = now(),
    manual_adjustment_by = _user_id,
    manual_adjustment_notes = NULLIF(trim(COALESCE(_notes, '')), '')
  WHERE id = _period_id
  RETURNING * INTO _period;

  RETURN _period;
END;
$$;

-- Atualiza RPC de edição manual completa de período aquisitivo/gozo
CREATE OR REPLACE FUNCTION public.edit_vacation_period_manual(
  _period_id uuid,
  _start_date date,
  _end_date date,
  _days_entitled integer,
  _days_taken integer,
  _days_sold integer,
  _status text,
  _gozo_start_date date DEFAULT NULL,
  _gozo_end_date date DEFAULT NULL,
  _data_limite date DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.vacation_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _period public.vacation_periods;
  _user_id uuid := auth.uid();
  _remaining integer;
  _final_status text;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO _period FROM vacation_periods WHERE id = _period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vacation_period not found';
  END IF;

  IF NOT public.can_manage_company_vacations(_user_id, _period.company_id, 'can_edit') THEN
    RAISE EXCEPTION 'sem permissão para editar férias';
  END IF;

  IF _start_date IS NULL OR _end_date IS NULL THEN
    RAISE EXCEPTION 'período de competência é obrigatório';
  END IF;
  IF _end_date < _start_date THEN
    RAISE EXCEPTION 'fim da competência não pode ser antes do início';
  END IF;

  IF (_gozo_start_date IS NULL) <> (_gozo_end_date IS NULL) THEN
    RAISE EXCEPTION 'informe início e fim do período de gozo (ou deixe ambos vazios)';
  END IF;
  IF _gozo_start_date IS NOT NULL AND _gozo_end_date < _gozo_start_date THEN
    RAISE EXCEPTION 'fim do gozo não pode ser antes do início';
  END IF;

  IF _days_entitled <= 0 THEN
    RAISE EXCEPTION 'direito (dias) deve ser maior que zero';
  END IF;
  IF _days_taken < 0 OR _days_sold < 0 THEN
    RAISE EXCEPTION 'dias não podem ser negativos';
  END IF;
  IF _days_taken + _days_sold > _days_entitled THEN
    RAISE EXCEPTION 'soma de dias gozados e vendidos excede o direito (%)', _days_entitled;
  END IF;

  _remaining := GREATEST(_days_entitled - _days_taken - _days_sold, 0);

  IF _status IN ('pending', 'expired') THEN
    _final_status := _status;
  ELSIF _remaining <= 0 THEN
    _final_status := 'used';
  ELSIF _days_taken + _days_sold > 0 THEN
    _final_status := 'partially_used';
  ELSE
    _final_status := 'available';
  END IF;

  UPDATE vacation_periods
  SET
    start_date = _start_date,
    end_date = _end_date,
    gozo_start_date = _gozo_start_date,
    gozo_end_date = _gozo_end_date,
    data_limite = _data_limite,
    days_entitled = _days_entitled,
    days_taken = _days_taken,
    days_sold = _days_sold,
    days_remaining = _remaining,
    status = _final_status,
    manual_adjustment_at = now(),
    manual_adjustment_by = _user_id,
    manual_adjustment_notes = NULLIF(trim(COALESCE(_notes, '')), '')
  WHERE id = _period_id
  RETURNING * INTO _period;

  RETURN _period;
END;
$$;

-- RLS para vacation_periods
DROP POLICY IF EXISTS "Users with permission can view vacation periods" ON public.vacation_periods;
CREATE POLICY "Users with permission can view vacation periods"
  ON public.vacation_periods FOR SELECT
  USING (
    public.can_manage_company_vacations(auth.uid(), company_id, 'can_view')
    OR EXISTS (
      SELECT 1 FROM public.collaborators c
      WHERE c.id = vacation_periods.collaborator_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users with permission can insert vacation periods" ON public.vacation_periods;
CREATE POLICY "Users with permission can insert vacation periods"
  ON public.vacation_periods FOR INSERT
  WITH CHECK (public.can_manage_company_vacations(auth.uid(), company_id, 'can_create'));

DROP POLICY IF EXISTS "Users with permission can update vacation periods" ON public.vacation_periods;
CREATE POLICY "Users with permission can update vacation periods"
  ON public.vacation_periods FOR UPDATE
  USING (public.can_manage_company_vacations(auth.uid(), company_id, 'can_edit'))
  WITH CHECK (public.can_manage_company_vacations(auth.uid(), company_id, 'can_edit'));

DROP POLICY IF EXISTS "Users with permission can delete vacation periods" ON public.vacation_periods;
CREATE POLICY "Users with permission can delete vacation periods"
  ON public.vacation_periods FOR DELETE
  USING (public.can_manage_company_vacations(auth.uid(), company_id, 'can_delete'));

-- RLS para vacation_requests
DROP POLICY IF EXISTS "Users with permission can view vacation requests" ON public.vacation_requests;
CREATE POLICY "Users with permission can view vacation requests"
  ON public.vacation_requests FOR SELECT
  USING (
    public.can_manage_company_vacations(auth.uid(), company_id, 'can_view')
    OR EXISTS (
      SELECT 1 FROM public.collaborators c
      WHERE c.id = vacation_requests.collaborator_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users with permission can insert vacation requests" ON public.vacation_requests;
CREATE POLICY "Users with permission can insert vacation requests"
  ON public.vacation_requests FOR INSERT
  WITH CHECK (
    public.can_manage_company_vacations(auth.uid(), company_id, 'can_create')
    OR EXISTS (
      SELECT 1 FROM public.collaborators c
      WHERE c.id = vacation_requests.collaborator_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users with permission can update vacation requests" ON public.vacation_requests;
CREATE POLICY "Users with permission can update vacation requests"
  ON public.vacation_requests FOR UPDATE
  USING (public.can_manage_company_vacations(auth.uid(), company_id, 'can_edit'))
  WITH CHECK (public.can_manage_company_vacations(auth.uid(), company_id, 'can_edit'));

DROP POLICY IF EXISTS "Users with permission can delete vacation requests" ON public.vacation_requests;
CREATE POLICY "Users with permission can delete vacation requests"
  ON public.vacation_requests FOR DELETE
  USING (public.can_manage_company_vacations(auth.uid(), company_id, 'can_delete'));

COMMIT;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
--
-- DROP POLICY IF EXISTS "Users with permission can view vacation periods" ON public.vacation_periods;
-- CREATE POLICY "Users with permission can view vacation periods"
--   ON public.vacation_periods FOR SELECT
--   USING (
--     can_view_module(auth.uid(), company_id, 'ferias'::text)
--     OR EXISTS (SELECT 1 FROM collaborators c WHERE c.id = vacation_periods.collaborator_id AND c.user_id = auth.uid())
--   );
--
-- DROP POLICY IF EXISTS "Users with permission can insert vacation periods" ON public.vacation_periods;
-- CREATE POLICY "Users with permission can insert vacation periods"
--   ON public.vacation_periods FOR INSERT
--   WITH CHECK (has_module_permission(auth.uid(), company_id, 'ferias'::text, 'can_create'::text));
--
-- DROP POLICY IF EXISTS "Users with permission can update vacation periods" ON public.vacation_periods;
-- CREATE POLICY "Users with permission can update vacation periods"
--   ON public.vacation_periods FOR UPDATE
--   USING (has_module_permission(auth.uid(), company_id, 'ferias'::text, 'can_edit'::text));
--
-- DROP POLICY IF EXISTS "Users with permission can delete vacation periods" ON public.vacation_periods;
-- CREATE POLICY "Users with permission can delete vacation periods"
--   ON public.vacation_periods FOR DELETE
--   USING (has_module_permission(auth.uid(), company_id, 'ferias'::text, 'can_delete'::text));
--
-- DROP POLICY IF EXISTS "Users with permission can view vacation requests" ON public.vacation_requests;
-- CREATE POLICY "Users with permission can view vacation requests"
--   ON public.vacation_requests FOR SELECT
--   USING (
--     can_view_module(auth.uid(), company_id, 'ferias'::text)
--     OR EXISTS (SELECT 1 FROM collaborators c WHERE c.id = vacation_requests.collaborator_id AND c.user_id = auth.uid())
--   );
--
-- DROP POLICY IF EXISTS "Users with permission can insert vacation requests" ON public.vacation_requests;
-- CREATE POLICY "Users with permission can insert vacation requests"
--   ON public.vacation_requests FOR INSERT
--   WITH CHECK (
--     has_module_permission(auth.uid(), company_id, 'ferias'::text, 'can_create'::text)
--     OR EXISTS (SELECT 1 FROM collaborators c WHERE c.id = vacation_requests.collaborator_id AND c.user_id = auth.uid())
--   );
--
-- DROP POLICY IF EXISTS "Users with permission can update vacation requests" ON public.vacation_requests;
-- CREATE POLICY "Users with permission can update vacation requests"
--   ON public.vacation_requests FOR UPDATE
--   USING (has_module_permission(auth.uid(), company_id, 'ferias'::text, 'can_edit'::text));
--
-- DROP POLICY IF EXISTS "Users with permission can delete vacation requests" ON public.vacation_requests;
-- CREATE POLICY "Users with permission can delete vacation requests"
--   ON public.vacation_requests FOR DELETE
--   USING (has_module_permission(auth.uid(), company_id, 'ferias'::text, 'can_delete'::text));
--
-- DROP FUNCTION IF EXISTS public.can_manage_company_vacations(uuid, uuid, text);
--
-- CREATE OR REPLACE FUNCTION public.has_module_permission(
--   _user_id uuid,
--   _company_id uuid,
--   _module text,
--   _permission text DEFAULT 'can_view'
-- )
-- RETURNS boolean
-- LANGUAGE sql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
--   SELECT CASE
--     WHEN EXISTS (
--       SELECT 1 FROM companies
--       WHERE id = _company_id AND owner_id = _user_id
--     ) THEN true
--     ELSE (
--       SELECT CASE _permission
--         WHEN 'can_view' THEN COALESCE(can_view, false)
--         WHEN 'can_create' THEN COALESCE(can_create, false)
--         WHEN 'can_edit' THEN COALESCE(can_edit, false)
--         WHEN 'can_delete' THEN COALESCE(can_delete, false)
--         ELSE false
--       END
--       FROM user_permissions
--       WHERE user_id = _user_id
--         AND company_id = _company_id
--         AND module = _module
--       LIMIT 1
--     )
--   END
-- $$;
--
-- COMMIT;
