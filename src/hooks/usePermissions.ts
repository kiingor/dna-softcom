import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDashboard } from "@/contexts/DashboardContext";

export type ModuleType =
  | "colaboradores"
  | "setores"
  | "cargos"
  | "empresas"
  | "beneficios"
  | "ferias"
  | "financeiro"
  | "relatorios"
  | "contabilidade"
  | "configuracoes"
  | "permissoes"
  | "exames"
  | "jornada"
  | "admissoes"
  | "vagas"
  | "candidatos"
  | "folha"
  | "folha_pagamentos"
  // Módulo de EXECUÇÃO do pagamento, separado de "folha_pagamentos" (que é a
  // tela/visão). Aqui `can_create` quer dizer EXECUTAR o pagamento — é o verbo
  // mais próximo semanticamente e é o que o padrão da casa mapeia pra
  // action='create'. Ele sozinho NÃO autoriza nada: o gate real exige papel +
  // este módulo + 2FA, e a escrita em si é feita por função SECURITY DEFINER.
  | "folha_pagamento_exec"
  | "decimo_terceiro"
  | "recrutador"
  | "feedback";

export interface ModulePermissions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isLoading: boolean;
  isAdmin: boolean;
}

export const MODULE_LABELS: Record<ModuleType, string> = {
  colaboradores: "Colaboradores",
  setores: "Setores",
  cargos: "Cargos",
  empresas: "Empresas",
  beneficios: "Benefícios",
  ferias: "Férias e Ausências",
  financeiro: "Lançamentos Financeiros",
  relatorios: "Relatórios",
  contabilidade: "Contabilidade",
  configuracoes: "Configurações",
  permissoes: "Permissões de Usuários",
  exames: "Exames Ocupacionais",
  jornada: "Jornada de Conhecimento",
  admissoes: "Admissões",
  vagas: "Vagas",
  candidatos: "Candidatos",
  folha: "Folha — Lançamentos",
  folha_pagamentos: "Folha — Pagamentos",
  folha_pagamento_exec: "Folha — Realizar Pagamento",
  decimo_terceiro: "13º Salário",
  recrutador: "Agente Recrutador",
  feedback: "Feedback do Colaborador",
};

export type ModuleGroup = {
  label: string;
  description?: string;
  modules: ModuleType[];
};

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    label: "Cadastros",
    description: "Estruturas básicas da empresa",
    modules: ["colaboradores", "empresas", "setores", "cargos"],
  },
  {
    label: "Operação",
    description: "Rotina de gente & cultura",
    modules: ["folha", "folha_pagamentos", "folha_pagamento_exec", "decimo_terceiro", "ferias", "financeiro", "beneficios", "exames", "contabilidade"],
  },
  {
    label: "Recrutamento",
    description: "Vagas, candidatos e admissão",
    modules: ["admissoes", "vagas", "candidatos", "recrutador"],
  },
  {
    label: "Engajamento & Análise",
    description: "Jornada do colaborador e relatórios",
    modules: ["jornada", "feedback", "relatorios"],
  },
  {
    label: "Sistema",
    description: "Configurações e controle de acesso",
    modules: ["configuracoes", "permissoes"],
  },
];

export const ALL_MODULES: ModuleType[] = MODULE_GROUPS.flatMap((g) => g.modules);

export const usePermissions = (
  module: ModuleType,
  // Pagamentos exigem permissão explícita mesmo para admin_gc. O dono mantém
  // as permissões concedidas pela própria RPC get_user_permissions.
  ignoreCompanyAdmin = false,
): ModulePermissions => {
  const { user, currentCompany } = useDashboard();

  const { data: isAdmin, isLoading: isAdminLoading } = useQuery({
    queryKey: ["is-company-admin", user?.id, currentCompany?.id],
    queryFn: async () => {
      if (!user?.id || !currentCompany?.id) return false;
      
      const { data, error } = await supabase.rpc("is_company_admin", {
        _user_id: user.id,
        _company_id: currentCompany.id,
      });
      
      if (error) {
        console.error("Error checking admin status:", error);
        return false;
      }
      
      return data ?? false;
    },
    enabled: !!user?.id && !!currentCompany?.id,
  });

  const { data: permissions, isLoading: isPermissionsLoading } = useQuery({
    queryKey: ["permissions", user?.id, currentCompany?.id, module],
    queryFn: async () => {
      if (!user?.id || !currentCompany?.id) {
        return { can_view: false, can_create: false, can_edit: false, can_delete: false };
      }

      const { data, error } = await supabase.rpc("get_user_permissions", {
        _user_id: user.id,
        _company_id: currentCompany.id,
        _module: module,
      });

      if (error) {
        console.error("Error fetching permissions:", error);
        return { can_view: false, can_create: false, can_edit: false, can_delete: false };
      }

      return data?.[0] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
    },
    enabled: !!user?.id && !!currentCompany?.id,
  });

  const isLoading = isAdminLoading || isPermissionsLoading;
  const userIsAdmin = isAdmin ?? false;

  if (userIsAdmin && !ignoreCompanyAdmin) {
    return {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      isLoading,
      isAdmin: true,
    };
  }

  return {
    canView: permissions?.can_view ?? false,
    canCreate: permissions?.can_create ?? false,
    canEdit: permissions?.can_edit ?? false,
    canDelete: permissions?.can_delete ?? false,
    isLoading,
    isAdmin: false,
  };
};

// Hook to check if current user is company admin
export const useIsCompanyAdmin = () => {
  const { user, currentCompany } = useDashboard();

  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-company-admin", user?.id, currentCompany?.id],
    queryFn: async () => {
      if (!user?.id || !currentCompany?.id) return false;
      
      const { data, error } = await supabase.rpc("is_company_admin", {
        _user_id: user.id,
        _company_id: currentCompany.id,
      });
      
      if (error) {
        console.error("Error checking admin status:", error);
        return false;
      }
      
      return data ?? false;
    },
    enabled: !!user?.id && !!currentCompany?.id,
  });

  return { isAdmin: isAdmin ?? false, isLoading };
};
