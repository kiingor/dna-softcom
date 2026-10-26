import { act, cleanup, render, screen } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentList } from "../components/DocumentList";
import { useAdmissionEvents } from "./use-admission-events";
import { useAdmissionJourney, useAdmissionJourneys } from "./use-admission-journeys";
import type { AdmissionDocument } from "../types";

const backend = vi.hoisted(() => ({
  from: vi.fn(),
  documents: [] as AdmissionDocument[],
  status: "docs_pending",
  events: [] as { id: string; kind: string }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: backend.from },
}));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({ currentCompany: { id: "company" } }),
}));

function AdmissionView() {
  const journey = useAdmissionJourney("journey");
  const { journeys } = useAdmissionJourneys();
  const { events } = useAdmissionEvents("journey");
  return (
    <>
      <output aria-label="Situação da admissão">{journey.data?.status}</output>
      <output aria-label="Situação na lista">{journeys[0]?.status}</output>
      <output aria-label="Eventos recebidos">{events.length}</output>
      <DocumentList journeyId="journey" canManage={false} />
    </>
  );
}

describe("envios do candidato atualizam o painel aberto", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    client = new QueryClient({
      defaultOptions: {
        queries: {
          // Mesmos defaults da aplicação que mantinham o painel desatualizado.
          staleTime: 5 * 60_000,
          refetchOnWindowFocus: false,
          retry: false,
          gcTime: Infinity,
        },
      },
    });
    backend.status = "docs_pending";
    backend.events = [];
    backend.documents = [{
      id: "document",
      company_id: "company",
      journey_id: "journey",
      doc_type: "rg",
      required: true,
      status: "pending",
      file_url: null,
      file_name: null,
      text_response: null,
      notes: null,
      rejection_reason: null,
      reviewer_id: null,
      reviewed_at: null,
      uploaded_at: null,
      ai_confidence: null,
      ai_validation_result: null,
      created_at: "2026-01-01T12:00:00Z",
      updated_at: "2026-01-01T12:00:00Z",
    }];
    backend.from.mockReset();
    backend.from.mockImplementation((table: string) => {
      const rows = () => {
        if (table === "admission_documents") return backend.documents;
        if (table === "admission_events") return backend.events;
        if (table === "admission_journeys") {
          return [{ id: "journey", company_id: "company", status: backend.status }];
        }
        throw new Error(`Tabela inesperada: ${table}`);
      };
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: rows(), error: null }),
        single: async () => ({ data: rows()[0], error: null }),
      };
      return query;
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  async function openPanel() {
    const view = render(
      <QueryClientProvider client={client}><AdmissionView /></QueryClientProvider>,
    );
    await advance(10);
    return view;
  }

  function candidateUploadsDocument() {
    backend.documents = backend.documents.map((doc) => ({
      ...doc,
      status: "submitted",
      file_url: "company/journey/rg.pdf",
      file_name: "rg.pdf",
      uploaded_at: "2026-01-01T12:01:00Z",
    }));
    backend.status = "docs_in_review";
    backend.events = [{ id: "event", kind: "docs_submitted" }];
  }

  function expectSubmissionVisible() {
    expect(screen.getByRole("button", { name: "Ver RG" })).toBeInTheDocument();
    expect(screen.getByLabelText("Situação da admissão")).toHaveTextContent("docs_in_review");
    expect(screen.getByLabelText("Situação na lista")).toHaveTextContent("docs_in_review");
    expect(screen.getByLabelText("Eventos recebidos")).toHaveTextContent("1");
  }

  it("mostra o arquivo, o novo status e o evento sem recarregar a página", async () => {
    await openPanel();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver RG" })).not.toBeInTheDocument();

    candidateUploadsDocument();
    await advance(15_000);

    expectSubmissionVisible();
  });

  it("busca os envios ao voltar à aba mesmo dentro dos cinco minutos do cache global", async () => {
    await openPanel();
    focusManager.setFocused(false);
    candidateUploadsDocument();
    await advance(1_000);

    focusManager.setFocused(true);
    await advance(10);

    expectSubmissionVisible();
  });

  it("atualiza ao reabrir a admissão sem aguardar o cache global expirar", async () => {
    const view = await openPanel();
    view.unmount();
    candidateUploadsDocument();
    await advance(1_000);

    await openPanel();

    expectSubmissionVisible();
  });

  it("pausa consultas periódicas enquanto a aba está oculta e retoma ao voltar", async () => {
    await openPanel();
    focusManager.setFocused(false);
    backend.from.mockClear();
    candidateUploadsDocument();

    await advance(30_000);

    expect(backend.from).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Ver RG" })).not.toBeInTheDocument();
    focusManager.setFocused(true);
    await advance(10);
    expectSubmissionVisible();
  });
});
