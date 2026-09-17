import type { Database } from "@/integrations/supabase/types";
export type AgentKind = "recruiter" | "analyst" | "document_validator";
export type ChatAgentKind = "recruiter" | "analyst";
export type AgentSession =
  Database["public"]["Tables"]["agent_sessions"]["Row"];
export type AgentMessageRole =
  Database["public"]["Enums"]["agent_message_role"];
export type AgentSearchLog =
  Database["public"]["Tables"]["agent_search_log"]["Row"];
export interface AgentSource {
  label: string;
  href: string;
  consultedAt: string;
  detail?: string;
}
export interface CandidateSelection {
  id: string;
  similarity?: number;
  reason?: string;
  evidence?: string[];
  gaps?: string[];
}
export interface CandidateMatch extends CandidateSelection {
  name: string;
  cv_summary: string | null;
  cv_url: string | null;
  source: string | null;
  is_active: boolean;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
}
export interface AgentMetadata {
  version?: number;
  candidates?: CandidateSelection[];
  sources?: AgentSource[];
  feedback?: 1 | -1;
  tool_calls?: { tool: string; ok?: boolean }[];
  request_id?: string;
}
export type AgentMessage = Omit<
  Database["public"]["Tables"]["agent_messages"]["Row"],
  "metadata"
> & { metadata: AgentMetadata | null };
export interface AgentChatResponse {
  success: boolean;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  requestId?: string;
  assistantText: string;
  candidates: CandidateMatch[];
  metadata?: AgentMetadata;
  durationMs?: number;
  tokens: { input: number; output: number };
  replayed?: boolean;
}
export type AnalystChatResponse = AgentChatResponse;
export type RecruiterSearchResponse = AgentChatResponse;
export type AnalystMessageMetadata = AgentMetadata;
export type RecruiterMessageMetadata = AgentMetadata;
export const AGENT_LABELS: Record<AgentKind, string> = {
  recruiter: "Recrutador",
  analyst: "Analista IA",
  document_validator: "Validador de Documentos",
};
