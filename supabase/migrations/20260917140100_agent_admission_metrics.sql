-- Registra transições futuras; não inventa a data da etapa de jornadas antigas.
BEGIN;
ALTER TABLE public.admission_journeys ADD COLUMN status_entered_at timestamptz;
CREATE FUNCTION public.admission_track_status_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='INSERT' THEN NEW.status_entered_at:=now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN NEW.status_entered_at:=now();
  ELSE NEW.status_entered_at:=OLD.status_entered_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admission_track_status_entry BEFORE INSERT OR UPDATE ON public.admission_journeys
  FOR EACH ROW EXECUTE FUNCTION public.admission_track_status_entry();
CREATE OR REPLACE VIEW public.agent_admission_funnel WITH (security_invoker=true) AS
SELECT company_id,status,regime,COUNT(*) AS count,
  AVG(EXTRACT(epoch FROM (now()-status_entered_at))/86400)::numeric(10,1) AS avg_days_in_status,
  MIN(created_at) AS oldest_journey_at,MAX(updated_at) AS latest_movement_at,
  COUNT(status_entered_at) AS known_status_entry_count
FROM public.admission_journeys GROUP BY company_id,status,regime;
COMMIT;
-- ROLLBACK
-- BEGIN;
-- DROP VIEW public.agent_admission_funnel;
-- CREATE VIEW public.agent_admission_funnel WITH (security_invoker=true) AS
-- SELECT company_id,status,regime,COUNT(*) AS count,
-- AVG(EXTRACT(epoch FROM (now()-created_at))/86400)::numeric(10,1) AS avg_days_in_status,
-- MIN(created_at) AS oldest_journey_at,MAX(updated_at) AS latest_movement_at
-- FROM public.admission_journeys GROUP BY company_id,status,regime;
-- DROP TRIGGER admission_track_status_entry ON public.admission_journeys;
-- DROP FUNCTION public.admission_track_status_entry();
-- ALTER TABLE public.admission_journeys DROP COLUMN status_entered_at;
-- COMMIT;
