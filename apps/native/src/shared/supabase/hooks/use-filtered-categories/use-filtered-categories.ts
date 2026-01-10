import { useMemo } from "react";

import {
  buildIngredientHierarchy,
  IngredientChild,
  IngredientParent,
  useIngredients,
} from "@/shared/supabase";

export interface FilteredCategory {
  categoryName: string;
  parents: IngredientParent[];
  orphans: IngredientChild[];
}

export interface FilteredCategoriesReturn {
  data: FilteredCategory[];
  isLoading: boolean;
}

export const useFilteredCategories = (
  filterFn?: (ingredientId: string) => boolean,
  searchQuery?: string,
): FilteredCategoriesReturn => {
  const ingredients = useIngredients();

  const hierarchicalIngredients = useMemo(() => {
    if (!ingredients.data) return {};
    return buildIngredientHierarchy(ingredients.data);
  }, [ingredients.data]);

  const filteredCategories = useMemo<FilteredCategory[]>(() => {
    // Create ingredient name lookup for search
    const ingredientNames = new Map<string, string>();
    if (searchQuery) {
      (ingredients.data ?? []).forEach((ing) => {
        ingredientNames.set(ing.id, ing.name.toLowerCase());
      });
    }

    return Object.entries(hierarchicalIngredients)
      .map(([categoryName, category]) => {
        const filteredParents: IngredientParent[] = [];
        let filteredOrphans: IngredientChild[] = [];

        // Apply search filter if query exists
        const searchFilter = (id: string) => {
          if (!searchQuery) return true;
          const name = ingredientNames.get(id);
          return name?.includes(searchQuery.toLowerCase()) ?? false;
        };

        // Combine filters
        const combinedFilter = (id: string) => {
          const passesMainFilter = filterFn ? filterFn(id) : true;
          const passesSearch = searchFilter(id);
          return passesMainFilter && passesSearch;
        };

        // If no filter function provided and no search, include all items
        if (!filterFn && !searchQuery) {
          return {
            categoryName,
            parents: category.parents,
            orphans: category.orphans,
          };
        }

        // Filter parents - only include if parent or any children match combined filter
        category.parents.forEach((parent) => {
          const parentMatches = combinedFilter(parent.id);
          const matchingChildren = parent.children.filter((child) =>
            combinedFilter(child.id),
          );

          if (parentMatches || matchingChildren.length > 0) {
            filteredParents.push({
              ...parent,
              children: matchingChildren,
            });
          }
        });

        // Filter orphans - only include if they match combined filter
        filteredOrphans = category.orphans.filter((orphan) =>
          combinedFilter(orphan.id),
        );

        return {
          categoryName,
          parents: filteredParents,
          orphans: filteredOrphans,
        };
      })
      .filter((cat) => cat.parents.length > 0 || cat.orphans.length > 0);
  }, [hierarchicalIngredients, filterFn, searchQuery, ingredients.data]);

  return {
    data: filteredCategories,
    isLoading: ingredients.isLoading ?? false,
  };
};
