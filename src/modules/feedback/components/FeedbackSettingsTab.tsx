import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleNotch, PencilSimple, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/hooks/usePermissions";
import { useDashboard } from "@/contexts/DashboardContext";
import { useFeedbackOptions, useFeedbackOptionMutation } from "../hooks/use-feedback-settings";
import { feedbackOptionSchema, type FeedbackOptionValues } from "../schemas/feedback-option.schema";
import type { FeedbackOption, FeedbackOptionKind } from "../types";

function OptionPanel({ kind, options, canCreate, canEdit }: {
  kind: FeedbackOptionKind; options: FeedbackOption[]; canCreate: boolean; canEdit: boolean;
}) {
  const isCampaign = kind === "campaign";
  const singular = isCampaign ? "campanha" : "cultura";
  const [dialog, setDialog] = useState<{ item: FeedbackOption | null } | null>(null);
  const mutation = useFeedbackOptionMutation(kind);
  const form = useForm<FeedbackOptionValues>({ resolver: zodResolver(feedbackOptionSchema), defaultValues: { name: "" } });
  const open = (item: FeedbackOption | null) => {
    form.reset({ name: item?.name ?? "" });
    setDialog({ item });
  };
  const save = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({ id: dialog?.item?.id, name: values.name, is_active: dialog?.item?.is_active ?? true });
      setDialog(null);
    } catch { /* O hook apresenta o erro; mantém o formulário preenchido. */ }
  });

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>{isCampaign ? "Campanhas" : "Culturas"}</CardTitle>
          {canCreate && <Button size="sm" variant="outline" onClick={() => open(null)}>
            <Plus className="mr-2 h-4 w-4" />Nova {singular}
          </Button>}
        </div>
        <CardDescription>{isCampaign ? "Ações e iniciativas associadas aos feedbacks." : "Valores e comportamentos que você quer reconhecer."}</CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma {singular} cadastrada.</p>
        ) : (
          <ul className="divide-y">
            {options.map((option) => (
              <li key={option.id} className="flex items-center justify-between gap-3 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{option.name}</p>
                  <Badge variant="outline" className={option.is_active ? "mt-1 text-success" : "mt-1 text-muted-foreground"}>
                    {option.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                {canEdit && <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="ghost" aria-label={`Editar ${singular} ${option.name}`} onClick={() => open(option)} disabled={mutation.isPending}>
                    <PencilSimple className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={mutation.isPending}
                    aria-label={`${option.is_active ? "Desativar" : "Reativar"} ${singular} ${option.name}`}
                    onClick={() => mutation.mutate({ ...option, is_active: !option.is_active })}>
                    {option.is_active ? "Desativar" : "Reativar"}
                  </Button>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!dialog} onOpenChange={(value) => { if (!value && !mutation.isPending) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog?.item ? "Editar" : "Nova"} {singular}</DialogTitle>
            <DialogDescription>Esta opção ficará disponível nos feedbacks do tipo Cultura.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="min-w-0 space-y-5">
            <div className="space-y-2">
              <Label htmlFor={`feedback-${kind}-name`}>Nome da {singular}</Label>
              <Input id={`feedback-${kind}-name`} {...form.register("name")} maxLength={100} autoFocus />
              {form.formState.errors.name && <p role="alert" className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setDialog(null)}>Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <CircleNotch className="mr-2 h-4 w-4 animate-spin" />}Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function FeedbackSettingsTab() {
  const { currentCompany } = useDashboard();
  const { canView, canCreate, canEdit } = usePermissions("configuracoes");
  const query = useFeedbackOptions(canView);
  if (!canView) return null;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Configurações de feedback</h2>
        <p className="text-sm text-muted-foreground mt-1">Cadastre as campanhas e culturas usadas pelo time. Opções desativadas permanecem nos feedbacks anteriores e deixam de aparecer em novos registros.</p>
      </div>
      {query.isLoading ? <p role="status" className="text-sm text-muted-foreground">Carregando configurações…</p>
        : query.isError ? <div role="alert" className="space-y-3">
          <p className="text-sm text-destructive">Não foi possível carregar as configurações.</p>
          <Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
        : <div className="grid gap-5 xl:grid-cols-2" key={currentCompany?.id}>
          <OptionPanel kind="campaign" options={query.data?.campaigns ?? []} canCreate={canCreate} canEdit={canEdit} />
          <OptionPanel kind="culture" options={query.data?.cultures ?? []} canCreate={canCreate} canEdit={canEdit} />
        </div>}
    </div>
  );
}
