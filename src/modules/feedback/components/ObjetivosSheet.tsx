import { useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  PencilSimple,
  Trash,
  Eye,
  EyeSlash,
  ChatCircleText,
  CircleNotch as Loader2,
} from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ObjetivoForm } from "./ObjetivoForm";
import { useObjetivos, useObjetivoMutations, useLancadorNames } from "../hooks/use-feedbacks";
import { fmtDate } from "../lib";
import type { FeedbackColaborador, Guardiao, Objetivo } from "../types";
import type { ObjetivoFormValues } from "../schemas/objetivo.schema";

interface Props {
  colaborador: FeedbackColaborador | null;
  guardiao: Guardiao | null;
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
  onOpenChange: (open: boolean) => void;
}

export function ObjetivosSheet({ colaborador, guardiao, perms, onOpenChange }: Props) {
  const colaboradorId = colaborador?.id ?? null;
  const { data: objetivos = [], isLoading, isError, refetch } = useObjetivos(colaboradorId);
  const lancadorNames = useLancadorNames(objetivos.map((o) => o.lancamentoUsuarioId));
  const { create, update, remove } = useObjetivoMutations(colaboradorId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Objetivo | null>(null);
  const [deleting, setDeleting] = useState<Objetivo | null>(null);

  const canCreate = perms.canCreate && !!guardiao;

  const openCreate = () => {
    if (!guardiao) {
      toast.error("Selecione o Guardião(ã) da Cultura primeiro.");
      return;
    }
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (o: Objetivo) => {
    setEditing(o);
    setFormOpen(true);
  };

  const handleSubmit = async (values: ObjetivoFormValues) => {
    if (editing) {
      await update.mutateAsync({
        itemId: editing.id,
        tipo: values.tipo,
        comentario: values.comentario,
        mostrarSuporte: values.mostrarSuporte,
        campanhaId: values.campanhaId,
        culturaId: values.culturaId,
      });
    } else {
      if (!guardiao) {
        toast.error("Selecione o Guardião(ã) da Cultura primeiro.");
        return;
      }
      await create.mutateAsync({
        lancamentoUsuarioId: guardiao.id,
        tipo: values.tipo,
        comentario: values.comentario,
        mostrarSuporte: values.mostrarSuporte,
        campanhaId: values.campanhaId,
        culturaId: values.culturaId,
      });
    }
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <>
      <Sheet open={!!colaborador} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="p-6 pb-4 border-b">
            <SheetTitle className="truncate">
              {colaborador?.nome ?? (colaboradorId ? `#${colaboradorId}` : "Colaborador")}
            </SheetTitle>
            <SheetDescription>
              Feedbacks e objetivos registrados pra esse colaborador.
            </SheetDescription>
          </SheetHeader>

          <div className="px-6 py-3 border-b">
            {perms.canCreate && !guardiao && (
              <p className="text-xs text-warning dark:text-warning mb-2">
                Selecione o Guardião(ã) da Cultura no topo pra poder registrar.
              </p>
            )}
            <Button size="sm" onClick={openCreate} disabled={!canCreate} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Novo feedback
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : isError ? (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground mb-3">
                  Algo não foi bem aqui. Tenta de novo?
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Recarregar
                </Button>
              </div>
            ) : objetivos.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <ChatCircleText className="w-7 h-7 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">Nenhum feedback ainda</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {canCreate
                    ? "Bora registrar o primeiro?"
                    : "Selecione o Guardião pra registrar o primeiro."}
                </p>
              </div>
            ) : (
              objetivos.map((o) => (
                <div key={o.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {o.tipo && (
                        <Badge variant="secondary" className="shrink-0">
                          {o.tipo}
                        </Badge>
                      )}
                      <span
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                        title={o.mostrarSuporte ? "Visível ao colaborador" : "Oculto do colaborador"}
                      >
                        {o.mostrarSuporte ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeSlash className="w-3.5 h-3.5" />
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {perms.canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(o)}
                          title="Editar"
                        >
                          <PencilSimple className="w-4 h-4" />
                        </Button>
                      )}
                      {perms.canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleting(o)}
                          title="Remover"
                        >
                          <Trash className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {o.tipo === "Cultura" && (
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      {o.campanhaNome && <p>Campanha: {o.campanhaNome}</p>}
                      {o.culturaNome && <p>Cultura: {o.culturaNome}</p>}
                      {!o.origemPainel && (!o.campanhaId || !o.culturaId) && <p className="text-warning">Campanha e cultura ainda não definidas.</p>}
                    </div>
                  )}
                  {o.origemPainel && (
                    <div className="mt-2 rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1 break-words">
                      <p className="font-medium text-foreground">Enviado pelo painel do colaborador</p>
                      {o.origemPainel.campanhaNome && <p>Campanha do envio: {o.origemPainel.campanhaNome}</p>}
                      {o.origemPainel.culturaNome && <p>Cultura do envio: {o.origemPainel.culturaNome}</p>}
                      {o.origemPainel.percentual != null && <p>Índice na ocasião: <span className="mono">{o.origemPainel.percentual}%</span></p>}
                      {o.origemPainel.objetivo && <p className="whitespace-pre-wrap break-words">Objetivo: {o.origemPainel.objetivo}</p>}
                      {o.origemPainel.prazo && <p>Data combinada: <span className="mono">{fmtDate(o.origemPainel.prazo)}</span></p>}
                    </div>
                  )}
                  {o.comentario && (
                    <p className="text-sm text-foreground mt-2 whitespace-pre-wrap break-words">
                      {o.comentario}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {fmtDate(o.datas)} · por{" "}
                    {lancadorNames.get(o.lancamentoUsuarioId) ??
                      (o.lancamentoUsuarioId > 0 ? `#${o.lancamentoUsuarioId}` : "Sistema")}
                  </p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ObjetivoForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        guardiaoName={guardiao?.nome ?? null}
        onSubmit={handleSubmit}
        isSubmitting={create.isPending || update.isPending}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover feedback?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai sumir aqui e também na agenda. Não dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/15"
              onClick={async () => {
                if (deleting) {
                  await remove.mutateAsync(deleting.id);
                  setDeleting(null);
                }
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
