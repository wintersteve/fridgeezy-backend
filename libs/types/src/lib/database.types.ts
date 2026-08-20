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
      categories: {
        Row: {
          canonical_id: string
          created_at: string
          description: string | null
          embedding: string | null
          id: string
          image_url: string | null
          name: string
        }
        Insert: {
          canonical_id: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          id?: string
          image_url?: string | null
          name: string
        }
        Update: {
          canonical_id?: string
          created_at?: string
          description?: string | null
          embedding?: string | null
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
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
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
          icon: string | null
          id: string
          profile_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          profile_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
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
      dietary_rules: {
        Row: {
          diet_canonical_id: string
          forbidden: Database["public"]["Enums"]["dietary_property"][]
        }
        Insert: {
          diet_canonical_id: string
          forbidden: Database["public"]["Enums"]["dietary_property"][]
        }
        Update: {
          diet_canonical_id?: string
          forbidden?: Database["public"]["Enums"]["dietary_property"][]
        }
        Relationships: []
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
      ingredients: {
        Row: {
          canonical_id: string
          category_id: string | null
          created_at: string
          default_shelf_life_days: number | null
          description: string | null
          dietary_classified_at: string | null
          dietary_properties: Database["public"]["Enums"]["dietary_property"][]
          embedding: string | null
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
          canonical_id: string
          category_id?: string | null
          created_at?: string
          default_shelf_life_days?: number | null
          description?: string | null
          dietary_classified_at?: string | null
          dietary_properties?: Database["public"]["Enums"]["dietary_property"][]
          embedding?: string | null
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
          canonical_id?: string
          category_id?: string | null
          created_at?: string
          default_shelf_life_days?: number | null
          description?: string | null
          dietary_classified_at?: string | null
          dietary_properties?: Database["public"]["Enums"]["dietary_property"][]
          embedding?: string | null
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
      menu_courses: {
        Row: {
          course_type: string
          created_at: string
          description: string | null
          difficulty: Database["public"]["Enums"]["difficulty_type"] | null
          dish_key: string
          id: string
          image: string | null
          is_recipe: boolean
          menu_id: string
          name: string
          position: number
          recipe_id: string
        }
        Insert: {
          course_type: string
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          dish_key: string
          id?: string
          image?: string | null
          is_recipe?: boolean
          menu_id: string
          name: string
          position?: number
          recipe_id: string
        }
        Update: {
          course_type?: string
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          dish_key?: string
          id?: string
          image?: string | null
          is_recipe?: boolean
          menu_id?: string
          name?: string
          position?: number
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_courses_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          course_count: number
          created_at: string
          dish_signature: string[]
          id: string
          main_recipe_id: string
          name: string
          owner_profile_id: string | null
          saved_count: number
          updated_at: string
        }
        Insert: {
          course_count?: number
          created_at?: string
          dish_signature: string[]
          id?: string
          main_recipe_id: string
          name: string
          owner_profile_id?: string | null
          saved_count?: number
          updated_at?: string
        }
        Update: {
          course_count?: number
          created_at?: string
          dish_signature?: string[]
          id?: string
          main_recipe_id?: string
          name?: string
          owner_profile_id?: string | null
          saved_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      profile_entitlements: {
        Row: {
          created_at: string
          entitlement_id: string | null
          environment: string | null
          expires_at: string | null
          id: string
          last_event_at: string | null
          last_event_id: string | null
          product_id: string | null
          revoked_at: string | null
          store: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entitlement_id?: string | null
          environment?: string | null
          expires_at?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          product_id?: string | null
          revoked_at?: string | null
          store?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entitlement_id?: string | null
          environment?: string | null
          expires_at?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          product_id?: string | null
          revoked_at?: string | null
          store?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_prompts: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          profile_id: string
          prompt: string
          recipe_id: string | null
          surface: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          profile_id: string
          prompt: string
          recipe_id?: string | null
          surface: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          profile_id?: string
          prompt?: string
          recipe_id?: string | null
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_prompts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_prompts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "profile_prompts_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
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
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
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
      profile_taste_signals: {
        Row: {
          first_seen_at: string
          id: string
          kind: string
          last_seen_at: string
          occurrences: number
          profile_id: string
          value: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          kind: string
          last_seen_at?: string
          occurrences?: number
          profile_id: string
          value: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          kind?: string
          last_seen_at?: string
          occurrences?: number
          profile_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_taste_signals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      recipe_family_defaults: {
        Row: {
          base_recipe_id: string
          created_at: string
          id: string
          profile_id: string
          recipe_id: string
          updated_at: string
        }
        Insert: {
          base_recipe_id: string
          created_at?: string
          id?: string
          profile_id: string
          recipe_id: string
          updated_at?: string
        }
        Update: {
          base_recipe_id?: string
          created_at?: string
          id?: string
          profile_id?: string
          recipe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_family_defaults_base_recipe_id_fkey"
            columns: ["base_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_family_defaults_base_recipe_id_fkey"
            columns: ["base_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_family_defaults_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_family_defaults_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_family_defaults_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit_id: string
        }
        Update: {
          comment?: string | null
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
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
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
          duration_seconds: number | null
          equipment: string[] | null
          id: string
          ingredient_refs: string[] | null
          instruction_text: string
          recipe_id: string
          step_number: number
          temperature_c: number | null
          tips: string | null
          title: string | null
        }
        Insert: {
          cooking_action_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          equipment?: string[] | null
          id?: string
          ingredient_refs?: string[] | null
          instruction_text: string
          recipe_id: string
          step_number: number
          temperature_c?: number | null
          tips?: string | null
          title?: string | null
        }
        Update: {
          cooking_action_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          equipment?: string[] | null
          id?: string
          ingredient_refs?: string[] | null
          instruction_text?: string
          recipe_id?: string
          step_number?: number
          temperature_c?: number | null
          tips?: string | null
          title?: string | null
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
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
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
            referencedRelation: "recipe_suggestion_dietary"
            referencedColumns: ["recipe_suggestion_id"]
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
            referencedRelation: "recipe_suggestion_dietary"
            referencedColumns: ["recipe_suggestion_id"]
          },
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
          canonical_id: string
          created_at: string
          description: string | null
          difficulty: Database["public"]["Enums"]["difficulty_type"] | null
          embedding: string | null
          id: string
          identity_cuisine: string | null
          name: string
          name_en: string | null
          total_time_minutes: number | null
        }
        Insert: {
          canonical_id: string
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          embedding?: string | null
          id?: string
          identity_cuisine?: string | null
          name: string
          name_en?: string | null
          total_time_minutes?: number | null
        }
        Update: {
          canonical_id?: string
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          embedding?: string | null
          id?: string
          identity_cuisine?: string | null
          name?: string
          name_en?: string | null
          total_time_minutes?: number | null
        }
        Relationships: []
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
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
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
      recipe_variants: {
        Row: {
          base_recipe_id: string
          created_at: string
          id: string
          label: string
          profile_id: string
          recipe_id: string
          updated_at: string
        }
        Insert: {
          base_recipe_id: string
          created_at?: string
          id?: string
          label: string
          profile_id: string
          recipe_id: string
          updated_at?: string
        }
        Update: {
          base_recipe_id?: string
          created_at?: string
          id?: string
          label?: string
          profile_id?: string
          recipe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_variants_base_recipe_id_fkey"
            columns: ["base_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_variants_base_recipe_id_fkey"
            columns: ["base_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipe_variants_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          base_recipe_id: string | null
          canonical_id: string | null
          carbs: number | null
          cook_time: string | null
          created_at: string
          created_by: string | null
          description: string | null
          difficulty: Database["public"]["Enums"]["difficulty_type"] | null
          fat: number | null
          favourite_count: number
          fts: string | null
          id: string
          identity_cuisine: string | null
          image: string | null
          is_generated: boolean
          kcal: number | null
          name: string
          name_en: string | null
          origin: string
          prep_time: string | null
          protein: number | null
          servings: number
          short_description: string | null
          source_suggestion_id: string | null
          tips: string[] | null
          total_time_minutes: number | null
          updated_at: string
        }
        Insert: {
          base_recipe_id?: string | null
          canonical_id?: string | null
          carbs?: number | null
          cook_time?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          fat?: number | null
          favourite_count?: number
          fts?: string | null
          id?: string
          identity_cuisine?: string | null
          image?: string | null
          is_generated?: boolean
          kcal?: number | null
          name: string
          name_en?: string | null
          origin?: string
          prep_time?: string | null
          protein?: number | null
          servings?: number
          short_description?: string | null
          source_suggestion_id?: string | null
          tips?: string[] | null
          total_time_minutes?: number | null
          updated_at?: string
        }
        Update: {
          base_recipe_id?: string | null
          canonical_id?: string | null
          carbs?: number | null
          cook_time?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          difficulty?: Database["public"]["Enums"]["difficulty_type"] | null
          fat?: number | null
          favourite_count?: number
          fts?: string | null
          id?: string
          identity_cuisine?: string | null
          image?: string | null
          is_generated?: boolean
          kcal?: number | null
          name?: string
          name_en?: string | null
          origin?: string
          prep_time?: string | null
          protein?: number | null
          servings?: number
          short_description?: string | null
          source_suggestion_id?: string | null
          tips?: string[] | null
          total_time_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_base_recipe_id_fkey"
            columns: ["base_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
          },
          {
            foreignKeyName: "recipes_base_recipe_id_fkey"
            columns: ["base_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_menus: {
        Row: {
          created_at: string
          id: string
          label: string | null
          main_recipe_id: string
          menu_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          main_recipe_id: string
          menu_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          main_recipe_id?: string
          menu_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_menus_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_menus_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          id: string
          menu_main_recipe_id: string | null
          menu_title: string | null
          name: string | null
          profile_id: string
          recipe_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          menu_main_recipe_id?: string | null
          menu_title?: string | null
          name?: string | null
          profile_id: string
          recipe_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          menu_main_recipe_id?: string | null
          menu_title?: string | null
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
            referencedRelation: "recipe_dietary"
            referencedColumns: ["recipe_id"]
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
          canonical_id: string
          conversion_factor: number | null
          created_at: string
          embedding: string | null
          id: string
          name: string
          system: Database["public"]["Enums"]["unit_system"]
          type: Database["public"]["Enums"]["unit_type"]
        }
        Insert: {
          abbreviation: string
          base_unit_id?: string | null
          canonical_id: string
          conversion_factor?: number | null
          created_at?: string
          embedding?: string | null
          id?: string
          name: string
          system: Database["public"]["Enums"]["unit_system"]
          type: Database["public"]["Enums"]["unit_type"]
        }
        Update: {
          abbreviation?: string
          base_unit_id?: string | null
          canonical_id?: string
          conversion_factor?: number | null
          created_at?: string
          embedding?: string | null
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
      recipe_dietary: {
        Row: {
          diet_canonical_id: string | null
          recipe_id: string | null
        }
        Relationships: []
      }
      recipe_display_tags: {
        Row: {
          id: string | null
          name: string | null
          recipe_id: string | null
          type: Database["public"]["Enums"]["tag_type"] | null
        }
        Relationships: []
      }
      recipe_suggestion_dietary: {
        Row: {
          diet_canonical_id: string | null
          recipe_suggestion_id: string | null
        }
        Relationships: []
      }
      recipe_suggestion_display_tags: {
        Row: {
          id: string | null
          name: string | null
          recipe_suggestion_id: string | null
          type: Database["public"]["Enums"]["tag_type"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      clear_recipe_family_default: {
        Args: { p_recipe_id: string }
        Returns: boolean
      }
      community_menus_for_recipe: {
        Args: { p_limit?: number; p_recipe_id: string }
        Returns: {
          courses: Json
          menu_id: string
          menu_title: string
          saved_count: number
        }[]
      }
      current_profile_id: { Args: never; Returns: string }
      delete_orphan_generated_recipes: { Args: never; Returns: number }
      difficulty_preference_rank: {
        Args: { difficulty: string; pref: string }
        Returns: number
      }
      entitlement_is_active: { Args: { p_user_id: string }; Returns: boolean }
      find_recipes: {
        Args: {
          blacklist?: string[]
          ingredients?: string[]
          limit_count?: number
          p_difficulty?: string
          p_offset?: number
          tags?: string[]
        }
        Returns: Database["public"]["CompositeTypes"]["find_recipes_result"][]
        SetofOptions: {
          from: "*"
          to: "find_recipes_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_recipe_family_default: {
        Args: { p_recipe_id: string }
        Returns: {
          base_recipe_id: string
          default_recipe_id: string
        }[]
      }
      has_user: { Args: { email: string }; Returns: boolean }
      ingredient_canonical_id: { Args: { input_text: string }; Returns: string }
      menu_by_id: {
        Args: { p_menu_id: string }
        Returns: {
          courses: Json
          is_saved: boolean
          main_name: string
          main_recipe_id: string
          menu_id: string
          menu_name: string
          saved_count: number
        }[]
      }
      menu_course_input: {
        Args: { p_courses: Json }
        Returns: {
          course_position: number
          course_type: string
          created_by: string
          description: string
          difficulty: Database["public"]["Enums"]["difficulty_type"]
          dish_key: string
          image: string
          is_recipe: boolean
          name: string
          recipe_id: string
        }[]
      }
      menu_courses_resolved: { Args: { p_menu_id: string }; Returns: Json }
      menu_is_publishable: {
        Args: {
          p_course_count: number
          p_menu_id: string
          p_owner_profile_id: string
        }
        Returns: boolean
      }
      menu_is_visible: {
        Args: { p_owner_profile_id: string }
        Returns: boolean
      }
      menu_pairings_for_recipe: {
        Args: {
          p_blacklist?: string[]
          p_course_types: string[]
          p_dietary?: string[]
          p_difficulty?: string
          p_exclude_keys?: string[]
          p_exclude_names?: string[]
          p_per_course?: number
          p_recipe_id: string
        }
        Returns: {
          course_type: string
          description: string
          difficulty: string
          dish_id: string
          dish_key: string
          image: string
          ingredients: Json
          is_recipe: boolean
          menu_ids: string[]
          name: string
          name_en: string
          pair_rank: number
          pair_saves: number
          short_description: string
          tags: Json
          total_time_minutes: number
        }[]
      }
      merge_ingredient: {
        Args: { p_from: string; p_into: string }
        Returns: undefined
      }
      merge_recipe: {
        Args: { p_from: string; p_into: string }
        Returns: undefined
      }
      minutes_from_time_text: { Args: { p_value: string }; Returns: number }
      my_saved_menus: {
        Args: never
        Returns: {
          courses: Json
          main_recipe_id: string
          menu_id: string
          menu_name: string
          saved_at: string
          saved_count: number
        }[]
      }
      normalize_to_canonical_id: {
        Args: { input_text: string }
        Returns: string
      }
      persist_recipe: {
        Args: {
          p_base_recipe_id?: string
          p_carbs: number
          p_cook_time: string
          p_description: string
          p_difficulty: Database["public"]["Enums"]["difficulty_type"]
          p_fat: number
          p_identity_cuisine?: string
          p_image: string
          p_ingredients: Json
          p_instructions: Json
          p_kcal: number
          p_name: string
          p_name_en?: string
          p_origin?: string
          p_prep_time: string
          p_protein: number
          p_servings: number
          p_tags: string[]
          p_tips: string[]
        }
        Returns: string
      }
      persist_recipe_with_ingredient_ids: {
        Args: {
          p_base_recipe_id?: string
          p_carbs: number
          p_cook_time: string
          p_created_by?: string
          p_description: string
          p_difficulty: Database["public"]["Enums"]["difficulty_type"]
          p_fat: number
          p_identity_cuisine?: string
          p_image: string
          p_ingredients: Json
          p_instructions: Json
          p_kcal: number
          p_name: string
          p_name_en?: string
          p_origin?: string
          p_prep_time: string
          p_protein: number
          p_servings: number
          p_tags: string[]
          p_tips: string[]
        }
        Returns: string
      }
      persist_suggestion: {
        Args: {
          p_description: string
          p_difficulty: Database["public"]["Enums"]["difficulty_type"]
          p_embedding: string
          p_identity_cuisine?: string
          p_ingredient_ids: string[]
          p_name: string
          p_name_en?: string
          p_tag_ids: string[]
          p_total_time_minutes?: number
        }
        Returns: string
      }
      recent_community_menus: {
        Args: { p_limit?: number }
        Returns: {
          courses: Json
          main_name: string
          main_recipe_id: string
          menu_id: string
          menu_title: string
        }[]
      }
      recipe_is_visible: { Args: { p_created_by: string }; Returns: boolean }
      record_menu: {
        Args: { p_courses: Json; p_main_recipe_id: string; p_name: string }
        Returns: {
          course_count: number
          created_at: string
          dish_signature: string[]
          id: string
          main_recipe_id: string
          name: string
          owner_profile_id: string | null
          saved_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "menus"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_prompt: {
        Args: {
          p_conversation_id?: string
          p_profile_id: string
          p_prompt: string
          p_recipe_id?: string
          p_surface: string
        }
        Returns: {
          conversation_id: string | null
          created_at: string
          id: string
          profile_id: string
          prompt: string
          recipe_id: string | null
          surface: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_prompts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_taste_signal: {
        Args: { p_kind: string; p_profile_id: string; p_value: string }
        Returns: undefined
      }
      rename_recipe_variant: {
        Args: { p_label: string; p_variant_id: string }
        Returns: {
          base_recipe_id: string
          created_at: string
          id: string
          label: string
          profile_id: string
          recipe_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recipe_variants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_menu: {
        Args: { p_courses: Json; p_main_recipe_id: string; p_name: string }
        Returns: {
          course_count: number
          created_at: string
          dish_signature: string[]
          id: string
          main_recipe_id: string
          name: string
          owner_profile_id: string | null
          saved_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "menus"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_categories: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          canonical_id: string
          id: string
          name: string
          similarity: number
        }[]
      }
      search_ingredients: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          id: string
          name: string
          similarity: number
        }[]
      }
      search_recipe_suggestions: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          description: string
          difficulty: Database["public"]["Enums"]["difficulty_type"]
          id: string
          name: string
          score: number
        }[]
      }
      search_recipes: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
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
      search_units: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          abbreviation: string
          canonical_id: string
          id: string
          name: string
          similarity: number
        }[]
      }
      set_recipe_family_default: {
        Args: { p_recipe_id: string }
        Returns: {
          base_recipe_id: string
          created_at: string
          id: string
          profile_id: string
          recipe_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recipe_family_defaults"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      singularize_token: { Args: { tok: string }; Returns: string }
      tag_subtree: {
        Args: { root_ids: string[] }
        Returns: {
          root_id: string
          tag_id: string
        }[]
      }
      title_case_name: { Args: { input: string }; Returns: string }
    }
    Enums: {
      dietary_property:
        | "meat"
        | "fish"
        | "shellfish"
        | "dairy"
        | "egg"
        | "honey"
        | "slaughter_derived"
        | "gluten"
        | "nuts"
        | "soy"
        | "grain"
        | "legume"
        | "refined_sugar"
        | "sesame"
      difficulty_type: "easy" | "medium" | "hard"
      recipe_interaction_type: "viewed" | "favourite" | "cooked"
      tag_type: "dietary" | "component" | "course" | "cuisine" | "dish_form"
      unit_system: "metric" | "imperial" | "universal"
      unit_type: "weight" | "volume" | "count"
    }
    CompositeTypes: {
      find_recipes_result: {
        id: string | null
        name: string | null
        description: string | null
        short_description: string | null
        image: string | null
        difficulty: string | null
        favourite_count: number | null
        ingredients: Json | null
        tags: Json | null
        source: string | null
        total_time_minutes: number | null
        origin: string | null
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      dietary_property: [
        "meat",
        "fish",
        "shellfish",
        "dairy",
        "egg",
        "honey",
        "slaughter_derived",
        "gluten",
        "nuts",
        "soy",
        "grain",
        "legume",
        "refined_sugar",
        "sesame",
      ],
      difficulty_type: ["easy", "medium", "hard"],
      recipe_interaction_type: ["viewed", "favourite", "cooked"],
      tag_type: ["dietary", "component", "course", "cuisine", "dish_form"],
      unit_system: ["metric", "imperial", "universal"],
      unit_type: ["weight", "volume", "count"],
    },
  },
} as const

