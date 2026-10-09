import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/DashboardContext";
import { usePermissions } from "@/hooks/usePermissions";
import { recordVacationPayment } from "../services/vacation-payment.service";

export function useRecordVacationPayment() {
  const { currentCompany, user, hasAnyRole } = useDashboard();
  const { canEdit, isLoading } = usePermissions("ferias");
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { requestId: string; companyId: string; paidValue: number }) => {
      if (!user?.id || !currentCompany?.id || input.companyId !== currentCompany.id
        || isLoading || !canEdit || !hasAnyRole(["admin_gc", "gestor_gc", "gestor"])) {
        throw new Error("Você não tem permissão para editar esta solicitação.");
      }
      return recordVacationPayment({ ...input, recordedBy: user.id });
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vacation-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["vacation-requests-collaborator", saved.collaborator_id] }),
      ]);
    },
  });
}
