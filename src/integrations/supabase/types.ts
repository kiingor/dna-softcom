export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admission_documents: {
        Row: {
          ai_confidence: number | null
          ai_validation_result: Json | null
          company_id: string
          created_at: string
          doc_type: string
          file_name: string | null
          file_url: string | null
          id: string
          journey_id: string
          notes: string | null
          rejection_reason: string | null
          required: boolean
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["admission_document_status"]
          text_response: string | null
          updated_at: string
          uploaded_at: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_validation_result?: Json | null
          company_id: string
          created_at?: string
          doc_type: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          journey_id: string
          notes?: string | null
          rejection_reason?: string | null
          required?: boolean
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["admission_document_status"]
          text_response?: string | null
          updated_at?: string
          uploaded_at?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_validation_result?: Json | null
          company_id?: string
          created_at?: string
          doc_type?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          journey_id?: string
          notes?: string | null
          rejection_reason?: string | null
          required?: boolean
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["admission_document_status"]
          text_response?: string | null
          updated_at?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "admission_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_documents_journey_id_fkey"
            columns: ["journey_id"]
            referencedRelation: "admission_journeys"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_events: {
        Row: {
          actor_id: string | null
          company_id: string
          created_at: string
          document_id: string | null
          id: string
          journey_id: string
          kind: Database["public"]["Enums"]["admission_event_kind"]
          message: string | null
          payload: Json | null
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          created_at?: string
          document_id?: string | null
          id?: string
          journey_id: string
          kind: Database["public"]["Enums"]["admission_event_kind"]
          message?: string | null
          payload?: Json | null
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          created_at?: string
          document_id?: string | null
          id?: string
          journey_id?: string
          kind?: Database["public"]["Enums"]["admission_event_kind"]
          message?: string | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "admission_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_events_document_id_fkey"
            columns: ["document_id"]
            referencedRelation: "admission_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_events_journey_id_fkey"
            columns: ["journey_id"]
            referencedRelation: "admission_journeys"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_journey_tests: {
        Row: {
          answers: Json
          assigned_at: string
          auto_score: number | null
          completed_at: string | null
          created_at: string
          id: string
          journey_id: string
          result_summary: Json | null
          reviewed_at: string | null
          reviewer_id: string | null
          reviewer_notes: string | null
          reviewer_score: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["admission_test_status"]
          test_id: string
          test_slug: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          assigned_at?: string
          auto_score?: number | null
          completed_at?: string | null
          created_at?: string
          id?: string
          journey_id: string
          result_summary?: Json | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          reviewer_score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["admission_test_status"]
          test_id: string
          test_slug: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          assigned_at?: string
          auto_score?: number | null
          completed_at?: string | null
          created_at?: string
          id?: string
          journey_id?: string
          result_summary?: Json | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          reviewer_score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["admission_test_status"]
          test_id?: string
          test_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_journey_tests_journey_id_fkey"
            columns: ["journey_id"]
            referencedRelation: "admission_journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_journey_tests_test_id_fkey"
            columns: ["test_id"]
            referencedRelation: "admission_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_journeys: {
        Row: {
          access_token: string
          application_id: string | null
          candidate_address: string | null
          candidate_address_complement: string | null
          candidate_address_number: string | null
          candidate_birth_date: string | null
          candidate_city: string | null
          candidate_cpf: string | null
          candidate_email: string | null
          candidate_name: string
          candidate_neighborhood: string | null
          candidate_phone: string | null
          candidate_rg: string | null
          candidate_state: string | null
          candidate_zip: string | null
          collaborator_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          position_id: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"]
          status: Database["public"]["Enums"]["admission_journey_status"]
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          application_id?: string | null
          candidate_address?: string | null
          candidate_address_complement?: string | null
          candidate_address_number?: string | null
          candidate_birth_date?: string | null
          candidate_city?: string | null
          candidate_cpf?: string | null
          candidate_email?: string | null
          candidate_name: string
          candidate_neighborhood?: string | null
          candidate_phone?: string | null
          candidate_rg?: string | null
          candidate_state?: string | null
          candidate_zip?: string | null
          collaborator_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          position_id?: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"]
          status?: Database["public"]["Enums"]["admission_journey_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          application_id?: string | null
          candidate_address?: string | null
          candidate_address_complement?: string | null
          candidate_address_number?: string | null
          candidate_birth_date?: string | null
          candidate_city?: string | null
          candidate_cpf?: string | null
          candidate_email?: string | null
          candidate_name?: string
          candidate_neighborhood?: string | null
          candidate_phone?: string | null
          candidate_rg?: string | null
          candidate_state?: string | null
          candidate_zip?: string | null
          collaborator_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          position_id?: string | null
          regime?: Database["public"]["Enums"]["collaborator_regime"]
          status?: Database["public"]["Enums"]["admission_journey_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_journeys_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_journeys_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "admission_journeys_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_journeys_position_id_fkey"
            columns: ["position_id"]
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_tests: {
        Row: {
          allow_pause: boolean
          category: string | null
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string
          time_limit_minutes: number | null
          updated_at: string
        }
        Insert: {
          allow_pause?: boolean
          category?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug: string
          time_limit_minutes?: number | null
          updated_at?: string
        }
        Update: {
          allow_pause?: boolean
          category?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string
          time_limit_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_tests_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "admission_tests_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: string
          content_blocks: Json | null
          created_at: string
          id: string
          metadata: Json | null
          model: string | null
          role: Database["public"]["Enums"]["agent_message_role"]
          session_id: string
          token_input: number | null
          token_output: number | null
        }
        Insert: {
          content: string
          content_blocks?: Json | null
          created_at?: string
          id?: string
          metadata?: Json | null
          model?: string | null
          role: Database["public"]["Enums"]["agent_message_role"]
          session_id: string
          token_input?: number | null
          token_output?: number | null
        }
        Update: {
          content?: string
          content_blocks?: Json | null
          created_at?: string
          id?: string
          metadata?: Json | null
          model?: string | null
          role?: Database["public"]["Enums"]["agent_message_role"]
          session_id?: string
          token_input?: number | null
          token_output?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_search_log: {
        Row: {
          agent_kind: string
          company_id: string
          created_at: string
          duration_ms: number | null
          id: string
          query: string
          results: Json
          session_id: string | null
          threshold: number | null
          top_k: number
          user_id: string
        }
        Insert: {
          agent_kind: string
          company_id: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          query: string
          results: Json
          session_id?: string | null
          threshold?: number | null
          top_k?: number
          user_id: string
        }
        Update: {
          agent_kind?: string
          company_id?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          query?: string
          results?: Json
          session_id?: string | null
          threshold?: number | null
          top_k?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_search_log_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agent_search_log_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_search_log_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          agent_kind: string
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_kind: string
          archived_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_kind?: string
          archived_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_sessions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agent_sessions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      application_tests: {
        Row: {
          access_token: string
          answers: Json
          application_id: string
          assigned_at: string
          auto_score: number | null
          candidate_id: string
          company_id: string
          completed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          result_summary: Json | null
          reviewed_at: string | null
          reviewer_id: string | null
          reviewer_notes: string | null
          reviewer_score: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["admission_test_status"]
          test_id: string
          test_slug: string
          updated_at: string
        }
        Insert: {
          access_token?: string
          answers?: Json
          application_id: string
          assigned_at?: string
          auto_score?: number | null
          candidate_id: string
          company_id: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          result_summary?: Json | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          reviewer_score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["admission_test_status"]
          test_id: string
          test_slug: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          answers?: Json
          application_id?: string
          assigned_at?: string
          auto_score?: number | null
          candidate_id?: string
          company_id?: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          result_summary?: Json | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          reviewer_score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["admission_test_status"]
          test_id?: string
          test_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_tests_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "candidate_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_tests_candidate_id_fkey"
            columns: ["candidate_id"]
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_tests_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "application_tests_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_tests_test_id_fkey"
            columns: ["test_id"]
            referencedRelation: "admission_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          company_id: string | null
          created_at: string
          id: string
          record_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          created_at?: string
          id?: string
          record_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          created_at?: string
          id?: string
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      backfill_20260722_ficha_log: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          type: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at: string
          value: number
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at: string
          created_by?: string | null
          description?: string | null
          id: string
          is_active: boolean
          type: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at: string
          value: number
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          type?: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      backfill_20260722_payroll_log: {
        Row: {
          id: string
        }
        Insert: {
          id: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
      backup_20260722_fixed_entries: {
        Row: {
          collaborator_id: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          type: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          type?: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          type?: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: []
      }
      backup_20260722_payroll_jul: {
        Row: {
          collaborator_id: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          external_id: string | null
          id: string | null
          installment_group_id: string | null
          installment_number: number | null
          installment_total: number | null
          is_fixed: boolean | null
          is_payable: boolean | null
          month: number | null
          store_id: string | null
          type: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at: string | null
          value: number | null
          year: number | null
        }
        Insert: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          id?: string | null
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_fixed?: boolean | null
          is_payable?: boolean | null
          month?: number | null
          store_id?: string | null
          type?: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at?: string | null
          value?: number | null
          year?: number | null
        }
        Update: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          id?: string | null
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_fixed?: boolean | null
          is_payable?: boolean | null
          month?: number | null
          store_id?: string | null
          type?: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at?: string | null
          value?: number | null
          year?: number | null
        }
        Relationships: []
      }
      badges: {
        Row: {
          category: Database["public"]["Enums"]["badge_category"]
          color: string | null
          company_id: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          weight: number
        }
        Insert: {
          category?: Database["public"]["Enums"]["badge_category"]
          color?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          weight?: number
        }
        Update: {
          category?: Database["public"]["Enums"]["badge_category"]
          color?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "badges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "badges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      benefits: {
        Row: {
          applicable_days: string[] | null
          category: Database["public"]["Enums"]["benefit_category"]
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_company_expense: boolean
          name: string
          region_id: string | null
          value: number
          value_type: string
        }
        Insert: {
          applicable_days?: string[] | null
          category?: Database["public"]["Enums"]["benefit_category"]
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_company_expense?: boolean
          name: string
          region_id?: string | null
          value?: number
          value_type?: string
        }
        Update: {
          applicable_days?: string[] | null
          category?: Database["public"]["Enums"]["benefit_category"]
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_company_expense?: boolean
          name?: string
          region_id?: string | null
          value?: number
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefits_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "benefits_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefits_region_id_fkey"
            columns: ["region_id"]
            referencedRelation: "vt_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      benefits_assignments: {
        Row: {
          assigned_at: string
          benefit_id: string
          collaborator_id: string
          custom_value: number | null
          id: string
          observation: string | null
        }
        Insert: {
          assigned_at?: string
          benefit_id: string
          collaborator_id: string
          custom_value?: number | null
          id?: string
          observation?: string | null
        }
        Update: {
          assigned_at?: string
          benefit_id?: string
          collaborator_id?: string
          custom_value?: number | null
          id?: string
          observation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benefits_assignments_benefit_id_fkey"
            columns: ["benefit_id"]
            referencedRelation: "benefits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefits_assignments_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_entries: {
        Row: {
          adicional_monthly: number
          base_salary: number
          collaborator_id: string
          created_at: string
          external_id: string | null
          gratificacao_sum: number
          gross_value: number
          id: string
          mode: Database["public"]["Enums"]["bonus_entry_mode"]
          mode_notes: string | null
          mode_set_at: string | null
          mode_set_by: string | null
          months_worked: number
          period_id: string
          updated_at: string
        }
        Insert: {
          adicional_monthly?: number
          base_salary?: number
          collaborator_id: string
          created_at?: string
          external_id?: string | null
          gratificacao_sum?: number
          gross_value?: number
          id?: string
          mode?: Database["public"]["Enums"]["bonus_entry_mode"]
          mode_notes?: string | null
          mode_set_at?: string | null
          mode_set_by?: string | null
          months_worked?: number
          period_id: string
          updated_at?: string
        }
        Update: {
          adicional_monthly?: number
          base_salary?: number
          collaborator_id?: string
          created_at?: string
          external_id?: string | null
          gratificacao_sum?: number
          gross_value?: number
          id?: string
          mode?: Database["public"]["Enums"]["bonus_entry_mode"]
          mode_notes?: string | null
          mode_set_at?: string | null
          mode_set_by?: string | null
          months_worked?: number
          period_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_entries_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "bonus_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_payments: {
        Row: {
          amount: number
          created_at: string
          entry_id: string
          id: string
          installment: Database["public"]["Enums"]["bonus_installment"]
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          entry_id: string
          id?: string
          installment: Database["public"]["Enums"]["bonus_installment"]
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          entry_id?: string
          id?: string
          installment?: Database["public"]["Enums"]["bonus_installment"]
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_payments_entry_id_fkey"
            columns: ["entry_id"]
            referencedRelation: "bonus_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          generated_at: string | null
          generated_by: string | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          status: Database["public"]["Enums"]["bonus_period_status"]
          updated_at: string
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          status?: Database["public"]["Enums"]["bonus_period_status"]
          updated_at?: string
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          status?: Database["public"]["Enums"]["bonus_period_status"]
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "bonus_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "bonus_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_applications: {
        Row: {
          ai_score: number | null
          ai_screened_at: string | null
          ai_summary: string | null
          applied_at: string
          candidate_id: string
          company_id: string
          created_at: string
          id: string
          job_id: string
          rejected_reason: string | null
          stage: string
          tests_session_token: string | null
          updated_at: string
        }
        Insert: {
          ai_score?: number | null
          ai_screened_at?: string | null
          ai_summary?: string | null
          applied_at?: string
          candidate_id: string
          company_id: string
          created_at?: string
          id?: string
          job_id: string
          rejected_reason?: string | null
          stage?: string
          tests_session_token?: string | null
          updated_at?: string
        }
        Update: {
          ai_score?: number | null
          ai_screened_at?: string | null
          ai_summary?: string | null
          applied_at?: string
          candidate_id?: string
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string
          rejected_reason?: string | null
          stage?: string
          tests_session_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_applications_candidate_id_fkey"
            columns: ["candidate_id"]
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_applications_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "candidate_applications_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_applications_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "agent_recruitment_pipeline"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "candidate_applications_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "job_openings"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_embeddings: {
        Row: {
          candidate_id: string
          company_id: string
          content: string
          created_at: string
          embedding: string
          id: string
          model: string
          token_count: number | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          company_id: string
          content: string
          created_at?: string
          embedding: string
          id?: string
          model: string
          token_count?: number | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          company_id?: string
          content?: string
          created_at?: string
          embedding?: string
          id?: string
          model?: string
          token_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_embeddings_candidate_id_fkey"
            columns: ["candidate_id"]
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_embeddings_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "candidate_embeddings_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          company_id: string
          consent_lgpd_at: string | null
          consent_talent_pool: boolean
          cpf: string | null
          created_at: string
          cv_filename: string | null
          cv_processed_at: string | null
          cv_summary: string | null
          cv_url: string | null
          email: string | null
          id: string
          is_active: boolean
          linkedin_url: string | null
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          consent_lgpd_at?: string | null
          consent_talent_pool?: boolean
          cpf?: string | null
          created_at?: string
          cv_filename?: string | null
          cv_processed_at?: string | null
          cv_summary?: string | null
          cv_url?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          linkedin_url?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          consent_lgpd_at?: string | null
          consent_talent_pool?: boolean
          cpf?: string | null
          created_at?: string
          cv_filename?: string | null
          cv_processed_at?: string | null
          cv_summary?: string | null
          cv_url?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          linkedin_url?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "candidates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      closed_periods: {
        Row: {
          closed_by: string | null
          company_id: string
          created_at: string
          id: string
          month: number
          year: number
        }
        Insert: {
          closed_by?: string | null
          company_id: string
          created_at?: string
          id?: string
          month: number
          year: number
        }
        Update: {
          closed_by?: string | null
          company_id?: string
          created_at?: string
          id?: string
          month?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "closed_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "closed_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_absences: {
        Row: {
          bank_hours: number
          collaborator_id: string
          company_id: string
          created_at: string
          days: number | null
          external_id: string | null
          has_certificate: boolean
          id: string
          notes: string | null
          occurred_on: string | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          bank_hours?: number
          collaborator_id: string
          company_id: string
          created_at?: string
          days?: number | null
          external_id?: string | null
          has_certificate?: boolean
          id?: string
          notes?: string | null
          occurred_on?: string | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          bank_hours?: number
          collaborator_id?: string
          company_id?: string
          created_at?: string
          days?: number | null
          external_id?: string | null
          has_certificate?: boolean
          id?: string
          notes?: string | null
          occurred_on?: string | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_absences_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_absences_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_absences_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_alimony_orders: {
        Row: {
          beneficiary_bank_info: string | null
          beneficiary_cpf: string | null
          beneficiary_name: string
          calculation_type: Database["public"]["Enums"]["alimony_calculation_type"]
          case_number: string | null
          collaborator_id: string
          company_id: string
          court_order_doc_url: string | null
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          judgment_date: string | null
          notes: string | null
          status: Database["public"]["Enums"]["alimony_status"]
          updated_at: string
          value: number
        }
        Insert: {
          beneficiary_bank_info?: string | null
          beneficiary_cpf?: string | null
          beneficiary_name: string
          calculation_type: Database["public"]["Enums"]["alimony_calculation_type"]
          case_number?: string | null
          collaborator_id: string
          company_id: string
          court_order_doc_url?: string | null
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          judgment_date?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["alimony_status"]
          updated_at?: string
          value: number
        }
        Update: {
          beneficiary_bank_info?: string | null
          beneficiary_cpf?: string | null
          beneficiary_name?: string
          calculation_type?: Database["public"]["Enums"]["alimony_calculation_type"]
          case_number?: string | null
          collaborator_id?: string
          company_id?: string
          court_order_doc_url?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          judgment_date?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["alimony_status"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_alimony_orders_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_alimony_orders_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_alimony_orders_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_badges: {
        Row: {
          awarded_at: string
          awarded_by: string | null
          badge_id: string
          collaborator_id: string
          company_id: string
          created_at: string
          evidence: string | null
          evidence_url: string | null
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          awarded_at?: string
          awarded_by?: string | null
          badge_id: string
          collaborator_id: string
          company_id: string
          created_at?: string
          evidence?: string | null
          evidence_url?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          awarded_at?: string
          awarded_by?: string | null
          badge_id?: string
          collaborator_id?: string
          company_id?: string
          created_at?: string
          evidence?: string | null
          evidence_url?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_badges_badge_id_fkey"
            columns: ["badge_id"]
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_badges_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_badges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_badges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_dependents: {
        Row: {
          birth_certificate_url: string | null
          birth_date: string | null
          collaborator_id: string
          company_id: string
          cpf: string | null
          created_at: string
          external_id: string | null
          id: string
          is_health_plan_dependent: boolean
          is_invalid: boolean
          is_irpf_dependent: boolean
          kinship: Database["public"]["Enums"]["kinship_type"]
          name: string
          notes: string | null
          school_enrollment_url: string | null
          updated_at: string
          vaccination_card_url: string | null
        }
        Insert: {
          birth_certificate_url?: string | null
          birth_date?: string | null
          collaborator_id: string
          company_id: string
          cpf?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          is_health_plan_dependent?: boolean
          is_invalid?: boolean
          is_irpf_dependent?: boolean
          kinship: Database["public"]["Enums"]["kinship_type"]
          name: string
          notes?: string | null
          school_enrollment_url?: string | null
          updated_at?: string
          vaccination_card_url?: string | null
        }
        Update: {
          birth_certificate_url?: string | null
          birth_date?: string | null
          collaborator_id?: string
          company_id?: string
          cpf?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          is_health_plan_dependent?: boolean
          is_invalid?: boolean
          is_irpf_dependent?: boolean
          kinship?: Database["public"]["Enums"]["kinship_type"]
          name?: string
          notes?: string | null
          school_enrollment_url?: string | null
          updated_at?: string
          vaccination_card_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_dependents_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_dependents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_dependents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_documents: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          file_name: string
          file_url: string
          id: string
          position_document_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          position_document_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          position_document_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_documents_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_documents_position_document_id_fkey"
            columns: ["position_document_id"]
            referencedRelation: "position_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_emails: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          email: string
          external_id: string | null
          id: string
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          email: string
          external_id?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          email?: string
          external_id?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_emails_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_emails_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_emails_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_emergency_contacts: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          id: string
          is_primary: boolean
          kinship: Database["public"]["Enums"]["kinship_type"]
          name: string
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          kinship: Database["public"]["Enums"]["kinship_type"]
          name: string
          notes?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          kinship?: Database["public"]["Enums"]["kinship_type"]
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_emergency_contacts_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_emergency_contacts_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_emergency_contacts_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_extras: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          description: string | null
          external_id: string | null
          extra_type: string | null
          id: string
          inspira_group: string | null
          inspira_type: string | null
          is_disabled: boolean
          posted_at: string | null
          posted_by_username: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          description?: string | null
          external_id?: string | null
          extra_type?: string | null
          id?: string
          inspira_group?: string | null
          inspira_type?: string | null
          is_disabled?: boolean
          posted_at?: string | null
          posted_by_username?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          description?: string | null
          external_id?: string | null
          extra_type?: string | null
          id?: string
          inspira_group?: string | null
          inspira_type?: string | null
          is_disabled?: boolean
          posted_at?: string | null
          posted_by_username?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_extras_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_extras_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_extras_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_fixed_entries: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          type: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at: string
          value: number
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          type: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at?: string
          value: number
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          type?: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_fixed_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_fixed_entries_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_fixed_entries_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_health_plans: {
        Row: {
          beneficiary_birth: string | null
          beneficiary_cpf: string | null
          beneficiary_name: string | null
          beneficiary_type: string | null
          collaborator_id: string
          company_id: string
          created_at: string
          disabled_at: string | null
          external_id: string | null
          id: string
          is_disabled: boolean
          notes: string | null
          plan_name: string | null
          plan_value: number | null
          registration_code: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          beneficiary_birth?: string | null
          beneficiary_cpf?: string | null
          beneficiary_name?: string | null
          beneficiary_type?: string | null
          collaborator_id: string
          company_id: string
          created_at?: string
          disabled_at?: string | null
          external_id?: string | null
          id?: string
          is_disabled?: boolean
          notes?: string | null
          plan_name?: string | null
          plan_value?: number | null
          registration_code?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          beneficiary_birth?: string | null
          beneficiary_cpf?: string | null
          beneficiary_name?: string | null
          beneficiary_type?: string | null
          collaborator_id?: string
          company_id?: string
          created_at?: string
          disabled_at?: string | null
          external_id?: string | null
          id?: string
          is_disabled?: boolean
          notes?: string | null
          plan_name?: string | null
          plan_value?: number | null
          registration_code?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_health_plans_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_health_plans_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_health_plans_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_internships: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          end_date: string | null
          external_id: string | null
          flagged: boolean
          id: string
          is_renewal: boolean
          notification_sent: boolean
          start_date: string | null
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          end_date?: string | null
          external_id?: string | null
          flagged?: boolean
          id?: string
          is_renewal?: boolean
          notification_sent?: boolean
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          end_date?: string | null
          external_id?: string | null
          flagged?: boolean
          id?: string
          is_renewal?: boolean
          notification_sent?: boolean
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_internships_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_internships_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_internships_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_leaves: {
        Row: {
          collaborator_id: string
          company_id: string
          compensated: number | null
          created_at: string
          description: string | null
          end_date: string | null
          external_id: string | null
          has_certificate: boolean
          id: string
          posted_at: string | null
          posted_by_username: string | null
          reason_code: number | null
          start_date: string | null
          trip_id: number | null
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          compensated?: number | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          external_id?: string | null
          has_certificate?: boolean
          id?: string
          posted_at?: string | null
          posted_by_username?: string | null
          reason_code?: number | null
          start_date?: string | null
          trip_id?: number | null
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          compensated?: number | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          external_id?: string | null
          has_certificate?: boolean
          id?: string
          posted_at?: string | null
          posted_by_username?: string | null
          reason_code?: number | null
          start_date?: string | null
          trip_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_leaves_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_leaves_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_leaves_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_medical_certificates: {
        Row: {
          cid_code: string | null
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string | null
          days_off: number
          doctor_crm: string | null
          doctor_name: string | null
          document_url: string | null
          id: string
          issued_at: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          cid_code?: string | null
          collaborator_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          days_off: number
          doctor_crm?: string | null
          doctor_name?: string | null
          document_url?: string | null
          id?: string
          issued_at: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          cid_code?: string | null
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          days_off?: number
          doctor_crm?: string | null
          doctor_name?: string | null
          document_url?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_medical_certificates_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_medical_certificates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_medical_certificates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_notifications: {
        Row: {
          body: string | null
          collaborator_id: string
          created_at: string
          id: string
          is_read: boolean
          payload: Json | null
          read_at: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          collaborator_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json | null
          read_at?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          collaborator_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json | null
          read_at?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_notifications_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_pdvs: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          external_id: string | null
          f10: number
          id: string
          pdv_name: string | null
          store_id: string | null
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          external_id?: string | null
          f10?: number
          id?: string
          pdv_name?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          external_id?: string | null
          f10?: number
          id?: string
          pdv_name?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_pdvs_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_pdvs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_pdvs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_pdvs_store_id_fkey"
            columns: ["store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_timeline_events: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string | null
          effective_date: string
          event_type: Database["public"]["Enums"]["collaborator_timeline_event_type"]
          external_id: string | null
          from_value: Json | null
          id: string
          reason: string | null
          to_value: Json | null
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          event_type: Database["public"]["Enums"]["collaborator_timeline_event_type"]
          external_id?: string | null
          from_value?: Json | null
          id?: string
          reason?: string | null
          to_value?: Json | null
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          event_type?: Database["public"]["Enums"]["collaborator_timeline_event_type"]
          external_id?: string | null
          from_value?: Json | null
          id?: string
          reason?: string | null
          to_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_timeline_events_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_timeline_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_timeline_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_uniform_sizes: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          id: string
          jacket_size: string | null
          measured_at: string
          measured_by: string | null
          notes: string | null
          pants_size: string | null
          shirt_size: string | null
          shoe_size: string | null
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          id?: string
          jacket_size?: string | null
          measured_at?: string
          measured_by?: string | null
          notes?: string | null
          pants_size?: string | null
          shirt_size?: string | null
          shoe_size?: string | null
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          id?: string
          jacket_size?: string | null
          measured_at?: string
          measured_by?: string | null
          notes?: string | null
          pants_size?: string | null
          shirt_size?: string | null
          shoe_size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_uniform_sizes_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_uniform_sizes_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_uniform_sizes_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborators: {
        Row: {
          accounting_code: string | null
          address: string | null
          admission_date: string | null
          agenda: string | null
          bank_account: string | null
          birth_date: string | null
          city: string | null
          commission_license: number | null
          commission_monthly: number | null
          commission_tef_install: number | null
          commission_tef_monthly: number | null
          commission_upgrade: number | null
          company_id: string
          contracted_cnpj: string | null
          contracted_store_id: string | null
          cpf: string | null
          created_at: string
          ctps: string | null
          ctps_series: string | null
          ctps_uf: string | null
          current_salary: number | null
          dependents_count: number
          discord_id: string | null
          discord_username: string | null
          district: string | null
          education_level: string | null
          email: string | null
          ethnicity: string | null
          external_id: string | null
          gender: string | null
          has_agenda_access: boolean
          id: string
          indicator_group: string | null
          inspira_date: string | null
          inspira_value: number | null
          internal_code: string | null
          internal_location: string | null
          is_apprentice: boolean
          is_godfather: boolean
          is_homeoffice: boolean
          is_manager_director: boolean
          is_manager_leader: boolean
          is_manager_support: boolean
          is_pcd: boolean
          is_temp: boolean
          name: string
          notes: string | null
          phone: string | null
          phone_extension: string | null
          photo_url: string | null
          pis: string | null
          pix_key: string | null
          pix_key_normalized: string | null
          pix_key_type: Database["public"]["Enums"]["pix_key_type"] | null
          position: string | null
          position_id: string | null
          postal_code: string | null
          radios_freeform: string | null
          recado_phone: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"]
          rg: string | null
          rg_issuer: string | null
          sales_group: string | null
          softcom_surname: string | null
          state: string | null
          status: Database["public"]["Enums"]["collaborator_status"]
          store_id: string | null
          subsector: string | null
          supervisor_id: string | null
          support_username: string | null
          team_id: string | null
          termination_date: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accounting_code?: string | null
          address?: string | null
          admission_date?: string | null
          agenda?: string | null
          bank_account?: string | null
          birth_date?: string | null
          city?: string | null
          commission_license?: number | null
          commission_monthly?: number | null
          commission_tef_install?: number | null
          commission_tef_monthly?: number | null
          commission_upgrade?: number | null
          company_id: string
          contracted_cnpj?: string | null
          contracted_store_id?: string | null
          cpf?: string | null
          created_at?: string
          ctps?: string | null
          ctps_series?: string | null
          ctps_uf?: string | null
          current_salary?: number | null
          dependents_count?: number
          discord_id?: string | null
          discord_username?: string | null
          district?: string | null
          education_level?: string | null
          email?: string | null
          ethnicity?: string | null
          external_id?: string | null
          gender?: string | null
          has_agenda_access?: boolean
          id?: string
          indicator_group?: string | null
          inspira_date?: string | null
          inspira_value?: number | null
          internal_code?: string | null
          internal_location?: string | null
          is_apprentice?: boolean
          is_godfather?: boolean
          is_homeoffice?: boolean
          is_manager_director?: boolean
          is_manager_leader?: boolean
          is_manager_support?: boolean
          is_pcd?: boolean
          is_temp?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          phone_extension?: string | null
          photo_url?: string | null
          pis?: string | null
          pix_key?: string | null
          pix_key_normalized?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          position?: string | null
          position_id?: string | null
          postal_code?: string | null
          radios_freeform?: string | null
          recado_phone?: string | null
          regime?: Database["public"]["Enums"]["collaborator_regime"]
          rg?: string | null
          rg_issuer?: string | null
          sales_group?: string | null
          softcom_surname?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["collaborator_status"]
          store_id?: string | null
          subsector?: string | null
          supervisor_id?: string | null
          support_username?: string | null
          team_id?: string | null
          termination_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accounting_code?: string | null
          address?: string | null
          admission_date?: string | null
          agenda?: string | null
          bank_account?: string | null
          birth_date?: string | null
          city?: string | null
          commission_license?: number | null
          commission_monthly?: number | null
          commission_tef_install?: number | null
          commission_tef_monthly?: number | null
          commission_upgrade?: number | null
          company_id?: string
          contracted_cnpj?: string | null
          contracted_store_id?: string | null
          cpf?: string | null
          created_at?: string
          ctps?: string | null
          ctps_series?: string | null
          ctps_uf?: string | null
          current_salary?: number | null
          dependents_count?: number
          discord_id?: string | null
          discord_username?: string | null
          district?: string | null
          education_level?: string | null
          email?: string | null
          ethnicity?: string | null
          external_id?: string | null
          gender?: string | null
          has_agenda_access?: boolean
          id?: string
          indicator_group?: string | null
          inspira_date?: string | null
          inspira_value?: number | null
          internal_code?: string | null
          internal_location?: string | null
          is_apprentice?: boolean
          is_godfather?: boolean
          is_homeoffice?: boolean
          is_manager_director?: boolean
          is_manager_leader?: boolean
          is_manager_support?: boolean
          is_pcd?: boolean
          is_temp?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          phone_extension?: string | null
          photo_url?: string | null
          pis?: string | null
          pix_key?: string | null
          pix_key_normalized?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          position?: string | null
          position_id?: string | null
          postal_code?: string | null
          radios_freeform?: string | null
          recado_phone?: string | null
          regime?: Database["public"]["Enums"]["collaborator_regime"]
          rg?: string | null
          rg_issuer?: string | null
          sales_group?: string | null
          softcom_surname?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["collaborator_status"]
          store_id?: string | null
          subsector?: string | null
          supervisor_id?: string | null
          support_username?: string | null
          team_id?: string | null
          termination_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborators_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborators_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_contracted_store_id_fkey"
            columns: ["contracted_store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_position_id_fkey"
            columns: ["position_id"]
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_store_id_fkey"
            columns: ["store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_supervisor_id_fkey"
            columns: ["supervisor_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_team_id_fkey"
            columns: ["team_id"]
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          cnpj: string | null
          company_name: string
          created_at: string
          email: string | null
          id: string
          is_matriz: boolean
          logo_url: string | null
          owner_id: string
          parent_company_id: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          cnpj?: string | null
          company_name: string
          created_at?: string
          email?: string | null
          id?: string
          is_matriz?: boolean
          logo_url?: string | null
          owner_id: string
          parent_company_id?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          cnpj?: string | null
          company_name?: string
          created_at?: string
          email?: string | null
          id?: string
          is_matriz?: boolean
          logo_url?: string | null
          owner_id?: string
          parent_company_id?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_users: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          is_active: boolean | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string | null
          email: string
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_users_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_users_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dep_irpf_backfill_backup_202606: {
        Row: {
          backed_up_at: string | null
          collaborator_id: string | null
          id: string | null
          original_flag: boolean | null
        }
        Insert: {
          backed_up_at?: string | null
          collaborator_id?: string | null
          id?: string | null
          original_flag?: boolean | null
        }
        Update: {
          backed_up_at?: string | null
          collaborator_id?: string | null
          id?: string | null
          original_flag?: boolean | null
        }
        Relationships: []
      }
      exam_documents: {
        Row: {
          company_id: string
          created_at: string
          exam_id: string
          file_name: string
          file_url: string
          id: string
          uploaded_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          exam_id: string
          file_name: string
          file_url: string
          id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          exam_id?: string
          file_name?: string
          file_url?: string
          id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "exam_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_documents_exam_id_fkey"
            columns: ["exam_id"]
            referencedRelation: "occupational_exams"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_feedbacks: {
        Row: {
          ai_summary: string | null
          application_id: string
          company_id: string
          created_at: string
          id: string
          interviewer_id: string | null
          notes: string | null
          recommendation: string
          schedule_id: string
          scores: Json | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          application_id: string
          company_id: string
          created_at?: string
          id?: string
          interviewer_id?: string | null
          notes?: string | null
          recommendation: string
          schedule_id: string
          scores?: Json | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          application_id?: string
          company_id?: string
          created_at?: string
          id?: string
          interviewer_id?: string | null
          notes?: string | null
          recommendation?: string
          schedule_id?: string
          scores?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_feedbacks_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "candidate_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_feedbacks_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "interview_feedbacks_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_feedbacks_schedule_id_fkey"
            columns: ["schedule_id"]
            referencedRelation: "interview_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_schedules: {
        Row: {
          application_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          company_id: string
          created_at: string
          duration_minutes: number
          id: string
          interviewer_id: string | null
          location: string | null
          notes: string | null
          scheduled_for: string
          updated_at: string
        }
        Insert: {
          application_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_id: string
          created_at?: string
          duration_minutes?: number
          id?: string
          interviewer_id?: string | null
          location?: string | null
          notes?: string | null
          scheduled_for: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          interviewer_id?: string | null
          location?: string | null
          notes?: string | null
          scheduled_for?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_schedules_application_id_fkey"
            columns: ["application_id"]
            referencedRelation: "candidate_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_schedules_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "interview_schedules_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      job_openings: {
        Row: {
          closed_at: string | null
          company_id: string
          created_at: string
          description: string | null
          hiring_manager_id: string | null
          id: string
          notes: string | null
          opened_at: string | null
          pipeline_stages: string[]
          position_id: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"]
          requirements: string | null
          status: Database["public"]["Enums"]["job_opening_status"]
          team_id: string | null
          title: string
          updated_at: string
          vacancies_count: number
        }
        Insert: {
          closed_at?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          hiring_manager_id?: string | null
          id?: string
          notes?: string | null
          opened_at?: string | null
          pipeline_stages?: string[]
          position_id?: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"]
          requirements?: string | null
          status?: Database["public"]["Enums"]["job_opening_status"]
          team_id?: string | null
          title: string
          updated_at?: string
          vacancies_count?: number
        }
        Update: {
          closed_at?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          hiring_manager_id?: string | null
          id?: string
          notes?: string | null
          opened_at?: string | null
          pipeline_stages?: string[]
          position_id?: string | null
          regime?: Database["public"]["Enums"]["collaborator_regime"]
          requirements?: string | null
          status?: Database["public"]["Enums"]["job_opening_status"]
          team_id?: string | null
          title?: string
          updated_at?: string
          vacancies_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_openings_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "job_openings_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_openings_position_id_fkey"
            columns: ["position_id"]
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_openings_team_id_fkey"
            columns: ["team_id"]
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_milestones: {
        Row: {
          badges_count: number
          collaborator_id: string
          company_id: string
          created_at: string
          due_date: string
          evaluated_at: string | null
          evaluated_by: string | null
          id: string
          kind: Database["public"]["Enums"]["journey_milestone_kind"]
          notes: string | null
          status: Database["public"]["Enums"]["journey_milestone_status"]
          updated_at: string
        }
        Insert: {
          badges_count?: number
          collaborator_id: string
          company_id: string
          created_at?: string
          due_date: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["journey_milestone_kind"]
          notes?: string | null
          status?: Database["public"]["Enums"]["journey_milestone_status"]
          updated_at?: string
        }
        Update: {
          badges_count?: number
          collaborator_id?: string
          company_id?: string
          created_at?: string
          due_date?: string
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["journey_milestone_kind"]
          notes?: string | null
          status?: Database["public"]["Enums"]["journey_milestone_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_milestones_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_milestones_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "journey_milestones_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          collaborator_id: string | null
          company_id: string
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          message_sent: string
          phone_number: string | null
          status: string
        }
        Insert: {
          collaborator_id?: string | null
          company_id: string
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          message_sent: string
          phone_number?: string | null
          status?: string
        }
        Update: {
          collaborator_id?: string | null
          company_id?: string
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          message_sent?: string
          phone_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "notification_logs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          company_id: string
          created_at: string
          event_type: string
          id: string
          is_enabled: boolean
          message_template: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          is_enabled?: boolean
          message_template: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          is_enabled?: boolean
          message_template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "notification_templates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      occupational_exams: {
        Row: {
          auto_generated: boolean
          collaborator_id: string
          company_id: string
          completed_date: string | null
          created_at: string
          created_by: string | null
          due_date: string
          exam_type: string
          external_id: string | null
          id: string
          notes: string | null
          position_id: string | null
          previous_position_id: string | null
          risk_group_at_time: string | null
          scheduled_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          collaborator_id: string
          company_id: string
          completed_date?: string | null
          created_at?: string
          created_by?: string | null
          due_date: string
          exam_type: string
          external_id?: string | null
          id?: string
          notes?: string | null
          position_id?: string | null
          previous_position_id?: string | null
          risk_group_at_time?: string | null
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          collaborator_id?: string
          company_id?: string
          completed_date?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string
          exam_type?: string
          external_id?: string | null
          id?: string
          notes?: string | null
          position_id?: string | null
          previous_position_id?: string | null
          risk_group_at_time?: string | null
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occupational_exams_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occupational_exams_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "occupational_exams_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occupational_exams_position_id_fkey"
            columns: ["position_id"]
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occupational_exams_previous_position_id_fkey"
            columns: ["previous_position_id"]
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_errors: {
        Row: {
          created_at: string
          description: string
          id: string
          onboarding_session_id: string
          step: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          onboarding_session_id: string
          step: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          onboarding_session_id?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_errors_onboarding_session_id_fkey"
            columns: ["onboarding_session_id"]
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          collaborator_id: string
          company_id: string
          completed_at: string | null
          created_at: string
          current_step: number
          data_validated: boolean
          documents_completed: boolean
          financial_validated: boolean
          id: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          data_validated?: boolean
          documents_completed?: boolean
          financial_validated?: boolean
          id?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          data_validated?: boolean
          documents_completed?: boolean
          financial_validated?: boolean
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_sessions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "onboarding_sessions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_2fa_challenges: {
        Row: {
          attempts: number
          code_hash: string
          company_id: string
          consumed_at: string | null
          created_at: string
          device_id: string | null
          expires_at: string
          factor_type: string
          failed_at: string | null
          id: string
          max_attempts: number
          purpose: string
          salt: string
          sent_to_last4: string | null
          transfer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          company_id: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string | null
          expires_at: string
          factor_type?: string
          failed_at?: string | null
          id?: string
          max_attempts?: number
          purpose: string
          salt: string
          sent_to_last4?: string | null
          transfer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          company_id?: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string | null
          expires_at?: string
          factor_type?: string
          failed_at?: string | null
          id?: string
          max_attempts?: number
          purpose?: string
          salt?: string
          sent_to_last4?: string | null
          transfer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_2fa_challenges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payment_2fa_challenges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_2fa_challenges_device_id_fkey"
            columns: ["device_id"]
            referencedRelation: "payment_2fa_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_2fa_challenges_transfer_id_fkey"
            columns: ["transfer_id"]
            referencedRelation: "payroll_pix_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_2fa_devices: {
        Row: {
          active_from: string | null
          company_id: string
          created_at: string
          id: string
          locked_until: string | null
          phone: string
          phone_last4: string | null
          revoked_at: string | null
          revoked_reason: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          active_from?: string | null
          company_id: string
          created_at?: string
          id?: string
          locked_until?: string | null
          phone: string
          phone_last4?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          active_from?: string | null
          company_id?: string
          created_at?: string
          id?: string
          locked_until?: string | null
          phone?: string
          phone_last4?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_2fa_devices_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payment_2fa_devices_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_2fa_events: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          ip: string | null
          kind: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          kind: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          kind?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_2fa_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payment_2fa_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_alerts: {
        Row: {
          collaborator_id: string | null
          company_id: string
          context: Json | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["payroll_alert_kind"]
          message: string
          period_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["payroll_alert_severity"]
          updated_at: string
        }
        Insert: {
          collaborator_id?: string | null
          company_id: string
          context?: Json | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["payroll_alert_kind"]
          message: string
          period_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["payroll_alert_severity"]
          updated_at?: string
        }
        Update: {
          collaborator_id?: string | null
          company_id?: string
          context?: Json | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payroll_alert_kind"]
          message?: string
          period_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["payroll_alert_severity"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_alerts_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_alerts_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_alerts_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_alerts_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_collaborator_reviews: {
        Row: {
          collaborator_id: string
          created_at: string
          director_status: string | null
          director_status_at: string | null
          director_status_by: string | null
          id: string
          is_reviewed: boolean
          observation: string | null
          period_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          director_status?: string | null
          director_status_at?: string | null
          director_status_by?: string | null
          id?: string
          is_reviewed?: boolean
          observation?: string | null
          period_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          director_status?: string | null
          director_status_at?: string | null
          director_status_by?: string | null
          id?: string
          is_reviewed?: boolean
          observation?: string | null
          period_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_collaborator_reviews_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_collaborator_reviews_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          archived_period_id: string | null
          collaborator_id: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          external_id: string | null
          id: string
          installment_group_id: string | null
          installment_number: number | null
          installment_total: number | null
          is_fixed: boolean
          is_payable: boolean
          month: number
          store_id: string | null
          type: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at: string
          value: number
          year: number
        }
        Insert: {
          archived_period_id?: string | null
          collaborator_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_fixed?: boolean
          is_payable?: boolean
          month: number
          store_id?: string | null
          type: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at?: string
          value: number
          year: number
        }
        Update: {
          archived_period_id?: string | null
          collaborator_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_fixed?: boolean
          is_payable?: boolean
          month?: number
          store_id?: string | null
          type?: Database["public"]["Enums"]["payroll_entry_type"]
          updated_at?: string
          value?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_archived_period_id_fkey"
            columns: ["archived_period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_entries_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_store_id_fkey"
            columns: ["store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries_fixed_backup_20260618: {
        Row: {
          collaborator_id: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          external_id: string | null
          id: string | null
          installment_group_id: string | null
          installment_number: number | null
          installment_total: number | null
          is_fixed: boolean | null
          is_payable: boolean | null
          month: number | null
          store_id: string | null
          type: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at: string | null
          value: number | null
          year: number | null
        }
        Insert: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          id?: string | null
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_fixed?: boolean | null
          is_payable?: boolean | null
          month?: number | null
          store_id?: string | null
          type?: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at?: string | null
          value?: number | null
          year?: number | null
        }
        Update: {
          collaborator_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          id?: string | null
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_fixed?: boolean | null
          is_payable?: boolean | null
          month?: number | null
          store_id?: string | null
          type?: Database["public"]["Enums"]["payroll_entry_type"] | null
          updated_at?: string | null
          value?: number | null
          year?: number | null
        }
        Relationships: []
      }
      payroll_payable_lines: {
        Row: {
          built_at: string
          built_from_status: Database["public"]["Enums"]["payroll_period_status"]
          collaborator_id: string
          company_id: string
          components: Json
          created_at: string
          discounts: Json
          entry_id: string
          gross: number
          has_alimony_block: boolean
          id: string
          inss: number
          irpf: number
          kind: string
          net_amount: number
          other_deductions: number
          payee_document: string | null
          payee_name: string
          payee_pix_key: string | null
          payee_pix_key_norm: string | null
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"] | null
          period_id: string
          updated_at: string
        }
        Insert: {
          built_at?: string
          built_from_status: Database["public"]["Enums"]["payroll_period_status"]
          collaborator_id: string
          company_id: string
          components: Json
          created_at?: string
          discounts?: Json
          entry_id: string
          gross: number
          has_alimony_block?: boolean
          id?: string
          inss?: number
          irpf?: number
          kind: string
          net_amount: number
          other_deductions?: number
          payee_document?: string | null
          payee_name: string
          payee_pix_key?: string | null
          payee_pix_key_norm?: string | null
          payee_pix_key_type?:
            | Database["public"]["Enums"]["pix_key_type"]
            | null
          period_id: string
          updated_at?: string
        }
        Update: {
          built_at?: string
          built_from_status?: Database["public"]["Enums"]["payroll_period_status"]
          collaborator_id?: string
          company_id?: string
          components?: Json
          created_at?: string
          discounts?: Json
          entry_id?: string
          gross?: number
          has_alimony_block?: boolean
          id?: string
          inss?: number
          irpf?: number
          kind?: string
          net_amount?: number
          other_deductions?: number
          payee_document?: string | null
          payee_name?: string
          payee_pix_key?: string | null
          payee_pix_key_norm?: string | null
          payee_pix_key_type?:
            | Database["public"]["Enums"]["pix_key_type"]
            | null
          period_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payable_lines_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payable_lines_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_payable_lines_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payable_lines_entry_id_fkey"
            columns: ["entry_id"]
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payable_lines_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          entry_id: string
          id: string
          method: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          period_id: string
          settled_transfer_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string
          entry_id: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_id: string
          settled_transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          entry_id?: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_id?: string
          settled_transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payments_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_payments_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_entry_id_fkey"
            columns: ["entry_id"]
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_settled_transfer_id_fkey"
            columns: ["settled_transfer_id"]
            referencedRelation: "payroll_pix_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_period_approvals: {
        Row: {
          action: string
          actor_role: string
          company_id: string
          created_at: string
          created_by: string | null
          from_status:
            | Database["public"]["Enums"]["payroll_period_status"]
            | null
          id: string
          period_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["payroll_period_status"]
        }
        Insert: {
          action: string
          actor_role: string
          company_id: string
          created_at?: string
          created_by?: string | null
          from_status?:
            | Database["public"]["Enums"]["payroll_period_status"]
            | null
          id?: string
          period_id: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["payroll_period_status"]
        }
        Update: {
          action?: string
          actor_role?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          from_status?:
            | Database["public"]["Enums"]["payroll_period_status"]
            | null
          id?: string
          period_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["payroll_period_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payroll_period_approvals_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_period_approvals_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_approvals_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_period_notes: {
        Row: {
          author_stage: string
          body: string
          collaborator_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_resolved: boolean
          period_id: string
          period_status_at_note:
            | Database["public"]["Enums"]["payroll_period_status"]
            | null
          resolved_at: string | null
          resolved_by: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          author_stage?: string
          body: string
          collaborator_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_resolved?: boolean
          period_id: string
          period_status_at_note?:
            | Database["public"]["Enums"]["payroll_period_status"]
            | null
          resolved_at?: string | null
          resolved_by?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          author_stage?: string
          body?: string
          collaborator_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_resolved?: boolean
          period_id?: string
          period_status_at_note?:
            | Database["public"]["Enums"]["payroll_period_status"]
            | null
          resolved_at?: string | null
          resolved_by?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_period_notes_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_notes_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_period_notes_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_period_notes_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          approved_dir_at: string | null
          approved_dir_by: string | null
          approved_rh_at: string | null
          approved_rh_by: string | null
          archive_reason: string | null
          archived_at: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          export_file_hash: string | null
          export_file_url: string | null
          exported_at: string | null
          exported_by: string | null
          id: string
          notes: string | null
          reference_month: string
          returned_at: string | null
          returned_by: string | null
          returned_reason: string | null
          status: Database["public"]["Enums"]["payroll_period_status"]
          updated_at: string
        }
        Insert: {
          approved_dir_at?: string | null
          approved_dir_by?: string | null
          approved_rh_at?: string | null
          approved_rh_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          export_file_hash?: string | null
          export_file_url?: string | null
          exported_at?: string | null
          exported_by?: string | null
          id?: string
          notes?: string | null
          reference_month: string
          returned_at?: string | null
          returned_by?: string | null
          returned_reason?: string | null
          status?: Database["public"]["Enums"]["payroll_period_status"]
          updated_at?: string
        }
        Update: {
          approved_dir_at?: string | null
          approved_dir_by?: string | null
          approved_rh_at?: string | null
          approved_rh_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          export_file_hash?: string | null
          export_file_url?: string | null
          exported_at?: string | null
          exported_by?: string | null
          id?: string
          notes?: string | null
          reference_month?: string
          returned_at?: string | null
          returned_by?: string | null
          returned_reason?: string | null
          status?: Database["public"]["Enums"]["payroll_period_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_pix_transfers: {
        Row: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          attempt: number
          check_count?: number
          collaborator_id: string
          company_id: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          end_to_end_id?: string | null
          entry_id: string
          environment: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          http_status?: number | null
          id?: string
          idempotency_key: string
          last_checked_at?: string | null
          next_check_at?: string | null
          payable_line_id?: string | null
          payee_document?: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot?: Json | null
          period_id: string
          provider?: string
          provider_payment_id?: string | null
          provider_status?: string | null
          request_payload?: Json | null
          resolved_by?: string | null
          resolved_reason?: string | null
          response_payload?: Json | null
          sent_at?: string | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          attempt?: number
          check_count?: number
          collaborator_id?: string
          company_id?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          end_to_end_id?: string | null
          entry_id?: string
          environment?: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string
          last_checked_at?: string | null
          next_check_at?: string | null
          payable_line_id?: string | null
          payee_document?: string | null
          payee_name?: string
          payee_pix_key?: string
          payee_pix_key_norm?: string
          payee_pix_key_type?: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot?: Json | null
          period_id?: string
          provider?: string
          provider_payment_id?: string | null
          provider_status?: string | null
          request_payload?: Json | null
          resolved_by?: string | null
          resolved_reason?: string | null
          response_payload?: Json | null
          sent_at?: string | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_pix_transfers_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_pix_transfers_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_pix_transfers_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_pix_transfers_entry_id_fkey"
            columns: ["entry_id"]
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_pix_transfers_payable_line_id_fkey"
            columns: ["payable_line_id"]
            referencedRelation: "payroll_payable_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_pix_transfers_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_validation_items: {
        Row: {
          actual_value: number | null
          check_group: string
          check_label: string
          collaborator_id: string | null
          collaborator_name: string
          company_id: string
          created_at: string
          diff: number | null
          direction: string | null
          expected_value: number | null
          id: string
          notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          updated_at: string
          validation_id: string
        }
        Insert: {
          actual_value?: number | null
          check_group: string
          check_label: string
          collaborator_id?: string | null
          collaborator_name: string
          company_id: string
          created_at?: string
          diff?: number | null
          direction?: string | null
          expected_value?: number | null
          id?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
          validation_id: string
        }
        Update: {
          actual_value?: number | null
          check_group?: string
          check_label?: string
          collaborator_id?: string | null
          collaborator_name?: string
          company_id?: string
          created_at?: string
          diff?: number | null
          direction?: string | null
          expected_value?: number | null
          id?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
          validation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_validation_items_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_validation_items_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_validation_items_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_validation_items_validation_id_fkey"
            columns: ["validation_id"]
            referencedRelation: "payroll_validations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_validation_logs: {
        Row: {
          action: string
          company_id: string
          created_at: string
          id: string
          item_id: string | null
          notes: string | null
          user_id: string | null
          validation_id: string
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          id?: string
          item_id?: string | null
          notes?: string | null
          user_id?: string | null
          validation_id: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          id?: string
          item_id?: string | null
          notes?: string | null
          user_id?: string | null
          validation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_validation_logs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_validation_logs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_validation_logs_item_id_fkey"
            columns: ["item_id"]
            referencedRelation: "payroll_validation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_validation_logs_validation_id_fkey"
            columns: ["validation_id"]
            referencedRelation: "payroll_validations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_validations: {
        Row: {
          collaborators_matched: number
          collaborators_total: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          items_resolved: number
          items_total: number
          pdf_file_names: string[]
          reference_month: string
          status: string
          updated_at: string
        }
        Insert: {
          collaborators_matched?: number
          collaborators_total?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          items_resolved?: number
          items_total?: number
          pdf_file_names?: string[]
          reference_month: string
          status?: string
          updated_at?: string
        }
        Update: {
          collaborators_matched?: number
          collaborators_total?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          items_resolved?: number
          items_total?: number
          pdf_file_names?: string[]
          reference_month?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_validations_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payroll_validations_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          collaborator_id: string
          company_id: string
          file_name: string
          file_url: string
          id: string
          month: number
          uploaded_at: string
          uploaded_by: string | null
          year: number
        }
        Insert: {
          collaborator_id: string
          company_id: string
          file_name: string
          file_url: string
          id?: string
          month: number
          uploaded_at?: string
          uploaded_by?: string | null
          year: number
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          file_name?: string
          file_url?: string
          id?: string
          month?: number
          uploaded_at?: string
          uploaded_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "payslips_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payslips_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      position_documents: {
        Row: {
          company_id: string
          created_at: string
          file_type: string
          id: string
          name: string
          observation: string | null
          position_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          file_type?: string
          id?: string
          name: string
          observation?: string | null
          position_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          file_type?: string
          id?: string
          name?: string
          observation?: string | null
          position_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "position_documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_documents_position_id_fkey"
            columns: ["position_id"]
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          company_id: string
          created_at: string
          exam_periodicity_months: number | null
          external_id: string | null
          fgts_percent: number | null
          id: string
          inss_percent: number | null
          irpf_percent: number | null
          is_active: boolean
          level: number | null
          name: string
          risk_group: string | null
          salary: number
          team_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          exam_periodicity_months?: number | null
          external_id?: string | null
          fgts_percent?: number | null
          id?: string
          inss_percent?: number | null
          irpf_percent?: number | null
          is_active?: boolean
          level?: number | null
          name: string
          risk_group?: string | null
          salary?: number
          team_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          exam_periodicity_months?: number | null
          external_id?: string | null
          fgts_percent?: number | null
          id?: string
          inss_percent?: number | null
          irpf_percent?: number | null
          is_active?: boolean
          level?: number | null
          name?: string
          risk_group?: string | null
          salary?: number
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "positions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_team_id_fkey"
            columns: ["team_id"]
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          full_name: string | null
          id: string
          store_id: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          store_id?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          store_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_store_id_fkey"
            columns: ["store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      reajuste_saude_202606_backup_entries: {
        Row: {
          backed_up_at: string | null
          collaborator_id: string | null
          company_id: string | null
          description: string | null
          id: string | null
          original_value: number | null
        }
        Insert: {
          backed_up_at?: string | null
          collaborator_id?: string | null
          company_id?: string | null
          description?: string | null
          id?: string | null
          original_value?: number | null
        }
        Update: {
          backed_up_at?: string | null
          collaborator_id?: string | null
          company_id?: string | null
          description?: string | null
          id?: string | null
          original_value?: number | null
        }
        Relationships: []
      }
      reajuste_saude_202606_backup_plans: {
        Row: {
          backed_up_at: string | null
          collaborator_id: string | null
          id: string | null
          original_value: number | null
        }
        Insert: {
          backed_up_at?: string | null
          collaborator_id?: string | null
          id?: string | null
          original_value?: number | null
        }
        Update: {
          backed_up_at?: string | null
          collaborator_id?: string | null
          id?: string | null
          original_value?: number | null
        }
        Relationships: []
      }
      store_holidays: {
        Row: {
          company_id: string
          created_at: string
          date: string
          id: string
          name: string
          source: string | null
          store_id: string
          type: Database["public"]["Enums"]["holiday_type"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          date: string
          id?: string
          name: string
          source?: string | null
          store_id: string
          type?: Database["public"]["Enums"]["holiday_type"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          date?: string
          id?: string
          name?: string
          source?: string | null
          store_id?: string
          type?: Database["public"]["Enums"]["holiday_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_holidays_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "store_holidays_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_holidays_store_id_fkey"
            columns: ["store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          cnpj: string | null
          company_id: string
          created_at: string
          external_id: string | null
          id: string
          is_active: boolean
          store_code: string | null
          store_name: string
        }
        Insert: {
          address?: string | null
          cnpj?: string | null
          company_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          is_active?: boolean
          store_code?: string | null
          store_name: string
        }
        Update: {
          address?: string | null
          cnpj?: string | null
          company_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          is_active?: boolean
          store_code?: string | null
          store_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "stores_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          current_step: string | null
          cursor: Json | null
          deactivated: number
          error_message: string | null
          errors: Json
          finished_at: string | null
          id: string
          inserted: number
          options: Json | null
          processed: number
          resource: string
          result: Json | null
          started_at: string | null
          status: string
          total: number
          updated: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          cursor?: Json | null
          deactivated?: number
          error_message?: string | null
          errors?: Json
          finished_at?: string | null
          id?: string
          inserted?: number
          options?: Json | null
          processed?: number
          resource: string
          result?: Json | null
          started_at?: string | null
          status?: string
          total?: number
          updated?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          cursor?: Json | null
          deactivated?: number
          error_message?: string | null
          errors?: Json
          finished_at?: string | null
          id?: string
          inserted?: number
          options?: Json | null
          processed?: number
          resource?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          total?: number
          updated?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "sync_jobs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_messages: {
        Row: {
          body: string
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          image_url: string | null
          is_read: boolean | null
          message_type: string
          read_at: string | null
          title: string
          visible_until: string | null
        }
        Insert: {
          body: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          is_read?: boolean | null
          message_type?: string
          read_at?: string | null
          title: string
          visible_until?: string | null
        }
        Update: {
          body?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          is_read?: boolean | null
          message_type?: string
          read_at?: string | null
          title?: string
          visible_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_messages_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "system_messages_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          external_id: string | null
          id: string
          is_active: boolean
          name: string
          store_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          store_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "teams_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_store_id_fkey"
            columns: ["store_id"]
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          can_create: boolean | null
          can_delete: boolean | null
          can_edit: boolean | null
          can_view: boolean | null
          company_id: string
          created_at: string | null
          id: string
          module: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_view?: boolean | null
          company_id: string
          created_at?: string | null
          id?: string
          module: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_view?: boolean | null
          company_id?: string
          created_at?: string | null
          id?: string
          module?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "user_permissions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vacation_periods: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          data_limite: string | null
          days_entitled: number
          days_remaining: number
          days_sold: number
          days_taken: number
          end_date: string
          external_id: string | null
          gozo_end_date: string | null
          gozo_start_date: string | null
          id: string
          manual_adjustment_at: string | null
          manual_adjustment_by: string | null
          manual_adjustment_notes: string | null
          start_date: string
          status: string
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          data_limite?: string | null
          days_entitled?: number
          days_remaining?: number
          days_sold?: number
          days_taken?: number
          end_date: string
          external_id?: string | null
          gozo_end_date?: string | null
          gozo_start_date?: string | null
          id?: string
          manual_adjustment_at?: string | null
          manual_adjustment_by?: string | null
          manual_adjustment_notes?: string | null
          start_date: string
          status?: string
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          data_limite?: string | null
          days_entitled?: number
          days_remaining?: number
          days_sold?: number
          days_taken?: number
          end_date?: string
          external_id?: string | null
          gozo_end_date?: string | null
          gozo_start_date?: string | null
          id?: string
          manual_adjustment_at?: string | null
          manual_adjustment_by?: string | null
          manual_adjustment_notes?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacation_periods_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vacation_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bonifications: number
          calculation_snapshot: Json | null
          collaborator_id: string
          company_id: string
          created_at: string
          days_count: number
          end_date: string
          gratifications: number
          id: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          paid_value: number | null
          payment_date: string | null
          payroll_entry_ids: string[] | null
          payroll_month: number | null
          payroll_year: number | null
          posted_to_payroll: boolean
          rejection_reason: string | null
          requested_by: string | null
          sell_days: number
          start_date: string
          status: string
          updated_at: string
          vacation_period_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bonifications?: number
          calculation_snapshot?: Json | null
          collaborator_id: string
          company_id: string
          created_at?: string
          days_count: number
          end_date: string
          gratifications?: number
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          paid_value?: number | null
          payment_date?: string | null
          payroll_entry_ids?: string[] | null
          payroll_month?: number | null
          payroll_year?: number | null
          posted_to_payroll?: boolean
          rejection_reason?: string | null
          requested_by?: string | null
          sell_days?: number
          start_date: string
          status?: string
          updated_at?: string
          vacation_period_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bonifications?: number
          calculation_snapshot?: Json | null
          collaborator_id?: string
          company_id?: string
          created_at?: string
          days_count?: number
          end_date?: string
          gratifications?: number
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          paid_value?: number | null
          payment_date?: string | null
          payroll_entry_ids?: string[] | null
          payroll_month?: number | null
          payroll_year?: number | null
          posted_to_payroll?: boolean
          rejection_reason?: string | null
          requested_by?: string | null
          sell_days?: number
          start_date?: string
          status?: string
          updated_at?: string
          vacation_period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacation_requests_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vacation_requests_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_requests_vacation_period_id_fkey"
            columns: ["vacation_period_id"]
            referencedRelation: "vacation_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      vt_period_entries: {
        Row: {
          collaborator_id: string
          company_id: string
          created_at: string
          current_balance: number
          discount_posted: number | null
          id: string
          is_validated: boolean
          next_month_value: number
          period_id: string
          region_id: string | null
          saturday_days: number
          saturday_diff: number
          total_recharged: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          value_per_day: number
          working_days: number
        }
        Insert: {
          collaborator_id: string
          company_id: string
          created_at?: string
          current_balance?: number
          discount_posted?: number | null
          id?: string
          is_validated?: boolean
          next_month_value?: number
          period_id: string
          region_id?: string | null
          saturday_days?: number
          saturday_diff?: number
          total_recharged?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          value_per_day?: number
          working_days?: number
        }
        Update: {
          collaborator_id?: string
          company_id?: string
          created_at?: string
          current_balance?: number
          discount_posted?: number | null
          id?: string
          is_validated?: boolean
          next_month_value?: number
          period_id?: string
          region_id?: string | null
          saturday_days?: number
          saturday_diff?: number
          total_recharged?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          value_per_day?: number
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "vt_period_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vt_period_entries_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vt_period_entries_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vt_period_entries_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "vt_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vt_period_entries_region_id_fkey"
            columns: ["region_id"]
            referencedRelation: "vt_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      vt_periods: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          reference_month: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reference_month: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reference_month?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vt_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vt_periods_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vt_regions: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          value_per_day: number
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          value_per_day: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          value_per_day?: number
        }
        Relationships: [
          {
            foreignKeyName: "vt_regions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vt_regions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          company_id: string
          created_at: string
          id: string
          instance_id: string | null
          instance_name: string
          phone_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_name: string
          phone_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_name?: string
          phone_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "whatsapp_instances_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agent_admission_funnel: {
        Row: {
          avg_days_in_status: number | null
          company_id: string | null
          count: number | null
          latest_movement_at: string | null
          oldest_journey_at: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"] | null
          status: Database["public"]["Enums"]["admission_journey_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_journeys_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "admission_journeys_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_collaborator_distribution: {
        Row: {
          company_id: string | null
          count: number | null
          position_title: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"] | null
          status: Database["public"]["Enums"]["collaborator_status"] | null
          team_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborators_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborators_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_company_overview: {
        Row: {
          active_collaborators: number | null
          clt_count: number | null
          company_id: string | null
          company_name: string | null
          estagiario_count: number | null
          inactive_collaborators: number | null
          is_matriz: boolean | null
          parent_company_id: string | null
          pj_count: number | null
          stores_count: number | null
          teams_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_journey_stats: {
        Row: {
          badges_count: number | null
          collaborator_id: string | null
          company_id: string | null
          first_award: string | null
          last_30d: number | null
          last_90d: number | null
          latest_award: string | null
          unique_badges_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_badges_collaborator_id_fkey"
            columns: ["collaborator_id"]
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_badges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "collaborator_badges_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_milestone_overview: {
        Row: {
          avg_badges_at_milestone: number | null
          company_id: string | null
          count: number | null
          kind: Database["public"]["Enums"]["journey_milestone_kind"] | null
          status: Database["public"]["Enums"]["journey_milestone_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "journey_milestones_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "journey_milestones_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_recruitment_pipeline: {
        Row: {
          avg_ai_score: number | null
          company_id: string | null
          job_id: string | null
          opened_at: string | null
          regime: Database["public"]["Enums"]["collaborator_regime"] | null
          stage_accepted: number | null
          stage_interview_hr: number | null
          stage_interview_manager: number | null
          stage_new: number | null
          stage_offer: number | null
          stage_rejected: number | null
          stage_screening: number | null
          status: Database["public"]["Enums"]["job_opening_status"] | null
          title: string | null
          total_applications: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_openings_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "agent_company_overview"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "job_openings_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      adjust_vacation_period_manual: {
        Args: {
          _days_sold: number
          _days_taken: number
          _notes?: string
          _period_id: string
        }
        Returns: {
          collaborator_id: string
          company_id: string
          created_at: string
          data_limite: string | null
          days_entitled: number
          days_remaining: number
          days_sold: number
          days_taken: number
          end_date: string
          external_id: string | null
          gozo_end_date: string | null
          gozo_start_date: string | null
          id: string
          manual_adjustment_at: string | null
          manual_adjustment_by: string | null
          manual_adjustment_notes: string | null
          start_date: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "vacation_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_manage_payroll_validation: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      can_modify_module: {
        Args: { _company_id: string; _module: string; _user_id: string }
        Returns: boolean
      }
      can_view_module: {
        Args: { _company_id: string; _module: string; _user_id: string }
        Returns: boolean
      }
      complete_application_test_by_token: {
        Args: {
          p_answers: Json
          p_auto_score: number
          p_result_summary: Json
          p_token: string
        }
        Returns: Json
      }
      complete_application_test_in_session: {
        Args: {
          p_answers: Json
          p_auto_score: number
          p_result_summary: Json
          p_test_id: string
          p_token: string
        }
        Returns: Json
      }
      create_payroll_validation: {
        Args: {
          p_company_id: string
          p_items: Json
          p_pdf_names: string[]
          p_reference_month: string
          p_stats: Json
        }
        Returns: string
      }
      delete_payroll_entry_with_reason: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: undefined
      }
      edit_vacation_period_manual: {
        Args: {
          _data_limite?: string
          _days_entitled: number
          _days_sold: number
          _days_taken: number
          _end_date: string
          _gozo_end_date?: string
          _gozo_start_date?: string
          _notes?: string
          _period_id: string
          _start_date: string
          _status: string
        }
        Returns: {
          collaborator_id: string
          company_id: string
          created_at: string
          data_limite: string | null
          days_entitled: number
          days_remaining: number
          days_sold: number
          days_taken: number
          end_date: string
          external_id: string | null
          gozo_end_date: string | null
          gozo_start_date: string | null
          id: string
          manual_adjustment_at: string | null
          manual_adjustment_by: string | null
          manual_adjustment_notes: string | null
          start_date: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "vacation_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_vacation_periods: {
        Args: {
          _admission_date: string
          _collaborator_id: string
          _company_id: string
        }
        Returns: undefined
      }
      get_application_test_by_token: {
        Args: { p_token: string }
        Returns: {
          answers: Json
          candidate_name: string
          expires_at: string
          id: string
          started_at: string
          status: Database["public"]["Enums"]["admission_test_status"]
          test_slug: string
        }[]
      }
      get_application_tests_session: {
        Args: { p_token: string }
        Returns: Json
      }
      get_user_permissions: {
        Args: { _company_id: string; _module: string; _user_id: string }
        Returns: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
        }[]
      }
      get_user_roles: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      has_module_permission: {
        Args: {
          _company_id: string
          _module: string
          _permission?: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      insert_default_position_documents: {
        Args: { p_company_id: string; p_position_id: string }
        Returns: undefined
      }
      is_admin_gc: { Args: { _user_id: string }; Returns: boolean }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      log_payroll_recalc: {
        Args: {
          p_company_id: string
          p_reference_month: string
          p_scope?: string
        }
        Returns: undefined
      }
      match_candidates: {
        Args: {
          filter_company_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          candidate_id: string
          content: string
          similarity: number
        }[]
      }
      payment_2fa_consume_challenge: {
        Args: { p_code_hash: string; p_id: string; p_purpose: string }
        Returns: {
          challenge_id: string
          company_id: string
          device_id: string
          purpose: string
          transfer_id: string
          user_id: string
        }[]
      }
      payroll_build_payable_lines: {
        Args: { p_period_id: string }
        Returns: number
      }
      payroll_entry_label: {
        Args: { p_description: string; p_type: string }
        Returns: string
      }
      payroll_monthly_merged_rank: { Args: { p_type: string }; Returns: number }
      payroll_payment_set_manual_paid: {
        Args: { p_amount?: number; p_entry_id: string; p_paid: boolean }
        Returns: {
          amount: number
          company_id: string
          created_at: string
          entry_id: string
          id: string
          method: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          period_id: string
          settled_transfer_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_period_is_locked:
        | {
            Args: { p_company_id: string; p_reference_month: string }
            Returns: boolean
          }
        | {
            Args: {
              p_status: Database["public"]["Enums"]["payroll_period_status"]
            }
            Returns: boolean
          }
      payroll_period_transition_action: {
        Args: {
          p_from: Database["public"]["Enums"]["payroll_period_status"]
          p_to: Database["public"]["Enums"]["payroll_period_status"]
        }
        Returns: string
      }
      payroll_pix_confirm: {
        Args: {
          p_http_status?: number
          p_id: string
          p_provider_status?: string
          p_response?: Json
        }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_pix_fail: {
        Args: {
          p_code: string
          p_http_status?: number
          p_id: string
          p_msg: string
          p_response?: Json
        }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_pix_mark_sent: {
        Args: {
          p_http_status?: number
          p_id: string
          p_provider_payment_id: string
          p_provider_status?: string
          p_response?: Json
        }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_pix_mark_unknown: {
        Args: { p_id: string; p_motivo: string }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_pix_open_transfer: {
        Args: { p_actor: string; p_entry_id: string; p_environment?: string }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_pix_resolve_unknown: {
        Args: {
          p_actor?: string
          p_e2e?: string
          p_id: string
          p_motivo: string
          p_status: Database["public"]["Enums"]["pix_transfer_status"]
        }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_pix_settle: {
        Args: {
          p_end_to_end_id: string
          p_response?: Json
          p_settled_at?: string
          p_transfer_id: string
        }
        Returns: {
          amount: number
          attempt: number
          check_count: number
          collaborator_id: string
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          entry_id: string
          environment: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          http_status: number | null
          id: string
          idempotency_key: string
          last_checked_at: string | null
          next_check_at: string | null
          payable_line_id: string | null
          payee_document: string | null
          payee_name: string
          payee_pix_key: string
          payee_pix_key_norm: string
          payee_pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          payer_snapshot: Json | null
          period_id: string
          provider: string
          provider_payment_id: string | null
          provider_status: string | null
          request_payload: Json | null
          resolved_by: string | null
          resolved_reason: string | null
          response_payload: Json | null
          sent_at: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["pix_transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_pix_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pix_key_normalized: {
        Args: { p_cpf: string; p_key: string }
        Returns: string
      }
      pix_key_type: {
        Args: { p_cpf: string; p_key: string }
        Returns: Database["public"]["Enums"]["pix_key_type"]
      }
      resolve_payroll_period_note: {
        Args: { p_note_id: string; p_resolved: boolean }
        Returns: undefined
      }
      resolve_payroll_validation_item: {
        Args: { p_item_id: string; p_notes: string; p_status: string }
        Returns: undefined
      }
      resolve_payroll_validation_items_bulk: {
        Args: { p_item_ids: string[]; p_notes: string; p_status: string }
        Returns: number
      }
      resolve_tests_session_application: {
        Args: { p_token: string }
        Returns: string
      }
      save_application_test_progress_by_token: {
        Args: { p_answers: Json; p_token: string }
        Returns: Json
      }
      save_application_test_progress_in_session: {
        Args: { p_answers: Json; p_test_id: string; p_token: string }
        Returns: Json
      }
      set_payroll_period_status: {
        Args: {
          p_period_id: string
          p_reason?: string
          p_to_status: Database["public"]["Enums"]["payroll_period_status"]
        }
        Returns: Database["public"]["Enums"]["payroll_period_status"]
      }
      start_application_test_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      start_application_test_in_session: {
        Args: { p_test_id: string; p_token: string }
        Returns: Json
      }
      storage_collaborator_company: {
        Args: { _collab: string }
        Returns: string
      }
      storage_is_company_staff: {
        Args: { _company: string; _module: string }
        Returns: boolean
      }
      storage_is_own_collaborator: {
        Args: { _collab: string }
        Returns: boolean
      }
      storage_is_rh: { Args: never; Returns: boolean }
      storage_uuid: { Args: { _txt: string }; Returns: string }
      user_belongs_to_company: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      admission_document_status:
        | "pending"
        | "submitted"
        | "ai_validating"
        | "approved"
        | "needs_adjustment"
      admission_event_kind:
        | "created"
        | "token_sent"
        | "docs_submitted"
        | "doc_validated"
        | "doc_approved"
        | "doc_rejected"
        | "exam_scheduled"
        | "exam_completed"
        | "contract_sent"
        | "contract_signed"
        | "admitted"
        | "cancelled"
        | "note"
        | "tests_assigned"
        | "test_started"
        | "test_completed"
        | "tests_advanced"
      admission_journey_status:
        | "created"
        | "tests_pending"
        | "tests_in_review"
        | "docs_pending"
        | "docs_in_review"
        | "docs_needs_adjustment"
        | "docs_approved"
        | "exam_scheduled"
        | "exam_done"
        | "contract_signed"
        | "admitted"
        | "cancelled"
      admission_test_status:
        | "not_started"
        | "in_progress"
        | "completed"
        | "reviewed"
      agent_message_role: "user" | "assistant" | "system" | "tool"
      alimony_calculation_type: "fixed" | "percentage_gross" | "percentage_net"
      alimony_status: "active" | "suspended" | "ended"
      app_role:
        | "admin_gc"
        | "rh"
        | "gestor"
        | "contador"
        | "colaborador"
        | "gestor_gc"
        | "diretoria"
      application_stage:
        | "new"
        | "screening"
        | "interview_hr"
        | "interview_manager"
        | "offer"
        | "accepted"
        | "rejected"
        | "withdrawn"
      badge_category:
        | "tecnico"
        | "comportamental"
        | "lideranca"
        | "cultura"
        | "integracao"
        | "outro"
      benefit_category:
        | "meal"
        | "transport"
        | "health"
        | "daycare"
        | "bonus"
        | "other"
        | "adicional"
      bonus_entry_mode: "batch" | "individual" | "anticipated"
      bonus_installment: "first" | "second" | "single"
      bonus_period_status: "aberto" | "pagamento" | "concluido"
      collaborator_regime: "clt" | "pj" | "estagiario"
      collaborator_status:
        | "ativo"
        | "inativo"
        | "aguardando_documentacao"
        | "validacao_pendente"
        | "reprovado"
      collaborator_timeline_event_type:
        | "store_change"
        | "position_change"
        | "team_change"
        | "regime_change"
        | "salary_change"
        | "migration"
        | "admission"
        | "termination"
        | "manual"
        | "reactivation"
      holiday_type: "national" | "state" | "municipal" | "manual"
      job_opening_status: "draft" | "open" | "paused" | "filled" | "cancelled"
      journey_milestone_kind: "d30" | "d60" | "d90" | "d180" | "annual"
      journey_milestone_status: "pending" | "due" | "completed" | "overdue"
      kinship_type:
        | "filho"
        | "enteado"
        | "tutelado"
        | "conjuge"
        | "companheiro"
        | "pai"
        | "mae"
        | "irmao"
        | "avô"
        | "neto"
        | "outro"
      payroll_alert_kind:
        | "collaborator_no_entry"
        | "value_divergence"
        | "absence_no_attestation"
        | "admission_pending"
        | "termination_pending"
        | "other"
      payroll_alert_severity: "info" | "warning" | "critical"
      payroll_entry_type:
        | "salario_base"
        | "beneficio"
        | "custo"
        | "despesa"
        | "hora_extra"
        | "inss"
        | "fgts"
        | "irpf"
        | "falta"
        | "atestado"
        | "adiantamento"
        | "bonificacao"
        | "desconto"
        | "gratificacao"
        | "ferias"
        | "salario_familia"
        | "carro_agregado"
        | "periculosidade"
        | "emprestimo"
        | "auxilio_vale_transporte"
        | "salario_retroativo"
      payroll_period_status:
        | "open"
        | "aprovado_rh"
        | "aprovado_diretoria"
        | "closed"
        | "exported"
      pix_key_type: "cpf" | "cnpj" | "email" | "phone" | "evp"
      pix_transfer_status:
        | "created"
        | "sent"
        | "confirmed"
        | "settled"
        | "failed"
        | "unknown"
      plan_tier: "essencial" | "crescer" | "profissional" | "empresa_plus"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      admission_document_status: [
        "pending",
        "submitted",
        "ai_validating",
        "approved",
        "needs_adjustment",
      ],
      admission_event_kind: [
        "created",
        "token_sent",
        "docs_submitted",
        "doc_validated",
        "doc_approved",
        "doc_rejected",
        "exam_scheduled",
        "exam_completed",
        "contract_sent",
        "contract_signed",
        "admitted",
        "cancelled",
        "note",
        "tests_assigned",
        "test_started",
        "test_completed",
        "tests_advanced",
      ],
      admission_journey_status: [
        "created",
        "tests_pending",
        "tests_in_review",
        "docs_pending",
        "docs_in_review",
        "docs_needs_adjustment",
        "docs_approved",
        "exam_scheduled",
        "exam_done",
        "contract_signed",
        "admitted",
        "cancelled",
      ],
      admission_test_status: [
        "not_started",
        "in_progress",
        "completed",
        "reviewed",
      ],
      agent_message_role: ["user", "assistant", "system", "tool"],
      alimony_calculation_type: ["fixed", "percentage_gross", "percentage_net"],
      alimony_status: ["active", "suspended", "ended"],
      app_role: [
        "admin_gc",
        "rh",
        "gestor",
        "contador",
        "colaborador",
        "gestor_gc",
        "diretoria",
      ],
      application_stage: [
        "new",
        "screening",
        "interview_hr",
        "interview_manager",
        "offer",
        "accepted",
        "rejected",
        "withdrawn",
      ],
      badge_category: [
        "tecnico",
        "comportamental",
        "lideranca",
        "cultura",
        "integracao",
        "outro",
      ],
      benefit_category: [
        "meal",
        "transport",
        "health",
        "daycare",
        "bonus",
        "other",
        "adicional",
      ],
      bonus_entry_mode: ["batch", "individual", "anticipated"],
      bonus_installment: ["first", "second", "single"],
      bonus_period_status: ["aberto", "pagamento", "concluido"],
      collaborator_regime: ["clt", "pj", "estagiario"],
      collaborator_status: [
        "ativo",
        "inativo",
        "aguardando_documentacao",
        "validacao_pendente",
        "reprovado",
      ],
      collaborator_timeline_event_type: [
        "store_change",
        "position_change",
        "team_change",
        "regime_change",
        "salary_change",
        "migration",
        "admission",
        "termination",
        "manual",
        "reactivation",
      ],
      holiday_type: ["national", "state", "municipal", "manual"],
      job_opening_status: ["draft", "open", "paused", "filled", "cancelled"],
      journey_milestone_kind: ["d30", "d60", "d90", "d180", "annual"],
      journey_milestone_status: ["pending", "due", "completed", "overdue"],
      kinship_type: [
        "filho",
        "enteado",
        "tutelado",
        "conjuge",
        "companheiro",
        "pai",
        "mae",
        "irmao",
        "avô",
        "neto",
        "outro",
      ],
      payroll_alert_kind: [
        "collaborator_no_entry",
        "value_divergence",
        "absence_no_attestation",
        "admission_pending",
        "termination_pending",
        "other",
      ],
      payroll_alert_severity: ["info", "warning", "critical"],
      payroll_entry_type: [
        "salario_base",
        "beneficio",
        "custo",
        "despesa",
        "hora_extra",
        "inss",
        "fgts",
        "irpf",
        "falta",
        "atestado",
        "adiantamento",
        "bonificacao",
        "desconto",
        "gratificacao",
        "ferias",
        "salario_familia",
        "carro_agregado",
        "periculosidade",
        "emprestimo",
        "auxilio_vale_transporte",
        "salario_retroativo",
      ],
      payroll_period_status: [
        "open",
        "aprovado_rh",
        "aprovado_diretoria",
        "closed",
        "exported",
      ],
      pix_key_type: ["cpf", "cnpj", "email", "phone", "evp"],
      pix_transfer_status: [
        "created",
        "sent",
        "confirmed",
        "settled",
        "failed",
        "unknown",
      ],
      plan_tier: ["essencial", "crescer", "profissional", "empresa_plus"],
    },
  },
} as const
