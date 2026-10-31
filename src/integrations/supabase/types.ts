export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_findings: {
        Row: {
          ai_run_id: string
          check_key: string
          created_at: string
          evidence: Json
          id: string
          message: string
          paper_id: string
          severity: string
          status: string
        }
        Insert: {
          ai_run_id: string
          check_key: string
          created_at?: string
          evidence?: Json
          id?: string
          message: string
          paper_id: string
          severity: string
          status: string
        }
        Update: {
          ai_run_id?: string
          check_key?: string
          created_at?: string
          evidence?: Json
          id?: string
          message?: string
          paper_id?: string
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_findings_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_findings_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_runs: {
        Row: {
          ai_run_code: string
          attempt: number
          completed_at: string | null
          deterministic_signals: Json | null
          error: string | null
          id: string
          input_hash: string | null
          latency_ms: number | null
          model_name: string
          model_version: string | null
          output_hash: string | null
          paper_id: string
          policy_key: string
          policy_version: string
          privacy_mode: string
          prompt_version: string
          provider: string
          started_at: string
          status: string
          structured_result: Json | null
          version_id: string
        }
        Insert: {
          ai_run_code?: string
          attempt?: number
          completed_at?: string | null
          deterministic_signals?: Json | null
          error?: string | null
          id?: string
          input_hash?: string | null
          latency_ms?: number | null
          model_name: string
          model_version?: string | null
          output_hash?: string | null
          paper_id: string
          policy_key: string
          policy_version: string
          privacy_mode: string
          prompt_version: string
          provider: string
          started_at?: string
          status?: string
          structured_result?: Json | null
          version_id: string
        }
        Update: {
          ai_run_code?: string
          attempt?: number
          completed_at?: string | null
          deterministic_signals?: Json | null
          error?: string | null
          id?: string
          input_hash?: string | null
          latency_ms?: number | null
          model_name?: string
          model_version?: string | null
          output_hash?: string | null
          paper_id?: string
          policy_key?: string
          policy_version?: string
          privacy_mode?: string
          prompt_version?: string
          provider?: string
          started_at?: string
          status?: string
          structured_result?: Json | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_spend: {
        Row: {
          cost_usd: number
          created_at: string
          day: string
          estimate_usd: number | null
          id: string
          model: string | null
          paper_id: string
          provider: string
          settled_at: string | null
          status: string
        }
        Insert: {
          cost_usd: number
          created_at?: string
          day?: string
          estimate_usd?: number | null
          id?: string
          model?: string | null
          paper_id: string
          provider: string
          settled_at?: string | null
          status?: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          day?: string
          estimate_usd?: number | null
          id?: string
          model?: string | null
          paper_id?: string
          provider?: string
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_spend_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          id: number
          metadata: Json
          new_value: Json | null
          old_value: Json | null
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: number
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: number
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      author_certificate_holds: {
        Row: {
          author_id: string
          paper_id: string
          paused_at: string
          paused_by: string
          reason: string
        }
        Insert: {
          author_id: string
          paper_id: string
          paused_at?: string
          paused_by: string
          reason: string
        }
        Update: {
          author_id?: string
          paper_id?: string
          paused_at?: string
          paused_by?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "author_certificate_holds_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: true
            referencedRelation: "paper_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_certificate_holds_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_events: {
        Row: {
          actor_id: string | null
          certificate_id: string
          created_at: string
          event: string
          id: string
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          certificate_id: string
          created_at?: string
          event: string
          id?: string
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          certificate_id?: string
          created_at?: string
          event?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificate_events_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          article_public_id: string
          author_role: string
          certificate_id: string
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          document_hash: string | null
          doi_at_issue: string | null
          id: string
          is_test: boolean
          issued_at: string
          on_hold: boolean
          orcid_at_issue: string | null
          paper_id: string
          paper_title_at_issue: string
          publication_date: string | null
          recipient_author_id: string | null
          recipient_email: string | null
          recipient_name_at_issue: string
          recipient_user_id: string | null
          status: Database["public"]["Enums"]["certificate_status"]
          status_reason: string | null
          storage_path: string | null
          verification_token: string
          version_id: string
        }
        Insert: {
          article_public_id: string
          author_role: string
          certificate_id?: string
          certificate_type: Database["public"]["Enums"]["certificate_type"]
          document_hash?: string | null
          doi_at_issue?: string | null
          id?: string
          is_test?: boolean
          issued_at?: string
          on_hold?: boolean
          orcid_at_issue?: string | null
          paper_id: string
          paper_title_at_issue: string
          publication_date?: string | null
          recipient_author_id?: string | null
          recipient_email?: string | null
          recipient_name_at_issue: string
          recipient_user_id?: string | null
          status?: Database["public"]["Enums"]["certificate_status"]
          status_reason?: string | null
          storage_path?: string | null
          verification_token?: string
          version_id: string
        }
        Update: {
          article_public_id?: string
          author_role?: string
          certificate_id?: string
          certificate_type?: Database["public"]["Enums"]["certificate_type"]
          document_hash?: string | null
          doi_at_issue?: string | null
          id?: string
          is_test?: boolean
          issued_at?: string
          on_hold?: boolean
          orcid_at_issue?: string | null
          paper_id?: string
          paper_title_at_issue?: string
          publication_date?: string | null
          recipient_author_id?: string | null
          recipient_email?: string | null
          recipient_name_at_issue?: string
          recipient_user_id?: string | null
          status?: Database["public"]["Enums"]["certificate_status"]
          status_reason?: string | null
          storage_path?: string | null
          verification_token?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_recipient_author_id_fkey"
            columns: ["recipient_author_id"]
            isOneToOne: false
            referencedRelation: "paper_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      contributor_confirmations: {
        Row: {
          confirmed_at: string
          confirmed_by: string
          id: string
          paper_id: string
          snapshot: Json
          statement: string
          version_id: string | null
        }
        Insert: {
          confirmed_at?: string
          confirmed_by: string
          id?: string
          paper_id: string
          snapshot: Json
          statement?: string
          version_id?: string | null
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string
          id?: string
          paper_id?: string
          snapshot?: Json
          statement?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contributor_confirmations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contributor_confirmations_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      copyright_complaints: {
        Row: {
          complainant_email: string
          complainant_name: string
          created_at: string
          description: string
          evidence_url: string | null
          id: string
          paper_id: string
          relationship: string
          resolution: string | null
          status: string
          updated_at: string
        }
        Insert: {
          complainant_email: string
          complainant_name: string
          created_at?: string
          description: string
          evidence_url?: string | null
          id?: string
          paper_id: string
          relationship: string
          resolution?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          complainant_email?: string
          complainant_name?: string
          created_at?: string
          description?: string
          evidence_url?: string | null
          id?: string
          paper_id?: string
          relationship?: string
          resolution?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copyright_complaints_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      corrections: {
        Row: {
          id: string
          issued_at: string
          issued_by: string
          kind: string
          new_version_id: string | null
          notice: string
          notice_code: string
          paper_id: string
          reason: string
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by: string
          kind: string
          new_version_id?: string | null
          notice: string
          notice_code?: string
          paper_id: string
          reason: string
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string
          kind?: string
          new_version_id?: string | null
          notice?: string
          notice_code?: string
          paper_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "corrections_new_version_id_fkey"
            columns: ["new_version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrections_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_policies: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          policy_key: string
          rules: Json
          version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          policy_key: string
          rules: Json
          version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          policy_key?: string
          rules?: Json
          version?: string
        }
        Relationships: []
      }
      decisions: {
        Row: {
          actor_id: string | null
          ai_run_id: string | null
          check_summary: Json
          created_at: string
          decision_code: string
          id: string
          is_override: boolean
          outcome: Database["public"]["Enums"]["decision_outcome"]
          override_reason: string | null
          overrides_decision_id: string | null
          paper_id: string
          policy_key: string | null
          policy_version: string | null
          reasons: Json
          revision_type: string | null
          source: string
          version_id: string | null
        }
        Insert: {
          actor_id?: string | null
          ai_run_id?: string | null
          check_summary?: Json
          created_at?: string
          decision_code?: string
          id?: string
          is_override?: boolean
          outcome: Database["public"]["Enums"]["decision_outcome"]
          override_reason?: string | null
          overrides_decision_id?: string | null
          paper_id: string
          policy_key?: string | null
          policy_version?: string | null
          reasons?: Json
          revision_type?: string | null
          source: string
          version_id?: string | null
        }
        Update: {
          actor_id?: string | null
          ai_run_id?: string | null
          check_summary?: Json
          created_at?: string
          decision_code?: string
          id?: string
          is_override?: boolean
          outcome?: Database["public"]["Enums"]["decision_outcome"]
          override_reason?: string | null
          overrides_decision_id?: string | null
          paper_id?: string
          policy_key?: string | null
          policy_version?: string | null
          reasons?: Json
          revision_type?: string | null
          source?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decisions_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_overrides_decision_id_fkey"
            columns: ["overrides_decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      doi_records: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attempt_count: number
          doi: string | null
          doi_record_code: string
          doi_url: string | null
          file_sha256: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_error_at: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          metadata: Json | null
          metadata_version: number
          next_retry_at: string | null
          paper_id: string
          provider: string
          record_url: string | null
          registered_at: string | null
          status: string
          updated_at: string
          uploaded_at: string | null
          verified_at: string | null
          workflow_status: string
          zenodo_deposit_id: number | null
          zenodo_environment: string | null
          zenodo_record_id: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          doi?: string | null
          doi_record_code?: string
          doi_url?: string | null
          file_sha256?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          metadata?: Json | null
          metadata_version?: number
          next_retry_at?: string | null
          paper_id: string
          provider: string
          record_url?: string | null
          registered_at?: string | null
          status: string
          updated_at?: string
          uploaded_at?: string | null
          verified_at?: string | null
          workflow_status?: string
          zenodo_deposit_id?: number | null
          zenodo_environment?: string | null
          zenodo_record_id?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          doi?: string | null
          doi_record_code?: string
          doi_url?: string | null
          file_sha256?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          metadata?: Json | null
          metadata_version?: number
          next_retry_at?: string | null
          paper_id?: string
          provider?: string
          record_url?: string | null
          registered_at?: string | null
          status?: string
          updated_at?: string
          uploaded_at?: string | null
          verified_at?: string | null
          workflow_status?: string
          zenodo_deposit_id?: number | null
          zenodo_environment?: string | null
          zenodo_record_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "doi_records_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: true
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_board_members: {
        Row: {
          affiliation: string
          biography: string | null
          confirmed: boolean
          confirmed_at: string | null
          confirmed_by: string | null
          country: string | null
          created_at: string
          created_by: string
          credentials: string | null
          display_order: number
          full_name: string
          id: string
          orcid: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          affiliation: string
          biography?: string | null
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          country?: string | null
          created_at?: string
          created_by: string
          credentials?: string | null
          display_order?: number
          full_name: string
          id?: string
          orcid?: string | null
          role: string
          user_id?: string | null
        }
        Update: {
          affiliation?: string
          biography?: string | null
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          country?: string | null
          created_at?: string
          created_by?: string
          credentials?: string | null
          display_order?: number
          full_name?: string
          id?: string
          orcid?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: []
      }
      editorial_edits: {
        Row: {
          after_text: string
          before_text: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          editor_id: string
          field: string
          id: string
          note: string | null
          paper_id: string
          status: string
          updated_at: string
          version_id: string | null
        }
        Insert: {
          after_text: string
          before_text: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          editor_id: string
          field: string
          id?: string
          note?: string | null
          paper_id: string
          status?: string
          updated_at?: string
          version_id?: string | null
        }
        Update: {
          after_text?: string
          before_text?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          editor_id?: string
          field?: string
          id?: string
          note?: string | null
          paper_id?: string
          status?: string
          updated_at?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "editorial_edits_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_settings: {
        Row: {
          default_review_model: string
          id: boolean
          journal_mode_enabled: boolean
          review_days: number
          reviews_required: number
          updated_at: string
          updated_by: string | null
          zenodo_last_test_at: string | null
          zenodo_last_test_env: string | null
          zenodo_last_test_message: string | null
          zenodo_last_test_ok: boolean | null
          zenodo_production_enabled: boolean
          zenodo_sandbox_verified_at: string | null
        }
        Insert: {
          default_review_model?: string
          id?: boolean
          journal_mode_enabled?: boolean
          review_days?: number
          reviews_required?: number
          updated_at?: string
          updated_by?: string | null
          zenodo_last_test_at?: string | null
          zenodo_last_test_env?: string | null
          zenodo_last_test_message?: string | null
          zenodo_last_test_ok?: boolean | null
          zenodo_production_enabled?: boolean
          zenodo_sandbox_verified_at?: string | null
        }
        Update: {
          default_review_model?: string
          id?: boolean
          journal_mode_enabled?: boolean
          review_days?: number
          reviews_required?: number
          updated_at?: string
          updated_by?: string | null
          zenodo_last_test_at?: string | null
          zenodo_last_test_env?: string | null
          zenodo_last_test_message?: string | null
          zenodo_last_test_ok?: boolean | null
          zenodo_production_enabled?: boolean
          zenodo_sandbox_verified_at?: string | null
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attachment_bucket: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachments: Json | null
          attempts: number
          cc_email: string | null
          claimed_at: string | null
          created_at: string
          dedupe_key: string
          html_body: string
          id: string
          kind: string
          last_error: string | null
          next_attempt_at: string
          notification_id: string | null
          paper_id: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: string
          subject: string
          text_body: string
          to_email: string
          user_id: string | null
        }
        Insert: {
          attachment_bucket?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachments?: Json | null
          attempts?: number
          cc_email?: string | null
          claimed_at?: string | null
          created_at?: string
          dedupe_key: string
          html_body: string
          id?: string
          kind: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id?: string | null
          paper_id?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          text_body: string
          to_email: string
          user_id?: string | null
        }
        Update: {
          attachment_bucket?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachments?: Json | null
          attempts?: number
          cc_email?: string | null
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string
          html_body?: string
          id?: string
          kind?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id?: string | null
          paper_id?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          text_body?: string
          to_email?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ethics_cases: {
        Row: {
          assigned_reviewer_id: string | null
          created_at: string
          declaration_id: string
          eth_id: string
          id: string
          paper_id: string
          policy_version: string
          requires_committee_approval: boolean
          requires_publication_consent: boolean
          requires_trial_registration: boolean
          research_category: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_reviewer_id?: string | null
          created_at?: string
          declaration_id: string
          eth_id?: string
          id?: string
          paper_id: string
          policy_version: string
          requires_committee_approval?: boolean
          requires_publication_consent?: boolean
          requires_trial_registration?: boolean
          research_category: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_reviewer_id?: string | null
          created_at?: string
          declaration_id?: string
          eth_id?: string
          id?: string
          paper_id?: string
          policy_version?: string
          requires_committee_approval?: boolean
          requires_publication_consent?: boolean
          requires_trial_registration?: boolean
          research_category?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ethics_cases_declaration_id_fkey"
            columns: ["declaration_id"]
            isOneToOne: false
            referencedRelation: "ethics_declarations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ethics_cases_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: true
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ethics_cases_policy_version_fkey"
            columns: ["policy_version"]
            isOneToOne: false
            referencedRelation: "ethics_policies"
            referencedColumns: ["version"]
          },
        ]
      }
      ethics_declarations: {
        Row: {
          amended_by: string | null
          amendment_reason: string | null
          answers: Json
          conflict_of_interest: string
          data_availability: string
          declaration_version: string
          declared_at: string
          funding: string
          id: string
          paper_id: string
          policy_version: string | null
          revision: number
          supersedes_id: string | null
          user_id: string
        }
        Insert: {
          amended_by?: string | null
          amendment_reason?: string | null
          answers: Json
          conflict_of_interest: string
          data_availability: string
          declaration_version: string
          declared_at?: string
          funding: string
          id?: string
          paper_id: string
          policy_version?: string | null
          revision?: number
          supersedes_id?: string | null
          user_id: string
        }
        Update: {
          amended_by?: string | null
          amendment_reason?: string | null
          answers?: Json
          conflict_of_interest?: string
          data_availability?: string
          declaration_version?: string
          declared_at?: string
          funding?: string
          id?: string
          paper_id?: string
          policy_version?: string | null
          revision?: number
          supersedes_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ethics_declarations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ethics_declarations_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "ethics_declarations"
            referencedColumns: ["id"]
          },
        ]
      }
      ethics_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          case_id: string
          correlation_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: number
          paper_id: string
          policy_version: string
          reason: string | null
          structured_reasons: Json
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          case_id: string
          correlation_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: number
          paper_id: string
          policy_version: string
          reason?: string | null
          structured_reasons?: Json
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          case_id?: string
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: number
          paper_id?: string
          policy_version?: string
          reason?: string | null
          structured_reasons?: Json
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ethics_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "ethics_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      ethics_policies: {
        Row: {
          content_hash: string
          created_at: string
          rules: Json
          version: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          rules: Json
          version: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          rules?: Json
          version?: string
        }
        Relationships: []
      }
      ethics_subject_declarations: {
        Row: {
          approval_reference: string | null
          committee_approval_status: string
          created_at: string
          declared_by: string
          deidentification_status: string
          human_participants: boolean
          id: string
          identifiable_info_present: boolean
          informed_consent_status: string
          paper_id: string
          privacy_sensitive_media: boolean
          publication_consent_status: string
          revision: number
          waiver_status: string
        }
        Insert: {
          approval_reference?: string | null
          committee_approval_status: string
          created_at?: string
          declared_by: string
          deidentification_status: string
          human_participants: boolean
          id?: string
          identifiable_info_present: boolean
          informed_consent_status: string
          paper_id: string
          privacy_sensitive_media?: boolean
          publication_consent_status: string
          revision?: number
          waiver_status: string
        }
        Update: {
          approval_reference?: string | null
          committee_approval_status?: string
          created_at?: string
          declared_by?: string
          deidentification_status?: string
          human_participants?: boolean
          id?: string
          identifiable_info_present?: boolean
          informed_consent_status?: string
          paper_id?: string
          privacy_sensitive_media?: boolean
          publication_consent_status?: string
          revision?: number
          waiver_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ethics_subject_declarations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_waivers: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          note: string | null
          revoked_at: string | null
          revoked_by: string | null
          set_by_admin: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          set_by_admin?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          set_by_admin?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_waivers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identifier_aliases: {
        Row: {
          alias: string
          alias_kind: string
          created_at: string
          identifier_type: string
          resource_id: string
        }
        Insert: {
          alias: string
          alias_kind: string
          created_at?: string
          identifier_type: string
          resource_id: string
        }
        Update: {
          alias?: string
          alias_kind?: string
          created_at?: string
          identifier_type?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identifier_aliases_identifier_type_fkey"
            columns: ["identifier_type"]
            isOneToOne: false
            referencedRelation: "identifier_types"
            referencedColumns: ["identifier_type"]
          },
          {
            foreignKeyName: "identifier_aliases_identifier_type_resource_id_fkey"
            columns: ["identifier_type", "resource_id"]
            isOneToOne: false
            referencedRelation: "identifier_registry"
            referencedColumns: ["identifier_type", "resource_id"]
          },
        ]
      }
      identifier_counters: {
        Row: {
          identifier_type: string
          last_value: number
          year: number
        }
        Insert: {
          identifier_type: string
          last_value?: number
          year: number
        }
        Update: {
          identifier_type?: string
          last_value?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "identifier_counters_identifier_type_fkey"
            columns: ["identifier_type"]
            isOneToOne: false
            referencedRelation: "identifier_types"
            referencedColumns: ["identifier_type"]
          },
        ]
      }
      identifier_registry: {
        Row: {
          created_at: string
          id: string
          identifier: string
          identifier_type: string
          resource_id: string
          resource_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier: string
          identifier_type: string
          resource_id: string
          resource_type: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier?: string
          identifier_type?: string
          resource_id?: string
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "identifier_registry_identifier_type_fkey"
            columns: ["identifier_type"]
            isOneToOne: false
            referencedRelation: "identifier_types"
            referencedColumns: ["identifier_type"]
          },
        ]
      }
      identifier_types: {
        Row: {
          allocator: string
          description: string
          identifier_type: string
          prefix: string
          resource_type: string
        }
        Insert: {
          allocator: string
          description: string
          identifier_type: string
          prefix: string
          resource_type: string
        }
        Update: {
          allocator?: string
          description?: string
          identifier_type?: string
          prefix?: string
          resource_type?: string
        }
        Relationships: []
      }
      journal_identity: {
        Row: {
          aims_scope: string | null
          editorial_office_address: string | null
          editorial_office_email: string | null
          eissn: string | null
          id: boolean
          issn: string | null
          issn_confirmed_at: string | null
          issn_confirmed_by: string | null
          journal_title: string
          publication_frequency: string
          publisher_name: string | null
          updated_at: string
        }
        Insert: {
          aims_scope?: string | null
          editorial_office_address?: string | null
          editorial_office_email?: string | null
          eissn?: string | null
          id?: boolean
          issn?: string | null
          issn_confirmed_at?: string | null
          issn_confirmed_by?: string | null
          journal_title?: string
          publication_frequency?: string
          publisher_name?: string | null
          updated_at?: string
        }
        Update: {
          aims_scope?: string | null
          editorial_office_address?: string | null
          editorial_office_email?: string | null
          eissn?: string | null
          id?: boolean
          issn?: string | null
          issn_confirmed_at?: string | null
          issn_confirmed_by?: string | null
          journal_title?: string
          publication_frequency?: string
          publisher_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          email_status: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          email_status?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          email_status?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      orcid_verifications: {
        Row: {
          last_verified_at: string
          name_at_verification: string | null
          oauth_subject: string
          orcid: string
          source: string
          user_id: string
          verified_at: string
        }
        Insert: {
          last_verified_at?: string
          name_at_verification?: string | null
          oauth_subject: string
          orcid: string
          source?: string
          user_id: string
          verified_at?: string
        }
        Update: {
          last_verified_at?: string
          name_at_verification?: string | null
          oauth_subject?: string
          orcid?: string
          source?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          country: string | null
          country_code: string | null
          fetched_at: string
          id: string
          name: string
          org_types: string[]
          ror_id: string
          source: string
        }
        Insert: {
          country?: string | null
          country_code?: string | null
          fetched_at?: string
          id?: string
          name: string
          org_types?: string[]
          ror_id: string
          source?: string
        }
        Update: {
          country?: string | null
          country_code?: string | null
          fetched_at?: string
          id?: string
          name?: string
          org_types?: string[]
          ror_id?: string
          source?: string
        }
        Relationships: []
      }
      paper_ai_disclosures: {
        Row: {
          category: string
          created_at: string
          extent: string
          human_verification: string
          id: string
          paper_id: string
          purpose: string
          tool_name: string
          tool_version: string | null
        }
        Insert: {
          category: string
          created_at?: string
          extent: string
          human_verification: string
          id?: string
          paper_id: string
          purpose: string
          tool_name: string
          tool_version?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          extent?: string
          human_verification?: string
          id?: string
          paper_id?: string
          purpose?: string
          tool_name?: string
          tool_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_ai_disclosures_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_author_affiliations: {
        Row: {
          author_id: string
          country: string | null
          department: string | null
          id: string
          organization: string
          organization_id: string | null
          original_text: string | null
          paper_id: string
          position: number
          ror_id: string | null
          ror_verified: boolean
        }
        Insert: {
          author_id: string
          country?: string | null
          department?: string | null
          id?: string
          organization: string
          organization_id?: string | null
          original_text?: string | null
          paper_id: string
          position: number
          ror_id?: string | null
          ror_verified?: boolean
        }
        Update: {
          author_id?: string
          country?: string | null
          department?: string | null
          id?: string
          organization?: string
          organization_id?: string | null
          original_text?: string | null
          paper_id?: string
          position?: number
          ror_id?: string | null
          ror_verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "paper_author_affiliations_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "paper_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_author_affiliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_author_affiliations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_author_roles: {
        Row: {
          author_id: string
          id: string
          paper_id: string
          role: string
        }
        Insert: {
          author_id: string
          id?: string
          paper_id: string
          role: string
        }
        Update: {
          author_id?: string
          id?: string
          paper_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_author_roles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "paper_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_author_roles_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_authors: {
        Row: {
          affiliation: string | null
          email: string | null
          full_name: string
          id: string
          is_corresponding: boolean
          orcid: string | null
          paper_id: string
          position: number
          user_id: string | null
        }
        Insert: {
          affiliation?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_corresponding?: boolean
          orcid?: string | null
          paper_id: string
          position: number
          user_id?: string | null
        }
        Update: {
          affiliation?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_corresponding?: boolean
          orcid?: string | null
          paper_id?: string
          position?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_authors_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_funding: {
        Row: {
          created_at: string
          funder_name: string
          grant_number: string | null
          id: string
          paper_id: string
        }
        Insert: {
          created_at?: string
          funder_name: string
          grant_number?: string | null
          id?: string
          paper_id: string
        }
        Update: {
          created_at?: string
          funder_name?: string
          grant_number?: string | null
          id?: string
          paper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_funding_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_references: {
        Row: {
          doi: string | null
          id: string
          matched_title: string | null
          paper_id: string
          position: number
          raw_text: string
          validated_at: string | null
          validation_note: string | null
          validation_status: string
        }
        Insert: {
          doi?: string | null
          id?: string
          matched_title?: string | null
          paper_id: string
          position: number
          raw_text: string
          validated_at?: string | null
          validation_note?: string | null
          validation_status?: string
        }
        Update: {
          doi?: string | null
          id?: string
          matched_title?: string | null
          paper_id?: string
          position?: number
          raw_text?: string
          validated_at?: string | null
          validation_note?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_references_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_versions: {
        Row: {
          anonymized_file_hash: string | null
          anonymized_storage_path: string | null
          author_name_at_submission: string
          change_reason: string | null
          extracted_chars: number | null
          file_hash: string
          file_size: number
          id: string
          major: number
          mime_type: string
          minor: number
          paper_id: string
          previous_version_id: string | null
          scan_result: Json
          storage_path: string
          uploaded_at: string
          uploaded_by: string
          version_code: string
          version_kind: string
          version_number: string | null
        }
        Insert: {
          anonymized_file_hash?: string | null
          anonymized_storage_path?: string | null
          author_name_at_submission: string
          change_reason?: string | null
          extracted_chars?: number | null
          file_hash: string
          file_size: number
          id?: string
          major: number
          mime_type: string
          minor: number
          paper_id: string
          previous_version_id?: string | null
          scan_result?: Json
          storage_path: string
          uploaded_at?: string
          uploaded_by: string
          version_code?: string
          version_kind?: string
          version_number?: string | null
        }
        Update: {
          anonymized_file_hash?: string | null
          anonymized_storage_path?: string | null
          author_name_at_submission?: string
          change_reason?: string | null
          extracted_chars?: number | null
          file_hash?: string
          file_size?: number
          id?: string
          major?: number
          mime_type?: string
          minor?: number
          paper_id?: string
          previous_version_id?: string | null
          scan_result?: Json
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
          version_code?: string
          version_kind?: string
          version_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_versions_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      papers: {
        Row: {
          abstract: string
          article_type: string
          copyright_holder: string | null
          created_at: string
          current_version_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          doi: string | null
          field: string
          field_metadata: Json
          handling_editor_id: string | null
          id: string
          is_test: boolean
          keywords: string[]
          language: string
          license: string | null
          open_claims: string
          owner_id: string
          paperly_id: string
          peer_reviewed: boolean
          review_waived: boolean
          review_waived_at: string | null
          review_waived_by: string | null
          review_waived_reason: string | null
          public_id: string
          publication_type: string
          published_at: string | null
          references_text: string | null
          restricted: boolean
          review_model: string | null
          review_round: number
          search: unknown
          status: Database["public"]["Enums"]["paper_status"]
          submission_id: string
          title: string
          updated_at: string
        }
        Insert: {
          abstract?: string
          article_type?: string
          copyright_holder?: string | null
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          doi?: string | null
          field?: string
          field_metadata?: Json
          handling_editor_id?: string | null
          id?: string
          is_test?: boolean
          keywords?: string[]
          language?: string
          license?: string | null
          open_claims?: string
          owner_id: string
          paperly_id?: string
          peer_reviewed?: boolean
          review_waived?: boolean
          review_waived_at?: string | null
          review_waived_by?: string | null
          review_waived_reason?: string | null
          public_id?: string
          publication_type?: string
          published_at?: string | null
          references_text?: string | null
          restricted?: boolean
          review_model?: string | null
          review_round?: number
          search?: unknown
          status?: Database["public"]["Enums"]["paper_status"]
          submission_id?: string
          title?: string
          updated_at?: string
        }
        Update: {
          abstract?: string
          article_type?: string
          copyright_holder?: string | null
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          doi?: string | null
          field?: string
          field_metadata?: Json
          handling_editor_id?: string | null
          id?: string
          is_test?: boolean
          keywords?: string[]
          language?: string
          license?: string | null
          open_claims?: string
          owner_id?: string
          paperly_id?: string
          peer_reviewed?: boolean
          review_waived?: boolean
          review_waived_at?: string | null
          review_waived_by?: string | null
          review_waived_reason?: string | null
          public_id?: string
          publication_type?: string
          published_at?: string | null
          references_text?: string | null
          restricted?: boolean
          review_model?: string | null
          review_round?: number
          search?: unknown
          status?: Database["public"]["Enums"]["paper_status"]
          submission_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "papers_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          payment_id: string | null
          processed: boolean
          provider: string
          provider_event_id: string
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          payment_id?: string | null
          processed?: boolean
          provider: string
          provider_event_id: string
          received_at?: string
          signature_valid: boolean
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          processed?: boolean
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_minor: number
          completed_at: string | null
          created_at: string
          currency: string
          discount_minor: number
          id: string
          idempotency_key: string
          is_test: boolean
          method: string
          order_id: string
          original_amount_minor: number | null
          paper_id: string | null
          payer_reference: string | null
          payment_code: string
          product_id: string
          promo_code_id: string | null
          promo_code_text: string | null
          provider: string
          provider_order_id: string | null
          provider_refund_id: string | null
          provider_transaction_id: string | null
          refund_claimed_at: string | null
          refund_error: string | null
          refunded_amount_minor: number
          refunded_at: string | null
          retained_amount_minor: number | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          user_id: string
        }
        Insert: {
          amount_minor: number
          completed_at?: string | null
          created_at?: string
          currency: string
          discount_minor?: number
          id?: string
          idempotency_key: string
          is_test?: boolean
          method?: string
          order_id: string
          original_amount_minor?: number | null
          paper_id?: string | null
          payer_reference?: string | null
          payment_code?: string
          product_id: string
          promo_code_id?: string | null
          promo_code_text?: string | null
          provider: string
          provider_order_id?: string | null
          provider_refund_id?: string | null
          provider_transaction_id?: string | null
          refund_claimed_at?: string | null
          refund_error?: string | null
          refunded_amount_minor?: number
          refunded_at?: string | null
          retained_amount_minor?: number | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          user_id: string
        }
        Update: {
          amount_minor?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          discount_minor?: number
          id?: string
          idempotency_key?: string
          is_test?: boolean
          method?: string
          order_id?: string
          original_amount_minor?: number | null
          paper_id?: string | null
          payer_reference?: string | null
          payment_code?: string
          product_id?: string
          promo_code_id?: string | null
          promo_code_text?: string | null
          provider?: string
          provider_order_id?: string | null
          provider_refund_id?: string | null
          provider_transaction_id?: string | null
          refund_claimed_at?: string | null
          refund_error?: string | null
          refunded_amount_minor?: number
          refunded_at?: string | null
          retained_amount_minor?: number | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          description: string
          permission_key: string
          sensitive: boolean
        }
        Insert: {
          category: string
          description: string
          permission_key: string
          sensitive?: boolean
        }
        Update: {
          category?: string
          description?: string
          permission_key?: string
          sensitive?: boolean
        }
        Relationships: []
      }
      product_prices: {
        Row: {
          active: boolean
          amount_minor: number
          created_at: string
          currency: string
          id: string
          product_id: string
        }
        Insert: {
          active?: boolean
          amount_minor: number
          created_at?: string
          currency: string
          id?: string
          product_id: string
        }
        Update: {
          active?: boolean
          amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          amount_minor: number
          code: string
          created_at: string
          currency: string
          description: string
          id: string
          name: string
          refund_policy: string
          required_for_publication: boolean
        }
        Insert: {
          active?: boolean
          amount_minor: number
          code: string
          created_at?: string
          currency: string
          description: string
          id?: string
          name: string
          refund_policy: string
          required_for_publication?: boolean
        }
        Update: {
          active?: boolean
          amount_minor?: number
          code?: string
          created_at?: string
          currency?: string
          description?: string
          id?: string
          name?: string
          refund_policy?: string
          required_for_publication?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          bio: string | null
          country: string | null
          created_at: string
          department: string | null
          display_name: string
          email: string | null
          id: string
          institution: string | null
          orcid: string | null
          orcid_verified: boolean
          photo_url: string | null
          researcher_id: string
          updated_at: string
        }
        Insert: {
          bio?: string | null
          country?: string | null
          created_at?: string
          department?: string | null
          display_name?: string
          email?: string | null
          id: string
          institution?: string | null
          orcid?: string | null
          orcid_verified?: boolean
          photo_url?: string | null
          researcher_id?: string
          updated_at?: string
        }
        Update: {
          bio?: string | null
          country?: string | null
          created_at?: string
          department?: string | null
          display_name?: string
          email?: string | null
          id?: string
          institution?: string | null
          orcid?: string | null
          orcid_verified?: boolean
          photo_url?: string | null
          researcher_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          active: boolean
          amount_off_minor: number
          code: string
          created_at: string
          created_by: string | null
          currency: string
          expires_at: string | null
          id: string
          max_redemptions: number | null
        }
        Insert: {
          active?: boolean
          amount_off_minor: number
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
        }
        Update: {
          active?: boolean
          amount_off_minor?: number
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          amount_off_minor: number
          created_at: string
          id: string
          paper_id: string | null
          payment_id: string
          promo_id: string
          user_id: string
        }
        Insert: {
          amount_off_minor: number
          created_at?: string
          id?: string
          paper_id?: string | null
          payment_id: string
          promo_id: string
          user_id: string
        }
        Update: {
          amount_off_minor?: number
          created_at?: string
          id?: string
          paper_id?: string | null
          payment_id?: string
          promo_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      review_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          coi_statement: string | null
          coi_status: string | null
          comments: string | null
          comments_to_author: string | null
          completed_at: string | null
          confidential_to_editor: string | null
          due_at: string | null
          editor_notes: string | null
          id: string
          paper_id: string
          recommendation: string | null
          responded_at: string | null
          review_code: string
          reviewer_id: string
          round: number
          status: string
          version_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          coi_statement?: string | null
          coi_status?: string | null
          comments?: string | null
          comments_to_author?: string | null
          completed_at?: string | null
          confidential_to_editor?: string | null
          due_at?: string | null
          editor_notes?: string | null
          id?: string
          paper_id: string
          recommendation?: string | null
          responded_at?: string | null
          review_code?: string
          reviewer_id: string
          round?: number
          status?: string
          version_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          coi_statement?: string | null
          coi_status?: string | null
          comments?: string | null
          comments_to_author?: string | null
          completed_at?: string | null
          confidential_to_editor?: string | null
          due_at?: string | null
          editor_notes?: string | null
          id?: string
          paper_id?: string
          recommendation?: string | null
          responded_at?: string | null
          review_code?: string
          reviewer_id?: string
          round?: number
          status?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_assignments_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_assignments_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_responses: {
        Row: {
          created_at: string
          created_by: string
          id: string
          paper_id: string
          response_text: string
          round: number
          version_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          paper_id: string
          response_text: string
          round: number
          version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          paper_id?: string
          response_text?: string
          round?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revision_responses_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revision_responses_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "paper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_declarations: {
        Row: {
          ai_disclosure_version: string
          ai_processing_consent: boolean
          amended_by: string | null
          amendment_reason: string | null
          coauthor_permission: boolean
          declaration_version: string
          declared_at: string
          has_upload_rights: boolean
          id: string
          is_author: boolean
          manuscript_version_type: string
          paper_id: string
          previous_doi: string | null
          previous_publication_reference: string | null
          previously_published: boolean
          requires_copyright_review: boolean
          revision: number
          selected_license: string
          supersedes_id: string | null
          third_party_content: boolean
          third_party_permission: boolean | null
          user_id: string
        }
        Insert: {
          ai_disclosure_version: string
          ai_processing_consent: boolean
          amended_by?: string | null
          amendment_reason?: string | null
          coauthor_permission: boolean
          declaration_version: string
          declared_at?: string
          has_upload_rights: boolean
          id?: string
          is_author: boolean
          manuscript_version_type: string
          paper_id: string
          previous_doi?: string | null
          previous_publication_reference?: string | null
          previously_published: boolean
          requires_copyright_review?: boolean
          revision?: number
          selected_license: string
          supersedes_id?: string | null
          third_party_content: boolean
          third_party_permission?: boolean | null
          user_id: string
        }
        Update: {
          ai_disclosure_version?: string
          ai_processing_consent?: boolean
          amended_by?: string | null
          amendment_reason?: string | null
          coauthor_permission?: boolean
          declaration_version?: string
          declared_at?: string
          has_upload_rights?: boolean
          id?: string
          is_author?: boolean
          manuscript_version_type?: string
          paper_id?: string
          previous_doi?: string | null
          previous_publication_reference?: string | null
          previously_published?: boolean
          requires_copyright_review?: boolean
          revision?: number
          selected_license?: string
          supersedes_id?: string | null
          third_party_content?: boolean
          third_party_permission?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_declarations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rights_declarations_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "rights_declarations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          granted_at: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          granted_at?: string
          permission_key: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          granted_at?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["permission_key"]
          },
        ]
      }
      scholarly_relationships: {
        Row: {
          created_at: string
          created_by: string | null
          from_identifier: string
          id: string
          note: string | null
          relationship_type: string
          to_external: string | null
          to_external_kind: string | null
          to_identifier: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_identifier: string
          id?: string
          note?: string | null
          relationship_type: string
          to_external?: string | null
          to_external_kind?: string | null
          to_identifier?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_identifier?: string
          id?: string
          note?: string | null
          relationship_type?: string
          to_external?: string | null
          to_external_kind?: string | null
          to_identifier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scholarly_relationships_from_identifier_fkey"
            columns: ["from_identifier"]
            isOneToOne: false
            referencedRelation: "identifier_registry"
            referencedColumns: ["identifier"]
          },
          {
            foreignKeyName: "scholarly_relationships_to_identifier_fkey"
            columns: ["to_identifier"]
            isOneToOne: false
            referencedRelation: "identifier_registry"
            referencedColumns: ["identifier"]
          },
        ]
      }
      site_banners: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_url: string | null
          dismissible: boolean
          ends_at: string | null
          id: string
          message: string
          placement: string
          promo_id: string | null
          show_countdown: boolean
          show_remaining: boolean
          starts_at: string | null
          theme: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          dismissible?: boolean
          ends_at?: string | null
          id?: string
          message?: string
          placement?: string
          promo_id?: string | null
          show_countdown?: boolean
          show_remaining?: boolean
          starts_at?: string | null
          theme?: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          dismissible?: boolean
          ends_at?: string | null
          id?: string
          message?: string
          placement?: string
          promo_id?: string | null
          show_countdown?: boolean
          show_remaining?: boolean
          starts_at?: string | null
          theme?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_banners_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_quarantine: {
        Row: {
          attempt_id: string | null
          bucket: string
          created_at: string
          id: string
          path: string
          reason: string
          resolved_at: string | null
        }
        Insert: {
          attempt_id?: string | null
          bucket: string
          created_at?: string
          id?: string
          path: string
          reason: string
          resolved_at?: string | null
        }
        Update: {
          attempt_id?: string | null
          bucket?: string
          created_at?: string
          id?: string
          path?: string
          reason?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_quarantine_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "submission_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_attempts: {
        Row: {
          correlation_id: string | null
          created_at: string
          failure_message: string | null
          failure_stage: string | null
          id: string
          idempotency_key: string
          paper_id: string
          request_hash: string
          status: string
          tries: number
          updated_at: string
          user_id: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          failure_message?: string | null
          failure_stage?: string | null
          id?: string
          idempotency_key: string
          paper_id?: string
          request_hash: string
          status?: string
          tries?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          failure_message?: string | null
          failure_stage?: string | null
          id?: string
          idempotency_key?: string
          paper_id?: string
          request_hash?: string
          status?: string
          tries?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trial_registrations: {
        Row: {
          case_id: string
          id: string
          paper_id: string
          registration_date: string | null
          registration_number: string | null
          registration_required: boolean
          registration_status: string
          registration_url: string | null
          registry_name: string | null
          updated_at: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          case_id: string
          id?: string
          paper_id: string
          registration_date?: string | null
          registration_number?: string | null
          registration_required: boolean
          registration_status?: string
          registration_url?: string | null
          registry_name?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          case_id?: string
          id?: string
          paper_id?: string
          registration_date?: string | null
          registration_number?: string | null
          registration_required?: boolean
          registration_status?: string
          registration_url?: string | null
          registry_name?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_registrations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "ethics_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_registrations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: true
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      zenodo_oauth_connection: {
        Row: {
          access_token_enc: string
          connected_at: string
          connected_by: string | null
          environment: string
          expires_at: string | null
          id: boolean
          refresh_token_enc: string | null
          scope: string | null
          updated_at: string
          zenodo_user_id: string | null
          zenodo_user_name: string | null
        }
        Insert: {
          access_token_enc: string
          connected_at?: string
          connected_by?: string | null
          environment: string
          expires_at?: string | null
          id?: boolean
          refresh_token_enc?: string | null
          scope?: string | null
          updated_at?: string
          zenodo_user_id?: string | null
          zenodo_user_name?: string | null
        }
        Update: {
          access_token_enc?: string
          connected_at?: string
          connected_by?: string | null
          environment?: string
          expires_at?: string | null
          id?: boolean
          refresh_token_enc?: string | null
          scope?: string | null
          updated_at?: string
          zenodo_user_id?: string | null
          zenodo_user_name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_purge_paper: {
        Args: { _actor: string; _paper: string; _reason: string }
        Returns: Json
      }
      ai_spend_release: { Args: { _id: string }; Returns: boolean }
      ai_spend_reserve: {
        Args: {
          _day_cap: number
          _estimate: number
          _model: string
          _paper: string
          _paper_cap: number
          _provider: string
        }
        Returns: {
          day_usd: number
          ok: boolean
          paper_usd: number
          reason: string
          reservation_id: string
        }[]
      }
      ai_spend_settle: {
        Args: { _actual: number; _id: string }
        Returns: boolean
      }
      amend_ethics: {
        Args: {
          _actor: string
          _correlation?: string
          _p: Json
          _paper: string
          _reason: string
        }
        Returns: number
      }
      amend_rights: {
        Args: {
          _actor: string
          _correlation?: string
          _paper: string
          _r: Json
          _reason: string
        }
        Returns: number
      }
      apply_published_correction: {
        Args: {
          _abstract: string
          _new_version_id: string
          _paper_id: string
          _title: string
        }
        Returns: undefined
      }
      can_access_paper: {
        Args: { _paper_id: string; _uid: string }
        Returns: boolean
      }
      claim_bootstrap_admin: { Args: { _uid: string }; Returns: boolean }
      claim_submission_attempt: {
        Args: {
          _correlation: string
          _hash: string
          _key: string
          _uid: string
        }
        Returns: {
          o_attempt_id: string
          o_owned: boolean
          o_paper_id: string
          o_status: string
        }[]
      }
      commit_new_version: {
        Args: {
          _actor: string
          _bump: string
          _kind: string
          _p: Json
          _paper: string
        }
        Returns: Json
      }
      commit_submission: { Args: { _attempt: string; _p: Json }; Returns: Json }
      contributors_confirmed: { Args: { _paper_id: string }; Returns: boolean }
      contributors_snapshot: { Args: { _paper_id: string }; Returns: Json }
      ensure_ethics_policy: {
        Args: { _hash: string; _rules: Json; _version: string }
        Returns: undefined
      }
      ethics_actor_is_party: {
        Args: { _paper: string; _uid: string }
        Returns: boolean
      }
      ethics_assign: {
        Args: {
          _actor: string
          _case: string
          _correlation?: string
          _reviewer: string
        }
        Returns: undefined
      }
      ethics_transition: {
        Args: {
          _actor: string
          _actor_type: string
          _case: string
          _correlation?: string
          _reason: string
          _structured?: Json
          _to: string
        }
        Returns: string
      }
      ethics_transition_allowed: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      ethics_verify_trial: {
        Args: {
          _actor: string
          _correlation?: string
          _paper: string
          _reason: string
          _result: string
        }
        Returns: undefined
      }
      fail_submission_attempt: {
        Args: { _attempt: string; _message: string; _stage: string }
        Returns: undefined
      }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      issn_checksum_ok: { Args: { _issn: string }; Returns: boolean }
      next_identifier: {
        Args: { _at?: string; _type: string }
        Returns: string
      }
      orcid_checksum_ok: { Args: { _orcid: string }; Returns: boolean }
      orcid_status: {
        Args: { _orcid: string; _user_id: string }
        Returns: string
      }
      paper_search_doc: {
        Args: { _abstract: string; _keywords: string[]; _title: string }
        Returns: unknown
      }
      paper_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["paper_status"]
          _override: boolean
          _to: Database["public"]["Enums"]["paper_status"]
        }
        Returns: boolean
      }
      quarantine_storage_object: {
        Args: {
          _attempt: string
          _bucket: string
          _path: string
          _reason: string
        }
        Returns: undefined
      }
      sha256_text: { Args: { _t: string }; Returns: string }
      transition_paper: {
        Args: {
          _actor: string
          _actor_type: string
          _metadata?: Json
          _override?: boolean
          _paper_id: string
          _reason: string
          _to: Database["public"]["Enums"]["paper_status"]
        }
        Returns: Database["public"]["Enums"]["paper_status"]
      }
      user_permissions: { Args: { _user_id: string }; Returns: string[] }
      zenodo_approve_publication: {
        Args: { _actor: string; _env: string; _paper_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          attempt_count: number
          doi: string | null
          doi_record_code: string
          doi_url: string | null
          file_sha256: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_error_at: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          metadata: Json | null
          metadata_version: number
          next_retry_at: string | null
          paper_id: string
          provider: string
          record_url: string | null
          registered_at: string | null
          status: string
          updated_at: string
          uploaded_at: string | null
          verified_at: string | null
          workflow_status: string
          zenodo_deposit_id: number | null
          zenodo_environment: string | null
          zenodo_record_id: number | null
        }
        SetofOptions: {
          from: "*"
          to: "doi_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      zenodo_claim_registration: {
        Args: {
          _force?: boolean
          _lease_seconds?: number
          _owner: string
          _paper_id: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          attempt_count: number
          doi: string | null
          doi_record_code: string
          doi_url: string | null
          file_sha256: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_error_at: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          metadata: Json | null
          metadata_version: number
          next_retry_at: string | null
          paper_id: string
          provider: string
          record_url: string | null
          registered_at: string | null
          status: string
          updated_at: string
          uploaded_at: string | null
          verified_at: string | null
          workflow_status: string
          zenodo_deposit_id: number | null
          zenodo_environment: string | null
          zenodo_record_id: number | null
        }
        SetofOptions: {
          from: "*"
          to: "doi_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role:
        | "researcher"
        | "editor"
        | "reviewer"
        | "admin"
        | "super_admin"
        | "payment_admin"
        | "ethics_reviewer"
        | "copyright_reviewer"
        | "founder"
      certificate_status: "VALID" | "REVOKED" | "SUPERSEDED" | "RETRACTED"
      certificate_type:
        | "SUBMISSION"
        | "PUBLICATION"
        | "PEER_REVIEW"
        | "AUTHOR_RECORD"
      decision_outcome:
        | "ACCEPT"
        | "REJECT"
        | "REVIEW_REQUIRED"
        | "REVISION_REQUIRED"
      paper_status:
        | "DRAFT"
        | "SUBMITTED"
        | "PROCESSING"
        | "AI_SCREENING"
        | "REVIEW_REQUIRED"
        | "REVISION_REQUIRED"
        | "ACCEPTED"
        | "REJECTED"
        | "PAYMENT_PENDING"
        | "PAYMENT_COMPLETED"
        | "PUBLICATION_PENDING"
        | "PUBLISHED"
        | "CORRECTED"
        | "RETRACTED"
        | "ARCHIVED"
        | "REVIEWER_ASSIGNMENT"
        | "PEER_REVIEW"
        | "EDITORIAL_DECISION"
        | "WITHDRAWN"
      payment_status:
        | "PENDING"
        | "PROCESSING"
        | "PAID"
        | "FAILED"
        | "REFUNDED"
        | "CANCELLED"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "researcher",
        "editor",
        "reviewer",
        "admin",
        "super_admin",
        "payment_admin",
        "ethics_reviewer",
        "copyright_reviewer",
        "founder",
      ],
      certificate_status: ["VALID", "REVOKED", "SUPERSEDED", "RETRACTED"],
      certificate_type: [
        "SUBMISSION",
        "PUBLICATION",
        "PEER_REVIEW",
        "AUTHOR_RECORD",
      ],
      decision_outcome: [
        "ACCEPT",
        "REJECT",
        "REVIEW_REQUIRED",
        "REVISION_REQUIRED",
      ],
      paper_status: [
        "DRAFT",
        "SUBMITTED",
        "PROCESSING",
        "AI_SCREENING",
        "REVIEW_REQUIRED",
        "REVISION_REQUIRED",
        "ACCEPTED",
        "REJECTED",
        "PAYMENT_PENDING",
        "PAYMENT_COMPLETED",
        "PUBLICATION_PENDING",
        "PUBLISHED",
        "CORRECTED",
        "RETRACTED",
        "ARCHIVED",
        "REVIEWER_ASSIGNMENT",
        "PEER_REVIEW",
        "EDITORIAL_DECISION",
        "WITHDRAWN",
      ],
      payment_status: [
        "PENDING",
        "PROCESSING",
        "PAID",
        "FAILED",
        "REFUNDED",
        "CANCELLED",
      ],
    },
  },
} as const
