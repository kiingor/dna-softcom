import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";
import type { AdmissionEvent } from "../types";
import type { JourneyNoteValues } from "../schemas/admission.schema";

export function useAdmissionEvents(journeyId: string | undefined) {
  const { currentCompany } = useDashboard();
  const queryClient = useQueryClient();
  const companyId = currentCompany?.id;

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["admission-events", journeyId],
    queryFn: async () => {
      if (!journeyId) return [];
      const { data, error } = await supabase
        .from("admission_events")
        .select("*")
        .eq("journey_id", journeyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdmissionEvent[];
    },
    enabled: !!journeyId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const addNote = useMutation({
    mutationFn: async (values: JourneyNoteValues) => {
      if (!companyId || !journeyId) throw new Error("Empresa ou jornada não encontrada");
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("admission_events").insert({
        company_id: companyId,
        journey_id: journeyId,
        kind: "note",
        actor_id: userData?.user?.id ?? null,
        message: values.message,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admission-events"] });
      toast.success("Nota adicionada ✓");
    },
    onError: (err: Error) => {
      toast.error("Não rolou. " + (err.message ?? "Tenta de novo?"));
    },
  });

  return {
    events,
    isLoading,
    addNote,
  };
}
