import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
vi.mock("../services/agent-chat.service", () => ({
  rateAgentMessage: vi.fn(),
}));
import { ChatMessage } from "./ChatMessage";
import { safeAgentLink } from "../services/safe-agent-link";
import type { AgentMessage } from "../types";
afterEach(cleanup);
it("renderiza tabela e bloqueia imagem e link externo vindos do modelo", () => {
  const message = {
    id: "1",
    role: "assistant",
    content:
      "| Critério | Resultado |\n|---|---|\n| SQL | Confirmado |\n\n[abrir](https://external.example/data) ![imagem](https://external.example/pixel) [admissões](/dashboard/admissoes)",
    created_at: new Date().toISOString(),
    metadata: null,
  } as AgentMessage;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatMessage message={message} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(safeAgentLink("//external.example")).toBeUndefined();
  expect(safeAgentLink("/dashboard/admissoes?secret=x")).toBeUndefined();
});
