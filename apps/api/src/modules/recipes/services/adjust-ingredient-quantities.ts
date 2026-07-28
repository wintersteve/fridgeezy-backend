interface Ingredient {
    name: string;
    category: string;
    parent: string | null;
    quantity: number;
    unit: string;
}

interface AdjustedIngredient extends Ingredient {
    adjustedQuantity: number;
}

/**
 * Adjusts ingredient quantities based on scaling factor.
 *
 * Handles special cases:
 * - Count units: rounds to nearest whole number (can't have 2.3 eggs)
 * - Weight/Volume: maintains precision with smart rounding
 * - Very small quantities: applies rounding rules to avoid 0.0001g
 *
 * @param ingredients - Original recipe ingredients
 * @param scalingFactor - Ratio of new servings to original servings
 * @returns Ingredients with adjusted quantities
 */
export function adjustIngredientQuantities(
    ingredients: Ingredient[],
    scalingFactor: number
): AdjustedIngredient[] {
    return ingredients.map((ingredient) => {
        let adjustedQuantity = ingredient.quantity * scalingFactor;

        // Handle count-based units
        if (isCountUnit(ingredient.unit)) {
            adjustedQuantity = Math.round(adjustedQuantity);
            if (adjustedQuantity < 1) adjustedQuantity = 1;
        } else {
            // Smart rounding for weight/volume
            adjustedQuantity = smartRound(adjustedQuantity);
        }

        return {
            ...ingredient,
            quantity: adjustedQuantity,
            adjustedQuantity,
        };
    });
}

/**
 * Determines if a unit is count-based vs weight/volume
 */
function isCountUnit(unit: string): boolean {
    const countUnits = [
        "item",
        "items",
        "piece",
        "pieces",
        "whole",
        "clove",
        "cloves",
        "slice",
        "slices",
        "leaf",
        "leaves",
        "sprig",
        "sprigs",
        "pinch",
        "pinches",
        "dash",
        "dashes",
    ];
    return countUnits.includes(unit.toLowerCase());
}

/**
 * Smart rounding based on quantity magnitude
 * - < 1: round to 2 decimals (0.75g)
 * - 1-10: round to 1 decimal (5.5g)
 * - 10-100: round to nearest 0.5 (45.5g)
 * - > 100: round to nearest integer (250g)
 */
function smartRound(value: number): number {
    if (value < 1) {
        return Math.round(value * 100) / 100;
    } else if (value < 10) {
        return Math.round(value * 10) / 10;
    } else if (value < 100) {
        return Math.round(value * 2) / 2;
    } else {
        return Math.round(value);
    }
}
