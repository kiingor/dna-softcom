import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Check,
  Warning,
  CircleNotch as Loader2,
  FileText,
} from "@phosphor-icons/react";
import { useAdmissionDocuments } from "../hooks/use-admission-documents";
import { RejectDocDialog } from "./RejectDocDialog";
import { ViewAdmissionDocumentButton } from "./ViewAdmissionDocumentButton";
import {
  DOCUMENT_STATUS_LABELS,
  getDocumentDisplayLabel,
  type AdmissionDocument,
} from "../types";
import type { RejectDocumentValues } from "../schemas/admission.schema";

interface DocumentListProps {
  journeyId: string;
  canManage: boolean;
  excludeExams?: boolean;
}

export function DocumentList({
  journeyId,
  canManage,
  excludeExams = false,
}: DocumentListProps) {
  const { documents: allDocs, isLoading, approveDocument, rejectDocument } =
    useAdmissionDocuments(journeyId);
  const documents = excludeExams
    ? allDocs.filter((d) => d.doc_type !== "atestado_exame")
    : allDocs;

  const [rejectingDoc, setRejectingDoc] = useState<AdmissionDocument | null>(null);

  const handleReject = async (values: RejectDocumentValues) => {
    if (!rejectingDoc) return;
    await rejectDocument.mutateAsync({
      documentId: rejectingDoc.id,
      values,
    });
    setRejectingDoc(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Nenhum documento cadastrado.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {documents.map((doc) => {
          const docLabel = getDocumentDisplayLabel(doc);
          // Limpa prefixo de tipo antes de extrair observação
          let cleanNotes = doc.notes;
          if (cleanNotes?.startsWith("[TEXTO] ")) cleanNotes = cleanNotes.slice(8);
          else if (cleanNotes?.startsWith("[SIM_NAO] ")) cleanNotes = cleanNotes.slice(10);
          const observation =
            doc.doc_type === "outro" && cleanNotes && cleanNotes.includes(" — ")
              ? cleanNotes.split(" — ").slice(1).join(" — ")
              : doc.doc_type !== "outro"
              ? cleanNotes
              : null;
          const submitted =
            doc.status === "submitted" ||
            doc.status === "ai_validating" ||
            doc.status === "approved" ||
            doc.status === "needs_adjustment";

          return (
            <li key={doc.id} className="py-4 flex items-start gap-3">
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                  doc.status === "approved"
                    ? "bg-primary/10 dark:bg-primary/15"
                    : doc.status === "needs_adjustment"
                    ? "bg-primary/10 dark:bg-primary/15"
                    : "bg-muted"
                )}
              >
                {doc.status === "approved" ? (
                  <Check className="w-4 h-4 text-primary dark:text-primary" />
                ) : doc.status === "needs_adjustment" ? (
                  <Warning className="w-4 h-4 text-primary dark:text-primary" />
                ) : (
                  <FileText className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-medium text-foreground">
                      {docLabel}
                      {doc.required && (
                        <span className="text-destructive ml-1">*</span>
                      )}
                    </p>
                    {observation && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {observation}
                      </p>
                    )}
                    {(doc as { text_response?: string | null }).text_response && (
                      <p className="text-sm text-foreground bg-muted/50 p-2 rounded mt-1.5 whitespace-pre-wrap">
                        {(doc as { text_response: string }).text_response}
                      </p>
                    )}
                    <Badge variant="outline" className="mt-1">
                      {DOCUMENT_STATUS_LABELS[doc.status]}
                    </Badge>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1 shrink-0">
                    {doc.file_url && (
                      <ViewAdmissionDocumentButton
                        filePath={doc.file_url}
                        documentLabel={docLabel}
                      />
                    )}
                    {canManage && submitted && doc.status !== "approved" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => approveDocument.mutate(doc.id)}
                          disabled={approveDocument.isPending}
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Aprovar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRejectingDoc(doc)}
                          className="text-primary border-primary/25 hover:bg-primary/15 dark:text-primary dark:border-primary/25"
                        >
                          Pedir ajuste
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {doc.rejection_reason && doc.status === "needs_adjustment" && (
                  <p className="text-sm text-primary dark:text-primary mt-2 bg-primary/5 dark:bg-primary/15 p-2 rounded">
                    <strong>Motivo:</strong> {doc.rejection_reason}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <RejectDocDialog
        open={!!rejectingDoc}
        onOpenChange={(o) => !o && setRejectingDoc(null)}
        docLabel={rejectingDoc ? getDocumentDisplayLabel(rejectingDoc) : ""}
        onSubmit={handleReject}
        isSubmitting={rejectDocument.isPending}
      />
    </>
  );
}
