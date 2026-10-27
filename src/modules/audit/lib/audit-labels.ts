// Tradução dos nomes técnicos de tabela/coluna pra português, usado no
// viewer de auditoria. Sem entrada = mostra o slug original.

export const TABLE_LABELS: Record<string, string> = {
  // Cadastros base
  companies: "Empresas",
  positions: "Cargos",
  position_documents: "Documentos do cargo",
  teams: "Setores",
  collaborators: "Colaboradores",
  collaborator_documents: "Documentos do colaborador",
  collaborator_badges: "Insígnias do colaborador",
  profiles: "Perfis",

  // Benefícios
  benefits: "Benefícios",
  benefits_assignments: "Atribuição de benefícios",

  // Recrutamento
  candidates: "Candidatos",
  candidate_applications: "Candidaturas",
  job_openings: "Vagas",
  interview_schedules: "Entrevistas (agenda)",
  interview_feedbacks: "Feedback de entrevistas",
  feedback_campaigns: "Campanhas de feedback",
  feedback_cultures: "Culturas de feedback",
  feedback_classifications: "Classificação de feedback",

  // Admissões
  admission_journeys: "Admissões",
  admission_documents: "Documentos de admissão",
  admission_events: "Timeline de admissão",

  // Folha
  payroll_periods: "Períodos de folha",
  payroll_entries: "Lançamentos de folha",
  payroll_payments: "Pagamentos de folha",
  payroll_alerts: "Alertas de folha",
  payslips: "Contracheques",

  // 13º Salário
  bonus_periods: "Campanhas de 13º",
  bonus_entries: "Linhas de 13º",
  bonus_payments: "Parcelas de 13º",

  // Férias
  vacation_periods: "Períodos aquisitivos",
  vacation_requests: "Solicitações de férias",

  // Exames
  occupational_exams: "Exames ocupacionais",
  exam_documents: "Documentos de exames",
  store_holidays: "Feriados",

  // Acessos & comunicação
  company_users: "Usuários da empresa",
  user_permissions: "Permissões",
  user_roles: "Papéis (roles)",
  notification_templates: "Templates de notificação",
  notification_logs: "Logs de notificação",
  whatsapp_instances: "Instâncias WhatsApp",

  // Jornada
  journey_badges: "Insígnias da jornada",
  journey_milestones: "Marcos da jornada",

  // Onboarding
  onboarding_sessions: "Onboarding (sessões)",
  onboarding_errors: "Onboarding (erros)",

  // Agentes
  agent_settings: "Configurações de IA",
};

