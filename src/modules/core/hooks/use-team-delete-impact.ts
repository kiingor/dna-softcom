import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { summarizeTeamDeleteImpact, type TeamDeleteImpact } from "../utils/team-delete-impact";

/**
 * Confere quem aponta para o setor antes de excluir (ver utils/team-delete-impact).
 *
 * A contagem respeita a RLS de quem consulta: sem acesso a Colaboradores ela
 * viria zerada, então o chamador só habilita a consulta para quem pode ver os
 * colaboradores. Qualquer erro mantém a exclusão bloqueada.
 */
export function useTeamDeleteImpact(teamId: string | null, enabled: boolean) {
  return useQuery<TeamDeleteImpact>({
    queryKey: ["team-delete-impact", teamId],
    enabled: !!teamId && enabled,
    // Vínculos mudam a qualquer momento: cada abertura do diálogo consulta de novo.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const [collaborators, positions, jobOpenings] = await Promise.all([
        supabase.from("collaborators").select("status").eq("team_id", teamId!),
        supabase
          .from("positions")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId!),
        supabase
          .from("job_openings")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId!),
      ]);
      if (collaborators.error) throw collaborators.error;
      if (positions.error) throw positions.error;
      if (jobOpenings.error) throw jobOpenings.error;
      return summarizeTeamDeleteImpact({
        collaborators: collaborators.data ?? [],
        positionsCount: positions.count,
        jobOpeningsCount: jobOpenings.count,
      });
    },
  });
}
