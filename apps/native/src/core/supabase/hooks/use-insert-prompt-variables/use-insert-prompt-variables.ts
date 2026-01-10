import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Database, TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type PromptVariableType =
  Database["public"]["Enums"]["prompt_variable_type"];
export type TagType = Database["public"]["Enums"]["tag_type"];

export type InsertPromptVariablePayload = Omit<
  TablesInsert<"prompt_variables">,
  "id" | "created_at"
>;

export const useInsertPromptVariables = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: InsertPromptVariablePayload[]) => {
      if (variables.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from("prompt_variables")
        .insert(variables)
        .select();

      if (error) {
        console.error("Error inserting prompt variables:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "prompts"],
      });
    },
    retry: false,
  });
};
