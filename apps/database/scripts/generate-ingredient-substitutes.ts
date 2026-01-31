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
            name: "dairy",
            ingredients: ingredientNames.filter((n) =>
                [
                    "milk",
                    "cream",
                    "butter",
                    "yogurt",
                    "cheese",
                    "sour_cream",
                ].some((d) => n.includes(d))
            ),
        },
        {
            name: "proteins",
            ingredients: ingredientNames.filter((n) =>
                [
                    "chicken",
                    "beef",
                    "pork",
                    "turkey",
                    "lamb",
                    "fish",
                    "tofu",
                    "tempeh",
                ].some((p) => n.includes(p))
            ),
        },
        {
            name: "grains",
            ingredients: ingredientNames.filter((n) =>
                [
                    "rice",
                    "pasta",
                    "noodle",
                    "flour",
                    "bread",
                    "quinoa",
                    "oat",
                ].some((g) => n.includes(g))
            ),
        },
        {
            name: "fats",
            ingredients: ingredientNames.filter((n) =>
                ["oil", "butter", "ghee", "lard"].some((f) => n.includes(f))
            ),
        },
        {
            name: "sweeteners",
            ingredients: ingredientNames.filter((n) =>
                ["sugar", "honey", "maple", "agave", "syrup"].some((s) =>
                    n.includes(s)
                )
            ),
        },
        {
            name: "acids",
            ingredients: ingredientNames.filter((n) =>
                ["vinegar", "lemon", "lime", "citrus"].some((a) =>
                    n.includes(a)
                )
            ),
        },
        {
            name: "alliums",
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
            name: "herbs",
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
                ].some((h) => n.includes(h))
            ),
        },
    ];

    for (const category of substitutionCategories) {
        if (category.ingredients.length < 2) continue;

        console.log(
            `  Generating substitutes for ${category.name} (${category.ingredients.length} ingredients)`
        );

        const prompt = `For these ${category.name} ingredients: ${category.ingredients.join(", ")}

Generate practical cooking substitutions. For each substitution provide:
1. ingredient: the original ingredient
2. substitute: what can replace it
3. notes: ratio/amount adjustments and any flavor/texture differences

Focus on:
- Direct substitutes (same category swaps)
- Dietary alternatives (vegan, dairy-free, gluten-free options)
- Emergency substitutes (common pantry swaps)

Generate 30-50 substitutions. Return as JSON with a "substitutes" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a culinary expert. Generate practical ingredient substitutions with accurate ratios. Return valid JSON.",
                    },
                    { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
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

    // Generate general substitutes (only if we have enough ingredients)
    if (ingredientNames.length >= 50) {
        console.log("  Generating general substitutes...");
        const subCount = Math.min(200, ingredientNames.length * 3);
        const generalPrompt = `From this ingredient list: ${ingredientNames.slice(0, 400).join(", ")}

Generate ${subCount} practical cooking substitutions covering:
- Common allergen alternatives
- Vegan/vegetarian swaps
- Low-sodium alternatives
- Budget-friendly substitutes
- Regional ingredient alternatives

Each needs:
1. ingredient: original ingredient name
2. substitute: replacement ingredient name
3. notes: how to substitute (ratios, cooking adjustments)

Return as JSON with a "substitutes" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a culinary expert. Generate practical substitutions. Return valid JSON.",
                    },
                    { role: "user", content: generalPrompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
                max_tokens: 16000,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                const substitutes: Substitute[] = parsed.substitutes || [];
                allSubstitutes.push(...substitutes);
                console.log(
                    `    Generated ${substitutes.length} general substitutes`
                );
            }
        } catch (error) {
            console.error(`  Error generating general substitutes:`, error);
        }
    } else {
        console.log("  Skipping general substitutes (not enough ingredients)");
    }

    console.log(`  Total substitutes generated: ${allSubstitutes.length}`);
    return allSubstitutes;
}

// Persist substitutes to database
async function persistSubstitutes(
    substitutes: Substitute[],
    ingredientIds: Map<string, string>
): Promise<void> {
    console.log("\nPersisting substitutes to database...");

    // Filter and deduplicate substitutes
    const seen = new Set<string>();
    const validSubstitutes = substitutes.filter((s) => {
        const id1 = ingredientIds.get(s.ingredient);
        const id2 = ingredientIds.get(s.substitute);
        if (!id1 || !id2) return false;

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
        const ingredientId = ingredientIds.get(s.ingredient);
        const substituteId = ingredientIds.get(s.substitute);
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
