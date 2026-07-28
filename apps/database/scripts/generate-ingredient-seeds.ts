import "dotenv/config";

import { supabaseAdmin } from "@fridgeezy/supabase";
import { Json } from "@fridgeezy/types";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Types
interface NutritionalInfo {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sodium: number;
    serving_size: string;
}

interface Ingredient {
    name: string;
    category: string;
    parent?: string;
    description: string;
    shelf_life: string;
    storage_tips: string;
    nutritional_info: NutritionalInfo;
    expires_by_default: boolean;
    default_shelf_life_days: number | null;
}

// Categories from the database
const CATEGORIES = [
    "meats",
    "seafood",
    "eggs",
    "dairy",
    "vegetables",
    "fruits",
    "grains",
    "legumes",
    "nuts_seeds",
    "herbs_spices",
    "mushrooms",
    "noodles",
    "breads",
    "fats_oils",
    "sweeteners",
    "stocks",
    "sauces",
    "vinegars",
    "beverages",
    "baking",
];

// Target counts per category for ~1000 total ingredients
// const CATEGORY_TARGETS: Record<string, number> = {
//     meats: 80,
//     seafood: 100,
//     eggs: 15,
//     dairy: 70,
//     vegetables: 150,
//     fruits: 80,
//     grains: 50,
//     legumes: 40,
//     nuts_seeds: 45,
//     herbs_spices: 120,
//     mushrooms: 25,
//     noodles: 35,
//     breads: 30,
//     fats_oils: 35,
//     sweeteners: 25,
//     stocks: 15,
//     sauces: 60,
//     vinegars: 20,
//     beverages: 40,
//     baking: 40,
// };

const CATEGORY_TARGETS: Record<string, number> = {
    meats: 4,
    seafood: 4,
    eggs: 4,
    dairy: 4,
    vegetables: 4,
    fruits: 4,
    grains: 4,
    legumes: 4,
    nuts_seeds: 4,
    herbs_spices: 4,
    mushrooms: 4,
    noodles: 4,
    breads: 4,
    fats_oils: 4,
    sweeteners: 4,
    stocks: 4,
    sauces: 4,
    vinegars: 4,
    beverages: 4,
    baking: 4,
};

