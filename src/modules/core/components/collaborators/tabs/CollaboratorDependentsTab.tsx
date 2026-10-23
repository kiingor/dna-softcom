import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AGENDA_SYNC_DISABLED } from "@/lib/agenda-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash, Pencil, CircleNotch as Loader2, Users } from "@phosphor-icons/react";
import { toast } from "sonner";
import { formatCPFInput } from "@/lib/validators";
import { EmptyState } from "@/shared/components/EmptyState";
import { TabContentSkeleton } from "@/shared/components/TabContentSkeleton";

interface Props {
  collaboratorId: string;
  companyId: string;
  canEdit: boolean;
}

interface Dependent {
  id: string;
  name: string;
  birth_date: string | null;
  cpf: string | null;
  kinship: string;
  is_irpf_dependent: boolean;
  is_health_plan_dependent: boolean;
  is_invalid: boolean;
  notes: string | null;
}

const KINSHIP_LABELS: Record<string, string> = {
  filho: "Filho(a)",
  enteado: "Enteado(a)",
  tutelado: "Tutelado(a)",
  conjuge: "Cônjuge",
  companheiro: "Companheiro(a)",
  pai: "Pai",
  mae: "Mãe",
  irmao: "Irmão/Irmã",
  avô: "Avô/Avó",
  neto: "Neto(a)",
  outro: "Outro",
};

