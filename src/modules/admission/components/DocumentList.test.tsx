import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentList } from "./DocumentList";
import type { AdmissionDocument } from "../types";

const mocks = vi.hoisted(() => ({
  documents: [] as AdmissionDocument[],
  from: vi.fn(),
  createSignedUrl: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: mocks.from } },
}));
vi.mock("../hooks/use-admission-documents", () => ({
  useAdmissionDocuments: () => ({
    documents: mocks.documents,
    isLoading: false,
    approveDocument: { mutate: vi.fn(), isPending: false },
    rejectDocument: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const filePath = "company/journey/rg.pdf";
const signedUrl = `https://api.example.test/storage/v1/object/sign/admission-docs/${filePath}?token=test-token`;

function makeDocument(overrides: Partial<AdmissionDocument> = {}): AdmissionDocument {
  return {
    id: "document",
    company_id: "company",
    journey_id: "journey",
    doc_type: "rg",
    required: true,
    status: "approved",
    file_url: filePath,
    file_name: "rg.pdf",
    text_response: null,
    notes: null,
    rejection_reason: null,
    reviewer_id: null,
    reviewed_at: null,
    uploaded_at: null,
    ai_confidence: null,
    ai_validation_result: null,
    created_at: "2026-09-15T12:00:00Z",
    updated_at: "2026-09-15T12:00:00Z",
    ...overrides,
  };
}

describe("visualização dos documentos de admissão", () => {
  let documentWindow: {
    opener: Window | null;
    closed: boolean;
    location: { replace: ReturnType<typeof vi.fn> };
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.documents = [makeDocument()];
    mocks.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl }, error: null });
    documentWindow = {
      opener: window,
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(documentWindow as unknown as Window);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(["rg.pdf", "foto.jpg", "atestado_exame.pdf"])(
    "abre %s pelo Storage privado mesmo em admissão aprovada",
    async (filename) => {
      const path = `company/journey/${filename}`;
      const url = signedUrl.replace(filePath, path);
      mocks.documents = [makeDocument({ file_url: path, file_name: filename })];
      mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: url }, error: null });
      render(<DocumentList journeyId="journey" canManage={false} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Ver RG" }));

      await waitFor(() => expect(documentWindow.location.replace).toHaveBeenCalledWith(url));
      expect(mocks.from).toHaveBeenCalledWith("admission-docs");
      expect(mocks.createSignedUrl).toHaveBeenCalledWith(path, 300);
      expect(documentWindow.opener).toBeNull();
      expect(mocks.toastError).not.toHaveBeenCalled();
    },
  );

  it("abre a aba durante o clique e impede novo pedido enquanto assina", async () => {
    let resolveUrl!: (value: { data: { signedUrl: string }; error: null }) => void;
    mocks.createSignedUrl.mockReturnValue(new Promise((resolve) => { resolveUrl = resolve; }));
    render(<DocumentList journeyId="journey" canManage={false} />);
    const button = screen.getByRole("button", { name: "Ver RG" });

    fireEvent.click(button);

    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Abrindo...");
    expect(documentWindow.location.replace).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);

    await act(async () => resolveUrl({ data: { signedUrl }, error: null }));
    expect(button).toBeEnabled();
    expect(documentWindow.location.replace).toHaveBeenCalledWith(signedUrl);
  });

  it.each([
    { data: null, error: { message: "Object not found" } },
    { data: null, error: { message: "Access denied" } },
    { data: null, error: null },
  ])("fecha a aba e permite tentar novamente quando não consegue gerar o link (%j)", async (result) => {
    mocks.createSignedUrl.mockResolvedValueOnce(result);
    render(<DocumentList journeyId="journey" canManage={false} />);
    const button = screen.getByRole("button", { name: "Ver RG" });

    fireEvent.click(button);

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Não consegui abrir o documento. Tente novamente.",
    ));
    expect(documentWindow.close).toHaveBeenCalledOnce();
    expect(documentWindow.location.replace).not.toHaveBeenCalled();
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(documentWindow.location.replace).toHaveBeenCalledWith(signedUrl));
  });

  it("trata falha de rede sem abrir uma rota inválida", async () => {
    mocks.createSignedUrl.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<DocumentList journeyId="journey" canManage={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver RG" }));

    await waitFor(() => expect(documentWindow.close).toHaveBeenCalledOnce());
    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(documentWindow.location.replace).not.toHaveBeenCalled();
  });

  it("solicita um link novo a cada abertura, sem reutilizar links expirados", async () => {
    render(<DocumentList journeyId="journey" canManage={false} />);
    const button = screen.getByRole("button", { name: "Ver RG" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());

    const renewedUrl = signedUrl.replace("test-token", "renewed-token");
    mocks.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: renewedUrl }, error: null });
    fireEvent.click(button);

    await waitFor(() => expect(documentWindow.location.replace).toHaveBeenLastCalledWith(renewedUrl));
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("avisa quando o navegador bloqueia a nova aba", () => {
    vi.mocked(window.open).mockReturnValueOnce(null);
    render(<DocumentList journeyId="journey" canManage={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver RG" }));

    expect(mocks.toastError).toHaveBeenCalledWith("Permita pop-ups para visualizar o documento.");
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ver RG" })).toBeEnabled();
  });

  it("não oferece visualização quando nenhum arquivo foi enviado", () => {
    mocks.documents = [makeDocument({ status: "pending", file_url: null })];
    render(<DocumentList journeyId="journey" canManage={false} />);

    expect(screen.queryByRole("button", { name: "Ver RG" })).not.toBeInTheDocument();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});
