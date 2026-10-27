import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { SoftcomCloudError } from "../_shared/softcom-cloud.ts";

type Selection = { campaign_id: string; culture_id: string };
type Classification = Selection & {
  agenda_objective_id: number;
  campaign: { name: string };
  culture: { name: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida tudo antes de escrever na Agenda. IDs locais nunca são enviados ao legado. */
export async function prepareClassification(
  db: SupabaseClient,
  companyId: string,
  collaboratorId: number,
  input: Record<string, unknown>,
  itemId?: number,
): Promise<{ agendaData: Record<string, unknown>; selection: Selection | null | undefined }> {
  const { campanhaId, culturaId, ...agendaData } = input;
  if (input.tipo !== "Cultura") {
    return { agendaData, selection: input.tipo === undefined ? undefined : null };
  }
  if (typeof campanhaId !== "string" || !UUID.test(campanhaId) ||
    typeof culturaId !== "string" || !UUID.test(culturaId)) {
    throw new SoftcomCloudError(400, "Escolha a campanha e a cultura.");
  }

  let previous: Selection | null = null;
  if (itemId) {
    const { data, error } = await db.from("feedback_classifications")
      .select("campaign_id, culture_id").eq("company_id", companyId)
      .eq("agenda_collaborator_id", collaboratorId).eq("agenda_objective_id", itemId).maybeSingle();
    if (error) throw new Error("Não foi possível conferir a classificação anterior.");
    previous = data;
  }
  const choices = [
    { table: "feedback_campaigns", id: campanhaId, old: previous?.campaign_id, label: "campanha" },
    { table: "feedback_cultures", id: culturaId, old: previous?.culture_id, label: "cultura" },
  ];
  for (const choice of choices) {
    const { data, error } = await db.from(choice.table).select("id, is_active")
      .eq("company_id", companyId).eq("id", choice.id).maybeSingle();
    if (error) throw new Error("Não foi possível conferir as opções de feedback.");
    // Uma opção desativada continua válida no registro que já a utilizava.
    if (!data || (!data.is_active && choice.old !== choice.id)) {
      throw new SoftcomCloudError(400, `Escolha uma ${choice.label} ativa nas configurações desta empresa.`);
    }
  }
  return { agendaData, selection: { campaign_id: campanhaId, culture_id: culturaId } };
}

/**
 * A Agenda já confirmou a escrita. Falha local deve ser explícita e não devolver
 * erro de criação que induza o usuário a repetir o POST e duplicar o feedback.
 * O vínculo é idempotente: tentar novamente via edição atualiza o mesmo item.
 */
export async function saveClassification(
  db: SupabaseClient,
  companyId: string,
  collaboratorId: number,
  itemId: number,
  userId: string,
  selection: Selection | null | undefined,
): Promise<string | undefined> {
  if (selection === undefined) return;
  try {
    const result = selection
      ? await db.from("feedback_classifications").upsert({
        company_id: companyId, agenda_objective_id: itemId,
        agenda_collaborator_id: collaboratorId, updated_by: userId, ...selection,
      }, { onConflict: "company_id,agenda_objective_id" })
      : await db.from("feedback_classifications").delete().eq("company_id", companyId)
        .eq("agenda_collaborator_id", collaboratorId).eq("agenda_objective_id", itemId);
    if (result.error) throw result.error;
  } catch {
    return "O feedback foi salvo na Agenda, mas a campanha e a cultura não foram atualizadas. Abra a edição desse feedback para salvar essas opções novamente.";
  }
}

export async function enrichClassifications<T extends { id: number; tipo: string | null }>(
  db: SupabaseClient,
  companyId: string,
  collaboratorId: number,
  items: T[],
) {
  const ids = items.filter((item) => item.tipo === "Cultura").map((item) => item.id);
  const classifications = new Map<number, Classification>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await db.from("feedback_classifications")
      .select("agenda_objective_id, campaign_id, culture_id, campaign:feedback_campaigns!feedback_classifications_campaign_fk(name), culture:feedback_cultures!feedback_classifications_culture_fk(name)")
      .eq("company_id", companyId).eq("agenda_collaborator_id", collaboratorId)
      .in("agenda_objective_id", ids.slice(offset, offset + 200));
    if (error) throw new Error("Não foi possível carregar as campanhas e culturas dos feedbacks.");
    for (const row of (data ?? []) as unknown as Classification[]) {
      classifications.set(Number(row.agenda_objective_id), row);
    }
  }
  return items.map((item) => {
    const row = item.tipo === "Cultura" ? classifications.get(item.id) : undefined;
    return {
      ...item, campanhaId: row?.campaign_id ?? null, campanhaNome: row?.campaign?.name ?? null,
      culturaId: row?.culture_id ?? null, culturaNome: row?.culture?.name ?? null,
    };
  });
}
