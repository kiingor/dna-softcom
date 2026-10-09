import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CircleNotch } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { VacationRequest } from "@/hooks/useVacations";
import { useRecordVacationPayment } from "../hooks/use-record-vacation-payment";
import { vacationPaymentSchema } from "../schemas/vacation-payment.schema";

type Props = {
  request: VacationRequest;
  onClose: () => void;
};

export function VacationPaymentDialog({ request, onClose }: Props) {
  const save = useRecordVacationPayment();
  const form = useForm<z.input<typeof vacationPaymentSchema>>({
    resolver: zodResolver(vacationPaymentSchema, undefined, { raw: true }),
    defaultValues: {
      paidValue: request.paid_value == null ? "" : request.paid_value.toLocaleString("pt-BR", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }),
    },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const { paidValue } = vacationPaymentSchema.parse(values);
      await save.mutateAsync({ requestId: request.id, companyId: request.company_id, paidValue });
      toast.success("Valor pago salvo.");
      onClose();
    } catch (error) {
      form.setError("root", { message: error instanceof Error ? error.message : "Não foi possível salvar o valor pago." });
    }
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{request.paid_value == null ? "Registrar valor pago" : "Editar valor pago"}</DialogTitle>
          <DialogDescription>
            Informe o total pago nas férias de {request.collaborator?.name || "este colaborador"} nesta solicitação.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-6">
            <FormField control={form.control} name="paidValue" render={({ field }) => (
              <FormItem>
                <FormLabel>Valor pago (R$)</FormLabel>
                <FormControl>
                  <Input {...field} inputMode="decimal" placeholder="0,00" autoComplete="off" className="mono" disabled={save.isPending} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <CircleNotch className="mr-2 h-4 w-4 animate-spin" />}
                {save.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
