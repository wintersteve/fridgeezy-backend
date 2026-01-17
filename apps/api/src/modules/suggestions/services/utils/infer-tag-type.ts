/**
 * Infers the tag type based on the tag name
 *
 * Uses pattern matching to classify tags into:
 * - dietary: vegan, vegetarian, gluten-free, etc.
 * - course: breakfast, lunch, dinner, dessert, etc.
 * - cuisine: default if no other pattern matches
 *
 * @param tagName The tag name to classify
 * @returns The inferred tag type
 */
export function inferTagType(
    tagName: string
): "dietary" | "cuisine" | "component" | "course" {
    const lower = tagName.toLowerCase();

    // Dietary patterns
    const dietaryPatterns = [
        "vegan",
        "vegetarian",
        "gluten-free",
        "dairy-free",
        "keto",
        "paleo",
        "low-carb",
        "low-fat",
        "sugar-free",
        "nut-free",
        "soy-free",
        "kosher",
        "halal",
    ];

    if (dietaryPatterns.some((pattern) => lower.includes(pattern))) {
        return "dietary";
    }

    // Course patterns
    const coursePatterns = [
        "breakfast",
        "lunch",
        "dinner",
        "snack",
        "dessert",
        "appetizer",
        "main course",
        "side dish",
        "brunch",
    ];

    if (coursePatterns.some((pattern) => lower.includes(pattern))) {
        return "course";
    }

    // Component patterns
    const componentPatterns = [
        "protein",
        "carb",
        "vegetable",
        "fruit",
        "grain",
        "dairy",
        "sauce",
        "condiment",
    ];

    if (componentPatterns.some((pattern) => lower.includes(pattern))) {
        return "component";
    }

    // Default to cuisine if no other pattern matches
    return "cuisine";
}
