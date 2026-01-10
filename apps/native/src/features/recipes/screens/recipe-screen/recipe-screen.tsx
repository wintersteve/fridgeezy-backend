import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { useInsertProfileRecipeInteraction } from "@/core/supabase";
import { RecipeLayout } from "@/shared/recipes/components/recipe-layout";
import { useRecipe } from "@/shared/supabase";

export const RecipeScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading } = useRecipe(id);

  const insertInteraction = useInsertProfileRecipeInteraction();

  useEffect(() => {
    insertInteraction.mutate({
      recipe_id: id,
      interaction_type: "viewed",
    });
  }, [id]);

  return <RecipeLayout data={data} isLoading={isLoading} />;
};
