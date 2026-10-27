import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CircleNotch as Loader2 } from "@phosphor-icons/react";
import { objetivoSchema, type ObjetivoFormValues } from "../schemas/objetivo.schema";
import { OBJETIVO_TIPOS, type Objetivo } from "../types";
import { CultureFields } from "./CultureFields";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = modo edição. */
  initial?: Objetivo | null;
  /** Nome do Guardião que vai lançar (mostrado no modo criar). */
  guardiaoName?: string | null;
  onSubmit: (values: ObjetivoFormValues) => Promise<void> | void;
  isSubmitting?: boolean;
}

export function ObjetivoForm({
  open,
  onOpenChange,
  initial,
  guardiaoName,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = !!initial;

  const form = useForm<ObjetivoFormValues>({
    resolver: zodResolver(objetivoSchema),
    defaultValues: { tipo: "", comentario: "", mostrarSuporte: false, campanhaId: "", culturaId: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset(
        initial
          ? {
              tipo: initial.tipo ?? "",
              comentario: initial.comentario ?? "",
              mostrarSuporte: initial.mostrarSuporte,
              campanhaId: initial.campanhaId ?? "",
              culturaId: initial.culturaId ?? "",
            }
          : { tipo: "", comentario: "", mostrarSuporte: false, campanhaId: "", culturaId: "" },
      );
    }
  }, [open, initial, form]);

  // Preserva um tipo legado (ex: "META") que não está nas opções fixas.
  const extraTipo =
    initial?.tipo && !OBJETIVO_TIPOS.some((t) => t.value === initial.tipo)
      ? initial.tipo
      : null;

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
  });

  const tipo = form.watch("tipo");
  const mostrarSuporte = form.watch("mostrarSuporte");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar feedback" : "Novo feedback"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Será sincronizado com a agenda (api.softcom.cloud)."
              : guardiaoName
                ? `Lançado por ${guardiaoName}. Será sincronizado com a agenda.`
                : "Será sincronizado com a agenda (api.softcom.cloud)."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => form.setValue("tipo", v, { shouldValidate: true })}>
              <SelectTrigger id="tipo">
                <SelectValue placeholder="Selecione o tipo de feedback" />
              </SelectTrigger>
              <SelectContent>
                {OBJETIVO_TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
                {extraTipo && <SelectItem value={extraTipo}>{extraTipo}</SelectItem>}
              </SelectContent>
            </Select>
            {form.formState.errors.tipo && (
              <p className="text-sm text-destructive">{form.formState.errors.tipo.message}</p>
            )}
          </div>

          <CultureFields form={form} open={open} initial={initial} prefix="editar" />

          <div className="space-y-2">
            <Label htmlFor="comentario">Comentário</Label>
            <Textarea
              id="comentario"
              {...form.register("comentario")}
              placeholder="O que você quer registrar?"
              rows={4}
            />
            {form.formState.errors.comentario && (
              <p className="text-sm text-destructive">{form.formState.errors.comentario.message}</p>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="mostrarSuporte">Exibir para o colaborador</Label>
              <p className="text-xs text-muted-foreground">
                Se ligado, o colaborador vê esse feedback no portal.
              </p>
            </div>
            <Switch
              id="mostrarSuporte"
              checked={mostrarSuporte}
              onCheckedChange={(v) => form.setValue("mostrarSuporte", v)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? "Salvar" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
