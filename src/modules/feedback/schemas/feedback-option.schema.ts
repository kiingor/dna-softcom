import { z } from "zod";

export const feedbackOptionSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100, "Use até 100 caracteres."),
});
export type FeedbackOptionValues = z.infer<typeof feedbackOptionSchema>;
