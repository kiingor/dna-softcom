import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDashboard } from "@/contexts/DashboardContext";
import { feedbackSettingsService } from "../services/feedback-settings.service";
import type { FeedbackOptionKind } from "../types";

export function useFeedbackOptions(enabled = true) {
  const { currentCompany } = useDashboard();
  const companyId = currentCompany?.id;
  return useQuery({
    queryKey: ["feedback-options", companyId],
    queryFn: () => feedbackSettingsService.list(companyId!),
    enabled: !!companyId && enabled,
  });
}

export function useFeedbackOptionMutation(kind: FeedbackOptionKind) {
  const { currentCompany } = useDashboard();
  const companyId = currentCompany?.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; name: string; is_active: boolean }) => {
      if (!companyId) throw new Error("Selecione uma empresa.");
      return feedbackSettingsService.save(companyId, kind, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback-options", companyId] });
      queryClient.invalidateQueries({ queryKey: ["objetivos", companyId] });
      toast.success("Configuração salva.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
