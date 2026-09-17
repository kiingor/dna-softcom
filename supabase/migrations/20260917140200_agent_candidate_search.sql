-- Busca apenas embeddings compatíveis de candidatos ativos autorizados por RLS.
BEGIN;
CREATE FUNCTION public.agent_match_candidates(query_embedding vector(1536), filter_company_id uuid,
  embedding_model text, candidate_ids uuid[] DEFAULT NULL, candidate_source text DEFAULT NULL)
RETURNS TABLE(candidate_id uuid, similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT ce.candidate_id, (1-(ce.embedding <=> query_embedding))::double precision
  FROM candidate_embeddings ce JOIN candidates c ON c.id=ce.candidate_id AND c.company_id=ce.company_id
  WHERE ce.company_id=filter_company_id AND ce.model=embedding_model AND c.is_active
    AND (candidate_ids IS NULL OR c.id=ANY(candidate_ids))
    AND (candidate_source IS NULL OR c.source=candidate_source)
    AND 1-(ce.embedding <=> query_embedding)>0.3
  ORDER BY ce.embedding <=> query_embedding LIMIT 30
$$;
REVOKE ALL ON FUNCTION public.agent_match_candidates(vector,uuid,text,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.agent_match_candidates(vector,uuid,text,uuid[],text) TO authenticated,service_role;
COMMIT;
-- ROLLBACK
-- BEGIN;
-- DROP FUNCTION public.agent_match_candidates(vector,uuid,text,uuid[],text);
-- COMMIT;
