import { useSSEBuilder } from "@/shared/streaming";

type Ingredient = { name: string; quantity: number; unit: string };

type Recipe = {
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  servings: number;
  prepTime: number;
  cookTime: number;
  ingredients: Ingredient[];
  instructions: string[];
  tips: string[];
  tags: string[];
};

type UseGenerateRecipePayload = {
  difficulty?: string | null;
  name: string;
  ingredients: string[];
  tags: string[];
};

export const useGenerateRecipe = (payload: UseGenerateRecipePayload) => {
  const cacheKey = JSON.stringify(payload);

  return useSSEBuilder<Recipe>({
    url: `${process.env.EXPO_PUBLIC_BACKEND_URL}/recipes/generate`,
    body: payload,
    initialState: {
      name: "",
      description: "",
      difficulty: "medium",
      servings: 4,
      prepTime: 0,
      cookTime: 0,
      ingredients: [],
      instructions: [],
      tips: [],
      tags: [],
    },
    onMessage: (state, message) => {
      switch (message.type) {
        case "initial":
          return {
            ...state,
            name: message.name as string,
            difficulty: message.difficulty as Recipe["difficulty"],
            tags: message.tags as string[],
          };
        case "header":
          return {
            ...state,
            description: message.description as string,
            servings: message.servings as number,
            prepTime: message.prepTime as number,
            cookTime: message.cookTime as number,
          };
        case "ingredient":
          return {
            ...state,
            ingredients: [
              ...state.ingredients,
              {
                name: message.name as string,
                quantity: message.quantity as number,
                unit: message.unit as string,
              },
            ],
          };
        case "instruction":
          return {
            ...state,
            instructions: [...state.instructions, message.text as string],
          };
        case "tip":
          return {
            ...state,
            tips: [...state.tips, message.text as string],
          };
        default:
          return state;
      }
    },
    cache: {
      queryKey: ["server", "generate_recipe", cacheKey],
      checkCache: true,
      saveOnComplete: true,
    },
    enabled: !!payload,
    dependencies: [cacheKey],
  });
};
