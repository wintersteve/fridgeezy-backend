import "dotenv/config";

import { supabaseAdmin } from "@fridgeezy/supabase";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Substitute {
    ingredient: string;
    substitute: string;
    notes: string;
}

// Helper to delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch all ingredients from database
async function fetchIngredients(): Promise<Map<string, string>> {
    console.log("\nFetching ingredients from database...");

    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .select("id, canonical_id")
        .order("canonical_id");

    if (error) {
        throw new Error(`Failed to fetch ingredients: ${error.message}`);
    }

    const ingredientMap = new Map<string, string>();
    for (const ing of data || []) {
        ingredientMap.set(ing.canonical_id, ing.id);
    }

    console.log(`  Found ${ingredientMap.size} ingredients`);
    return ingredientMap;
}

// Generate substitutes using GPT-4o
async function generateSubstitutes(
    ingredientNames: string[]
): Promise<Substitute[]> {
    console.log("\nGenerating ingredient substitutes...");

    const allSubstitutes: Substitute[] = [];

    // Process common substitution categories
    const substitutionCategories = [
        {
            name: "cooking oils",
            description: "neutral and flavored cooking oils that can be swapped based on smoke point and flavor",
            ingredients: ingredientNames.filter((n) =>
                ["oil", "ghee"].some((f) => n.includes(f) && !n.includes("butter"))
            ),
        },
        {
            name: "dairy",
            description: "milk, cream, and dairy products with similar fat content and texture",
            ingredients: ingredientNames.filter((n) =>
                [
                    "milk",
                    "cream",
                    "yogurt",
                    "sour_cream",
                ].some((d) => n.includes(d))
            ),
        },
        {
            name: "butter and solid fats",
            description: "solid fats used for baking and cooking",
            ingredients: ingredientNames.filter((n) =>
                ["butter", "lard", "shortening", "margarine"].some((f) => n.includes(f))
            ),
        },
        {
            name: "cheese",
            description: "cheeses with similar melting properties and flavor profiles",
            ingredients: ingredientNames.filter((n) => n.includes("cheese")),
        },
        {
            name: "sweeteners",
            description: "liquid and granular sweeteners",
            ingredients: ingredientNames.filter((n) =>
                ["sugar", "honey", "maple", "agave", "syrup", "molasses"].some((s) =>
                    n.includes(s)
                )
            ),
        },
        {
            name: "vinegars and acids",
            description: "acidic ingredients for dressings and cooking",
            ingredients: ingredientNames.filter((n) =>
                ["vinegar", "lemon_juice", "lime_juice"].some((a) =>
                    n.includes(a)
                )
            ),
        },
        {
            name: "alliums",
            description: "onion family ingredients",
            ingredients: ingredientNames.filter((n) =>
                [
                    "onion",
                    "garlic",
                    "shallot",
                    "leek",
                    "scallion",
                    "chive",
                ].some((a) => n.includes(a))
            ),
        },
        {
            name: "fresh herbs",
            description: "fresh leafy herbs with similar flavor profiles",
            ingredients: ingredientNames.filter((n) =>
                [
                    "basil",
                    "parsley",
                    "cilantro",
                    "oregano",
                    "thyme",
                    "rosemary",
                    "mint",
                    "dill",
                    "sage",
                    "tarragon",
                ].some((h) => n.includes(h))
            ),
        },
        {
            name: "flours",
            description: "different types of flour for baking and thickening",
            ingredients: ingredientNames.filter((n) => n.includes("flour")),
        },
        {
            name: "rice varieties",
            description: "different rice types with similar cooking properties",
            ingredients: ingredientNames.filter((n) => n.includes("rice") && !n.includes("vinegar")),
        },
        {
            name: "pasta shapes",
            description: "pasta shapes that work similarly in dishes",
            ingredients: ingredientNames.filter((n) =>
                ["pasta", "spaghetti", "penne", "fusilli", "macaroni", "linguine", "fettuccine"].some((p) => n.includes(p))
            ),
        },
    ];

    const systemPrompt = `You are a professional chef and culinary expert. Generate ONLY realistic, practical ingredient substitutions.

CRITICAL RULES:
1. Substitutes must have SIMILAR cooking properties (smoke point, melting behavior, texture)
2. Substitutes must be in the SAME category (oil for oil, vinegar for vinegar, herb for herb)
3. NO cross-category substitutions (e.g., NO pasta for rice, NO oil for butter unless specifically for dietary needs)
4. Use snake_case for ingredient names (e.g., olive_oil, brown_sugar, soy_sauce)
5. Include realistic ratio adjustments in notes
6. Focus on substitutes a home cook would actually use

GOOD examples:
- olive_oil <-> grapeseed_oil (both neutral high-heat oils)
- white_sugar <-> brown_sugar (similar sweetness, note moisture difference)
- lemon_juice <-> lime_juice (both citrus acids)
- basil <-> oregano (both Mediterranean herbs)

BAD examples (DO NOT generate these):
- spaghetti <-> rice_noodles (different categories, different cooking)
- butter <-> olive_oil (different states, different uses)
- honey <-> maple_syrup without ratio notes

Return valid JSON.`;

    for (const category of substitutionCategories) {
        if (category.ingredients.length < 2) continue;

        console.log(
            `  Generating substitutes for ${category.name} (${category.ingredients.length} ingredients)`
        );

        const prompt = `Category: ${category.name}
Description: ${category.description}
Available ingredients: ${category.ingredients.join(", ")}

Generate practical cooking substitutions ONLY within this category. For each substitution provide:
1. ingredient: the original ingredient (use snake_case, e.g., olive_oil)
2. substitute: what can replace it (use snake_case, must be realistic for this category)
3. notes: ratio/amount adjustments and any flavor/texture differences

Generate 5-15 high-quality substitutions. Quality over quantity - only realistic swaps.
Return as JSON with a "substitutes" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.3,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                const substitutes: Substitute[] = parsed.substitutes || [];
                allSubstitutes.push(...substitutes);
                console.log(`    Generated ${substitutes.length} substitutes`);
            }
        } catch (error) {
            console.error(
                `  Error generating substitutes for ${category.name}:`,
                error
            );
        }

        await delay(500);
    }

    console.log(`  Total substitutes generated: ${allSubstitutes.length}`);
    return allSubstitutes;
}

// Create missing ingredients in the database
async function createMissingIngredients(
    substitutes: Substitute[],
    ingredientIds: Map<string, string>
): Promise<Map<string, string>> {
    // Collect all unique ingredient names from substitutes
    const allNames = new Set<string>();
    for (const s of substitutes) {
        allNames.add(s.ingredient);
        allNames.add(s.substitute);
    }

    // Find missing ingredients
    const missingNames = Array.from(allNames).filter(
        (name) => !ingredientIds.has(name)
    );

    if (missingNames.length === 0) {
        console.log("  No missing ingredients to create");
        return ingredientIds;
    }

    console.log(`  Creating ${missingNames.length} missing ingredients...`);

    // Create new ingredients
    const newIngredients = missingNames.map((name) => ({
        canonical_id: name,
        name: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

    const batchSize = 50;
    let createdCount = 0;

    for (let i = 0; i < newIngredients.length; i += batchSize) {
        const batch = newIngredients.slice(i, i + batchSize);

        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .upsert(batch, {
                onConflict: "canonical_id",
                ignoreDuplicates: false,
            })
            .select("id, canonical_id");

        if (error) {
            console.error(`  Error creating ingredients:`, error.message);
        } else if (data) {
            for (const ing of data) {
                ingredientIds.set(ing.canonical_id, ing.id);
                createdCount++;
            }
        }
    }

    console.log(`  Created ${createdCount} new ingredients`);
    return ingredientIds;
}

// Persist substitutes to database
async function persistSubstitutes(
    substitutes: Substitute[],
    ingredientIds: Map<string, string>
): Promise<void> {
    console.log("\nPersisting substitutes to database...");

    // First, create any missing ingredients
    const updatedIngredientIds = await createMissingIngredients(
        substitutes,
        ingredientIds
    );

    // Filter and deduplicate substitutes
    const seen = new Set<string>();
    const validSubstitutes = substitutes.filter((s) => {
        const id1 = updatedIngredientIds.get(s.ingredient);
        const id2 = updatedIngredientIds.get(s.substitute);
        if (!id1 || !id2) {
            console.log(`  Skipping: ${s.ingredient} -> ${s.substitute} (missing IDs)`);
            return false;
        }

        const key = `${id1}|${id2}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(
        `  ${validSubstitutes.length} valid unique substitutes to insert`
    );

    const records: {
        ingredient_id: string;
        substitute_id: string;
        notes: string;
    }[] = [];
    for (const s of validSubstitutes) {
        const ingredientId = updatedIngredientIds.get(s.ingredient);
        const substituteId = updatedIngredientIds.get(s.substitute);
        if (ingredientId && substituteId) {
            records.push({
                ingredient_id: ingredientId,
                substitute_id: substituteId,
                notes: s.notes,
            });
        }
    }

    // Insert in batches
    const batchSize = 100;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        const { error } = await supabaseAdmin
            .from("ingredient_substitutes")
            .upsert(batch, {
                onConflict: "ingredient_id,substitute_id",
                ignoreDuplicates: true,
            });

        if (error) {
            console.error(`  Error inserting substitute batch:`, error.message);
            errorCount += batch.length;
        } else {
            successCount += batch.length;
        }
    }

    console.log(
        `  Inserted ${successCount} substitute records (${errorCount} errors)`
    );
}

