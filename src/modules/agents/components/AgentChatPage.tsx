import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/DashboardContext";
import PermissionGuard from "@/components/dashboard/PermissionGuard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Robot,
  Plus,
  Archive,
  PaperPlaneRight,
  CircleNotch,
  Stop,
  ArrowClockwise,
} from "@phosphor-icons/react";
import {
  useAgentMessages,
  useAgentSessions,
  useMessageCandidates,
} from "../hooks/use-agent-sessions";
import {
  ChatError,
  sendAgentMessage,
  type ChatRequest,
} from "../services/agent-chat.service";
import { ChatMessage } from "./ChatMessage";
import { CandidateMatchCard } from "./CandidateMatchCard";
import {
  AGENT_LABELS,
  type AgentChatResponse,
  type AgentMessage,
  type ChatAgentKind,
} from "../types";

const suggestions = {
  recruiter: [
    "Preciso de alguém para suporte com SQL e atendimento ao cliente.",
    "Quais vagas estão abertas?",
    "Ajude a definir os requisitos de uma vaga de suporte.",
  ],
  analyst: [
    "Quais admissões precisam de atenção?",
    "Como está a distribuição do time ativo por loja?",
    "Mostre o funil das vagas abertas.",
  ],
};
export default function AgentChatPage({ kind }: { kind: ChatAgentKind }) {
  const { user, currentCompany } = useDashboard();
  return (
    <PermissionGuard
      module={kind === "recruiter" ? "recrutador" : "relatorios"}
    >
      <Conversation
        key={`${kind}:${user?.id}:${currentCompany?.id}`}
        kind={kind}
      />
    </PermissionGuard>
  );
}
function Conversation({ kind }: { kind: ChatAgentKind }) {
  const { user, currentCompany } = useDashboard(),
    queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null),
    [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatRequest | null>(null),
    [retry, setRetry] = useState<ChatRequest | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [progress, setProgress] = useState(""),
    [streamed, setStreamed] = useState(""),
    [error, setError] = useState("");
  const [localResponse, setLocalResponse] = useState<AgentChatResponse | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false),
    mounted = useRef(true),
    end = useRef<HTMLDivElement>(null);
  const sessions = useAgentSessions({ agentKind: kind }),
    history = useAgentMessages(sessionId, kind);
  const messages = history.data ?? [],
    candidates = useMessageCandidates(messages);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamed, progress]);
  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ["agent-sessions"] });
    queryClient.invalidateQueries({ queryKey: ["agent-messages"] });
  };
  async function send(text?: string, previous?: ChatRequest) {
    if (inFlight.current || !currentCompany) return;
    const query = (text ?? draft).trim();
    if (!query && !previous) return;
    const request = previous ?? {
      sessionId,
      companyId: currentCompany.id,
      query,
      requestId: crypto.randomUUID(),
    };
    inFlight.current = true;
    controller.current = new AbortController();
    setPending(request);
    setPendingMessageId(null);
    setDraft("");
    setError("");
    setStreamed("");
    setProgress("Preparando a resposta...");
    setRetry(null);
    setLocalResponse(null);
    let knownSession = request.sessionId;
    try {
      const result = await sendAgentMessage(
        kind,
        request,
        controller.current.signal,
        ({ event, data }) => {
          if (!mounted.current) return;
          if (event === "session") {
            setPendingMessageId(String(data.userMessageId));
            knownSession = String(data.sessionId);
            setSessionId(knownSession);
            setPending((p) => (p ? { ...p, sessionId: knownSession } : p));
            reload();
          }
          if (event === "progress") {
            setProgress(String(data.label));
            setStreamed("");
          }
          if (event === "response_start") setStreamed("");
          if (event === "text") {
            setProgress("Escrevendo a resposta...");
            setStreamed((value) => value + String(data.text));
          }
        },
      );
      if (!mounted.current) return;
      setSessionId(result.sessionId);
      setLocalResponse(result);
      setStreamed("");
      reload();
    } catch (err) {
      if (!mounted.current) return;
      const aborted = controller.current?.signal.aborted;
      const failure = err instanceof ChatError ? err : null;
      const failedSession = failure?.sessionId ?? knownSession;
      setSessionId(failedSession);
      setError(
        aborted
          ? "Consulta interrompida. Você pode tentar novamente."
          : err instanceof Error
            ? err.message
            : "Não consegui concluir. Tente novamente.",
      );
      if (
        failure?.code === "request_conflict" ||
        failure?.code === "session_not_found"
      )
        setDraft(request.query);
      else setRetry({ ...request, sessionId: failedSession });
      reload();
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setPending(null);
        setProgress("");
        setStreamed("");
      }
    }
  }
  const makeMessage = (
    id: string,
    role: "user" | "assistant",
    content: string,
    metadata: AgentMessage["metadata"] = null,
  ): AgentMessage => ({
    id,
    role,
    content,
    metadata,
    session_id: sessionId ?? "",
    created_at: new Date().toISOString(),
    content_blocks: null,
    token_input: null,
    token_output: null,
    model: null,
  });
  const display = [...messages];
  if (pending && !messages.some((m) => m.id === pendingMessageId))
    display.push(makeMessage("pending-user", "user", pending.query));
  if (
    localResponse &&
    localResponse.sessionId === sessionId &&
    !messages.some((m) => m.id === localResponse.assistantMessageId)
  )
    display.push(
      makeMessage(
        localResponse.assistantMessageId,
        "assistant",
        localResponse.assistantText,
        localResponse.metadata ?? null,
      ),
    );
  const working = !!pending;
  const changeSession = (id: string | null) => {
    if (working) return;
    setSessionId(id);
    setLocalResponse(null);
    setDraft("");
    setError("");
    setRetry(null);
  };
  return (
    <div className="flex min-h-[32rem] h-[calc(100dvh-7rem)] flex-col gap-3 md:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-2 md:w-60">
        <Button onClick={() => changeSession(null)} disabled={working}>
          <Plus className="mr-2 h-4 w-4" />
          Nova conversa
        </Button>
        <div className="max-h-28 overflow-y-auto rounded-lg border p-2 md:max-h-none md:flex-1">
          {sessions.isError && (
            <p role="alert" className="p-2 text-sm">
              Não consegui listar as conversas.{" "}
              <button onClick={() => sessions.refetch()} className="underline">
                Tentar novamente
              </button>
            </p>
          )}
          {sessions.isLoading && (
            <p className="p-2 text-sm text-muted-foreground">
              Buscando conversas...
            </p>
          )}
          {!sessions.isLoading && !sessions.sessions.length && (
            <p className="p-2 text-sm text-muted-foreground">
              Suas conversas desta empresa aparecem aqui.
            </p>
          )}
          {sessions.sessions.map((s) => (
            <div
              key={s.id}
              className={`mb-1 flex items-center rounded-md ${sessionId === s.id ? "bg-primary/10" : "hover:bg-muted"}`}
            >
              <button
                disabled={working}
                onClick={() => changeSession(s.id)}
                className="min-w-0 flex-1 p-2 text-left text-sm"
              >
                <span className="block truncate">{s.title ?? "Conversa"}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(s.updated_at).toLocaleDateString("pt-BR")}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                disabled={working || sessions.archiveSession.isPending}
                aria-label={`Arquivar ${s.title ?? "conversa"}`}
                onClick={async () => {
                  try {
                    await sessions.archiveSession.mutateAsync(s.id);
                    if (s.id === sessionId) changeSession(null);
                  } catch {
                    /* Mensagem exibida pelo hook. */
                  }
                }}
              >
                <Archive className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Robot className="h-6 w-6 text-primary" />
          <div>
            <h1 className="font-semibold">{AGENT_LABELS[kind]}</h1>
            <p className="text-xs text-muted-foreground">
              {currentCompany?.company_name ?? "Selecione uma empresa"}
            </p>
          </div>
        </div>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className="flex-1 space-y-4 overflow-y-auto p-4"
            aria-label="Mensagens da conversa"
          >
            {!sessionId && !working && (
              <div className="mx-auto max-w-xl space-y-4 py-8">
                <p>
                  {kind === "recruiter"
                    ? "Encontre candidatos, compare experiências e prepare entrevistas."
                    : "Consulte os números e identifique onde agir no dia a dia do RH."}
                </p>
                <div className="flex flex-col gap-2">
                  {suggestions[kind].map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      className="h-auto whitespace-normal justify-start text-left"
                      disabled={!currentCompany}
                      onClick={() => send(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {history.isError && (
              <p role="alert">
                Não consegui recuperar a conversa.{" "}
                <button className="underline" onClick={() => history.refetch()}>
                  Tentar novamente
                </button>
              </p>
            )}
            {history.isLoading && sessionId && (
              <p className="text-sm text-muted-foreground">
                Buscando mensagens...
              </p>
            )}
            {display.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                kind={kind}
                companyId={currentCompany?.id}
              >
                {(message.metadata?.candidates ?? []).map(
                  (selection, index) => {
                    const candidate =
                      (candidates.data ?? []).find(
                        (c) => c.id === selection.id,
                      ) ??
                      localResponse?.candidates?.find(
                        (c) => c.id === selection.id,
                      );
                    return candidate ? (
                      <CandidateMatchCard
                        key={selection.id}
                        candidate={{ ...candidate, ...selection }}
                        rank={index + 1}
                      />
                    ) : null;
                  },
                )}
              </ChatMessage>
            ))}
            {working && (
              <div
                aria-live="polite"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CircleNotch className="h-4 w-4 animate-spin" />
                {progress}
              </div>
            )}
            {working && streamed && (
              <ChatMessage
                message={makeMessage("streaming", "assistant", streamed)}
              />
            )}
            {error && (
              <div
                role="alert"
                className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"
              >
                <p>{error}</p>
                {retry && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={working}
                    onClick={() => send(undefined, retry)}
                  >
                    <ArrowClockwise className="mr-2 h-4 w-4" />
                    Tentar novamente
                  </Button>
                )}
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 border-t p-3"
          >
            <Textarea
              aria-label="Mensagem"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={6000}
              rows={2}
              className="resize-none"
              placeholder={
                kind === "recruiter"
                  ? "Descreva a vaga ou continue a conversa..."
                  : "Pergunte sobre os dados ou detalhe a consulta..."
              }
              disabled={working || !currentCompany}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {working ? (
              <Button
                type="button"
                variant="outline"
                aria-label="Interromper consulta"
                onClick={() => controller.current?.abort()}
              >
                <Stop className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                aria-label="Enviar mensagem"
                disabled={!draft.trim() || !currentCompany || history.isError}
              >
                <PaperPlaneRight className="h-4 w-4" />
              </Button>
            )}
          </form>
        </Card>
      </section>
    </div>
  );
}
