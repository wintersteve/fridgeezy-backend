interface AdjustedIngredient {
    name: string;
    category: string;
    parent: string | null;
    quantity: number;
    adjustedQuantity: number;
    unit: string;
}

interface DisplayIngredient {
    name: string;
    category: string;
    parent: string | null;
    quantity: number;
    displayQuantity: string;
    unit: string;
    displayUnit: string;
}

/**
 * Normalizes quantity display for better readability.
 *
 * Examples:
 * - 1000g -> "1" + "kg"
 * - 1500ml -> "1.5" + "L"
 * - 3 tsp -> "1" + "tbsp"
 *
 * @param ingredient - Ingredient with adjusted quantity
 * @returns Ingredient with display-friendly quantity and unit
 */
export function normalizeQuantityDisplay(
    ingredient: AdjustedIngredient
): DisplayIngredient {
    let displayQuantity = ingredient.adjustedQuantity;
    let displayUnit = ingredient.unit;

    // Weight conversions
    if (ingredient.unit === "g" && ingredient.adjustedQuantity >= 1000) {
        displayQuantity = ingredient.adjustedQuantity / 1000;
        displayUnit = "kg";
    } else if (
        ingredient.unit === "mg" &&
        ingredient.adjustedQuantity >= 1000
    ) {
        displayQuantity = ingredient.adjustedQuantity / 1000;
        displayUnit = "g";
    }
    // Volume conversions
    else if (ingredient.unit === "ml" && ingredient.adjustedQuantity >= 1000) {
        displayQuantity = ingredient.adjustedQuantity / 1000;
        displayUnit = "L";
    } else if (ingredient.unit === "tsp" && ingredient.adjustedQuantity >= 3) {
        displayQuantity = ingredient.adjustedQuantity / 3;
        displayUnit = "tbsp";
    } else if (
        ingredient.unit === "tbsp" &&
        ingredient.adjustedQuantity >= 16
    ) {
        displayQuantity = ingredient.adjustedQuantity / 16;
        displayUnit = "cup";
    }

    return {
        name: ingredient.name,
        category: ingredient.category,
        parent: ingredient.parent,
        quantity: ingredient.adjustedQuantity,
        displayQuantity: displayQuantity.toString(),
        unit: ingredient.unit,
        displayUnit,
    };
}