export function CollaboratorDependentsTab({
  collaboratorId,
  companyId,
  canEdit,
}: Props) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  /** id do dependente em edição; null = adicionando um novo. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    birth_date: "",
    cpf: "",
    kinship: "filho",
    // Padrão: dependente cadastrado já conta pro IRPF (desmarque se não for).
    // O trigger sync_irpf_dependents_count atualiza o dependents_count da folha.
    is_irpf_dependent: true,
    is_health_plan_dependent: false,
    is_invalid: false,
  });

  const EMPTY_FORM = {
    name: "",
    birth_date: "",
    cpf: "",
    kinship: "filho",
    is_irpf_dependent: false,
    is_health_plan_dependent: false,
    is_invalid: false,
  };
  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsOpen(true);
  };
  const openEdit = (d: Dependent) => {
    setEditingId(d.id);
    setForm({
      name: d.name ?? "",
      birth_date: d.birth_date ?? "",
      cpf: d.cpf ? formatCPFInput(d.cpf) : "",
      kinship: d.kinship ?? "filho",
      is_irpf_dependent: d.is_irpf_dependent,
      is_health_plan_dependent: d.is_health_plan_dependent,
      is_invalid: d.is_invalid,
    });
    setIsOpen(true);
  };
  const closeDialog = () => {
    setIsOpen(false);
    setEditingId(null);
  };

  const { data: dependents = [], isLoading } = useQuery({
    queryKey: ["collaborator-dependents", collaboratorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborator_dependents")
        .select("*")
        .eq("collaborator_id", collaboratorId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Dependent[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Mutations vão via edge function collaborator-subresource (PUSH → agenda → local).
  // Flags is_irpf_dependent e is_health_plan_dependent são INTERNAS do DNA Softcom
  // (não existem na agenda), aplicadas em UPDATE separado depois da criação remota.
  //
  // Tratamento de erro: supabase.functions.invoke mascarara o body em non-2xx
  // como "Edge Function returned a non-2xx status code". Pra ver o real,
  // lemos error.context (que é o Response) e extraímos o JSON.
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("collaborator-subresource", {
        body: {
          action: "create",
          kind: "parentes",
          collaboratorId,
          data: {
            name: form.name.trim(),
            birth_date: form.birth_date || null,
            cpf: form.cpf.replace(/\D/g, "") || null,
            kinship: form.kinship,
            is_invalid: form.is_invalid,
          },
        },
      });
      if (error) {
        const detail = await extractFnErrorDetail(error);
        throw new Error(detail);
      }
      if (data && typeof data === "object" && "error" in data) {
        const err = data as { error: string; details?: string };
        throw new Error(err.details ? `${err.error}: ${err.details}` : err.error);
      }
      // Campos LOCAL-ONLY (não existem na agenda): patch direto após o
      // edge function persistir o registro espelho via fromRemote.
      //   - is_irpf_dependent, is_health_plan_dependent: flags do DNA
      //   - is_invalid: pra regra de salário-família (filho inválido)
      const localId = (data as { localId?: string })?.localId;
      const localOnlyUpdates: Record<string, unknown> = {};
      if (form.is_irpf_dependent) localOnlyUpdates.is_irpf_dependent = true;
      if (form.is_health_plan_dependent) localOnlyUpdates.is_health_plan_dependent = true;
      if (form.is_invalid) localOnlyUpdates.is_invalid = true;
      if (localId && Object.keys(localOnlyUpdates).length > 0) {
        await supabase
          .from("collaborator_dependents")
          .update(localOnlyUpdates)
          .eq("id", localId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collaborator-dependents", collaboratorId],
      });
      queryClient.invalidateQueries({ queryKey: ["collaborator", collaboratorId] });
      setIsOpen(false);
      setForm({
        name: "",
        birth_date: "",
        cpf: "",
        kinship: "filho",
        is_irpf_dependent: false,
        is_health_plan_dependent: false,
        is_invalid: false,
      });
      toast.success(
        AGENDA_SYNC_DISABLED
          ? "Dependente adicionado ✓"
          : "Dependente adicionado ✓ (sincronizado com a agenda)",
      );
    },
    onError: (err: Error) => toast.error("Não rolou. " + err.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      // Campos da agenda (nome, nascimento, CPF, parentesco) via edge function
      // (PUSH → agenda → local). As flags do DNA (IRPF/plano/inválido) não
      // existem na agenda — vão num UPDATE local direto, sempre setando o valor
      // (true OU false), diferente do create que só liga as true.
      const { data, error } = await supabase.functions.invoke("collaborator-subresource", {
        body: {
          action: "update",
          kind: "parentes",
          collaboratorId,
          localId: editingId,
          data: {
            name: form.name.trim(),
            birth_date: form.birth_date || null,
            cpf: form.cpf.replace(/\D/g, "") || null,
            kinship: form.kinship,
          },
        },
      });
      if (error) {
        const detail = await extractFnErrorDetail(error);
        throw new Error(detail);
      }
      if (data && typeof data === "object" && "error" in data) {
        const err = data as { error: string; details?: string };
        throw new Error(err.details ? `${err.error}: ${err.details}` : err.error);
      }
      const { error: localErr } = await supabase
        .from("collaborator_dependents")
        .update({
          is_irpf_dependent: form.is_irpf_dependent,
          is_health_plan_dependent: form.is_health_plan_dependent,
          is_invalid: form.is_invalid,
        })
        .eq("id", editingId);
      if (localErr) throw new Error(localErr.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collaborator-dependents", collaboratorId],
      });
      queryClient.invalidateQueries({ queryKey: ["collaborator", collaboratorId] });
      setIsOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast.success(
        AGENDA_SYNC_DISABLED
          ? "Dependente atualizado ✓"
          : "Dependente atualizado ✓ (sincronizado com a agenda)",
      );
    },
    onError: (err: Error) => toast.error("Não rolou. " + err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("collaborator-subresource", {
        body: {
          action: "delete",
          kind: "parentes",
          collaboratorId,
          localId: id,
        },
      });
      if (error) {
        const detail = await extractFnErrorDetail(error);
        throw new Error(detail);
      }
      if (data && typeof data === "object" && "error" in data) {
        const err = data as { error: string; details?: string };
        throw new Error(err.details ? `${err.error}: ${err.details}` : err.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["collaborator-dependents", collaboratorId],
      });
      queryClient.invalidateQueries({ queryKey: ["collaborator", collaboratorId] });
      toast.success(
        AGENDA_SYNC_DISABLED ? "Removido ✓" : "Removido ✓ (sincronizado com a agenda)",
      );
    },
    onError: (err: Error) => toast.error("Não rolou. " + err.message),
  });

  if (isLoading) {
    return <TabContentSkeleton rows={3} />;
  }

  return (
    <div className="space-y-3">
      {dependents.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Dependentes legais e familiares. Quem é dependente para IRPF afeta o
            cálculo da folha automaticamente.
          </p>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" />
              Adicionar
            </Button>
          )}
        </div>
      )}

      {dependents.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8 text-primary" />}
          title="Sem dependentes por aqui"
          description="Cadastra dependentes legais e familiares. Quem é IRPF afeta o cálculo da folha automaticamente."
          action={
            canEdit && (
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Adicionar dependente
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {dependents.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{d.name}</p>
                    <Badge variant="outline" >
                      {KINSHIP_LABELS[d.kinship] ?? d.kinship}
                    </Badge>
                    {d.is_irpf_dependent && (
                      <Badge className="bg-success/10 text-success dark:bg-success/15 dark:text-success border-0">
                        IRPF
                      </Badge>
                    )}
                    {d.is_health_plan_dependent && (
                      <Badge className="bg-info/10 text-info dark:bg-info/15 dark:text-info border-0">
                        Plano de Saúde
                      </Badge>
                    )}
                    {d.is_invalid && (
                      <Badge className="bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning border-0">
                        Inválido
                      </Badge>
                    )}
                  </div>
                  {(d.birth_date || d.cpf) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {d.birth_date &&
                        new Date(d.birth_date).toLocaleDateString("pt-BR")}
                      {d.birth_date && d.cpf && " · "}
                      {d.cpf && <span className="font-mono">{d.cpf}</span>}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(d)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Editar dependente"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove.mutate(d.id)}
                      disabled={remove.isPending}
                      className="text-destructive hover:text-destructive"
                      title="Excluir dependente"
                    >
                      <Trash className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar dependente" : "Adicionar dependente"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dep-name">Nome completo *</Label>
              <Input
                id="dep-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dep-birth">Nascimento</Label>
                <Input
                  id="dep-birth"
                  type="date"
                  value={form.birth_date}
                  onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-cpf">CPF</Label>
                <Input
                  id="dep-cpf"
                  value={form.cpf}
                  onChange={(e) =>
                    setForm({ ...form, cpf: formatCPFInput(e.target.value) })
                  }
                  placeholder="000.000.000-00"
                  maxLength={14}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dep-kinship">Parentesco *</Label>
              <Select
                value={form.kinship}
                onValueChange={(v) => setForm({ ...form, kinship: v })}
              >
                <SelectTrigger id="dep-kinship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KINSHIP_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="dep-irpf" className="text-sm font-medium">
                  Dependente IRPF
                </Label>
                <p className="text-xs text-muted-foreground">
                  Inclui na dedução mensal de IRPF na folha.
                </p>
              </div>
              <Switch
                id="dep-irpf"
                checked={form.is_irpf_dependent}
                onCheckedChange={(v) =>
                  setForm({ ...form, is_irpf_dependent: v })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="dep-plan" className="text-sm font-medium">
                  Plano de Saúde
                </Label>
                <p className="text-xs text-muted-foreground">
                  Marca como dependente no plano de saúde.
                </p>
              </div>
              <Switch
                id="dep-plan"
                checked={form.is_health_plan_dependent}
                onCheckedChange={(v) =>
                  setForm({ ...form, is_health_plan_dependent: v })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="dep-invalid" className="text-sm font-medium">
                  Inválido (deficiente)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pra salário-família, inválido tem direito a qualquer idade —
                  não só até 14 anos.
                </p>
              </div>
              <Switch
                id="dep-invalid"
                checked={form.is_invalid}
                onCheckedChange={(v) => setForm({ ...form, is_invalid: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button
              onClick={() => (editingId ? update.mutate() : create.mutate())}
              disabled={
                (editingId ? update.isPending : create.isPending) || !form.name.trim()
              }
            >
              {(editingId ? update.isPending : create.isPending) ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Extrai mensagem útil de um FunctionsHttpError do supabase-js.
 * Default error.message é genérico ("non-2xx status code"); o body real
 * fica em error.context (Response). Lê uma vez e retorna texto formatado.
 */
async function extractFnErrorDetail(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: Response | undefined };
  const fallback = e.message ?? "Falha na chamada.";
  const ctx = e.context;
  if (!ctx || typeof ctx.text !== "function") return fallback;
  try {
    const txt = await ctx.text();
    if (!txt) return fallback;
    try {
      const parsed = JSON.parse(txt) as { error?: string; details?: string };
      if (parsed.error) {
        return parsed.details ? `${parsed.error}: ${parsed.details}` : parsed.error;
      }
    } catch {
      // body não é JSON — retorna texto bruto
    }
    return txt.slice(0, 300);
  } catch {
    return fallback;
  }
}
