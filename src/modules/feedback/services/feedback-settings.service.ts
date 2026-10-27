import { supabase } from "@/integrations/supabase/client";
import type { FeedbackOption, FeedbackOptionKind, FeedbackOptions } from "../types";
import { feedbackOptionSchema } from "../schemas/feedback-option.schema";

const tableFor = (kind: FeedbackOptionKind) => kind === "campaign" ? "feedback_campaigns" : "feedback_cultures";

export const feedbackSettingsService = {
  async list(companyId: string): Promise<FeedbackOptions> {
    const [campaigns, cultures] = await Promise.all([
      supabase.from("feedback_campaigns").select("id, name, is_active").eq("company_id", companyId).order("name"),
      supabase.from("feedback_cultures").select("id, name, is_active").eq("company_id", companyId).order("name"),
    ]);
    if (campaigns.error || cultures.error) throw new Error("Não foi possível carregar as opções de feedback.");
    return { campaigns: campaigns.data ?? [], cultures: cultures.data ?? [] };
  },

  async save(companyId: string, kind: FeedbackOptionKind, input: { id?: string; name: string; is_active: boolean }): Promise<FeedbackOption> {
    const { name } = feedbackOptionSchema.parse(input);
    const payload = { name, is_active: input.is_active };
    const table = tableFor(kind);
    const query = input.id
      ? supabase.from(table).update(payload).eq("company_id", companyId).eq("id", input.id)
      : supabase.from(table).insert({ company_id: companyId, ...payload });
    const { data, error } = await query.select("id, name, is_active").single();
    if (error) {
      if (error.code === "23505") throw new Error("Já existe uma opção com esse nome, inclusive entre as inativas.");
      throw new Error("Não foi possível salvar. Confira sua permissão e tente novamente.");
    }
    return data;
  },
};
