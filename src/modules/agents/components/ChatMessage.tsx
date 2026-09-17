import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Robot, User, Copy, ThumbsUp, ThumbsDown } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { rateAgentMessage } from "../services/agent-chat.service";
import type { AgentMessage, ChatAgentKind } from "../types";

import { safeAgentLink } from "../services/safe-agent-link";

export function ChatMessage({
  message,
  children,
  kind,
  companyId,
}: {
  message: AgentMessage;
  children?: React.ReactNode;
  kind?: ChatAgentKind;
  companyId?: string;
}) {
  const isUser = message.role === "user",
    queryClient = useQueryClient();
  const [saving, setSaving] = useState(false),
    [rating, setRating] = useState<1 | -1 | undefined>();
  const currentRating = rating ?? message.metadata?.feedback;
  async function rate(value: 1 | -1) {
    if (!kind || !companyId || saving) return;
    setSaving(true);
    try {
      await rateAgentMessage(kind, companyId, message.id, value);
      setRating(value);
      queryClient.invalidateQueries({ queryKey: ["agent-messages"] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary/20 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Robot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "flex min-w-0 max-w-[90%] flex-col md:max-w-[85%]",
          isUser ? "items-end" : "items-start",
        )}
      >
        <Card
          className={cn(
            "max-w-full",
            isUser && "border-primary bg-primary text-primary-foreground",
          )}
        >
          <CardContent className="p-3">
            {isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.content}
              </p>
            ) : (
              <div className="max-w-none break-words text-sm [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_h1]:my-3 [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) =>
                      safeAgentLink(href) ? (
                        <a
                          href={href}
                          className="text-primary underline underline-offset-2"
                        >
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      ),
                    img: () => null,
                    table: ({ children }) => (
                      <div className="my-3 max-w-full overflow-x-auto">
                        <table className="w-full min-w-[24rem] border-collapse text-left">
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border bg-muted px-3 py-2 font-medium">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border px-3 py-2 align-top">{children}</td>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </CardContent>
        </Card>
        {!isUser && children && (
          <div className="mt-3 w-full space-y-2">{children}</div>
        )}
        {!isUser && !!message.metadata?.sources?.length && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Fontes consultadas</summary>
            <ul className="mt-1 space-y-2">
              {message.metadata.sources.map((source, index) => (
                <li key={index}>
                  {safeAgentLink(source.href) ? (
                    <a href={source.href} className="text-primary underline">
                      {source.label}
                    </a>
                  ) : (
                    source.label
                  )}
                  {source.detail && <p>{source.detail}</p>}
                  <span>
                    {new Date(source.consultedAt).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {!isUser && kind && (
          <div className="mt-1 flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copiar resposta"
              onClick={() =>
                navigator.clipboard
                  .writeText(message.content)
                  .then(() => toast.success("Resposta copiada."))
                  .catch(() =>
                    toast.error(
                      "Não consegui copiar. Selecione o texto para copiar.",
                    ),
                  )
              }
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="A resposta ajudou"
              aria-pressed={currentRating === 1}
              disabled={saving}
              onClick={() => rate(1)}
            >
              <ThumbsUp
                className="h-4 w-4"
                weight={currentRating === 1 ? "fill" : "regular"}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="A resposta não ajudou"
              aria-pressed={currentRating === -1}
              disabled={saving}
              onClick={() => rate(-1)}
            >
              <ThumbsDown
                className="h-4 w-4"
                weight={currentRating === -1 ? "fill" : "regular"}
              />
            </Button>
          </div>
        )}
        <p className="mt-1 px-1 text-xs text-muted-foreground">
          {new Date(message.created_at).toLocaleString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
          })}
        </p>
      </div>
    </div>
  );
}
