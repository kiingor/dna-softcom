-- Carro agregado passa a ser Veículo (enum interno carro_agregado).
-- Corrige bonificações identificadas explicitamente pela descrição e impede
-- que novos lançamentos com essa descrição voltem à classificação anterior.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Guarda apenas os identificadores alterados para rollback, sem copiar valores.
CREATE TABLE private.vehicle_entry_reclassification_20260908 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  source_table text NOT NULL CHECK (source_table IN ('payroll_entries', 'collaborator_fixed_entries')),
  record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, record_id)
);
ALTER TABLE private.vehicle_entry_reclassification_20260908 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vehicle_entry_reclassification_20260908 FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_vehicle_entry_reclassification
  AFTER INSERT OR UPDATE OR DELETE ON private.vehicle_entry_reclassification_20260908
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

CREATE FUNCTION private.is_vehicle_payroll_description(description text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(description, '') ~*
    '^[[:space:]]*(bonifica[cç][aã]o[[:space:]]*[-–—:][[:space:]]*)?(carro[[:space:]]+agregado|ve[ií]culo([[:space:]]+agregado)?|agregamento)([[:space:]]|$|[-–—:])';
$$;

INSERT INTO private.vehicle_entry_reclassification_20260908 (company_id, source_table, record_id)
SELECT e.company_id, 'payroll_entries', e.id
  FROM public.payroll_entries e
  JOIN public.payroll_periods p ON p.company_id = e.company_id
    AND extract(month FROM p.reference_month) = e.month
    AND extract(year FROM p.reference_month) = e.year
 WHERE e.type = 'bonificacao'
   AND private.is_vehicle_payroll_description(e.description)
   AND coalesce(e.external_id, '') NOT LIKE 'ferias-%'
   AND p.status::text IN ('open', 'aprovado_rh')
   AND NOT EXISTS (SELECT 1 FROM public.payroll_payable_lines l WHERE l.period_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.payroll_payments pp WHERE pp.period_id = p.id AND pp.paid_at IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM public.payroll_pix_transfers t WHERE t.period_id = p.id AND t.status::text <> 'failed');

INSERT INTO private.vehicle_entry_reclassification_20260908 (company_id, source_table, record_id)
SELECT e.company_id, 'collaborator_fixed_entries', e.id
  FROM public.collaborator_fixed_entries e
 WHERE e.type = 'bonificacao'
   AND private.is_vehicle_payroll_description(e.description)
   -- A ficha fixa tem índice único por tipo/descrição. Não combina valores
   -- de cadastros duplicados, que precisam de conferência individual.
   AND (NOT e.is_active OR NOT EXISTS (
     SELECT 1 FROM public.collaborator_fixed_entries other
      WHERE other.collaborator_id = e.collaborator_id
        AND other.type = 'carro_agregado' AND other.is_active
        AND lower(coalesce(other.description, '')) = lower(coalesce(e.description, ''))
   ));

UPDATE public.payroll_entries e SET type = 'carro_agregado'
  FROM private.vehicle_entry_reclassification_20260908 b
 WHERE b.source_table = 'payroll_entries' AND b.record_id = e.id;
UPDATE public.collaborator_fixed_entries e SET type = 'carro_agregado'
  FROM private.vehicle_entry_reclassification_20260908 b
 WHERE b.source_table = 'collaborator_fixed_entries' AND b.record_id = e.id;

CREATE FUNCTION private.normalize_vehicle_payroll_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.type::text = 'bonificacao'
     AND coalesce(NEW.description, '') ~*
       '^[[:space:]]*(bonifica[cç][aã]o[[:space:]]*[-–—:][[:space:]]*)?(carro[[:space:]]+agregado|ve[ií]culo([[:space:]]+agregado)?|agregamento)([[:space:]]|$|[-–—:])'
     AND (TG_TABLE_NAME <> 'payroll_entries' OR coalesce(to_jsonb(NEW)->>'external_id', '') NOT LIKE 'ferias-%') THEN
    NEW.type := 'carro_agregado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER normalize_vehicle_payroll_entry
  BEFORE INSERT OR UPDATE OF type, description ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION private.normalize_vehicle_payroll_entry();
CREATE TRIGGER normalize_vehicle_fixed_entry
  BEFORE INSERT OR UPDATE OF type, description ON public.collaborator_fixed_entries
  FOR EACH ROW EXECUTE FUNCTION private.normalize_vehicle_payroll_entry();

COMMIT;

-- ROLLBACK: restaura somente os registros corrigidos por esta migration.
-- Folhas aprovadas/pagas desde a correção devem manter o histórico aprovado.
-- BEGIN;
-- DROP TRIGGER normalize_vehicle_payroll_entry ON public.payroll_entries;
-- DROP TRIGGER normalize_vehicle_fixed_entry ON public.collaborator_fixed_entries;
-- DROP FUNCTION private.normalize_vehicle_payroll_entry();
-- UPDATE public.payroll_entries e SET type = 'bonificacao'
--   FROM private.vehicle_entry_reclassification_20260908 b, public.payroll_periods p
--  WHERE b.source_table = 'payroll_entries' AND b.record_id = e.id
--    AND e.type = 'carro_agregado' AND p.company_id = e.company_id
--    AND extract(month FROM p.reference_month) = e.month AND extract(year FROM p.reference_month) = e.year
--    AND p.status::text IN ('open', 'aprovado_rh')
--    AND NOT EXISTS (SELECT 1 FROM public.payroll_payable_lines l WHERE l.period_id = p.id)
--    AND NOT EXISTS (SELECT 1 FROM public.payroll_payments pp WHERE pp.period_id = p.id AND pp.paid_at IS NOT NULL)
--    AND NOT EXISTS (SELECT 1 FROM public.payroll_pix_transfers t WHERE t.period_id = p.id AND t.status::text <> 'failed');
-- UPDATE public.collaborator_fixed_entries e SET type = 'bonificacao'
--   FROM private.vehicle_entry_reclassification_20260908 b
--  WHERE b.source_table = 'collaborator_fixed_entries' AND b.record_id = e.id AND e.type = 'carro_agregado'
--    AND (NOT e.is_active OR NOT EXISTS (
--      SELECT 1 FROM public.collaborator_fixed_entries other
--       WHERE other.collaborator_id = e.collaborator_id AND other.type = 'bonificacao' AND other.is_active
--         AND lower(coalesce(other.description, '')) = lower(coalesce(e.description, ''))));
-- DROP TABLE private.vehicle_entry_reclassification_20260908;
-- DROP FUNCTION private.is_vehicle_payroll_description(text);
-- COMMIT;
