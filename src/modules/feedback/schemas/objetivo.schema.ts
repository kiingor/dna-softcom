import { z } from "zod";

export const objetivoSchema = z.object({
  tipo: z.string().min(1, "Escolha o tipo."),
  comentario: z.string().max(2000, "Comentário muito longo.").optional(),
  mostrarSuporte: z.boolean(),
  campanhaId: z.string().optional(),
  culturaId: z.string().optional(),
}).superRefine((values, ctx) => {
  if (values.tipo !== "Cultura") return;
  if (!z.string().uuid().safeParse(values.campanhaId).success) {
    ctx.addIssue({ code: "custom", path: ["campanhaId"], message: "Escolha a campanha." });
  }
  if (!z.string().uuid().safeParse(values.culturaId).success) {
    ctx.addIssue({ code: "custom", path: ["culturaId"], message: "Escolha a cultura." });
  }
});

export type ObjetivoFormValues = z.infer<typeof objetivoSchema>;
