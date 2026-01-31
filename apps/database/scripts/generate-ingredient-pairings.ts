import "dotenv/config";

import { supabaseAdmin } from "@fridgeezy/supabase";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Pairing {
    ingredient1: string;
    ingredient2: string;
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

// Generate pairings using GPT-4o
async function generatePairings(ingredientNames: string[]): Promise<Pairing[]> {
    console.log("\nGenerating ingredient pairings...");

    const allPairings: Pairing[] = [];

    // Process in batches to avoid token limits
    const batchSize = 200;
    for (let i = 0; i < ingredientNames.length; i += batchSize) {
        const batch = ingredientNames.slice(i, i + batchSize);
        console.log(
            `  Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ingredientNames.length / batchSize)}`
        );

        const prompt = `Given these ingredients: ${batch.join(", ")}

Generate classic and popular ingredient pairings. Focus on:
- Classic culinary combinations (tomato + basil, lamb + rosemary)
- Regional cuisine pairings (soy_sauce + ginger + garlic for Asian)
- Flavor profile matches (sweet + salt, acid + fat)
- Complementary textures

Generate 50-80 pairings for this batch. Each pairing should have:
1. ingredient1: first ingredient name (must be from the list)
2. ingredient2: second ingredient name (must be from the list)
3. notes: brief explanation of why they pair well

Return as JSON with a "pairings" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a culinary expert. Generate accurate ingredient pairings based on established culinary traditions. Return valid JSON.",
                    },
                    { role: "user", content: prompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                const pairings: Pairing[] = parsed.pairings || [];
                allPairings.push(...pairings);
                console.log(`    Generated ${pairings.length} pairings`);
            }
        } catch (error) {
            console.error(`  Error generating pairings:`, error);
        }

        await delay(500); // Rate limiting
    }

    // Generate cross-category pairings (only if we have enough ingredients)
    if (ingredientNames.length >= 50) {
        console.log("  Generating cross-category pairings...");
        const pairingCount = Math.min(500, ingredientNames.length * 5);
        const crossCategoryPrompt = `Generate ${pairingCount} classic cross-category ingredient pairings from this list: ${ingredientNames.slice(0, 500).join(", ")}

Focus on fundamental pairings that work across cuisines:
- Protein + aromatic (chicken + garlic, beef + onion)
- Protein + herb (lamb + rosemary, fish + dill)
- Starch + sauce (pasta + tomato_sauce, rice + soy_sauce)
- Vegetable + fat (potato + butter, salad + olive_oil)
- Fruit + dairy (strawberry + cream, apple + cheddar)

Each pairing needs:
1. ingredient1: first ingredient name
2. ingredient2: second ingredient name
3. notes: why they work together

Return as JSON with a "pairings" array.`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a culinary expert. Generate classic ingredient pairings. Return valid JSON.",
                    },
                    { role: "user", content: crossCategoryPrompt },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
                max_tokens: 16000,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                const pairings: Pairing[] = parsed.pairings || [];
                allPairings.push(...pairings);
                console.log(
                    `    Generated ${pairings.length} cross-category pairings`
                );
            }
        } catch (error) {
            console.error(`  Error generating cross-category pairings:`, error);
        }
    } else {
        console.log("  Skipping cross-category pairings (not enough ingredients)");
    }

    console.log(`  Total pairings generated: ${allPairings.length}`);
    return allPairings;
}

// Persist pairings to database
async function persistPairings(
    pairings: Pairing[],
    ingredientIds: Map<string, string>
): Promise<void> {
    console.log("\nPersisting pairings to database...");

    // Filter and deduplicate pairings
    const seen = new Set<string>();
    const validPairings = pairings.filter((p) => {
        const id1 = ingredientIds.get(p.ingredient1);
        const id2 = ingredientIds.get(p.ingredient2);
        if (!id1 || !id2) return false;

        const key1 = `${id1}|${id2}`;
        const key2 = `${id2}|${id1}`;
        if (seen.has(key1) || seen.has(key2)) return false;
        seen.add(key1);
        return true;
    });

    console.log(`  ${validPairings.length} valid unique pairings to insert`);

    // Create bidirectional records
    const records: {
        ingredient_id: string;
        paired_ingredient_id: string;
        notes: string;
    }[] = [];
    for (const p of validPairings) {
        const id1 = ingredientIds.get(p.ingredient1);
        const id2 = ingredientIds.get(p.ingredient2);
        if (!id1 || !id2) continue;

        records.push({
            ingredient_id: id1,
            paired_ingredient_id: id2,
            notes: p.notes,
        });
        records.push({
            ingredient_id: id2,
            paired_ingredient_id: id1,
            notes: p.notes,
        });
    }

    // Insert in batches
    const batchSize = 100;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        const { error } = await supabaseAdmin
            .from("ingredient_pairings")
            .upsert(batch, {
                onConflict: "ingredient_id,paired_ingredient_id",
                ignoreDuplicates: true,
            });

        if (error) {
            console.error(`  Error inserting pairing batch:`, error.message);
            errorCount += batch.length;
        } else {
            successCount += batch.length;
        }
    }

    console.log(
        `  Inserted ${successCount} pairing records (${errorCount} errors)`
    );
}

// Main function
async function main() {
    console.log("=".repeat(60));
    console.log("INGREDIENT PAIRINGS GENERATOR");
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

    // Step 2: Generate pairings
    console.log("\n" + "=".repeat(40));
    console.log("STEP 2: GENERATING PAIRINGS");
    console.log("=".repeat(40));

    const pairings = await generatePairings(ingredientNames);

    // Step 3: Persist pairings
    console.log("\n" + "=".repeat(40));
    console.log("STEP 3: PERSISTING PAIRINGS");
    console.log("=".repeat(40));

    await persistPairings(pairings, ingredientIds);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log("GENERATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total ingredients: ${ingredientNames.length}`);
    console.log(`Total pairings generated: ${pairings.length}`);
    console.log(`Time elapsed: ${elapsed} minutes`);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