// Main function
async function main() {
    console.log("=".repeat(60));
    console.log("INGREDIENT SUBSTITUTES GENERATOR");
    console.log("=".repeat(60));

    const startTime = Date.now();

    // Step 1: Fetch ingredients from database
    console.log("\n" + "=".repeat(40));
    console.log("STEP 1: FETCHING INGREDIENTS");
    console.log("=".repeat(40));

    const ingredientIds = await fetchIngredients();
    const ingredientNames = Array.from(ingredientIds.keys());

    if (ingredientNames.length === 0) {
        console.error("No ingredients found in database. Run generate-ingredient-seeds.ts first.");
        process.exit(1);
    }

    // Step 2: Generate substitutes
    console.log("\n" + "=".repeat(40));
    console.log("STEP 2: GENERATING SUBSTITUTES");
    console.log("=".repeat(40));

    const substitutes = await generateSubstitutes(ingredientNames);

    // Step 3: Persist substitutes
    console.log("\n" + "=".repeat(40));
    console.log("STEP 3: PERSISTING SUBSTITUTES");
    console.log("=".repeat(40));

    await persistSubstitutes(substitutes, ingredientIds);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log("GENERATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total ingredients: ${ingredientNames.length}`);
    console.log(`Total substitutes generated: ${substitutes.length}`);
    console.log(`Time elapsed: ${elapsed} minutes`);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
