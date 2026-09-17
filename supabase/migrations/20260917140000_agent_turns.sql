-- Conversas: pedido durável, exclusão mútua por sessão e reenvio idempotente.
BEGIN;
ALTER TABLE public.agent_sessions ADD COLUMN task_context jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  user_message_id uuid NOT NULL REFERENCES public.agent_messages(id) ON DELETE CASCADE,
  assistant_message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  lease_id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, request_id)
);
CREATE UNIQUE INDEX agent_runs_one_running_session ON public.agent_runs(session_id) WHERE status = 'running';
CREATE INDEX agent_runs_company ON public.agent_runs(company_id, created_at DESC);
CREATE TRIGGER set_updated_at_agent_runs BEFORE UPDATE ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
-- Metadados operacionais; conteúdo pessoal permanece em agent_messages.
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own agent runs" ON public.agent_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND (public.user_belongs_to_company(auth.uid(), company_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('admin_gc','admin'))));
-- Sem policies de escrita: somente backend autenticado com service_role.
GRANT SELECT ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;

-- SECURITY INVOKER: só service_role pode chamar. O endpoint valida JWT,
-- papel, módulo e empresa antes de chamar; a RPC valida a sessão novamente.
CREATE FUNCTION public.agent_begin_turn(p_user_id uuid, p_company_id uuid, p_kind text,
  p_session_id uuid, p_request_id uuid, p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s public.agent_sessions; r public.agent_runs; m uuid; old_query text;
BEGIN
  IF p_kind NOT IN ('analyst','recruiter') OR length(trim(p_query)) NOT BETWEEN 1 AND 6000 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_request_id::text, 0));
  SELECT * INTO r FROM agent_runs WHERE user_id=p_user_id AND request_id=p_request_id;
  IF FOUND THEN
    SELECT * INTO s FROM agent_sessions WHERE id=r.session_id FOR UPDATE;
    SELECT * INTO r FROM agent_runs WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
    SELECT content INTO old_query FROM agent_messages WHERE id=r.user_message_id;
    IF r.company_id<>p_company_id OR s.agent_kind<>p_kind OR s.user_id<>p_user_id
      OR s.archived_at IS NOT NULL OR old_query<>p_query
      OR (p_session_id IS NOT NULL AND p_session_id<>s.id) THEN RAISE EXCEPTION 'request_conflict'; END IF;
    IF r.status='completed' THEN RETURN jsonb_build_object('run',to_jsonb(r),'session',to_jsonb(s),'replayed',true); END IF;
    IF r.status='running' AND r.updated_at > now()-interval '2 minutes' THEN RAISE EXCEPTION 'turn_running'; END IF;
    -- Um retry antigo não pode ultrapassar um turno mais recente da conversa.
    IF EXISTS (SELECT 1 FROM agent_runs WHERE session_id=s.id AND created_at>r.created_at) THEN RAISE EXCEPTION 'stale_request'; END IF;
    UPDATE agent_runs SET status='running',lease_id=gen_random_uuid(),error_code=NULL WHERE id=r.id RETURNING * INTO r;
    RETURN jsonb_build_object('run',to_jsonb(r),'session',to_jsonb(s),'replayed',false);
  END IF;
  IF p_session_id IS NULL THEN
    INSERT INTO agent_sessions(company_id,user_id,agent_kind,title)
      VALUES(p_company_id,p_user_id,p_kind,left(p_query,80)) RETURNING * INTO s;
  ELSE
    SELECT * INTO s FROM agent_sessions WHERE id=p_session_id FOR UPDATE;
    IF NOT FOUND OR s.user_id<>p_user_id OR s.company_id<>p_company_id OR s.agent_kind<>p_kind OR s.archived_at IS NOT NULL
      THEN RAISE EXCEPTION 'session_not_found'; END IF;
  END IF;
  UPDATE agent_runs SET status='failed',error_code='interrupted' WHERE session_id=s.id AND status='running' AND updated_at<=now()-interval '2 minutes';
  IF EXISTS(SELECT 1 FROM agent_runs WHERE session_id=s.id AND status='running') THEN RAISE EXCEPTION 'turn_running'; END IF;
  INSERT INTO agent_messages(session_id,role,content,created_at)
    VALUES(s.id,'user',p_query,GREATEST(clock_timestamp(),(SELECT max(created_at)+interval '1 microsecond' FROM agent_messages WHERE session_id=s.id))) RETURNING id INTO m;
  INSERT INTO agent_runs(company_id,user_id,session_id,request_id,user_message_id,status,created_at)
    VALUES(p_company_id,p_user_id,s.id,p_request_id,m,'running',(SELECT created_at FROM agent_messages WHERE id=m)) RETURNING * INTO r;
  UPDATE agent_sessions SET updated_at=now() WHERE id=s.id;
  RETURN jsonb_build_object('run',to_jsonb(r),'session',to_jsonb(s),'replayed',false);
END $$;

CREATE FUNCTION public.agent_finish_turn(p_run_id uuid, p_lease_id uuid, p_content text,
  p_metadata jsonb, p_context jsonb, p_model text, p_input integer, p_output integer)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.agent_runs; m uuid;
BEGIN
  SELECT * INTO r FROM agent_runs WHERE id=p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale_run'; END IF;
  PERFORM 1 FROM agent_sessions WHERE id=r.session_id FOR UPDATE;
  SELECT * INTO r FROM agent_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.lease_id<>p_lease_id OR r.status<>'running' THEN RAISE EXCEPTION 'stale_run'; END IF;
  INSERT INTO agent_messages(session_id,role,content,metadata,model,token_input,token_output,created_at)
    VALUES(r.session_id,'assistant',p_content,p_metadata,p_model,p_input,p_output,GREATEST(clock_timestamp(),(SELECT max(created_at)+interval '1 microsecond' FROM agent_messages WHERE session_id=r.session_id))) RETURNING id INTO m;
  UPDATE agent_sessions SET task_context=p_context,updated_at=now() WHERE id=r.session_id;
  UPDATE agent_runs SET status='completed',assistant_message_id=m WHERE id=r.id;
  RETURN m;
END $$;
REVOKE ALL ON FUNCTION public.agent_begin_turn(uuid,uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agent_finish_turn(uuid,uuid,text,jsonb,jsonb,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_begin_turn(uuid,uuid,text,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_finish_turn(uuid,uuid,text,jsonb,jsonb,text,integer,integer) TO service_role;
COMMIT;
-- ROLLBACK (preservar backup das execuções antes de aplicar)
-- BEGIN;
-- DROP FUNCTION public.agent_finish_turn(uuid,uuid,text,jsonb,jsonb,text,integer,integer);
-- DROP FUNCTION public.agent_begin_turn(uuid,uuid,text,uuid,uuid,text);
-- DROP TABLE public.agent_runs;
-- ALTER TABLE public.agent_sessions DROP COLUMN task_context;
-- COMMIT;
