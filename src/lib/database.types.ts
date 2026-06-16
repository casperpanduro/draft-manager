export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      clubs: {
        Row: {
          competition_id: string
          external_ref: string | null
          id: string
          logo_url: string | null
          name: string
          provider: string
          strength: number | null
        }
        Insert: {
          competition_id: string
          external_ref?: string | null
          id?: string
          logo_url?: string | null
          name: string
          provider?: string
          strength?: number | null
        }
        Update: {
          competition_id?: string
          external_ref?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          provider?: string
          strength?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clubs_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          accent: Json | null
          bg_url: string | null
          external_ref: string | null
          id: string
          name: string
          playable: boolean
          provider: string | null
          roster_template: Json
          season: number | null
          seed_progress: Json | null
          seed_status: string
          short: string | null
          slug: string
          sort: number
          sport_slug: string | null
          tagline: string | null
          theme: string
        }
        Insert: {
          accent?: Json | null
          bg_url?: string | null
          external_ref?: string | null
          id?: string
          name: string
          playable?: boolean
          provider?: string | null
          roster_template?: Json
          season?: number | null
          seed_progress?: Json | null
          seed_status?: string
          short?: string | null
          slug: string
          sort?: number
          sport_slug?: string | null
          tagline?: string | null
          theme: string
        }
        Update: {
          accent?: Json | null
          bg_url?: string | null
          external_ref?: string | null
          id?: string
          name?: string
          playable?: boolean
          provider?: string | null
          roster_template?: Json
          season?: number | null
          seed_progress?: Json | null
          seed_status?: string
          short?: string | null
          slug?: string
          sort?: number
          sport_slug?: string | null
          tagline?: string | null
          theme?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitions_sport_slug_fkey"
            columns: ["sport_slug"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["slug"]
          },
        ]
      }
      draft_picks: {
        Row: {
          auto_picked: boolean
          created_at: string
          id: string
          league_id: string
          pick_number: number
          player_id: string
          round: number
          team_id: string
        }
        Insert: {
          auto_picked?: boolean
          created_at?: string
          id?: string
          league_id: string
          pick_number: number
          player_id: string
          round: number
          team_id: string
        }
        Update: {
          auto_picked?: boolean
          created_at?: string
          id?: string
          league_id?: string
          pick_number?: number
          player_id?: string
          round?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          competition_id: string
          external_ref: string | null
          id: string
          label: string
          provider: string
          result: Json | null
          starts_at: string | null
          status: string | null
        }
        Insert: {
          competition_id: string
          external_ref?: string | null
          id?: string
          label: string
          provider?: string
          result?: Json | null
          starts_at?: string | null
          status?: string | null
        }
        Update: {
          competition_id?: string
          external_ref?: string | null
          id?: string
          label?: string
          provider?: string
          result?: Json | null
          starts_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          clock_seconds: number
          commissioner_id: string
          competition_id: string
          created_at: string
          current_pick_number: number
          id: string
          join_code: string
          name: string
          pick_deadline: string | null
          status: Database["public"]["Enums"]["league_status"]
        }
        Insert: {
          clock_seconds?: number
          commissioner_id: string
          competition_id: string
          created_at?: string
          current_pick_number?: number
          id?: string
          join_code: string
          name: string
          pick_deadline?: string | null
          status?: Database["public"]["Enums"]["league_status"]
        }
        Update: {
          clock_seconds?: number
          commissioner_id?: string
          competition_id?: string
          created_at?: string
          current_pick_number?: number
          id?: string
          join_code?: string
          name?: string
          pick_deadline?: string | null
          status?: Database["public"]["Enums"]["league_status"]
        }
        Relationships: [
          {
            foreignKeyName: "leagues_commissioner_id_fkey"
            columns: ["commissioner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leagues_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          base_value: number
          club: string
          club_id: string | null
          competition_id: string
          external_ref: string | null
          id: string
          name: string
          position: string | null
          provider: string
          rating: number
          stats: Json | null
          value: number
        }
        Insert: {
          base_value?: number
          club?: string
          club_id?: string | null
          competition_id: string
          external_ref?: string | null
          id?: string
          name: string
          position?: string | null
          provider?: string
          rating?: number
          stats?: Json | null
          value?: number
        }
        Update: {
          base_value?: number
          club?: string
          club_id?: string | null
          competition_id?: string
          external_ref?: string | null
          id?: string
          name?: string
          position?: string | null
          provider?: string
          rating?: number
          stats?: Json | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "players_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_admin: boolean
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
          is_admin?: boolean
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_admin?: boolean
        }
        Relationships: []
      }
      sports: {
        Row: {
          default_roster_template: Json
          name: string
          provider: string | null
          provider_config: Json
          slug: string
          sort: number
        }
        Insert: {
          default_roster_template?: Json
          name: string
          provider?: string | null
          provider_config?: Json
          slug: string
          sort?: number
        }
        Update: {
          default_roster_template?: Json
          name?: string
          provider?: string | null
          provider_config?: Json
          slug?: string
          sort?: number
        }
        Relationships: []
      }
      teams: {
        Row: {
          budget: number
          created_at: string
          draft_position: number | null
          draft_queue: Json
          id: string
          league_id: string
          name: string
          user_id: string
        }
        Insert: {
          budget?: number
          created_at?: string
          draft_position?: number | null
          draft_queue?: Json
          id?: string
          league_id: string
          name: string
          user_id: string
        }
        Update: {
          budget?: number
          created_at?: string
          draft_position?: number | null
          draft_queue?: Json
          id?: string
          league_id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_pick: { Args: { p_league_id: string }; Returns: boolean }
      compute_player_value: {
        Args: { p_rating: number; p_strength: number }
        Returns: number
      }
      create_league: {
        Args: {
          p_competition_slug: string
          p_league_name: string
          p_team_name: string
        }
        Returns: string
      }
      football_template: { Args: never; Returns: Json }
      gen_join_code: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      join_league: {
        Args: { p_code: string; p_team_name: string }
        Returns: string
      }
      make_pick: {
        Args: { p_league_id: string; p_player_id: string }
        Returns: undefined
      }
      position_draftable: {
        Args: { p_pos: string; p_team_id: string }
        Returns: boolean
      }
      recompute_competition_values: {
        Args: { p_competition_id: string }
        Returns: undefined
      }
      record_pick: {
        Args: {
          p_auto: boolean
          p_league_id: string
          p_player_id: string
          p_team_id: string
        }
        Returns: undefined
      }
      seat_for_pick: {
        Args: { p_pick: number; p_teams: number }
        Returns: number
      }
      set_draft_queue: {
        Args: { p_league_id: string; p_player_ids: string[] }
        Returns: undefined
      }
      start_draft: { Args: { p_league_id: string }; Returns: undefined }
      template_bench: { Args: { t: Json }; Returns: number }
      template_roster_size: { Args: { t: Json }; Returns: number }
      template_slot_count: {
        Args: { p_code: string; t: Json }
        Returns: number
      }
    }
    Enums: {
      league_status: "lobby" | "drafting" | "complete"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      league_status: ["lobby", "drafting", "complete"],
    },
  },
} as const

