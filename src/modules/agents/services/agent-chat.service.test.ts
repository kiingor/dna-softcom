// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { readAgentStream } from "./agent-chat.service";
function response(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
  );
}
describe("transporte do chat", () => {
  it("lê eventos fragmentados, preserva UTF-8 e conclui apenas no evento final", async () => {
    const onEvent = vi.fn();
    const result = await readAgentStream(
      response(
        'event: text\r\ndata: {"text":"admissão"}\r\n\r\nevent: complete\ndata: {"success":true,"assistantText":"admissão"}\n\n',
      ),
      onEvent,
    );
    expect(result.assistantText).toBe("admissão");
    expect(onEvent.mock.calls[0][0].data.text).toBe("admissão");
  });
  it("não trata conexão encerrada como resposta concluída", async () => {
    await expect(
      readAgentStream(
        response('event: progress\ndata: {"label":"Consultando"}\n\n'),
        () => {},
      ),
    ).rejects.toMatchObject({ code: "interrupted" });
  });
  it("preserva referência da sessão em falha para o retry", async () => {
    await expect(
      readAgentStream(
        response(
          'event: error\ndata: {"error":"Tente novamente","code":"timeout","sessionId":"s1"}\n\n',
        ),
        () => {},
      ),
    ).rejects.toMatchObject({ code: "timeout", sessionId: "s1" });
  });
});
