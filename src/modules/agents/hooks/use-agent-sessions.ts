import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { toast } from "sonner";
import type {
  AgentKind,
  AgentMessage,
  AgentSession,
  CandidateMatch,
} from "../types";

export function useAgentSessions({ agentKind }: { agentKind: AgentKind }) {
  const { user, currentCompany } = useDashboard(),
    queryClient = useQueryClient();
  const companyId = currentCompany?.id;
  const key = ["agent-sessions", user?.id, companyId, agentKind];
  const query = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_sessions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("company_id", companyId!)
        .eq("agent_kind", agentKind)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentSession[];
    },
  });
  const archiveSession = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("agent_sessions")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user!.id)
        .eq("company_id", companyId!)
        .eq("agent_kind", agentKind);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast.success("Conversa arquivada.");
    },
    onError: () => toast.error("Não consegui arquivar. Tente novamente."),
  });
  return { ...query, sessions: query.data ?? [], archiveSession };
}
export function useAgentMessages(
  sessionId: string | null,
  agentKind: AgentKind,
) {
  const { user, currentCompany } = useDashboard();
  return useQuery({
    queryKey: [
      "agent-messages",
      user?.id,
      currentCompany?.id,
      agentKind,
      sessionId,
    ],
    enabled: !!sessionId && !!user?.id && !!currentCompany?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_messages")
        .select("*,agent_sessions!inner(user_id,company_id,agent_kind)")
        .eq("session_id", sessionId!)
        .eq("agent_sessions.user_id", user!.id)
        .eq("agent_sessions.company_id", currentCompany!.id)
        .eq("agent_sessions.agent_kind", agentKind)
        .in("role", ["user", "assistant"])
        .order("created_at")
        .order("id");
      if (error) throw error;
      return (data ?? []) as unknown as AgentMessage[];
    },
  });
}
export function useMessageCandidates(messages: AgentMessage[]) {
  const { user, currentCompany } = useDashboard();
  const ids = [
    ...new Set(
      messages.flatMap((m) => (m.metadata?.candidates ?? []).map((c) => c.id)),
    ),
  ].sort();
  return useQuery({
    queryKey: ["agent-candidates", user?.id, currentCompany?.id, ids],
    enabled: ids.length > 0 && !!currentCompany?.id && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id,name,cv_summary,cv_url,source,is_active")
        .eq("company_id", currentCompany!.id)
        .eq("is_active", true)
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as CandidateMatch[];
    },
  });
}
