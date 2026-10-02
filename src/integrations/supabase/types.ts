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
    PostgrestVersion: "14.5"
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
          issued_at: string
          paper_id: string
          paper_title_at_issue: string
          publication_date: string | null
          recipient_name_at_issue: string
          recipient_user_id: string
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
          issued_at?: string
          paper_id: string
          paper_title_at_issue: string
          publication_date?: string | null
          recipient_name_at_issue: string
          recipient_user_id: string
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
          issued_at?: string
          paper_id?: string
          paper_title_at_issue?: string
          publication_date?: string | null
          recipient_name_at_issue?: string
          recipient_user_id?: string
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
            foreignKeyName: "certificates_version_id_fkey"
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
          id: string
          is_override: boolean
          outcome: Database["public"]["Enums"]["decision_outcome"]
          override_reason: string | null
          overrides_decision_id: string | null
          paper_id: string
          policy_key: string | null
          policy_version: string | null
          reasons: Json
          source: string
          version_id: string | null
        }
        Insert: {
          actor_id?: string | null
          ai_run_id?: string | null
          check_summary?: Json
          created_at?: string
          id?: string
          is_override?: boolean
          outcome: Database["public"]["Enums"]["decision_outcome"]
          override_reason?: string | null
          overrides_decision_id?: string | null
          paper_id: string
          policy_key?: string | null
          policy_version?: string | null
          reasons?: Json
          source: string
          version_id?: string | null
        }
        Update: {
          actor_id?: string | null
          ai_run_id?: string | null
          check_summary?: Json
          created_at?: string
          id?: string
          is_override?: boolean
          outcome?: Database["public"]["Enums"]["decision_outcome"]
          override_reason?: string | null
          overrides_decision_id?: string | null
          paper_id?: string
          policy_key?: string | null
          policy_version?: string | null
          reasons?: Json
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
          doi: string | null
          id: string
          last_error: string | null
          metadata: Json | null
          metadata_version: number
          paper_id: string
          provider: string
          registered_at: string | null
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          doi?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json | null
          metadata_version?: number
          paper_id: string
          provider: string
          registered_at?: string | null
          status: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          doi?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json | null
          metadata_version?: number
          paper_id?: string
          provider?: string
          registered_at?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
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
      ethics_declarations: {
        Row: {
          answers: Json
          conflict_of_interest: string
          data_availability: string
          declaration_version: string
          declared_at: string
          funding: string
          id: string
          paper_id: string
          user_id: string
        }
        Insert: {
          answers: Json
          conflict_of_interest: string
          data_availability: string
          declaration_version: string
          declared_at?: string
          funding: string
          id?: string
          paper_id: string
          user_id: string
        }
        Update: {
          answers?: Json
          conflict_of_interest?: string
          data_availability?: string
          declaration_version?: string
          declared_at?: string
          funding?: string
          id?: string
          paper_id?: string
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
        ]
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
      paper_versions: {
        Row: {
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
          version_number: string | null
        }
        Insert: {
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
          version_number?: string | null
        }
        Update: {
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
          created_at: string
          current_version_id: string | null
          doi: string | null
          field: string
          field_metadata: Json
          id: string
          keywords: string[]
          license: string | null
          owner_id: string
          peer_reviewed: boolean
          public_id: string
          published_at: string | null
          references_text: string | null
          restricted: boolean
          search: unknown
          status: Database["public"]["Enums"]["paper_status"]
          title: string
          updated_at: string
        }
        Insert: {
          abstract?: string
          article_type?: string
          created_at?: string
          current_version_id?: string | null
          doi?: string | null
          field?: string
          field_metadata?: Json
          id?: string
          keywords?: string[]
          license?: string | null
          owner_id: string
          peer_reviewed?: boolean
          public_id?: string
          published_at?: string | null
          references_text?: string | null
          restricted?: boolean
          search?: unknown
          status?: Database["public"]["Enums"]["paper_status"]
          title?: string
          updated_at?: string
        }
        Update: {
          abstract?: string
          article_type?: string
          created_at?: string
          current_version_id?: string | null
          doi?: string | null
          field?: string
          field_metadata?: Json
          id?: string
          keywords?: string[]
          license?: string | null
          owner_id?: string
          peer_reviewed?: boolean
          public_id?: string
          published_at?: string | null
          references_text?: string | null
          restricted?: boolean
          search?: unknown
          status?: Database["public"]["Enums"]["paper_status"]
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
          id: string
          idempotency_key: string
          method: string
          order_id: string
          paper_id: string | null
          payer_reference: string | null
          product_id: string
          provider: string
          provider_order_id: string | null
          provider_transaction_id: string | null
          refunded_at: string | null
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
          id?: string
          idempotency_key: string
          method?: string
          order_id: string
          paper_id?: string | null
          payer_reference?: string | null
          product_id: string
          provider: string
          provider_order_id?: string | null
          provider_transaction_id?: string | null
          refunded_at?: string | null
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
          id?: string
          idempotency_key?: string
          method?: string
          order_id?: string
          paper_id?: string | null
          payer_reference?: string | null
          product_id?: string
          provider?: string
          provider_order_id?: string | null
          provider_transaction_id?: string | null
          refunded_at?: string | null
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
        ]
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
      review_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          comments: string | null
          completed_at: string | null
          id: string
          paper_id: string
          recommendation: string | null
          reviewer_id: string
          status: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          comments?: string | null
          completed_at?: string | null
          id?: string
          paper_id: string
          recommendation?: string | null
          reviewer_id: string
          status?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          comments?: string | null
          completed_at?: string | null
          id?: string
          paper_id?: string
          recommendation?: string | null
          reviewer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_assignments_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "papers"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_declarations: {
        Row: {
          ai_disclosure_version: string
          ai_processing_consent: boolean
          coauthor_permission: boolean
          declaration_version: string
          declared_at: string
          has_upload_rights: boolean
          id: string
          is_author: boolean
          manuscript_version_type: string
          paper_id: string
          previous_doi: string | null
          previously_published: boolean
          selected_license: string
          third_party_content: boolean
          third_party_permission: boolean | null
          user_id: string
        }
        Insert: {
          ai_disclosure_version: string
          ai_processing_consent: boolean
          coauthor_permission: boolean
          declaration_version: string
          declared_at?: string
          has_upload_rights: boolean
          id?: string
          is_author: boolean
          manuscript_version_type: string
          paper_id: string
          previous_doi?: string | null
          previously_published: boolean
          selected_license: string
          third_party_content: boolean
          third_party_permission?: boolean | null
          user_id: string
        }
        Update: {
          ai_disclosure_version?: string
          ai_processing_consent?: boolean
          coauthor_permission?: boolean
          declaration_version?: string
          declared_at?: string
          has_upload_rights?: boolean
          id?: string
          is_author?: boolean
          manuscript_version_type?: string
          paper_id?: string
          previous_doi?: string | null
          previously_published?: boolean
          selected_license?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
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
