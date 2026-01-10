import { useLocalSearchParams, useNavigation } from "expo-router";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { useGenerateRecipe } from "@/shared/mcp/hooks/use-generate-recipe";
import { RecipeLayout } from "@/shared/recipes/components/recipe-layout";

export const GenerateRecipeScreen = () => {
  const params = useLocalSearchParams<{
    ingredients?: string;
    name: string;
    tags: string;
  }>();

  const navigation = useNavigation();

  const filterStore = useIngredientsFilterStore();

  const ingredients = (params.ingredients?.split(",") ?? []).map((item) =>
    item.toLowerCase(),
  );

  const tags = (params.tags?.split(",") ?? []).map((item) =>
    item.toLowerCase(),
  );

  const { data, isLoading } = useGenerateRecipe({
    ingredients,
    tags,
    difficulty: filterStore.difficulty,
    name: params.name,
  });

  console.log("data", isLoading, data);

  return <RecipeLayout data={data} isLoading={isLoading} />;
};
