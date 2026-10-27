import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { User, CircleNotch as Loader2 } from "@phosphor-icons/react";
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
import { GuardiaoSelect } from "./GuardiaoSelect";
import { CultureFields } from "./CultureFields";
import { objetivoSchema, type ObjetivoFormValues } from "../schemas/objetivo.schema";
import { OBJETIVO_TIPOS, type Guardiao } from "../types";
import { useObjetivoMutations } from "../hooks/use-feedbacks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Guardião(ã) que lança — vem da seleção no topo (obrigatório pra criar). */
  guardiao: Guardiao | null;
}

export function NovoFeedbackDialog({ open, onOpenChange, guardiao }: Props) {
  const [colaborador, setColaborador] = useState<Guardiao | null>(null);
  const { create } = useObjetivoMutations(colaborador?.id ?? null);

  const form = useForm<ObjetivoFormValues>({
    resolver: zodResolver(objetivoSchema),
    defaultValues: { tipo: "", comentario: "", mostrarSuporte: false, campanhaId: "", culturaId: "" },
  });

  useEffect(() => {
    if (open) {
      setColaborador(null);
      form.reset({ tipo: "", comentario: "", mostrarSuporte: false, campanhaId: "", culturaId: "" });
    }
  }, [open, form]);

  const tipo = form.watch("tipo");
  const mostrarSuporte = form.watch("mostrarSuporte");

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!guardiao) {
      toast.error("Selecione o Guardião(ã) da Cultura primeiro.");
      return;
    }
    if (!colaborador) {
      toast.error("Escolha o colaborador.");
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
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo feedback</DialogTitle>
          <DialogDescription>
            {guardiao
              ? `Lançado por ${guardiao.nome}. Será sincronizado com a agenda.`
              : "Será sincronizado com a agenda (api.softcom.cloud)."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label>Colaborador</Label>
            <GuardiaoSelect
              value={colaborador}
              onChange={setColaborador}
              placeholder="Selecionar colaborador"
              icon={<User className="h-4 w-4 shrink-0 text-muted-foreground" />}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">Quem vai receber o feedback.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="novo-tipo">Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => form.setValue("tipo", v, { shouldValidate: true })}
            >
              <SelectTrigger id="novo-tipo">
                <SelectValue placeholder="Selecione o tipo de feedback" />
              </SelectTrigger>
              <SelectContent>
                {OBJETIVO_TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.tipo && (
              <p className="text-sm text-destructive">{form.formState.errors.tipo.message}</p>
            )}
          </div>

          <CultureFields form={form} open={open} prefix="novo" />

          <div className="space-y-2">
            <Label htmlFor="novo-comentario">Comentário</Label>
            <Textarea
              id="novo-comentario"
              {...form.register("comentario")}
              placeholder="O que você quer registrar?"
              rows={4}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="novo-mostrar">Exibir para o colaborador</Label>
              <p className="text-xs text-muted-foreground">
                Se ligado, o colaborador vê esse feedback no portal.
              </p>
            </div>
            <Switch
              id="novo-mostrar"
              checked={mostrarSuporte}
              onCheckedChange={(v) => form.setValue("mostrarSuporte", v)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || !colaborador}>
              {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
