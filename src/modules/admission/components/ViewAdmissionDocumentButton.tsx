import { useState } from "react";
import { CircleNotch, Eye } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAdmissionDocumentSignedUrl } from "../services/admission-document.service";

interface ViewAdmissionDocumentButtonProps {
  filePath: string;
  documentLabel: string;
}

export function ViewAdmissionDocumentButton({
  filePath,
  documentLabel,
}: ViewAdmissionDocumentButtonProps) {
  const [isOpening, setIsOpening] = useState(false);

  const handleOpen = async () => {
    // Abre durante o clique para evitar bloqueio de pop-up após a chamada à API.
    const documentWindow = window.open("about:blank", "_blank");
    if (!documentWindow) {
      toast.error("Permita pop-ups para visualizar o documento.");
      return;
    }
    documentWindow.opener = null;

    setIsOpening(true);
    try {
      const url = await getAdmissionDocumentSignedUrl(filePath);
      if (!documentWindow.closed) documentWindow.location.replace(url);
    } catch {
      documentWindow.close();
      toast.error("Não consegui abrir o documento. Tente novamente.");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleOpen}
      disabled={isOpening}
      aria-label={`Ver ${documentLabel}`}
      aria-busy={isOpening}
    >
      {isOpening ? (
        <CircleNotch className="w-4 h-4 mr-1 animate-spin" />
      ) : (
        <Eye className="w-4 h-4 mr-1" />
      )}
      {isOpening ? "Abrindo..." : "Ver"}
    </Button>
  );
}
