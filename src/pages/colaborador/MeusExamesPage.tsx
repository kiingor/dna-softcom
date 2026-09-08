import { usePortal } from "@/contexts/PortalContext";
import { useCollaboratorExams, useExamDocuments } from "@/hooks/useExams";
import { EXAM_TYPE_LABELS, EXAM_STATUS_LABELS, EXAM_STATUS_COLORS } from "@/lib/riskGroupDefaults";
import { getExamStatus } from "@/lib/examStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClipboardText as ClipboardCheck, Download, FileText } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const MeusExamesPage = () => {
  const { collaborator } = usePortal();
  const { exams, isLoading } = useCollaboratorExams(collaborator?.id);

  const examIds = exams.map((e) => e.id);
  const { data: allDocs = [] } = useQuery({
    queryKey: ["my-exam-docs", examIds],
    queryFn: async () => {
      if (examIds.length === 0) return [];
      const { data, error } = await supabase
        .from("exam_documents")
        .select("*")
        .in("exam_id", examIds)
        .order("version", { ascending: false });
      if (error) return [];
      return data;
    },
    enabled: examIds.length > 0,
  });

  const docsByExam = allDocs.reduce((acc, doc) => {
    if (!acc[doc.exam_id]) acc[doc.exam_id] = [];
    acc[doc.exam_id].push(doc);
    return acc;
  }, {} as Record<string, typeof allDocs>);

  const handleDownload = async (fileUrl: string) => {
    const path = fileUrl.split("/exam-documents/")[1];
    if (path) {
      const { data } = await supabase.storage.from("exam-documents").createSignedUrl(path, 60);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Meus Exames</h1>
        <p className="text-muted-foreground">Histórico de exames ocupacionais e documentos ASO</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : exams.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <ClipboardCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum exame registrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {exams.map((exam) => {
            const docs = docsByExam[exam.id] || [];
            const status = getExamStatus(exam);

            return (
              <Card key={exam.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{EXAM_TYPE_LABELS[exam.exam_type] || exam.exam_type}</span>
                        <Badge variant={EXAM_STATUS_COLORS[status]} >
                          {EXAM_STATUS_LABELS[status] || status}
                        </Badge>
                      </div>
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>Limite: {format(parseISO(exam.due_date), "dd/MM/yyyy")}</span>
                        {exam.completed_date && <span>Realizado: {format(parseISO(exam.completed_date), "dd/MM/yyyy")}</span>}
                      </div>
                    </div>
                  </div>

                  {docs.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Documentos ASO</p>
                      {docs.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="text-sm truncate">{doc.file_name}</p>
                              <p className="text-xs text-muted-foreground">v{doc.version} • {new Date(doc.uploaded_at).toLocaleDateString("pt-BR")}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => handleDownload(doc.file_url)}>
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MeusExamesPage;
