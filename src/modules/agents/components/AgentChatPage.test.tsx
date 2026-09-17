import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import AgentChatPage from "./AgentChatPage";
const state = vi.hoisted(() => ({
  company: { id: "company-a", company_name: "Empresa A" },
  messages: [] as unknown[],
  sessions: [] as unknown[],
  send: vi.fn(),
  archiver: vi.fn(),
  candidates: [] as unknown[],
}));
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({
    user: { id: "user-a" },
    currentCompany: state.company,
  }),
}));
vi.mock("@/components/dashboard/PermissionGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../hooks/use-agent-sessions", () => ({
  useAgentSessions: () => ({
    sessions: state.sessions,
    isLoading: false,
    archiveSession: { mutateAsync: state.archiver },
  }),
  useAgentMessages: () => ({
    data: state.messages,
    isLoading: false,
    isError: false,
  }),
  useMessageCandidates: () => ({ data: state.candidates }),
}));
vi.mock("../services/agent-chat.service", () => ({
  sendAgentMessage: (...args: unknown[]) => state.send(...args),
  rateAgentMessage: vi.fn(),
  ChatError: class extends Error {
    code?: string;
    sessionId?: string;
  },
}));
vi.mock("@/modules/recruitment/hooks/use-cv-viewer", () => ({
  useCvViewer: () => ({ openCv: vi.fn(), isOpening: false }),
}));
let client: QueryClient;
const view = () => (
  <QueryClientProvider client={client}>
    <AgentChatPage kind="recruiter" />
  </QueryClientProvider>
);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.company = { id: "company-a", company_name: "Empresa A" };
  state.messages = [];
  state.sessions = [];
  state.candidates = [];
  state.send.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  client.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const result = {
  success: true,
  sessionId: "session-a",
  assistantMessageId: "answer-a",
  userMessageId: "question-a",
  assistantText: "Resposta útil",
  candidates: [],
  tokens: { input: 1, output: 1 },
};
describe("conversa dos agentes", () => {
  it("mostra o pedido imediatamente e impede duplo envio", async () => {
    const pending = deferred<typeof result>();
    state.send.mockReturnValue(pending.promise);
    render(view());
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "Suporte com SQL" },
    });
    fireEvent.click(screen.getByLabelText("Enviar mensagem"));
    expect(screen.getByText("Suporte com SQL")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toBeDisabled();
    expect(state.send).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(result));
    expect(await screen.findByText("Resposta útil")).toBeInTheDocument();
  });
  it("troca de empresa cancela execução e não exibe resposta antiga", async () => {
    const pending = deferred<typeof result>();
    state.send.mockReturnValue(pending.promise);
    const rendered = render(view());
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "Dados da empresa A" },
    });
    fireEvent.click(screen.getByLabelText("Enviar mensagem"));
    const signal = state.send.mock.calls[0][2];
    state.company = { id: "company-b", company_name: "Empresa B" };
    rendered.rerender(view());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(result));
    expect(screen.queryByText("Resposta útil")).not.toBeInTheDocument();
    expect(screen.getByText("Empresa B")).toBeInTheDocument();
  });
  it("reenvio mantém a chave idempotente e o texto do pedido", async () => {
    state.send
      .mockRejectedValueOnce(new Error("Falha temporária"))
      .mockResolvedValueOnce(result);
    render(view());
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "Compare os candidatos" },
    });
    fireEvent.click(screen.getByLabelText("Enviar mensagem"));
    await screen.findByText("Falha temporária");
    fireEvent.click(screen.getByText("Tentar novamente"));
    await screen.findByText("Resposta útil");
    expect(state.send.mock.calls[1][1].requestId).toBe(
      state.send.mock.calls[0][1].requestId,
    );
    expect(state.send.mock.calls[1][1].query).toBe("Compare os candidatos");
  });
  it("não duplica a mensagem otimista depois que ela aparece no histórico", async () => {
    const pending = deferred<typeof result>();
    state.send.mockImplementation((_kind, _req, _signal, onEvent) => {
      onEvent({
        event: "session",
        data: { sessionId: "s1", userMessageId: "u1" },
      });
      return pending.promise;
    });
    const rendered = render(view());
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "Suporte SQL" },
    });
    fireEvent.click(screen.getByLabelText("Enviar mensagem"));
    state.messages = [
      {
        id: "u1",
        role: "user",
        content: "Suporte SQL",
        metadata: null,
        created_at: new Date().toISOString(),
      },
    ];
    rendered.rerender(view());
    expect(screen.getAllByText("Suporte SQL")).toHaveLength(1);
    await act(async () => pending.resolve(result));
  });
  it("preserva ordem e evidências dos candidatos ao reabrir uma conversa", () => {
    state.messages = [
      {
        id: "m1",
        role: "assistant",
        content: "Comparação pronta",
        created_at: new Date().toISOString(),
        metadata: {
          candidates: [
            {
              id: "b",
              reason: "SQL no suporte",
              evidence: ["Atendeu com SQL"],
              gaps: ["Confirmar disponibilidade"],
            },
            { id: "a", reason: "Experiência em suporte" },
          ],
        },
      },
    ];
    state.candidates = [
      {
        id: "a",
        name: "Candidato A",
        is_active: true,
        cv_summary: "Suporte",
        cv_url: null,
      },
      {
        id: "b",
        name: "Candidato B",
        is_active: true,
        cv_summary: "Atendeu com SQL",
        cv_url: null,
      },
    ];
    render(view());
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((n) => n.textContent),
    ).toEqual(["#1Candidato B", "#2Candidato A"]);
    expect(screen.getByText("Atendeu com SQL")).toBeInTheDocument();
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  });
});
