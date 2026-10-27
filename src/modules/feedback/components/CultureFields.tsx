import type { UseFormReturn } from "react-hook-form";
import { Link } from "react-router-dom";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { useFeedbackOptions } from "../hooks/use-feedback-settings";
import type { ObjetivoFormValues } from "../schemas/objetivo.schema";
import type { Objetivo } from "../types";

export function CultureFields({ form, open, initial, prefix }: {
  form: UseFormReturn<ObjetivoFormValues>; open: boolean; initial?: Objetivo | null; prefix: string;
}) {
  const tipo = form.watch("tipo");
  const campanhaId = form.watch("campanhaId");
  const culturaId = form.watch("culturaId");
  const { canView: canConfigure } = usePermissions("configuracoes");
  const query = useFeedbackOptions(open && tipo === "Cultura");
  if (tipo !== "Cultura") return null;

  const fields = [
    { key: "campanhaId" as const, label: "Campanha", value: campanhaId, previous: initial?.campanhaId, options: query.data?.campaigns ?? [] },
    { key: "culturaId" as const, label: "Cultura", value: culturaId, previous: initial?.culturaId, options: query.data?.cultures ?? [] },
  ];
  return (
    <div className="space-y-5">
      {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando campanhas e culturas…</p>}
      {query.isError && <div role="alert" className="text-sm text-destructive">
        Não foi possível carregar as opções.
        <Button type="button" variant="link" onClick={() => query.refetch()}>Tentar novamente</Button>
      </div>}
      {fields.map((field) => {
        const available = field.options.filter((option) => option.is_active || option.id === field.previous);
        return <div key={field.key} className="space-y-2">
          <Label htmlFor={`${prefix}-${field.key}`}>{field.label} <span aria-hidden="true">*</span></Label>
          <Select value={field.value ?? ""} onValueChange={(value) => form.setValue(field.key, value, { shouldValidate: true })}
            disabled={query.isLoading || query.isError || available.length === 0}>
            <SelectTrigger id={`${prefix}-${field.key}`} aria-required="true">
              <SelectValue placeholder={`Selecione a ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {available.map((option) => <SelectItem key={option.id} value={option.id}>
                {option.name}{!option.is_active ? " (inativa)" : ""}
              </SelectItem>)}
            </SelectContent>
          </Select>
          {form.formState.errors[field.key] && <p role="alert" className="text-sm text-destructive">{form.formState.errors[field.key]?.message}</p>}
          {query.isSuccess && available.length === 0 && <p className="text-xs text-muted-foreground">
            Nenhuma {field.label.toLowerCase()} ativa. {canConfigure
              ? <Link className="text-primary underline" to="/dashboard/configuracoes?tab=feedback">Cadastrar nas configurações</Link>
              : "Peça ao responsável pelas configurações para cadastrar uma opção."}
          </p>}
        </div>;
      })}
    </div>
  );
}
