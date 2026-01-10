import { create } from "zustand";

import { Ingredient } from "@/shared/entities";
import { uniqueBy } from "@/shared/toolkit";

export type IngredientStorageItem = Pick<Ingredient, "id">;

export type IngredientState = {
  ingredients: IngredientStorageItem[];
  add: (id: IngredientStorageItem) => void;
  addMany: (ids: IngredientStorageItem[]) => void;
  remove: (id: string) => void;
  replace: (ids: IngredientStorageItem[]) => void;
  clear: () => void;
};

const createIngredientItem = (
  item: Pick<
    {
      id: string;
      createdAt: string;
    },
    "id"
  >,
): {
  id: string;
  createdAt: string;
} => ({
  id: item.id.toUpperCase(),
  createdAt: new Date().toISOString(),
});

export const useIngredientStore = create<IngredientState>((set) => ({
  ingredients: [],
  add: (ingredient) =>
    set((state) => ({
      ingredients: uniqueBy(
        [...state.ingredients, createIngredientItem(ingredient)],
        (ingredient) => ingredient.id,
      ),
    })),
  addMany: (ingredients) =>
    set((state) => ({
      ingredients: uniqueBy(
        [...state.ingredients, ...ingredients.map(createIngredientItem)],
        (ingredient) => ingredient.id,
      ),
    })),
  remove: (id) =>
    set((state) => ({
      ingredients: uniqueBy(
        state.ingredients.filter((ingredient) => ingredient.id !== id),
        (ingredient) => ingredient.id,
      ),
    })),
  replace: (ingredients) => set(() => ({ ingredients })),
  clear: () =>
    set(() => ({
      ingredients: [],
    })),
}));
