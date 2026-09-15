import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  RISK_GROUP_PERIODICITY_LABELS,
  EXAMS_BY_RISK_GROUP,
} from "@/lib/riskGroupDefaults";
import { Stethoscope, Upload, Check } from "@phosphor-icons/react";
import { RejectDocDialog } from "../components/RejectDocDialog";
import type { AdmissionDocument } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import {
  ArrowLeft,
  Copy,
  ArrowsClockwise as RefreshCw,
  CircleNotch as Loader2,
  Trophy,
  XCircle,
  EnvelopeSimple as Mail,
  WhatsappLogo,
  DotsThreeVertical,
  Trash,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDashboard } from "@/contexts/DashboardContext";
import {
  useAdmissionJourney,
  useAdmissionJourneys,
  buildCandidateFormUrl,
} from "../hooks/use-admission-journeys";
import { useAdmissionDocuments } from "../hooks/use-admission-documents";
import { AdmissionStatusBadge } from "../components/AdmissionStatusBadge";
import { DocumentList } from "../components/DocumentList";
import { ViewAdmissionDocumentButton } from "../components/ViewAdmissionDocumentButton";
import { AdmissionTimeline } from "../components/AdmissionTimeline";
import { TestsSection } from "../components/TestsSection";
import { REGIME_LABELS, type AdmissionJourneyStatus } from "../types";
import CollaboratorModal, {
  type CollaboratorPrefill,
} from "@/modules/core/components/collaborators/CollaboratorModal";
import { formatPhoneInput, formatCEPInput, formatCPFInput } from "@/lib/validators";

