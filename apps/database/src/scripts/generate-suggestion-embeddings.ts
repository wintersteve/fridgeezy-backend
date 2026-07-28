import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { buildSuggestionSignature } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

interface SuggestionRow {
    id: string;
    name: string;
    name_en: string | null;
    recipe_suggestion_ingredients: Array<{ ingredients: { name: string } | null }>;
    recipe_suggestion_tags: Array<{ tags: { name: string } | null }>;
}

/**
 * (Re)builds the recipe_suggestions embeddings from the dish SIGNATURE (English
 * name + tags + ingredients) using the shared buildSuggestionSignature — the same
 * text the app embeds on insert. Re-embeds every suggestion (not just null ones)
 * so switching from name-embeddings to signature-embeddings is a single run.
 */
export async function generateSuggestionEmbeddings() {
    console.log("Starting recipe_suggestions signature-embedding backfill...\n");

    try {
        console.log("Fetching suggestions (with ingredients + tags)...");
        const { data, error: fetchError } = await supabaseAdmin
            .from("recipe_suggestions")
            .select(
                "id, name, name_en, recipe_suggestion_ingredients(ingredients(name)), recipe_suggestion_tags(tags(name))"
            )
            .order("name");

        if (fetchError) {
            throw new Error(`Failed to fetch suggestions: ${fetchError.message}`);
        }

        const suggestions = (data ?? []) as unknown as SuggestionRow[];
        if (suggestions.length === 0) {
            console.log("No suggestions found. Nothing to do!");
            return;
        }

        console.log(`Found ${suggestions.length} suggestions to (re)signature.\n`);

        // Build one dish signature per suggestion (identical to the app's).
        const signatures = suggestions.map((s) =>
            buildSuggestionSignature({
                name: s.name,
                nameEn: s.name_en,
                tags: s.recipe_suggestion_tags
                    .map((t) => t.tags?.name)
                    .filter((n): n is string => Boolean(n)),
                ingredients: s.recipe_suggestion_ingredients
                    .map((i) => i.ingredients?.name)
                    .filter((n): n is string => Boolean(n)),
            })
        );

        console.log("Generating signature embeddings via OpenAI API...");
        const result = await generateBatchEmbeddings(signatures, {
            model: "text-embedding-3-small",
            dimensions: 1536,
        });
        console.log(
            `Generated ${result.embeddings.length} embeddings (model ${result.model}, ${result.usage.total_tokens} tokens)\n`
        );

        console.log("Storing embeddings...");
        let successCount = 0;
        let errorCount = 0;
        for (let i = 0; i < suggestions.length; i++) {
            const { error: updateError } = await supabaseAdmin
                .from("recipe_suggestions")
                .update({ embedding: JSON.stringify(result.embeddings[i]) })
                .eq("id", suggestions[i].id);

            if (updateError) {
                console.error(
                    `  ✗ ${suggestions[i].name}: ${updateError.message}`
                );
                errorCount++;
            } else {
                successCount++;
            }
        }

        console.log("\n" + "=".repeat(50));
        console.log(
            `Total: ${suggestions.length}, updated: ${successCount}, failed: ${errorCount}`
        );
        const estimatedCost = (result.usage.total_tokens / 1_000_000) * 0.02;
        console.log(
            `API tokens: ${result.usage.total_tokens}, est. cost: $${estimatedCost.toFixed(6)}`
        );

        if (errorCount > 0) process.exit(1);
    } catch (error) {
        console.error(
            "\nFATAL ERROR:",
            error instanceof Error ? error.message : error
        );
        process.exit(1);
    }
}

generateSuggestionEmbeddings()
    .then(() => {
        console.log("\nDone.");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
