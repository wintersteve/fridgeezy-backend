import { IngredientWithRelations } from "./use-ingredients";

export interface IngredientChild {
  id: string;
  name: string;
}

export interface IngredientParent {
  id: string;
  name: string;
  children: IngredientChild[];
}

export interface CategoryGroup {
  categoryName: string;
  parents: IngredientParent[];
  orphans: IngredientChild[];
}

export type IngredientHierarchy = Record<string, CategoryGroup>;

export function buildIngredientHierarchy(
  ingredients: IngredientWithRelations[],
): IngredientHierarchy {
  // Step 1: Create a Set of all ingredient IDs that are referenced as parent_id
  const parentIds = new Set(
    ingredients
      .filter((i) => i.parent_id !== null)
      .map((i) => i.parent_id as string),
  );

  // Step 2: Create a map of parent ID to parent data
  const parentMap = new Map<string, IngredientParent>();

  // Step 3: Group by category
  const grouped: IngredientHierarchy = {};

  // First pass: identify and create parents and orphans
  ingredients.forEach((ingredient) => {
    const categoryName = ingredient.categories?.name || "Uncategorized";

    if (!grouped[categoryName]) {
      grouped[categoryName] = {
        categoryName,
        parents: [],
        orphans: [],
      };
    }

    // Is this ingredient a parent (i.e., other ingredients reference it)?
    if (parentIds.has(ingredient.id)) {
      const parent: IngredientParent = {
        id: ingredient.id,
        name: ingredient.name,
        children: [],
      };
      parentMap.set(ingredient.id, parent);
      grouped[categoryName].parents.push(parent);
    }
    // Is this ingredient a child (has a parent_id)?
    else if (ingredient.parent_id !== null) {
      // Will be attached to parent in second pass
    }
    // Orphan: no parent_id and not referenced as parent
    else {
      grouped[categoryName].orphans.push({
        id: ingredient.id,
        name: ingredient.name,
      });
    }
  });

  // Second pass: attach children to parents
  ingredients
    .filter((i) => i.parent_id !== null)
    .forEach((child) => {
      const parent = parentMap.get(child.parent_id as string);
      if (parent) {
        parent.children.push({
          id: child.id,
          name: child.name,
        });
      }
    });

  // Step 4: Sort alphabetically
  Object.values(grouped).forEach((category) => {
    category.parents.sort((a, b) => a.name.localeCompare(b.name));
    category.parents.forEach((p) => {
      p.children.sort((a, b) => a.name.localeCompare(b.name));
    });
    category.orphans.sort((a, b) => a.name.localeCompare(b.name));
  });

  // Sort categories alphabetically
  const sortedGrouped: IngredientHierarchy = {};
  Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      sortedGrouped[key] = grouped[key];
    });

  return sortedGrouped;
}
