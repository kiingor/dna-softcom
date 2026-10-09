import { supabase } from "@/integrations/supabase/client";
import { vacationPaidValueSchema } from "../schemas/vacation-payment.schema";

export const VACATION_PAYMENT_STATUSES = ["approved", "in_progress", "completed"];

export async function recordVacationPayment(input: {
  requestId: string;
  companyId: string;
  recordedBy: string;
  paidValue: number;
}) {
  const paidValue = vacationPaidValueSchema.parse(input.paidValue);
  const { data, error } = await supabase
    .from("vacation_requests")
    .update({ paid_value: paidValue, paid_by: input.recordedBy })
    .eq("id", input.requestId)
    .eq("company_id", input.companyId)
    .in("status", VACATION_PAYMENT_STATUSES)
    .select("id, collaborator_id, paid_value, paid_by")
    .single();

  // Zero linhas também é falha: a solicitação pode ter sido cancelada ou o
  // usuário pode ter perdido a permissão desde que abriu o formulário.
  if (error || !data) {
    throw new Error("Não foi possível salvar o valor pago. Atualize a solicitação e tente novamente.");
  }
  return data;
}
