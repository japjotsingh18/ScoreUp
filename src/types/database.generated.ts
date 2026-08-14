export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      action_choices: {
        Row: {
          automatic: boolean;
          choice: Database["public"]["Enums"]["action_choice_type"];
          created_at: string;
          id: string;
          idempotency_key: string;
          player_id: string;
          room_id: string;
          round_id: string;
          round_number: number;
        };
        Insert: {
          automatic?: boolean;
          choice: Database["public"]["Enums"]["action_choice_type"];
          created_at?: string;
          id?: string;
          idempotency_key: string;
          player_id: string;
          room_id: string;
          round_id: string;
          round_number: number;
        };
        Update: {
          automatic?: boolean;
          choice?: Database["public"]["Enums"]["action_choice_type"];
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          player_id?: string;
          room_id?: string;
          round_id?: string;
          round_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "action_choices_player_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "action_choices_round_fk";
            columns: ["room_id", "round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      action_draws: {
        Row: {
          card_code: string;
          category: Database["public"]["Enums"]["action_card_category"];
          choice_id: string;
          drawn_at: string;
          id: string;
          idempotency_key: string;
          player_id: string;
          private_effect_result: Json;
          public_safe_result: Json;
          resolved_at: string | null;
          room_id: string;
          round_id: string;
          round_number: number;
          status: Database["public"]["Enums"]["action_draw_status"];
          target_deadline: string | null;
          target_idempotency_key: string | null;
          target_player_id: string | null;
          target_requirement: Database["public"]["Enums"]["action_target_requirement"];
          targeted_at: string | null;
        };
        Insert: {
          card_code: string;
          category: Database["public"]["Enums"]["action_card_category"];
          choice_id: string;
          drawn_at?: string;
          id?: string;
          idempotency_key: string;
          player_id: string;
          private_effect_result?: Json;
          public_safe_result?: Json;
          resolved_at?: string | null;
          room_id: string;
          round_id: string;
          round_number: number;
          status: Database["public"]["Enums"]["action_draw_status"];
          target_deadline?: string | null;
          target_idempotency_key?: string | null;
          target_player_id?: string | null;
          target_requirement: Database["public"]["Enums"]["action_target_requirement"];
          targeted_at?: string | null;
        };
        Update: {
          card_code?: string;
          category?: Database["public"]["Enums"]["action_card_category"];
          choice_id?: string;
          drawn_at?: string;
          id?: string;
          idempotency_key?: string;
          player_id?: string;
          private_effect_result?: Json;
          public_safe_result?: Json;
          resolved_at?: string | null;
          room_id?: string;
          round_id?: string;
          round_number?: number;
          status?: Database["public"]["Enums"]["action_draw_status"];
          target_deadline?: string | null;
          target_idempotency_key?: string | null;
          target_player_id?: string | null;
          target_requirement?: Database["public"]["Enums"]["action_target_requirement"];
          targeted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "action_draws_choice_id_fkey";
            columns: ["choice_id"];
            isOneToOne: true;
            referencedRelation: "action_choices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_draws_player_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "action_draws_round_fk";
            columns: ["room_id", "round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "action_draws_target_fk";
            columns: ["room_id", "target_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      championship_participants: {
        Row: {
          join_order: number;
          player_id: string;
          room_id: string;
        };
        Insert: {
          join_order: number;
          player_id: string;
          room_id: string;
        };
        Update: {
          join_order?: number;
          player_id?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "championship_participant_player_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: true;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "championship_participants_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "championship_tiebreakers";
            referencedColumns: ["room_id"];
          },
        ];
      };
      championship_submissions: {
        Row: {
          elapsed_ms: number | null;
          id: string;
          idempotency_key: string;
          normalized_distance: number | null;
          player_id: string;
          room_id: string;
          submitted_at: string;
          validation_reason: string | null;
          validation_status: Database["public"]["Enums"]["championship_validation_status"];
        };
        Insert: {
          elapsed_ms?: number | null;
          id?: string;
          idempotency_key: string;
          normalized_distance?: number | null;
          player_id: string;
          room_id: string;
          submitted_at?: string;
          validation_reason?: string | null;
          validation_status: Database["public"]["Enums"]["championship_validation_status"];
        };
        Update: {
          elapsed_ms?: number | null;
          id?: string;
          idempotency_key?: string;
          normalized_distance?: number | null;
          player_id?: string;
          room_id?: string;
          submitted_at?: string;
          validation_reason?: string | null;
          validation_status?: Database["public"]["Enums"]["championship_validation_status"];
        };
        Relationships: [
          {
            foreignKeyName: "championship_submission_participant_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: true;
            referencedRelation: "championship_participants";
            referencedColumns: ["room_id", "player_id"];
          },
          {
            foreignKeyName: "championship_submissions_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "championship_tiebreakers";
            referencedColumns: ["room_id"];
          },
        ];
      };
      championship_tiebreakers: {
        Row: {
          created_at: string;
          resolution_method:
            | Database["public"]["Enums"]["championship_resolution_method"]
            | null;
          resolved_at: string | null;
          room_id: string;
          starts_at: string;
          status: Database["public"]["Enums"]["championship_status"];
          submission_deadline: string;
          winner_player_id: string | null;
        };
        Insert: {
          created_at?: string;
          resolution_method?:
            | Database["public"]["Enums"]["championship_resolution_method"]
            | null;
          resolved_at?: string | null;
          room_id: string;
          starts_at: string;
          status?: Database["public"]["Enums"]["championship_status"];
          submission_deadline: string;
          winner_player_id?: string | null;
        };
        Update: {
          created_at?: string;
          resolution_method?:
            | Database["public"]["Enums"]["championship_resolution_method"]
            | null;
          resolved_at?: string | null;
          room_id?: string;
          starts_at?: string;
          status?: Database["public"]["Enums"]["championship_status"];
          submission_deadline?: string;
          winner_player_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "championship_tiebreakers_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "championship_winner_room_fk";
            columns: ["room_id", "winner_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      game_events: {
        Row: {
          actor_player_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["game_event_type"];
          public_payload: Json;
          room_id: string;
          round_number: number | null;
          sequence: number;
        };
        Insert: {
          actor_player_id?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["game_event_type"];
          public_payload?: Json;
          room_id: string;
          round_number?: number | null;
          sequence?: never;
        };
        Update: {
          actor_player_id?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["game_event_type"];
          public_payload?: Json;
          room_id?: string;
          round_number?: number | null;
          sequence?: never;
        };
        Relationships: [
          {
            foreignKeyName: "game_events_actor_player_id_fkey";
            columns: ["actor_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_events_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      match_result_players: {
        Row: {
          display_order: number;
          final_rank: number;
          final_score: number;
          player_id: string;
          room_id: string;
        };
        Insert: {
          display_order: number;
          final_rank: number;
          final_score: number;
          player_id: string;
          room_id: string;
        };
        Update: {
          display_order?: number;
          final_rank?: number;
          final_score?: number;
          player_id?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_result_player_room_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: true;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "match_result_players_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "match_results";
            referencedColumns: ["room_id"];
          },
        ];
      };
      match_results: {
        Row: {
          completed_at: string;
          resolution_method: Database["public"]["Enums"]["championship_resolution_method"];
          room_id: string;
          winner_player_id: string;
        };
        Insert: {
          completed_at: string;
          resolution_method: Database["public"]["Enums"]["championship_resolution_method"];
          room_id: string;
          winner_player_id: string;
        };
        Update: {
          completed_at?: string;
          resolution_method?: Database["public"]["Enums"]["championship_resolution_method"];
          room_id?: string;
          winner_player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_result_winner_room_fk";
            columns: ["room_id", "winner_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "match_results_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      match_stat_awards: {
        Row: {
          category: Database["public"]["Enums"]["match_stat_category"];
          player_id: string;
          room_id: string;
          value: number;
        };
        Insert: {
          category: Database["public"]["Enums"]["match_stat_category"];
          player_id: string;
          room_id: string;
          value: number;
        };
        Update: {
          category?: Database["public"]["Enums"]["match_stat_category"];
          player_id?: string;
          room_id?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "match_stat_awards_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "match_results";
            referencedColumns: ["room_id"];
          },
          {
            foreignKeyName: "match_stat_player_room_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      mini_game_challenges: {
        Row: {
          cancellation_reason: string | null;
          cancelled_at: string | null;
          challenger_player_id: string;
          completed_at: string | null;
          current_attempt: number;
          game_type: Database["public"]["Enums"]["mini_game_type"] | null;
          id: string;
          idempotency_key: string;
          opponent_player_id: string;
          pot: number | null;
          queue_position: number;
          requested_at: string;
          resolution_method:
            Database["public"]["Enums"]["mini_game_resolution_method"] | null;
          room_id: string;
          round_id: string;
          round_number: number;
          stake_per_player: number | null;
          stake_type: Database["public"]["Enums"]["mini_game_stake_type"];
          started_at: string | null;
          starts_at: string | null;
          status: Database["public"]["Enums"]["mini_game_challenge_status"];
          submission_deadline: string | null;
          winner_player_id: string | null;
        };
        Insert: {
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          challenger_player_id: string;
          completed_at?: string | null;
          current_attempt?: number;
          game_type?: Database["public"]["Enums"]["mini_game_type"] | null;
          id?: string;
          idempotency_key: string;
          opponent_player_id: string;
          pot?: number | null;
          queue_position?: never;
          requested_at?: string;
          resolution_method?:
            Database["public"]["Enums"]["mini_game_resolution_method"] | null;
          room_id: string;
          round_id: string;
          round_number: number;
          stake_per_player?: number | null;
          stake_type: Database["public"]["Enums"]["mini_game_stake_type"];
          started_at?: string | null;
          starts_at?: string | null;
          status?: Database["public"]["Enums"]["mini_game_challenge_status"];
          submission_deadline?: string | null;
          winner_player_id?: string | null;
        };
        Update: {
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          challenger_player_id?: string;
          completed_at?: string | null;
          current_attempt?: number;
          game_type?: Database["public"]["Enums"]["mini_game_type"] | null;
          id?: string;
          idempotency_key?: string;
          opponent_player_id?: string;
          pot?: number | null;
          queue_position?: never;
          requested_at?: string;
          resolution_method?:
            Database["public"]["Enums"]["mini_game_resolution_method"] | null;
          room_id?: string;
          round_id?: string;
          round_number?: number;
          stake_per_player?: number | null;
          stake_type?: Database["public"]["Enums"]["mini_game_stake_type"];
          started_at?: string | null;
          starts_at?: string | null;
          status?: Database["public"]["Enums"]["mini_game_challenge_status"];
          submission_deadline?: string | null;
          winner_player_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mini_game_challenges_challenger_fk";
            columns: ["room_id", "challenger_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "mini_game_challenges_opponent_fk";
            columns: ["room_id", "opponent_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "mini_game_challenges_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mini_game_challenges_round_fk";
            columns: ["room_id", "round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "mini_game_challenges_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mini_game_challenges_winner_fk";
            columns: ["room_id", "winner_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      mini_game_submissions: {
        Row: {
          attempt: number;
          challenge_id: string;
          client_elapsed_ms: number | null;
          id: string;
          idempotency_key: string;
          normalized_result: Json;
          player_id: string;
          received_at: string;
          result_payload: Json;
          room_id: string;
          round_id: string;
          validation_reason: string | null;
          validation_status: Database["public"]["Enums"]["mini_game_validation_status"];
        };
        Insert: {
          attempt: number;
          challenge_id: string;
          client_elapsed_ms?: number | null;
          id?: string;
          idempotency_key: string;
          normalized_result?: Json;
          player_id: string;
          received_at?: string;
          result_payload: Json;
          room_id: string;
          round_id: string;
          validation_reason?: string | null;
          validation_status: Database["public"]["Enums"]["mini_game_validation_status"];
        };
        Update: {
          attempt?: number;
          challenge_id?: string;
          client_elapsed_ms?: number | null;
          id?: string;
          idempotency_key?: string;
          normalized_result?: Json;
          player_id?: string;
          received_at?: string;
          result_payload?: Json;
          room_id?: string;
          round_id?: string;
          validation_reason?: string | null;
          validation_status?: Database["public"]["Enums"]["mini_game_validation_status"];
        };
        Relationships: [
          {
            foreignKeyName: "mini_game_submissions_challenge_id_fkey";
            columns: ["challenge_id"];
            isOneToOne: false;
            referencedRelation: "mini_game_challenges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mini_game_submissions_player_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "mini_game_submissions_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mini_game_submissions_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mini_game_submissions_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          action_draw_allowance: number;
          action_draws_used: number;
          auth_user_id: string;
          challenges_lost: number;
          challenges_tied: number;
          challenges_won: number;
          connected: boolean;
          disconnected_at: string | null;
          display_name: string;
          id: string;
          is_host: boolean;
          join_order: number;
          joined_at: string;
          last_seen_at: string;
          left_at: string | null;
          lock_ins_count: number;
          match_participant: boolean;
          mini_game_token_used: boolean;
          ready: boolean;
          room_id: string;
          score: number;
          timeouts_count: number;
          updated_at: string;
        };
        Insert: {
          action_draw_allowance?: number;
          action_draws_used?: number;
          auth_user_id: string;
          challenges_lost?: number;
          challenges_tied?: number;
          challenges_won?: number;
          connected?: boolean;
          disconnected_at?: string | null;
          display_name: string;
          id?: string;
          is_host?: boolean;
          join_order?: never;
          joined_at?: string;
          last_seen_at?: string;
          left_at?: string | null;
          lock_ins_count?: number;
          match_participant?: boolean;
          mini_game_token_used?: boolean;
          ready?: boolean;
          room_id: string;
          score?: number;
          timeouts_count?: number;
          updated_at?: string;
        };
        Update: {
          action_draw_allowance?: number;
          action_draws_used?: number;
          auth_user_id?: string;
          challenges_lost?: number;
          challenges_tied?: number;
          challenges_won?: number;
          connected?: boolean;
          disconnected_at?: string | null;
          display_name?: string;
          id?: string;
          is_host?: boolean;
          join_order?: never;
          joined_at?: string;
          last_seen_at?: string;
          left_at?: string | null;
          lock_ins_count?: number;
          match_participant?: boolean;
          mini_game_token_used?: boolean;
          ready?: boolean;
          room_id?: string;
          score?: number;
          timeouts_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "players_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      point_decisions: {
        Row: {
          acting_player_id: string;
          created_at: string;
          decision_type: Database["public"]["Enums"]["point_decision_type"];
          id: string;
          idempotency_key: string;
          resolved_at: string;
          result_metadata: Json;
          room_id: string;
          round_id: string;
          round_number: number;
          target_player_id: string | null;
        };
        Insert: {
          acting_player_id: string;
          created_at?: string;
          decision_type: Database["public"]["Enums"]["point_decision_type"];
          id?: string;
          idempotency_key: string;
          resolved_at?: string;
          result_metadata?: Json;
          room_id: string;
          round_id: string;
          round_number: number;
          target_player_id?: string | null;
        };
        Update: {
          acting_player_id?: string;
          created_at?: string;
          decision_type?: Database["public"]["Enums"]["point_decision_type"];
          id?: string;
          idempotency_key?: string;
          resolved_at?: string;
          result_metadata?: Json;
          room_id?: string;
          round_id?: string;
          round_number?: number;
          target_player_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "point_decisions_actor_fk";
            columns: ["room_id", "acting_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "point_decisions_round_fk";
            columns: ["room_id", "round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "point_decisions_target_fk";
            columns: ["room_id", "target_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      rematches: {
        Row: {
          created_at: string;
          idempotency_key: string;
          rematch_room_id: string;
          requested_by_player_id: string;
          source_room_id: string;
        };
        Insert: {
          created_at?: string;
          idempotency_key: string;
          rematch_room_id: string;
          requested_by_player_id: string;
          source_room_id: string;
        };
        Update: {
          created_at?: string;
          idempotency_key?: string;
          rematch_room_id?: string;
          requested_by_player_id?: string;
          source_room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rematches_rematch_room_id_fkey";
            columns: ["rematch_room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rematches_requested_by_player_id_fkey";
            columns: ["requested_by_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rematches_source_room_id_fkey";
            columns: ["source_room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      rooms: {
        Row: {
          completed_at: string | null;
          created_at: string;
          created_by_user_id: string;
          creation_request_id: string;
          current_phase: Database["public"]["Enums"]["game_phase"] | null;
          current_round: number;
          current_turn_player_id: string | null;
          host_player_id: string;
          id: string;
          match_version: number;
          max_players: number;
          password_hash: string | null;
          phase_deadline: string | null;
          room_code: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["room_status"];
          tiebreaker_required: boolean;
          total_rounds: number;
          turn_timer_seconds: number;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          created_by_user_id: string;
          creation_request_id: string;
          current_phase?: Database["public"]["Enums"]["game_phase"] | null;
          current_round?: number;
          current_turn_player_id?: string | null;
          host_player_id: string;
          id?: string;
          match_version?: number;
          max_players: number;
          password_hash?: string | null;
          phase_deadline?: string | null;
          room_code: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["room_status"];
          tiebreaker_required?: boolean;
          total_rounds: number;
          turn_timer_seconds: number;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          created_by_user_id?: string;
          creation_request_id?: string;
          current_phase?: Database["public"]["Enums"]["game_phase"] | null;
          current_round?: number;
          current_turn_player_id?: string | null;
          host_player_id?: string;
          id?: string;
          match_version?: number;
          max_players?: number;
          password_hash?: string | null;
          phase_deadline?: string | null;
          room_code?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["room_status"];
          tiebreaker_required?: boolean;
          total_rounds?: number;
          turn_timer_seconds?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_current_turn_belongs_to_room";
            columns: ["id", "current_turn_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "rooms_host_belongs_to_room";
            columns: ["id", "host_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      round_cards_private: {
        Row: {
          created_at: string;
          current_value: number;
          current_value_source_player_id: string;
          id: string;
          original_value: number;
          player_id: string;
          points_awarded: number;
          resolution_status: Database["public"]["Enums"]["card_resolution_status"];
          resolution_type:
            Database["public"]["Enums"]["card_resolution_type"] | null;
          resolved_at: string | null;
          room_id: string;
          round_id: string;
          round_number: number;
        };
        Insert: {
          created_at?: string;
          current_value: number;
          current_value_source_player_id: string;
          id?: string;
          original_value: number;
          player_id: string;
          points_awarded?: number;
          resolution_status?: Database["public"]["Enums"]["card_resolution_status"];
          resolution_type?:
            Database["public"]["Enums"]["card_resolution_type"] | null;
          resolved_at?: string | null;
          room_id: string;
          round_id: string;
          round_number: number;
        };
        Update: {
          created_at?: string;
          current_value?: number;
          current_value_source_player_id?: string;
          id?: string;
          original_value?: number;
          player_id?: string;
          points_awarded?: number;
          resolution_status?: Database["public"]["Enums"]["card_resolution_status"];
          resolution_type?:
            Database["public"]["Enums"]["card_resolution_type"] | null;
          resolved_at?: string | null;
          room_id?: string;
          round_id?: string;
          round_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "round_cards_player_fk";
            columns: ["room_id", "player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "round_cards_round_fk";
            columns: ["room_id", "round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "round_cards_value_source_fk";
            columns: ["room_id", "current_value_source_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      rounds: {
        Row: {
          action_deadline: string | null;
          completed_at: string | null;
          current_turn_index: number | null;
          current_turn_player_id: string | null;
          decision_order: string[];
          id: string;
          phase: Database["public"]["Enums"]["game_phase"];
          phase_deadline: string | null;
          room_id: string;
          round_number: number;
          started_at: string;
          status: Database["public"]["Enums"]["round_status"];
          turn_deadline: string | null;
        };
        Insert: {
          action_deadline?: string | null;
          completed_at?: string | null;
          current_turn_index?: number | null;
          current_turn_player_id?: string | null;
          decision_order?: string[];
          id?: string;
          phase?: Database["public"]["Enums"]["game_phase"];
          phase_deadline?: string | null;
          room_id: string;
          round_number: number;
          started_at?: string;
          status?: Database["public"]["Enums"]["round_status"];
          turn_deadline?: string | null;
        };
        Update: {
          action_deadline?: string | null;
          completed_at?: string | null;
          current_turn_index?: number | null;
          current_turn_player_id?: string | null;
          decision_order?: string[];
          id?: string;
          phase?: Database["public"]["Enums"]["game_phase"];
          phase_deadline?: string | null;
          room_id?: string;
          round_number?: number;
          started_at?: string;
          status?: Database["public"]["Enums"]["round_status"];
          turn_deadline?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rounds_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rounds_turn_belongs_to_room";
            columns: ["room_id", "current_turn_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["room_id", "id"];
          },
        ];
      };
      score_ledger: {
        Row: {
          action_draw_id: string | null;
          balance_after: number;
          created_at: string;
          decision_id: string | null;
          delta: number;
          id: number;
          mini_game_challenge_id: string | null;
          player_id: string;
          reason_code: string;
          room_id: string;
          round_id: string;
          source_key: string;
        };
        Insert: {
          action_draw_id?: string | null;
          balance_after: number;
          created_at?: string;
          decision_id?: string | null;
          delta: number;
          id?: never;
          mini_game_challenge_id?: string | null;
          player_id: string;
          reason_code: string;
          room_id: string;
          round_id: string;
          source_key: string;
        };
        Update: {
          action_draw_id?: string | null;
          balance_after?: number;
          created_at?: string;
          decision_id?: string | null;
          delta?: number;
          id?: never;
          mini_game_challenge_id?: string | null;
          player_id?: string;
          reason_code?: string;
          room_id?: string;
          round_id?: string;
          source_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "score_ledger_action_draw_id_fkey";
            columns: ["action_draw_id"];
            isOneToOne: false;
            referencedRelation: "action_draws";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "score_ledger_decision_id_fkey";
            columns: ["decision_id"];
            isOneToOne: false;
            referencedRelation: "point_decisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "score_ledger_mini_game_challenge_id_fkey";
            columns: ["mini_game_challenge_id"];
            isOneToOne: false;
            referencedRelation: "mini_game_challenges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "score_ledger_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "score_ledger_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "score_ledger_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      advance_round_summary: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      challenge_point_card: {
        Args: {
          p_idempotency_key: string;
          p_room_id: string;
          p_target_player_id: string;
        };
        Returns: Json;
      };
      create_room: {
        Args: {
          p_display_name: string;
          p_max_players: number;
          p_password: string;
          p_request_id: string;
          p_total_rounds: number;
          p_turn_timer_seconds: number;
        };
        Returns: Json;
      };
      get_action_state_snapshot: { Args: { p_room_id: string }; Returns: Json };
      get_lobby_snapshot: { Args: { p_room_id: string }; Returns: Json };
      get_match_snapshot: { Args: { p_room_id: string }; Returns: Json };
      get_mini_game_snapshot: { Args: { p_room_id: string }; Returns: Json };
      heartbeat_room: { Args: { p_room_id: string }; Returns: Json };
      join_room: {
        Args: {
          p_display_name: string;
          p_password?: string;
          p_room_code: string;
        };
        Returns: Json;
      };
      leave_room: { Args: { p_room_id: string }; Returns: undefined };
      lock_in_point_card: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      mark_room_disconnected: {
        Args: { p_room_id: string };
        Returns: undefined;
      };
      process_expired_action_phase: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      process_expired_action_target: {
        Args: {
          p_action_draw_id: string;
          p_idempotency_key: string;
          p_room_id: string;
        };
        Returns: Json;
      };
      process_expired_championship: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      process_expired_mini_game: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      process_expired_turn: {
        Args: {
          p_expected_turn_player_id: string;
          p_idempotency_key: string;
          p_room_id: string;
        };
        Returns: Json;
      };
      process_mini_game_queue: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      remove_lobby_player: {
        Args: { p_player_id: string; p_room_id: string };
        Returns: Json;
      };
      request_mini_game_challenge: {
        Args: {
          p_idempotency_key: string;
          p_opponent_player_id: string;
          p_room_id: string;
          p_stake_type: Database["public"]["Enums"]["mini_game_stake_type"];
        };
        Returns: Json;
      };
      request_rematch: {
        Args: { p_idempotency_key: string; p_room_id: string };
        Returns: Json;
      };
      set_ready_state: {
        Args: { p_ready: boolean; p_room_id: string };
        Returns: Json;
      };
      start_room: { Args: { p_room_id: string }; Returns: Json };
      submit_action_choice: {
        Args: {
          p_choice: Database["public"]["Enums"]["action_choice_type"];
          p_idempotency_key: string;
          p_room_id: string;
        };
        Returns: Json;
      };
      submit_action_target: {
        Args: {
          p_action_draw_id: string;
          p_idempotency_key: string;
          p_room_id: string;
          p_target_player_id: string;
        };
        Returns: Json;
      };
      submit_championship_result: {
        Args: {
          p_idempotency_key: string;
          p_result_payload: Json;
          p_room_id: string;
        };
        Returns: Json;
      };
      submit_mini_game_result: {
        Args: {
          p_challenge_id: string;
          p_idempotency_key: string;
          p_result_payload: Json;
          p_room_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      action_card_category: "positive" | "negative" | "unpredictable";
      action_choice_type: "draw" | "skip";
      action_draw_status: "selected" | "awaiting_target" | "resolved";
      action_target_requirement: "none" | "player_select" | "server_select";
      card_resolution_status: "unresolved" | "resolved";
      card_resolution_type:
        | "lock_in"
        | "challenge_win"
        | "challenge_loss"
        | "challenge_tie"
        | "auto_lock_in"
        | "timeout";
      championship_resolution_method:
        "skill" | "timing" | "timeout" | "secure_fallback";
      championship_status: "active" | "resolved";
      championship_validation_status: "accepted" | "rejected";
      game_event_type:
        | "round_started"
        | "turn_started"
        | "player_locked_in"
        | "challenge_started"
        | "challenge_resolved"
        | "timeout_occurred"
        | "round_completed"
        | "scores_updated"
        | "match_completed"
        | "action_phase_started"
        | "action_target_required"
        | "action_card_resolved"
        | "action_skipped"
        | "action_auto_skipped"
        | "action_phase_completed"
        | "mini_game_requested"
        | "mini_game_started"
        | "mini_game_submission_received"
        | "mini_game_tiebreaker_started"
        | "mini_game_resolved"
        | "mini_game_queue_advanced"
        | "mini_game_phase_completed"
        | "match_finalizing"
        | "championship_tiebreaker_started"
        | "championship_submission_received"
        | "championship_resolved"
        | "rematch_created";
      game_phase:
        | "dealing"
        | "action_choice"
        | "point_decisions"
        | "mini_game_resolution"
        | "round_summary"
        | "finalizing"
        | "championship_tiebreaker"
        | "completed";
      match_stat_category:
        | "lock_in_points"
        | "biggest_point_challenge"
        | "action_draws"
        | "mini_game_wins"
        | "biggest_comeback";
      mini_game_challenge_status:
        | "queued"
        | "active"
        | "tiebreaker_active"
        | "resolved"
        | "cancelled"
        | "refunded";
      mini_game_resolution_method:
        | "game_result"
        | "opponent_timeout"
        | "opponent_invalid"
        | "tiebreaker_result"
        | "random_fallback"
        | "server_refund";
      mini_game_stake_type: "half" | "all";
      mini_game_type: "stop_bar" | "memory_sequence" | "different_symbol";
      mini_game_validation_status: "accepted" | "rejected";
      point_decision_type: "lock_in" | "challenge" | "auto_lock_in" | "timeout";
      room_status: "lobby" | "starting" | "in_progress" | "completed";
      round_status: "active" | "completed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      action_card_category: ["positive", "negative", "unpredictable"],
      action_choice_type: ["draw", "skip"],
      action_draw_status: ["selected", "awaiting_target", "resolved"],
      action_target_requirement: ["none", "player_select", "server_select"],
      card_resolution_status: ["unresolved", "resolved"],
      card_resolution_type: [
        "lock_in",
        "challenge_win",
        "challenge_loss",
        "challenge_tie",
        "auto_lock_in",
        "timeout",
      ],
      championship_resolution_method: [
        "skill",
        "timing",
        "timeout",
        "secure_fallback",
      ],
      championship_status: ["active", "resolved"],
      championship_validation_status: ["accepted", "rejected"],
      game_event_type: [
        "round_started",
        "turn_started",
        "player_locked_in",
        "challenge_started",
        "challenge_resolved",
        "timeout_occurred",
        "round_completed",
        "scores_updated",
        "match_completed",
        "action_phase_started",
        "action_target_required",
        "action_card_resolved",
        "action_skipped",
        "action_auto_skipped",
        "action_phase_completed",
        "mini_game_requested",
        "mini_game_started",
        "mini_game_submission_received",
        "mini_game_tiebreaker_started",
        "mini_game_resolved",
        "mini_game_queue_advanced",
        "mini_game_phase_completed",
        "match_finalizing",
        "championship_tiebreaker_started",
        "championship_submission_received",
        "championship_resolved",
        "rematch_created",
      ],
      game_phase: [
        "dealing",
        "action_choice",
        "point_decisions",
        "mini_game_resolution",
        "round_summary",
        "finalizing",
        "championship_tiebreaker",
        "completed",
      ],
      match_stat_category: [
        "lock_in_points",
        "biggest_point_challenge",
        "action_draws",
        "mini_game_wins",
        "biggest_comeback",
      ],
      mini_game_challenge_status: [
        "queued",
        "active",
        "tiebreaker_active",
        "resolved",
        "cancelled",
        "refunded",
      ],
      mini_game_resolution_method: [
        "game_result",
        "opponent_timeout",
        "opponent_invalid",
        "tiebreaker_result",
        "random_fallback",
        "server_refund",
      ],
      mini_game_stake_type: ["half", "all"],
      mini_game_type: ["stop_bar", "memory_sequence", "different_symbol"],
      mini_game_validation_status: ["accepted", "rejected"],
      point_decision_type: ["lock_in", "challenge", "auto_lock_in", "timeout"],
      room_status: ["lobby", "starting", "in_progress", "completed"],
      round_status: ["active", "completed"],
    },
  },
} as const;