// Helper to delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Convert snake_case to Title Case (e.g., "beef_tenderloin" -> "Beef Tenderloin")
function toTitleCase(snakeCase: string): string {
    return snakeCase
        .split("_")
        .map(
            (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(" ");
}

// Run promises in parallel with concurrency limit
async function parallelLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    const executing = new Set<Promise<void>>();

    for (const item of items) {
        const p: Promise<void> = fn(item).then((result) => {
            results.push(result);
            executing.delete(p);
        });
        executing.add(p);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    await Promise.all(executing);
    return results;
}

// Check if an object looks like an Ingredient
function isIngredientObject(obj: unknown): obj is Ingredient {
    if (typeof obj !== "object" || obj === null) return false;
    const keys = Object.keys(obj);
    return (
        keys.includes("name") &&
        keys.includes("category") &&
        keys.includes("description")
    );
}

// Parse ingredients from GPT-4o response, handling various response structures
function parseIngredientsResponse(parsed: unknown): Ingredient[] {
    // Case 1: Direct array
    if (Array.isArray(parsed)) {
        return parsed;
    }

    // Case 2: Single ingredient object (the error case)
    if (isIngredientObject(parsed)) {
        console.log(
            "  Note: GPT-4o returned a single ingredient object, wrapping in array"
        );
        return [parsed];
    }

    // Case 3: Object with an array property
    if (typeof parsed === "object" && parsed !== null) {
        const values = Object.values(parsed);

        // Check if it has an 'ingredients' property that's an array
        if (
            "ingredients" in parsed &&
            Array.isArray((parsed as Record<string, unknown>).ingredients)
        ) {
            return (parsed as Record<string, unknown>)
                .ingredients as Ingredient[];
        }

        // Try to find any array property
        const firstArrayProp = values.find(Array.isArray);
        if (firstArrayProp) {
            return firstArrayProp as Ingredient[];
        }
    }

    console.error("  Unexpected response structure:", parsed);
    return [];
}

// Generate ingredients for a category using GPT-4o
async function generateIngredientsForCategory(
    category: string,
    count: number,
    existingNames: string[] = []
): Promise<Ingredient[]> {
    console.log(`\nGenerating ${count} ingredients for category: ${category}`);

    const exclusionClause =
        existingNames.length > 0
            ? `\n\nIMPORTANT: The following ingredients already exist in the database. DO NOT include these:\n${existingNames.join(", ")}`
            : "";

    const prompt = `Generate exactly ${count} ingredients for the "${category}" category for a recipe app database.

Focus on the most commonly used ingredients globally, including:
- Western cuisine staples
- Asian cuisine essentials (Chinese, Japanese, Korean, Thai, Vietnamese, Indian)
- Mediterranean and Middle Eastern ingredients
- Latin American ingredients
- African ingredients

For each ingredient, provide:
1. name: lowercase with underscores (e.g., "chicken_breast", "soy_sauce")
2. category: "${category}"
3. parent: optional parent ingredient name if this is a variant (e.g., "chicken" for "chicken_breast")
4. description: brief 1-2 sentence description
5. shelf_life: storage duration (e.g., "3-5 days refrigerated, 6-12 months frozen")
6. storage_tips: how to store properly
7. nutritional_info: per 100g with calories, protein, carbs, fat, fiber, sodium (in mg), serving_size: "100g"
8. expires_by_default: true for perishables (meat, dairy, produce), false for shelf-stable items
9. default_shelf_life_days: number of days until expiration (only if expires_by_default is true, otherwise null)

IMPORTANT: Return as a JSON object with an "ingredients" array containing ${count} ingredient objects.${exclusionClause}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a culinary expert and food scientist. Generate accurate, comprehensive ingredient data for a recipe database. Always return valid JSON with an 'ingredients' array.",
                },
                { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.error("  Empty response from GPT-4o");
            return [];
        }

        const parsed = JSON.parse(content);
        const ingredients = parseIngredientsResponse(parsed);

        console.log(`  Generated ${ingredients.length} ingredients`);
        return ingredients;
    } catch (error) {
        console.error(`  Error generating ingredients for ${category}:`, error);
        return [];
    }
}

// Fetch category IDs from database
async function fetchCategoryIds(): Promise<Map<string, string>> {
    console.log("\nFetching category IDs from database...");

    const { data, error } = await supabaseAdmin
        .from("categories")
        .select("id, canonical_id, name")
        .in("canonical_id", CATEGORIES);

    if (error) {
        throw new Error(`Failed to fetch categories: ${error.message}`);
    }

    const categoryMap = new Map<string, string>();
    for (const cat of data || []) {
        // Map by canonical_id (snake_case) since GPT outputs category in that format
        categoryMap.set(cat.canonical_id, cat.id);
    }

    console.log(`  Found ${categoryMap.size} categories`);
    return categoryMap;
}

// Fetch ingredient IDs by canonical_ids from the database
async function fetchIngredientIdsByCanonicalIds(
    canonicalIds: string[]
): Promise<Map<string, string>> {
    if (canonicalIds.length === 0) return new Map();

    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .select("id, canonical_id")
        .in("canonical_id", canonicalIds);

    if (error) {
        console.error("Failed to fetch ingredient IDs:", error.message);
        return new Map();
    }

    const map = new Map<string, string>();
    for (const row of data || []) {
        map.set(row.canonical_id, row.id);
    }
    return map;
}

// Fetch existing ingredients grouped by category
async function fetchExistingIngredients(
    categoryIds: Map<string, string>
): Promise<Map<string, Set<string>>> {
    console.log("\nFetching existing ingredients from database...");

    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .select("canonical_id, category_id");

    if (error) {
        throw new Error(
            `Failed to fetch existing ingredients: ${error.message}`
        );
    }

    // Create reverse mapping: category_id -> canonical_id (category name)
    const categoryIdToName = new Map<string, string>();
    categoryIds.forEach((id, name) => {
        categoryIdToName.set(id, name);
    });

    // Map category name -> Set of ingredient canonical_ids
    const existingByCategory = new Map<string, Set<string>>();
    for (const ing of data || []) {
        if (!ing.category_id) continue;
        const categoryName = categoryIdToName.get(ing.category_id);
        if (!categoryName) continue;

        let categorySet = existingByCategory.get(categoryName);
        if (!categorySet) {
            categorySet = new Set<string>();
            existingByCategory.set(categoryName, categorySet);
        }
        categorySet.add(ing.canonical_id);
    }

    const totalExisting = Array.from(existingByCategory.values()).reduce(
        (sum, set) => sum + set.size,
        0
    );
    console.log(
        `  Found ${totalExisting} existing ingredients across ${existingByCategory.size} categories`
    );

    return existingByCategory;
}

// Normalize category name to snake_case for matching
function normalizeCategoryName(category: string): string {
    return category
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
}

// Get category ID with fallback matching
function getCategoryId(
    category: string,
    categoryIds: Map<string, string>
): string | null {
    // Direct match
    if (categoryIds.has(category)) {
        return categoryIds.get(category) || null;
    }

    // Try normalized version
    const normalized = normalizeCategoryName(category);
    if (categoryIds.has(normalized)) {
        return categoryIds.get(normalized) || null;
    }

    // Try to find partial match
    let partialMatchId: string | null = null;
    categoryIds.forEach((id, key) => {
        if (key.includes(normalized) || normalized.includes(key)) {
            partialMatchId = id;
        }
    });
    if (partialMatchId) {
        return partialMatchId;
    }

    console.warn(`  Warning: No category match for "${category}"`);
    return null;
}

// Persist ingredients to database
async function persistIngredients(
    ingredients: Ingredient[],
    categoryIds: Map<string, string>
): Promise<number> {
    console.log("\nPersisting ingredients to database...");

    // Deduplicate ingredients by name (keep first occurrence)
    const seen = new Set<string>();
    const uniqueIngredients = ingredients.filter((ing) => {
        if (seen.has(ing.name)) {
            return false;
        }
        seen.add(ing.name);
        return true;
    });

    if (uniqueIngredients.length < ingredients.length) {
        console.log(
            `  Deduplicated: ${ingredients.length} -> ${uniqueIngredients.length} ingredients`
        );
    }

    const ingredientIds = new Map<string, string>();
    let successCount = 0;
    let errorCount = 0;

    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < uniqueIngredients.length; i += batchSize) {
        const batch = uniqueIngredients.slice(i, i + batchSize);

        const records = batch.map((ing) => ({
            name: toTitleCase(ing.name),
            canonical_id: ing.name,
            category_id: getCategoryId(ing.category, categoryIds),
            description: ing.description,
            shelf_life: ing.shelf_life,
            storage_tips: ing.storage_tips,
            nutritional_info: ing.nutritional_info as unknown as Json,
            expires_by_default: ing.expires_by_default,
            default_shelf_life_days: ing.default_shelf_life_days,
        }));

        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .upsert(records, { onConflict: "canonical_id" })
            .select("id, canonical_id");

        if (error) {
            console.error(
                `  Error inserting batch ${Math.floor(i / batchSize) + 1}:`,
                error.message
            );
            errorCount += batch.length;
        } else if (data) {
            for (const row of data) {
                ingredientIds.set(row.canonical_id, row.id);
            }
            successCount += data.length;
        }
    }

    console.log(
        `  Inserted ${successCount} ingredients (${errorCount} errors)`
    );

    // Handle parent relationships
    const parentRelations = uniqueIngredients.filter(
        (ing): ing is Ingredient & { parent: string } => !!ing.parent
    );
    if (parentRelations.length > 0) {
        console.log(
            `  Setting up ${parentRelations.length} parent relationships...`
        );

        // Collect parent names that need database lookup
        const missingParentNames = parentRelations
            .map((ing) => ing.parent)
            .filter((parent) => !ingredientIds.has(parent));

        // Fetch missing parents from database
        const dbParentIds =
            await fetchIngredientIdsByCanonicalIds(missingParentNames);

        if (dbParentIds.size > 0) {
            console.log(
                `  Found ${dbParentIds.size} parent(s) from previous runs in database`
            );
        }

        // Find parents that don't exist anywhere
        const nonExistentParents = missingParentNames.filter(
            (parent) => !dbParentIds.has(parent)
        );

        // Create stub parents
        if (nonExistentParents.length > 0) {
            console.log(
                `  Creating ${nonExistentParents.length} stub parent ingredient(s)...`
            );

            // Group by category (infer from first child that references each parent)
            const parentToCategory = new Map<string, string>();
            for (const ing of parentRelations) {
                if (
                    ing.parent &&
                    nonExistentParents.includes(ing.parent) &&
                    !parentToCategory.has(ing.parent)
                ) {
                    parentToCategory.set(ing.parent, ing.category);
                }
            }

            const stubRecords = nonExistentParents.map((parent) => ({
                name: toTitleCase(parent),
                canonical_id: parent,
                category_id: getCategoryId(
                    parentToCategory.get(parent) || "",
                    categoryIds
                ),
                description: `Base ingredient (auto-generated stub)`,
                shelf_life: null,
                storage_tips: null,
                nutritional_info: null,
                expires_by_default: true,
                default_shelf_life_days: null,
            }));

            const { data, error } = await supabaseAdmin
                .from("ingredients")
                .upsert(stubRecords, { onConflict: "canonical_id" })
                .select("id, canonical_id");

            if (error) {
                console.error(
                    "  Failed to create stub parents:",
                    error.message
                );
            } else if (data) {
                for (const row of data) {
                    dbParentIds.set(row.canonical_id, row.id);
                }
                console.log(`  Created ${data.length} stub parent(s)`);
            }
        }

        for (const ing of parentRelations) {
            const childId = ingredientIds.get(ing.name);
            // Prefer current batch, fallback to database
            const parentId =
                ingredientIds.get(ing.parent) || dbParentIds.get(ing.parent);

            if (childId && parentId) {
                const { error } = await supabaseAdmin
                    .from("ingredients")
                    .update({ parent_id: parentId })
                    .eq("id", childId);

                if (error) {
                    console.error(
                        `  Failed to set parent for ${ing.name}:`,
                        error.message
                    );
                }
            } else if (!parentId) {
                console.warn(
                    `  Parent "${ing.parent}" not found for ${ing.name}`
                );
            }
        }
    }

    return successCount;
}

// Main function
async function main() {
    console.log("=".repeat(60));
    console.log("INGREDIENT SEED GENERATOR");
    console.log("=".repeat(60));
    console.log("\nThis script will generate ingredients with:");
    console.log("- Nutritional information");
    console.log("- Shelf life and storage tips");
    console.log("- Parent-child relationships");
    console.log("\nNote: Run separate scripts for pairings and substitutes.");
    console.log("");

    const startTime = Date.now();

    // Step 1: Fetch category IDs
    console.log("\n" + "=".repeat(40));
    console.log("STEP 1: FETCHING CATEGORIES");
    console.log("=".repeat(40));

    const categoryIds = await fetchCategoryIds();

    // Step 2: Fetch existing ingredients
    console.log("\n" + "=".repeat(40));
    console.log("STEP 2: FETCHING EXISTING INGREDIENTS");
    console.log("=".repeat(40));

    const existingByCategory = await fetchExistingIngredients(categoryIds);

    // Step 3: Generate ingredients for each category (parallel with limit)
    console.log("\n" + "=".repeat(40));
    console.log("STEP 3: GENERATING NEW INGREDIENTS");
    console.log("=".repeat(40));

    // Calculate how many new ingredients are needed per category
    const categoryTasks: {
        category: string;
        count: number;
        existingNames: string[];
    }[] = [];

    for (const category of CATEGORIES) {
        const target = CATEGORY_TARGETS[category] || 30;
        const existingSet = existingByCategory.get(category) || new Set();
        const existingCount = existingSet.size;
        const needed = target - existingCount;

        if (needed <= 0) {
            console.log(
                `\nSkipping ${category}: already has ${existingCount}/${target} ingredients`
            );
            continue;
        }

        console.log(
            `\n${category}: need ${needed} more (have ${existingCount}/${target})`
        );
        categoryTasks.push({
            category,
            count: needed,
            existingNames: Array.from(existingSet),
        });
    }

    if (categoryTasks.length === 0) {
        console.log("\nAll categories already have enough ingredients!");
        console.log("No generation needed.");
        return;
    }

    // Run 3 categories in parallel at a time with longer delay
    const ingredientBatches = await parallelLimit(
        categoryTasks,
        3,
        async ({ category, count, existingNames }) => {
            const ingredients = await generateIngredientsForCategory(
                category,
                count,
                existingNames
            );
            await delay(1000); // Delay to avoid rate limits
            return ingredients;
        }
    );

    const allIngredients = ingredientBatches.flat();
    console.log(`\nTotal new ingredients generated: ${allIngredients.length}`);

    // Step 4: Persist ingredients
    console.log("\n" + "=".repeat(40));
    console.log("STEP 4: PERSISTING INGREDIENTS");
    console.log("=".repeat(40));

    const insertedCount = await persistIngredients(allIngredients, categoryIds);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log("GENERATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total new ingredients generated: ${allIngredients.length}`);
    console.log(`Total new ingredients persisted: ${insertedCount}`);
    console.log(`Time elapsed: ${elapsed} minutes`);
    console.log("");
    console.log("Next steps:");
    console.log(
        "1. Run: npx ts-node apps/database/scripts/generate-ingredient-pairings.ts"
    );
    console.log(
        "2. Run: npx ts-node apps/database/scripts/generate-ingredient-substitutes.ts"
    );
    console.log("3. Run the embedding generation script");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
