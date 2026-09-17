import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye } from "@phosphor-icons/react";
import { useCvViewer } from "@/modules/recruitment/hooks/use-cv-viewer";
import type { CandidateMatch } from "../types";
export function CandidateMatchCard({
  candidate,
  rank,
}: {
  candidate: CandidateMatch;
  rank: number;
}) {
  const { openCv, isOpening } = useCvViewer();
  if (!candidate.is_active) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h3 className="font-semibold">
          <span className="mr-2 text-xs text-muted-foreground">#{rank}</span>
          {candidate.name}
        </h3>
        {candidate.reason ? (
          <p className="text-sm">{candidate.reason}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {candidate.cv_summary?.slice(0, 300) ??
              "Resumo ainda não disponível."}
          </p>
        )}
        {!!candidate.evidence?.length && (
          <div className="text-sm">
            <p className="font-medium">Evidências no currículo</p>
            <ul className="list-disc space-y-1 pl-4">
              {candidate.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {!!candidate.gaps?.length && (
          <div className="text-sm">
            <p className="font-medium">Pontos a confirmar</p>
            <ul className="list-disc space-y-1 pl-4">
              {candidate.gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
          </div>
        )}
        {candidate.cv_url && (
          <Button
            variant="outline"
            size="sm"
            disabled={isOpening}
            onClick={() => openCv(candidate.cv_url!)}
          >
            <Eye className="mr-2 h-4 w-4" />
            Ver currículo
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
