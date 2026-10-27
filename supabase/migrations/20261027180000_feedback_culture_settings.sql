-- Campanhas e culturas configuráveis no DNA, vinculadas ao feedback da Agenda.
BEGIN;

CREATE TABLE public.feedback_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX feedback_campaigns_name_unique
  ON public.feedback_campaigns(company_id, lower(name));

CREATE TABLE public.feedback_cultures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX feedback_cultures_name_unique
  ON public.feedback_cultures(company_id, lower(name));

CREATE TABLE public.feedback_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  agenda_objective_id bigint NOT NULL CHECK (agenda_objective_id > 0),
  agenda_collaborator_id bigint NOT NULL CHECK (agenda_collaborator_id > 0),
  campaign_id uuid NOT NULL,
  culture_id uuid NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, agenda_objective_id),
  CONSTRAINT feedback_classifications_campaign_fk FOREIGN KEY (company_id, campaign_id)
    REFERENCES public.feedback_campaigns(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT feedback_classifications_culture_fk FOREIGN KEY (company_id, culture_id)
    REFERENCES public.feedback_cultures(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX feedback_classifications_collaborator_idx
  ON public.feedback_classifications(company_id, agenda_collaborator_id);
CREATE INDEX feedback_classifications_campaign_idx
  ON public.feedback_classifications(company_id, campaign_id);
CREATE INDEX feedback_classifications_culture_idx
  ON public.feedback_classifications(company_id, culture_id);

-- Os catálogos são lidos por quem usa feedback ou administra configurações.
-- Apenas configurações autoriza cadastrar/editar; desativar preserva referências.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['feedback_campaigns', 'feedback_cultures'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY feedback_options_read ON public.%I FOR SELECT TO authenticated USING (
      public.has_module_permission(auth.uid(), company_id, ''feedback'', ''can_view'')
      OR public.has_module_permission(auth.uid(), company_id, ''feedback'', ''can_create'')
      OR public.has_module_permission(auth.uid(), company_id, ''feedback'', ''can_edit'')
      OR public.has_module_permission(auth.uid(), company_id, ''configuracoes'', ''can_view'')
    )', t);
    EXECUTE format('CREATE POLICY feedback_options_create ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.has_module_permission(auth.uid(), company_id, ''configuracoes'', ''can_create''))', t);
    EXECUTE format('CREATE POLICY feedback_options_update ON public.%I FOR UPDATE TO authenticated
      USING (public.has_module_permission(auth.uid(), company_id, ''configuracoes'', ''can_edit''))
      WITH CHECK (public.has_module_permission(auth.uid(), company_id, ''configuracoes'', ''can_edit''))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT INSERT (company_id, name, is_active) ON public.%I TO authenticated', t);
    EXECUTE format('GRANT UPDATE (name, is_active) ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
    EXECUTE format('CREATE TRIGGER audit_feedback_options AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger()', t);
  END LOOP;
END $$;

ALTER TABLE public.feedback_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY feedback_classifications_read ON public.feedback_classifications
  FOR SELECT TO authenticated USING (
    public.has_module_permission(auth.uid(), company_id, 'feedback', 'can_view')
  );
-- A escrita só ocorre na Edge Function, após checar permissão, Agenda e catálogo.
REVOKE ALL ON public.feedback_classifications FROM anon, authenticated;
GRANT SELECT ON public.feedback_classifications TO authenticated;
GRANT ALL ON public.feedback_classifications TO service_role;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.feedback_classifications
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER audit_feedback_classifications AFTER INSERT OR UPDATE OR DELETE
  ON public.feedback_classifications FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

COMMENT ON TABLE public.feedback_classifications IS
  'Classificação do feedback da Agenda. Não replica comentário ou dados do colaborador. '
  'Removida com o feedback; updated_by identifica o usuário validado pela Edge Function.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ROLLBACK (exportar os cadastros/vínculos antes de reverter uma base em uso)
-- BEGIN;
-- DROP TABLE public.feedback_classifications;
-- DROP TABLE public.feedback_cultures;
-- DROP TABLE public.feedback_campaigns;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