// Labels de coluna por tabela. Padrão `<table>.<column>` permite
// override por tabela; `*.column` é fallback global.
export const COLUMN_LABELS: Record<string, string> = {
  // Globais (qualquer tabela)
  "*.id": "ID",
  "*.created_at": "Criado em",
  "*.updated_at": "Atualizado em",
  "*.created_by": "Criado por",
  "*.notes": "Observações",
  "*.is_active": "Ativo",
  "*.company_id": "Empresa",
  "*.deletion_reason": "Motivo da exclusão",
  "feedback_campaigns.name": "Campanha",
  "feedback_cultures.name": "Cultura",
  "feedback_classifications.agenda_objective_id": "Feedback na Agenda",
  "feedback_classifications.agenda_collaborator_id": "Colaborador na Agenda",
  "feedback_classifications.campaign_id": "Campanha",
  "feedback_classifications.culture_id": "Cultura",
  "feedback_classifications.updated_by": "Atualizado por",

  // collaborators
  "collaborators.name": "Nome",
  "collaborators.email": "Email",
  "collaborators.cpf": "CPF",
  "collaborators.rg": "RG",
  "collaborators.phone": "Telefone",
  "collaborators.address": "Endereço",
  "collaborators.regime": "Regime",
  "collaborators.status": "Status",
  "collaborators.position_id": "Cargo",
  "collaborators.team_id": "Setor",
  "collaborators.store_id": "Empresa (loja)",
  "collaborators.contracted_store_id": "Empresa contratada",
  "collaborators.admission_date": "Data de admissão",
  "collaborators.salary": "Salário",
  "collaborators.birth_date": "Nascimento",
  "collaborators.is_pcd": "PcD",
  "collaborators.is_jovem_aprendiz": "Jovem aprendiz",
  "collaborators.is_avulso": "Avulso",

  // positions
  "positions.name": "Nome do cargo",
  "positions.salary": "Salário",
  "positions.inss_percent": "INSS %",
  "positions.fgts_percent": "FGTS %",
  "positions.irpf_percent": "IRPF %",
  "positions.risk_group": "Grupo de risco",
  "positions.exam_periodicity_months": "Periodicidade exame (meses)",
  "positions.team_id": "Setor",
  "positions.level": "Nível",

  // benefits
  "benefits.name": "Nome",
  "benefits.value": "Valor",
  "benefits.value_type": "Tipo de valor",
  "benefits.applicable_days": "Dias aplicáveis",
  "benefits.category": "Categoria",
  "benefits.description": "Descrição",
  "benefits_assignments.collaborator_id": "Colaborador",
  "benefits_assignments.benefit_id": "Benefício",
  "benefits_assignments.custom_value": "Valor personalizado",
  "benefits_assignments.observation": "Observação",

  // job_openings
  "job_openings.title": "Título",
  "job_openings.description": "Descrição",
  "job_openings.requirements": "Requisitos",
  "job_openings.regime": "Regime",
  "job_openings.status": "Status",
  "job_openings.vacancies_count": "Quantidade de vagas",
  "job_openings.position_id": "Cargo",
  "job_openings.team_id": "Setor",
  "job_openings.hiring_manager_id": "Gestor responsável",
  "job_openings.pipeline_stages": "Etapas do pipeline",
  "job_openings.opened_at": "Aberta em",
  "job_openings.closed_at": "Fechada em",

  // candidate_applications
  "candidate_applications.candidate_id": "Candidato",
  "candidate_applications.job_id": "Vaga",
  "candidate_applications.stage": "Etapa",
  "candidate_applications.ai_score": "Score IA",
  "candidate_applications.rejected_reason": "Motivo da rejeição",
  "candidate_applications.applied_at": "Candidatou em",

  // candidates
  "candidates.name": "Nome",
  "candidates.email": "Email",
  "candidates.phone": "Telefone",
  "candidates.cpf": "CPF",
  "candidates.linkedin_url": "LinkedIn",
  "candidates.cv_url": "Link do CV",
  "candidates.is_active": "Ativo",
  "candidates.source": "Origem",

  // admission_journeys
  "admission_journeys.candidate_name": "Nome do candidato",
  "admission_journeys.candidate_email": "Email",
  "admission_journeys.candidate_phone": "Telefone",
  "admission_journeys.candidate_cpf": "CPF",
  "admission_journeys.regime": "Regime",
  "admission_journeys.status": "Status",
  "admission_journeys.position_id": "Cargo",
  "admission_journeys.application_id": "Candidatura",
  "admission_journeys.access_token": "Token de acesso",
  "admission_journeys.token_expires_at": "Token expira em",
  "admission_documents.doc_type": "Tipo de documento",
  "admission_documents.required": "Obrigatório",
  "admission_documents.status": "Status",
  "admission_documents.file_name": "Nome do arquivo",
  "admission_documents.rejection_reason": "Motivo da rejeição",

  // payroll
  "payroll_periods.reference_month": "Mês de referência",
  "payroll_periods.status": "Status",
  "payroll_periods.closed_at": "Fechado em",
  "payroll_periods.closed_by": "Fechado por",
  "payroll_entries.collaborator_id": "Colaborador",
  "payroll_entries.type": "Tipo",
  "payroll_entries.value": "Valor",
  "payroll_entries.description": "Descrição",
  "payroll_entries.is_fixed": "Fixo",
  "payroll_entries.month": "Mês",
  "payroll_entries.year": "Ano",
  "payroll_payments.entry_id": "Lançamento",
  "payroll_payments.amount": "Valor",
  "payroll_payments.paid_at": "Pago em",
  "payroll_payments.paid_by": "Pago por",

  // vacation
  "vacation_periods.start_date": "Início (aquisitivo)",
  "vacation_periods.end_date": "Fim (aquisitivo)",
  "vacation_periods.days_taken": "Dias gozados",
  "vacation_periods.days_sold": "Dias vendidos",
  "vacation_periods.days_remaining": "Dias restantes",
  "vacation_periods.status": "Status",
  "vacation_periods.manual_adjustment_at": "Ajuste manual em",
  "vacation_periods.manual_adjustment_notes": "Motivo do ajuste",
  "vacation_requests.start_date": "Início",
  "vacation_requests.end_date": "Fim",
  "vacation_requests.days": "Dias",
  "vacation_requests.status": "Status",

  // exames
  "occupational_exams.exam_type": "Tipo de exame",
  "occupational_exams.status": "Status",
  "occupational_exams.due_date": "Vencimento",
  "occupational_exams.scheduled_date": "Agendado pra",
  "occupational_exams.completed_date": "Realizado em",
  "occupational_exams.risk_group_at_time": "Grupo de risco",

  // teams / setores
  "teams.name": "Nome",
  "teams.description": "Descrição",

  // companies
  "companies.company_name": "Razão social",
  "companies.cnpj": "CNPJ",
  "companies.email": "Email",
  "companies.phone": "Telefone",

  // user_roles / permissions
  "user_roles.role": "Papel",
  "user_roles.user_id": "Usuário",
  "user_permissions.module": "Módulo",
  "user_permissions.can_view": "Pode ver",
  "user_permissions.can_create": "Pode criar",
  "user_permissions.can_edit": "Pode editar",
  "user_permissions.can_delete": "Pode excluir",

  // company_users
  "company_users.email": "Email",
  "company_users.full_name": "Nome",
  "company_users.is_active": "Ativo",
};

// Campos sensíveis que NÃO devem aparecer no diff (mascara como ***).
// Admin vê CPF/RG (esses ficam visíveis). Aqui só escondemos hashes,
// tokens e similares.
const MASKED_COLUMNS = new Set<string>([
  "password_hash",
  "password",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
]);

export function isMaskedColumn(column: string): boolean {
  return MASKED_COLUMNS.has(column);
}

// Campos puramente técnicos que poluem o diff sem agregar (timestamps
// auto-gerenciados, ids de tabelas-pivô não-essenciais, etc.). Excluídos
// da listagem de "campos alterados" mas continuam no JSON cru.
export const NOISE_COLUMNS = new Set<string>([
  "updated_at",
  "created_at",
  "id",
]);

export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

export function columnLabel(table: string, column: string): string {
  return (
    COLUMN_LABELS[`${table}.${column}`] ??
    COLUMN_LABELS[`*.${column}`] ??
    column
  );
}
