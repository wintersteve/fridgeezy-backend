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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
        }
        Relationships: []
      }
      collection_recipes: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          recipe_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          recipe_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_recipes_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_recipes_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          profile_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          profile_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          profile_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cooking_action_aliases: {
        Row: {
          action_id: string
          alias: string
          created_at: string
          id: string
        }
        Insert: {
          action_id: string
          alias: string
          created_at?: string
          id?: string
        }
        Update: {
          action_id?: string
          alias?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cooking_action_aliases_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "cooking_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      cooking_action_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      cooking_actions: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          tips: string | null
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tips?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tips?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cooking_actions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "cooking_action_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          ingredient_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          ingredient_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          ingredient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_substitutes: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          notes: string | null
          substitute_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          notes?: string | null
          substitute_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          notes?: string | null
          substitute_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_substitutes_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_substitutes_substitute_id_fkey"
            columns: ["substitute_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          category_id: string | null
          created_at: string
          default_shelf_life_days: number | null
          description: string | null
          expires_by_default: boolean
          id: string
          image_url: string | null
          name: string
          nutritional_info: Json | null
          parent_id: string | null
          shelf_life: string | null
          storage_tips: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          default_shelf_life_days?: number | null
          description?: string | null
          expires_by_default?: boolean
          id?: string
          image_url?: string | null
          name: string
          nutritional_info?: Json | null
          parent_id?: string | null
          shelf_life?: string | null
          storage_tips?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          default_shelf_life_days?: number | null
          description?: string | null
          expires_by_default?: boolean
          id?: string
          image_url?: string | null
          name?: string
          nutritional_info?: Json | null
          parent_id?: string | null
          shelf_life?: string | null
          storage_tips?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      pantry_items: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          ingredient_id: string
          profile_id: string
          quantity: number | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id: string
          profile_id: string
          quantity?: number | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id?: string
          profile_id?: string
          quantity?: number | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pantry_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pantry_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pantry_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_blacklisted_ingredients: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_blacklisted_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_blacklisted_ingredients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_dietary_preferences: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_dietary_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_dietary_preferences_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_recipe_interactions: {
        Row: {
          created_at: string
          id: string
          interaction_type: Database["public"]["Enums"]["recipe_interaction_type"]
          profile_id: string
          recipe_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interaction_type: Database["public"]["Enums"]["recipe_interaction_type"]
          profile_id: string
          recipe_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interaction_type?: Database["public"]["Enums"]["recipe_interaction_type"]
          profile_id?: string
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_recipe_interactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_recipe_interactions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_settings: {
        Row: {
          created_at: string
          difficulty: Database["public"]["Enums"]["difficulty_type"] | null
          id: string
          profile_id: string
          servings: number
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          id?: string
          profile_id: string
          servings?: number
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          id?: string
          profile_id?: string
          servings?: number
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_settings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_settings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          onboarding_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prompt_variables: {
        Row: {
          created_at: string
          id: string
          label: string
          position: number
          prompt_id: string
          tag_type: Database["public"]["Enums"]["tag_type"] | null
          variable_type: Database["public"]["Enums"]["prompt_variable_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          position: number
          prompt_id: string
          tag_type?: Database["public"]["Enums"]["tag_type"] | null
          variable_type: Database["public"]["Enums"]["prompt_variable_type"]
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          prompt_id?: string
          tag_type?: Database["public"]["Enums"]["tag_type"] | null
          variable_type?: Database["public"]["Enums"]["prompt_variable_type"]
        }
        Relationships: [
          {
            foreignKeyName: "prompt_variables_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          created_at: string
          id: string
          position: number
          profile_id: string
          prompt: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          profile_id: string
          prompt: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          profile_id?: string
          prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          quantity?: number
          recipe_id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_instructions: {
        Row: {
          cooking_action_id: string | null
          created_at: string
          duration_minutes: number | null
          id: string
          ingredient_refs: string[] | null
          instruction_text: string
          recipe_id: string
          step_number: number
          temperature: Json | null
          tips: string | null
        }
        Insert: {
          cooking_action_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          ingredient_refs?: string[] | null
          instruction_text: string
          recipe_id: string
          step_number: number
          temperature?: Json | null
          tips?: string | null
        }
        Update: {
          cooking_action_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          ingredient_refs?: string[] | null
          instruction_text?: string
          recipe_id?: string
          step_number?: number
          temperature?: Json | null
          tips?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_instructions_cooking_action_id_fkey"
            columns: ["cooking_action_id"]
            isOneToOne: false
            referencedRelation: "cooking_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_instructions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_suggestion_ingredients: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          recipe_suggestion_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          recipe_suggestion_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          recipe_suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_suggestion_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_suggestion_ingredients_recipe_suggestion_id_fkey"
            columns: ["recipe_suggestion_id"]
            isOneToOne: false
            referencedRelation: "recipe_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_suggestion_tags: {
        Row: {
          created_at: string
          id: string
          recipe_suggestion_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipe_suggestion_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recipe_suggestion_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_suggestion_tags_recipe_suggestion_id_fkey"
            columns: ["recipe_suggestion_id"]
            isOneToOne: false
            referencedRelation: "recipe_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_suggestion_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_suggestions: {
        Row: {
          created_at: string
          description: string | null
          difficulty: Database["public"]["Enums"]["difficulty_type"] | null
          id: string
          name: string
          promoted_at: string | null
          promoted_to_recipe_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          id?: string
          name: string
          promoted_at?: string | null
          promoted_to_recipe_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          id?: string
          name?: string
          promoted_at?: string | null
          promoted_to_recipe_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_suggestions_promoted_to_recipe_id_fkey"
            columns: ["promoted_to_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_tags: {
        Row: {
          created_at: string
          id: string
          recipe_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipe_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recipe_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_tags_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          cook_time: string | null
          created_at: string
          description: string | null
          difficulty: Database["public"]["Enums"]["difficulty_type"] | null
          fts: string | null
          id: string
          instructions: string[]
          name: string
          prep_time: string | null
          servings: number
          tips: string[] | null
          updated_at: string
        }
        Insert: {
          cook_time?: string | null
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          fts?: string | null
          id?: string
          instructions?: string[]
          name: string
          prep_time?: string | null
          servings?: number
          tips?: string[] | null
          updated_at?: string
        }
        Update: {
          cook_time?: string | null
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          fts?: string | null
          id?: string
          instructions?: string[]
          name?: string
          prep_time?: string | null
          servings?: number
          tips?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      shopping_lists: {
        Row: {
          created_at: string
          id: string
          name: string | null
          profile_id: string
          recipe_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          profile_id: string
          recipe_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          profile_id?: string
          recipe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_lists_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_lists_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_aliases: {
        Row: {
          alias: string
          canonical_id: string
          created_at: string
          id: string
          tag_id: string
          type: Database["public"]["Enums"]["tag_type"]
        }
        Insert: {
          alias: string
          canonical_id: string
          created_at?: string
          id?: string
          tag_id: string
          type: Database["public"]["Enums"]["tag_type"]
        }
        Update: {
          alias?: string
          canonical_id?: string
          created_at?: string
          id?: string
          tag_id?: string
          type?: Database["public"]["Enums"]["tag_type"]
        }
        Relationships: [
          {
            foreignKeyName: "tag_aliases_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          canonical_id: string
          created_at: string
          description: string | null
          embedding: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          type: Database["public"]["Enums"]["tag_type"]
        }
        Insert: {
          canonical_id: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          type: Database["public"]["Enums"]["tag_type"]
        }
        Update: {
          canonical_id?: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          type?: Database["public"]["Enums"]["tag_type"]
        }
        Relationships: [
          {
            foreignKeyName: "tags_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          abbreviation: string
          base_unit_id: string | null
          conversion_factor: number | null
          created_at: string
          id: string
          name: string
          system: Database["public"]["Enums"]["unit_system"]
          type: Database["public"]["Enums"]["unit_type"]
        }
        Insert: {
          abbreviation: string
          base_unit_id?: string | null
          conversion_factor?: number | null
          created_at?: string
          id?: string
          name: string
          system: Database["public"]["Enums"]["unit_system"]
          type: Database["public"]["Enums"]["unit_type"]
        }
        Update: {
          abbreviation?: string
          base_unit_id?: string | null
          conversion_factor?: number | null
          created_at?: string
          id?: string
          name?: string
          system?: Database["public"]["Enums"]["unit_system"]
          type?: Database["public"]["Enums"]["unit_type"]
        }
        Relationships: [
          {
            foreignKeyName: "units_base_unit_id_fkey"
            columns: ["base_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bytea_to_text: { Args: { data: string }; Returns: string }
      delete_expired_pantry_items: { Args: never; Returns: number }
      generate_embedding: { Args: { input_text: string }; Returns: string }
      get_prompt_variable_types: {
        Args: never
        Returns: {
          variable_type: string
        }[]
      }
      has_user: { Args: { email: string }; Returns: boolean }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      search_recipes: {
        Args: {
          match_count?: number
          match_threshold?: number
          search_query: string
        }
        Returns: {
          id: string
          name: string
          score: number
        }[]
      }
      search_tags: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_type: Database["public"]["Enums"]["tag_type"]
          query_embedding: string
        }
        Returns: {
          canonical_id: string
          embedding: string
          id: string
          name: string
          similarity: number
          type: Database["public"]["Enums"]["tag_type"]
        }[]
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
    }
    Enums: {
      difficulty_type: "easy" | "medium" | "hard"
      prompt_variable_type:
        | "component"
        | "course"
        | "type"
        | "ingredient"
        | "tag"
        | "text"
      recipe_interaction_type: "viewed" | "favourite" | "cooked"
      tag_type: "dietary" | "component" | "course" | "cuisine"
      unit_system: "metric" | "imperial" | "universal"
      unit_type: "weight" | "volume" | "count"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
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
      difficulty_type: ["easy", "medium", "hard"],
      prompt_variable_type: [
        "component",
        "course",
        "type",
        "ingredient",
        "tag",
        "text",
      ],
      recipe_interaction_type: ["viewed", "favourite", "cooked"],
      tag_type: ["dietary", "component", "course", "cuisine"],
      unit_system: ["metric", "imperial", "universal"],
      unit_type: ["weight", "volume", "count"],
    },
  },
} as const
