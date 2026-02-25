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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      analysis_jobs: {
        Row: {
          attempt_count: number | null
          checkpoints: Json | null
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          input_data: Json | null
          last_heartbeat_at: string | null
          max_attempts: number | null
          progress: number | null
          result_data: Json | null
          session_id: string | null
          started_at: string | null
          status: string
          step: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number | null
          checkpoints?: Json | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_data?: Json | null
          last_heartbeat_at?: string | null
          max_attempts?: number | null
          progress?: number | null
          result_data?: Json | null
          session_id?: string | null
          started_at?: string | null
          status?: string
          step?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number | null
          checkpoints?: Json | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_data?: Json | null
          last_heartbeat_at?: string | null
          max_attempts?: number | null
          progress?: number | null
          result_data?: Json | null
          session_id?: string | null
          started_at?: string | null
          status?: string
          step?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dispute_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_accounts: {
        Row: {
          bureau_statuses: Json | null
          confidence: number | null
          created_at: string
          creditor_name: string
          custom_reason: string | null
          date_opened: string | null
          dispute_reason: string | null
          id: string
          is_selected: boolean | null
          masked_account_number: string
          session_id: string
          source_file: string | null
          source_page: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bureau_statuses?: Json | null
          confidence?: number | null
          created_at?: string
          creditor_name: string
          custom_reason?: string | null
          date_opened?: string | null
          dispute_reason?: string | null
          id?: string
          is_selected?: boolean | null
          masked_account_number: string
          session_id: string
          source_file?: string | null
          source_page?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bureau_statuses?: Json | null
          confidence?: number | null
          created_at?: string
          creditor_name?: string
          custom_reason?: string | null
          date_opened?: string | null
          dispute_reason?: string | null
          id?: string
          is_selected?: boolean | null
          masked_account_number?: string
          session_id?: string
          source_file?: string | null
          source_page?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_accounts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dispute_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_sessions: {
        Row: {
          active_job_id: string | null
          analysis_result: Json | null
          analysis_status: string
          bureau_response_text: string | null
          consumer_info: Json | null
          created_at: string
          documents: Json | null
          generated_letters: Json | null
          id: string
          imported_analyzer_data: Json | null
          is_analyzed: boolean | null
          latest_analysis_job_id: string | null
          manual_claims_text: string
          mode: string
          outcome_confirmation: Json | null
          prior_letter_text: string | null
          processing_progress: Json | null
          selected_bureaus: string[] | null
          survey: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_job_id?: string | null
          analysis_result?: Json | null
          analysis_status?: string
          bureau_response_text?: string | null
          consumer_info?: Json | null
          created_at?: string
          documents?: Json | null
          generated_letters?: Json | null
          id?: string
          imported_analyzer_data?: Json | null
          is_analyzed?: boolean | null
          latest_analysis_job_id?: string | null
          manual_claims_text?: string
          mode?: string
          outcome_confirmation?: Json | null
          prior_letter_text?: string | null
          processing_progress?: Json | null
          selected_bureaus?: string[] | null
          survey?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_job_id?: string | null
          analysis_result?: Json | null
          analysis_status?: string
          bureau_response_text?: string | null
          consumer_info?: Json | null
          created_at?: string
          documents?: Json | null
          generated_letters?: Json | null
          id?: string
          imported_analyzer_data?: Json | null
          is_analyzed?: boolean | null
          latest_analysis_job_id?: string | null
          manual_claims_text?: string
          mode?: string
          outcome_confirmation?: Json | null
          prior_letter_text?: string | null
          processing_progress?: Json | null
          selected_bureaus?: string[] | null
          survey?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_sessions_active_job_id_fkey"
            columns: ["active_job_id"]
            isOneToOne: false
            referencedRelation: "analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_sessions_latest_analysis_job_id_fkey"
            columns: ["latest_analysis_job_id"]
            isOneToOne: false
            referencedRelation: "analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