export default function AdmissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyRole } = useDashboard();
  const canManage = hasAnyRole(["admin_gc", "gestor_gc"]);

  const { data: journey, isLoading } = useAdmissionJourney(id);
  const { documents } = useAdmissionDocuments(id);
  const {
    updateStatus,
    regenerateToken,
    sendTokenEmail,
    sendTokenWhatsApp,
    deleteJourney,
  } = useAdmissionJourneys();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  const [confirmAction, setConfirmAction] = useState<
    "cancel" | "admit" | null
  >(null);

  // Cargo pra mostrar info de exames ocupacionais (risk_group → periodicidade)
  const { data: position } = useQuery({
    queryKey: ["admission-position", journey?.position_id],
    queryFn: async () => {
      if (!journey?.position_id) return null;
      const { data } = await supabase
        .from("positions")
        .select("name, risk_group, exam_periodicity_months")
        .eq("id", journey.position_id)
        .maybeSingle();
      return data as {
        name: string;
        risk_group: string | null;
        exam_periodicity_months: number | null;
      } | null;
    },
    enabled: !!journey?.position_id,
  });

  // Docs de exame (atestado_exame). Cada exame específico é identificado
  // pelo prefixo `EXAM:slug — label` no campo notes.
  const examDocs = useMemo(
    () => documents.filter((d) => d.doc_type === "atestado_exame"),
    [documents],
  );

  function parseExamLabel(notes: string | null): { slug: string | null; label: string } {
    if (!notes || !notes.startsWith("EXAM:")) {
      return { slug: null, label: "Atestado de exame admissional" };
    }
    const rest = notes.slice("EXAM:".length);
    const sep = rest.indexOf(" — ");
    if (sep === -1) return { slug: rest, label: rest };
    return { slug: rest.slice(0, sep), label: rest.slice(sep + 3) };
  }

  const docsStats = useMemo(() => {
    const total = documents.length;
    const approved = documents.filter((d) => d.status === "approved").length;
    const pending = documents.filter(
      (d) => d.status === "pending" || d.status === "submitted"
    ).length;
    const needsAdjustment = documents.filter(
      (d) => d.status === "needs_adjustment"
    ).length;
    return { total, approved, pending, needsAdjustment };
  }, [documents]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!journey) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">Admissão não encontrada.</p>
        <Button asChild variant="outline">
          <Link to="/dashboard/admissoes">Voltar pra lista</Link>
        </Button>
      </div>
    );
  }

  const candidateUrl = buildCandidateFormUrl(journey.access_token);
  const tokenExpired =
    journey.token_expires_at && new Date(journey.token_expires_at) < new Date();

  const handleCopy = () => {
    navigator.clipboard
      .writeText(candidateUrl)
      .then(() => toast.success("Link copiado ✓"))
      .catch(() => toast.error("Não rolou copiar."));
  };

  const handleStatusChange = (status: AdmissionJourneyStatus, message?: string) => {
    updateStatus.mutate({ id: journey.id, status, message });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/dashboard/admissoes">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Admissões
          </Link>
        </Button>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {journey.candidate_name}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <AdmissionStatusBadge status={journey.status} />
              <span className="text-sm text-muted-foreground">
                {REGIME_LABELS[journey.regime]}
              </span>
              {journey.candidate_email && (
                <span className="text-sm text-muted-foreground">
                  · {journey.candidate_email}
                </span>
              )}
            </div>
          </div>

          {/* Ações */}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {journey.status !== "admitted" &&
                journey.status !== "cancelled" && (
                  <Button
                    onClick={() => setApproveOpen(true)}
                    className="bg-primary hover:bg-primary/15"
                    disabled={
                      !(
                        docsStats.approved === docsStats.total &&
                        docsStats.total > 0
                      )
                    }
                    title={
                      docsStats.approved === docsStats.total &&
                      docsStats.total > 0
                        ? "Aprovar e cadastrar como colaborador"
                        : "Aprove todos os documentos antes"
                    }
                  >
                    <Trophy className="w-4 h-4 mr-2" />
                    Aprovar e cadastrar
                  </Button>
                )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Mais ações">
                    <DotsThreeVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {journey.status !== "admitted" &&
                    journey.status !== "cancelled" && (
                      <DropdownMenuItem onClick={() => setConfirmAction("cancel")}>
                        <XCircle className="w-4 h-4 mr-2" />
                        Cancelar admissão
                      </DropdownMenuItem>
                    )}
                  <DropdownMenuItem
                    onClick={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash className="w-4 h-4 mr-2" />
                    Excluir admissão
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {/* Link público pro candidato */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link pro candidato preencher</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
              {candidateUrl}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="w-4 h-4 mr-2" />
              Copiar
            </Button>
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Mais ações">
                    <DotsThreeVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {journey.candidate_email && (
                    <DropdownMenuItem
                      onClick={() => sendTokenEmail.mutate(journey.id)}
                      disabled={sendTokenEmail.isPending || !!tokenExpired}
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Enviar por email
                    </DropdownMenuItem>
                  )}
                  {journey.candidate_phone && (
                    <DropdownMenuItem
                      onClick={() => sendTokenWhatsApp.mutate(journey.id)}
                      disabled={sendTokenWhatsApp.isPending || !!tokenExpired}
                    >
                      <WhatsappLogo className="w-4 h-4 mr-2" />
                      Enviar por WhatsApp
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => regenerateToken.mutate(journey.id)}
                    disabled={regenerateToken.isPending}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerar link
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {tokenExpired ? (
              <span className="text-destructive">
                Link expirado em{" "}
                {new Date(journey.token_expires_at!).toLocaleDateString("pt-BR")}.
                Regenera pra reativar.
              </span>
            ) : journey.token_expires_at ? (
              <>
                Válido até{" "}
                {new Date(journey.token_expires_at).toLocaleDateString("pt-BR")}.
              </>
            ) : (
              "Sem expiração."
            )}
          </p>
          {!journey.candidate_email && canManage && (
            <p className="text-xs text-muted-foreground mt-1">
              Pra mandar por email, cadastra o email do candidato primeiro.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stats inline — pílulas compactas em vez de 4 cards grandes */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-muted-foreground">
          <strong className="text-foreground">{docsStats.total}</strong> docs
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/5 text-success dark:bg-success/15 dark:text-success">
          <strong>{docsStats.approved}</strong> aprovados
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-info/5 text-info dark:bg-info/15 dark:text-info">
          <strong>{docsStats.pending}</strong> pendentes
        </span>
        {docsStats.needsAdjustment > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning/5 text-warning dark:bg-warning/15 dark:text-warning">
            <strong>{docsStats.needsAdjustment}</strong> precisam ajuste
          </span>
        )}
      </div>

      {/* Layout 2 colunas: docs à esquerda (mais espaço), dados+timeline na sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Testes saíram da Admissão e foram para Recrutamento (vagas).
              Mantido aqui apenas para journeys legadas que ainda estão em
              tests_pending — em produção a maioria já avançou. */}
          {(journey.status === "tests_pending" ||
            journey.status === "tests_in_review") && (
            <TestsSection
              journeyId={journey.id}
              journeyStatus={journey.status}
              canManage={canManage}
            />
          )}

          {/* Documentos (sem exames) */}
          <Card>
            <CardHeader>
              <CardTitle>Documentos (Etapa 2)</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentList
                journeyId={journey.id}
                canManage={canManage}
                excludeExams
              />
            </CardContent>
          </Card>

          {/* Exames ocupacionais */}
          {(position?.risk_group || examDocs.length > 0) && (
            <ExamsCard
              journeyId={journey.id}
              position={position}
              examDocs={examDocs}
              canManage={canManage}
              parseExamLabel={parseExamLabel}
            />
          )}

          {/* Notas internas */}
          {journey.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Observações internas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {journey.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: dados do candidato + timeline */}
        <div className="space-y-6">
          {/* Dados do candidato — tudo que ele preencheu */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do candidato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <CandidateDataField
                label="Email"
                value={journey.candidate_email}
              />
              <CandidateDataField
                label="Telefone"
                value={
                  journey.candidate_phone
                    ? formatPhoneInput(journey.candidate_phone)
                    : null
                }
              />
              <CandidateDataField
                label="CPF"
                value={
                  journey.candidate_cpf
                    ? formatCPFInput(journey.candidate_cpf)
                    : null
                }
              />
              <CandidateDataField
                label="RG"
                value={(journey as { candidate_rg?: string | null }).candidate_rg ?? null}
              />
              <CandidateDataField
                label="Nascimento"
                value={
                  (journey as { candidate_birth_date?: string | null }).candidate_birth_date
                    ? new Date(
                        (journey as { candidate_birth_date: string }).candidate_birth_date,
                      ).toLocaleDateString("pt-BR", { timeZone: "UTC" })
                    : null
                }
              />

              <div className="pt-2 border-t border-border">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  Endereço
                </p>
                <CandidateDataField
                  label="CEP"
                  value={
                    (journey as { candidate_zip?: string | null }).candidate_zip
                      ? formatCEPInput(
                          (journey as { candidate_zip: string }).candidate_zip,
                        )
                      : null
                  }
                />
                <CandidateDataField
                  label="Logradouro"
                  value={
                    (journey as { candidate_address?: string | null })
                      .candidate_address ?? null
                  }
                />
                <CandidateDataField
                  label="Número"
                  value={
                    (journey as { candidate_address_number?: string | null })
                      .candidate_address_number ?? null
                  }
                />
                <CandidateDataField
                  label="Complemento"
                  value={
                    (journey as { candidate_address_complement?: string | null })
                      .candidate_address_complement ?? null
                  }
                />
                <CandidateDataField
                  label="Bairro"
                  value={
                    (journey as { candidate_neighborhood?: string | null })
                      .candidate_neighborhood ?? null
                  }
                />
                <CandidateDataField
                  label="Cidade"
                  value={
                    (journey as { candidate_city?: string | null })
                      .candidate_city ?? null
                  }
                />
                <CandidateDataField
                  label="UF"
                  value={
                    (journey as { candidate_state?: string | null })
                      .candidate_state ?? null
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Timeline com altura limitada e scroll interno */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Histórico</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] overflow-y-auto pr-1">
              <AdmissionTimeline
                journeyId={journey.id}
                canAddNote={canManage}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirma ações destrutivas */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "cancel"
                ? "Cancelar admissão?"
                : "Confirmar admissão?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "cancel"
                ? "O processo será encerrado. Documentos enviados ficam preservados, mas o candidato não consegue mais acessar o link."
                : `${journey.candidate_name} será admitido. Essa ação registra o evento e atualiza o status. Após admitir, o RH ainda precisa cadastrar o colaborador no sistema (passo manual nesta versão).`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction === "cancel") {
                  handleStatusChange("cancelled", "Admissão cancelada");
                  navigate("/dashboard/admissoes");
                } else if (confirmAction === "admit") {
                  handleStatusChange("admitted", `${journey.candidate_name} admitido`);
                }
                setConfirmAction(null);
              }}
              className={
                confirmAction === "cancel"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary hover:bg-primary/15"
              }
            >
              {confirmAction === "cancel" ? "Cancelar admissão" : "Admitir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir admissão?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove a admissão de{" "}
              <strong>{journey.candidate_name}</strong> e todos os documentos
              enviados. O link público vira inválido. Não dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteJourney.mutateAsync(journey.id);
                navigate("/dashboard/admissoes");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal "Novo colaborador" pré-preenchido com dados da admissão.
          Após salvar, marca a journey como admitted e linka o collaborator_id. */}
      <CollaboratorModal
        open={approveOpen}
        onOpenChange={setApproveOpen}
        prefill={{
          name: journey.candidate_name,
          cpf: journey.candidate_cpf
            ? formatCPFInput(journey.candidate_cpf)
            : "",
          rg: journey.candidate_rg ?? "",
          email: journey.candidate_email ?? "",
          phone: journey.candidate_phone
            ? formatPhoneInput(journey.candidate_phone)
            : "",
          birth_date: journey.candidate_birth_date ?? "",
          regime: journey.regime,
          position_id: journey.position_id ?? "",
          address: journey.candidate_address ?? "",
          district: journey.candidate_neighborhood ?? "",
          city: journey.candidate_city ?? "",
          state: journey.candidate_state ?? "",
          postal_code: journey.candidate_zip
            ? formatCEPInput(journey.candidate_zip)
            : "",
        }}
        onSuccess={async (newCollabId) => {
          if (!newCollabId) return;
          // Marca journey como admitted + linka collaborator
          try {
            await supabase
              .from("admission_journeys")
              .update({
                status: "admitted",
                collaborator_id: newCollabId,
              })
              .eq("id", journey.id);
            await supabase.from("admission_events").insert({
              company_id: journey.company_id,
              journey_id: journey.id,
              kind: "admitted",
              message: `${journey.candidate_name} foi admitido como colaborador.`,
            });
            toast.success("Admissão concluída ✓");
            navigate(`/dashboard/colaboradores`);
          } catch (err) {
            toast.error(
              "Colaborador criado, mas não rolou marcar admissão como concluída. " +
                (err as Error).message,
            );
          }
        }}
      />
    </div>
  );
}

function CandidateDataField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 text-foreground break-words">
        {value && value.trim().length > 0 ? (
          value
        ) : (
          <span className="text-muted-foreground italic">—</span>
        )}
      </span>
    </div>
  );
}

interface ExamsCardProps {
  journeyId: string;
  position: {
    name: string;
    risk_group: string | null;
    exam_periodicity_months: number | null;
  } | null;
  examDocs: AdmissionDocument[];
  canManage: boolean;
  parseExamLabel: (notes: string | null) => { slug: string | null; label: string };
}

function ExamsCard({
  journeyId,
  position,
  examDocs,
  canManage,
  parseExamLabel,
}: ExamsCardProps) {
  const { uploadDocFile, createExamDoc, approveDocument, rejectDocument } =
    useAdmissionDocuments(journeyId);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [rejectingExam, setRejectingExam] = useState<AdmissionDocument | null>(null);
  const backfilledRef = useRef(false);

  // Backfill: pra admissões antigas (criadas antes da feature de exames
  // automáticos), gera os rows de admission_documents pros exames esperados
  // do grupo de risco. Roda uma vez por mount, idempotente — pula se já
  // existem rows pros slugs.
  useEffect(() => {
    if (backfilledRef.current) return;
    if (!canManage) return;
    if (!position?.risk_group) return;
    const expected = EXAMS_BY_RISK_GROUP[position.risk_group] ?? [];
    if (expected.length === 0) return;

    const existingSlugs = new Set<string>();
    for (const d of examDocs) {
      if (d.notes?.startsWith("EXAM:")) {
        const slug = d.notes.slice("EXAM:".length).split(" — ")[0];
        existingSlugs.add(slug);
      }
    }
    const missing = expected.filter((e) => !existingSlugs.has(e.slug));
    if (missing.length === 0) return;

    backfilledRef.current = true;
    Promise.all(
      missing.map((e) =>
        createExamDoc.mutateAsync({ slug: e.slug, label: e.label }),
      ),
    ).catch((err) => {
      console.warn("[admission] backfill de exames falhou:", err);
      backfilledRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.risk_group, examDocs.length, canManage]);

  // Recebe slug+label pra lazy-create se ainda não tem doc; ou só id se já tem
  const handleFileSelect = async (
    args: {
      doc: AdmissionDocument | undefined;
      slug?: string;
      label?: string;
    },
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const key = args.doc?.id ?? args.slug ?? "?";
    setUploadingKey(key);
    try {
      let docId = args.doc?.id;
      if (!docId) {
        if (!args.slug || !args.label) throw new Error("Sem slug/label");
        const created = await createExamDoc.mutateAsync({
          slug: args.slug,
          label: args.label,
        });
        docId = created.id;
      }
      await uploadDocFile.mutateAsync({ documentId: docId, file });
    } finally {
      setUploadingKey(null);
      e.target.value = "";
    }
  };

  // Lista esperada do grupo de risco (pra mostrar mesmo se ainda não tem rows)
  const expectedExams = position?.risk_group
    ? EXAMS_BY_RISK_GROUP[position.risk_group] ?? []
    : [];

  // Mapa dos docs por slug do exame
  const docBySlug = new Map<string, AdmissionDocument>();
  const legacyDocs: AdmissionDocument[] = [];
  for (const d of examDocs) {
    const { slug } = parseExamLabel(d.notes);
    if (slug) docBySlug.set(slug, d);
    else legacyDocs.push(d);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="w-4 h-4 text-primary" />
          Exames ocupacionais
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {position?.risk_group && (
          <div className="rounded-lg border p-3 bg-muted/30 text-xs text-muted-foreground">
            Cargo <strong>{position.name}</strong> · Grupo{" "}
            {position.risk_group} ·{" "}
            {RISK_GROUP_PERIODICITY_LABELS[position.risk_group]}
          </div>
        )}

        {expectedExams.length === 0 && examDocs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Cargo sem grupo de risco definido — sem exames padrão.
          </p>
        )}

        {/* Lista por exame esperado, casando com doc se existir */}
        {expectedExams.map((exam) => {
          const doc = docBySlug.get(exam.slug);
          return (
            <ExamRow
              key={exam.slug}
              label={exam.label}
              doc={doc}
              canManage={canManage}
              uploading={uploadingKey === (doc?.id ?? exam.slug)}
              onUpload={(e) =>
                handleFileSelect(
                  { doc, slug: exam.slug, label: exam.label },
                  e,
                )
              }
              onApprove={
                doc ? () => approveDocument.mutate(doc.id) : undefined
              }
              onReject={doc ? () => setRejectingExam(doc) : undefined}
            />
          );
        })}

        {/* Atestados antigos sem slug (legacy) */}
        {legacyDocs.map((doc) => (
          <ExamRow
            key={doc.id}
            label="Atestado de exame admissional"
            doc={doc}
            canManage={canManage}
            uploading={uploadingKey === doc.id}
            onUpload={(e) => handleFileSelect({ doc }, e)}
            onApprove={() => approveDocument.mutate(doc.id)}
            onReject={() => setRejectingExam(doc)}
          />
        ))}
      </CardContent>

      <RejectDocDialog
        open={!!rejectingExam}
        onOpenChange={(o) => !o && setRejectingExam(null)}
        docLabel={
          rejectingExam
            ? parseExamLabel(rejectingExam.notes).label
            : ""
        }
        onSubmit={async (values) => {
          if (!rejectingExam) return;
          await rejectDocument.mutateAsync({
            documentId: rejectingExam.id,
            values,
          });
          setRejectingExam(null);
        }}
        isSubmitting={rejectDocument.isPending}
      />
    </Card>
  );
}

function ExamRow({
  label,
  doc,
  canManage,
  uploading,
  onUpload,
  onApprove,
  onReject,
}: {
  label: string;
  doc: AdmissionDocument | undefined;
  canManage: boolean;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = doc?.status ?? "pending";
  const statusLabel =
    status === "approved"
      ? "Aprovado"
      : status === "needs_adjustment"
      ? "Pedindo ajuste"
      : status === "submitted"
      ? "Enviado"
      : "Pendente";

  const statusColor =
    status === "approved"
      ? "text-success dark:text-success"
      : status === "needs_adjustment"
      ? "text-warning dark:text-warning"
      : status === "submitted"
      ? "text-info dark:text-info"
      : "text-muted-foreground";

  const isSubmittedOrAdjust =
    status === "submitted" || status === "needs_adjustment";

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className={`text-xs ${statusColor}`}>{statusLabel}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0 flex-wrap">
        {doc?.file_url && (
          <ViewAdmissionDocumentButton filePath={doc.file_url} documentLabel={label} />
        )}
        {canManage && status !== "approved" && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={onUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-4 h-4 mr-1" />
              {uploading
                ? "Enviando..."
                : doc?.file_url
                ? "Trocar"
                : "Anexar"}
            </Button>
          </>
        )}
        {canManage && doc && isSubmittedOrAdjust && onApprove && (
          <Button variant="outline" size="sm" onClick={onApprove}>
            <Check className="w-4 h-4 mr-1" />
            Aprovar
          </Button>
        )}
        {canManage && doc && isSubmittedOrAdjust && onReject && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            className="text-primary border-primary/25 hover:bg-primary/15 dark:text-primary dark:border-primary/25"
          >
            Pedir ajuste
          </Button>
        )}
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "orange";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p
          className={`text-2xl font-light mt-1 ${
            accent === "emerald"
              ? "text-primary dark:text-primary"
              : accent === "orange"
              ? "text-primary dark:text-primary"
              : "text-foreground"
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
