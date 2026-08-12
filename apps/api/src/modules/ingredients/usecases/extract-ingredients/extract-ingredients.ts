import { generateCompletion } from "@fridgeezy/llm";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { IngredientsRepository } from "@fridgeezy/supabase";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";
import { z } from "zod/v4";

// Imported from the file rather than the `services` barrel: the barrel also
// exports the suggestion generation stack, and this module needs one function.
import { matchIngredients } from "../../../suggestions/services/match-ingredients";

// Request body schema - accepts base64 image or URL
const RequestSchema = z.object({
    image: z.string().min(1).describe("Base64-encoded image data or image URL"),
    imageType: z
        .enum(["base64", "url"])
        .default("base64")
        .describe("Whether the image is base64-encoded or a URL"),
    mimeType: z
        .enum(["image/jpeg", "image/png", "image/gif", "image/webp"])
        .default("image/jpeg")
        .describe("MIME type of the image (for base64)"),
});

/** What the vision model returns — names only; identity is resolved against the catalog below. */
const ExtractedIngredientsSchema = z.object({
    ingredients: z.array(z.object({ name: z.string() })),
    confidence: z.enum(["high", "medium", "low"]),
});

/**
 * What the endpoint returns: catalog rows, not raw model output.
 *
 * `id` is the whole point — the client's ingredient store keys off catalog ids,
 * so a name it cannot resolve is a name it has to drop.
 */
const ExtractIngredientsResponseSchema = z.object({
    ingredients: z.array(
        z.object({
            id: z.string(),
            /** The catalog's display name, which may differ from what was seen. */
            name: z.string(),
            /** What the vision model called it, for debugging a surprising match. */
            extractedName: z.string(),
            matchType: z.enum(["exact_name", "alias", "vector", "created"]),
        })
    ),
    confidence: z.enum(["high", "medium", "low"]),
});

/**
 * The catalog's display-name house style: Title Case, no underscores. All 1051
 * rows follow it, so a name that reaches `ingredients.create` in any other shape
 * is a visible blemish on a list every user browses.
 *
 * The prompt asks for this shape directly; this is the belt to that braces. A
 * vision model drifting back to `red_bell_pepper` for one item out of twelve is
 * exactly the kind of thing that would otherwise land in the catalog forever.
 */
const toDisplayName = (raw: string): string =>
    raw
        .replace(/[_\s]+/g, " ")
        .trim()
        .split(" ")
        .map((word) =>
            word.length > 0
                ? word[0].toUpperCase() + word.slice(1).toLowerCase()
                : word
        )
        .join(" ");

export const extractIngredients = createStreamHandler({
    requestSchema: RequestSchema,
    responseSchema: ExtractIngredientsResponseSchema,
    useBufferedParser: true, // Use buffered parser for large base64 images

    handler: async ({ body }) => {
        const systemPrompt = `You are an ingredient extraction assistant. Analyze the provided image and identify all visible food ingredients.

## Rules
- Identify the food ingredients you can actually SEE in the image
- Be specific when the image supports it (e.g. "Leg Of Lamb" not just "Lamb", "Red Bell Pepper" not just "Bell Pepper")
- Use the singular form (e.g. "Tomato" not "Tomatoes")
- For processed/prepared items, identify the base ingredients if visible
- OMIT anything you cannot identify with reasonable confidence. A guess is worse
  than a gap here: every name you return is matched against a shared ingredient
  catalog and creates a new entry if it is not already there, so an invented
  ingredient becomes a permanent bad row that every user sees. Leaving out a
  doubtful item costs the user one tap to add it themselves.
- Ignore non-food items, packaging, and containers
- Do not list the same ingredient twice

## Name Format
Write each name the way it would appear in a shop's aisle listing: Title Case
words separated by spaces, singular, no underscores.

Good: "Red Bell Pepper", "Extra Virgin Olive Oil", "Ground Cumin", "Chicken Breast"
Bad: "red_bell_pepper", "TOMATOES", "a few carrots", "some kind of cheese"

## Output Format
Output a single JSON object with this structure:
{"ingredients":[{"name":"Leg Of Lamb"},{"name":"Red Bell Pepper"}],"confidence":"high"}

Confidence levels:
- "high": Clear image, ingredients easily identifiable
- "medium": Some ingredients unclear or partially visible
- "low": Poor image quality or many uncertain identifications

No markdown, no code blocks, just the JSON object.`;

        const { text: content, finishReason } = await generateCompletion({
            model: { openai: "gpt-4o" },
            label: "ingredients.extract",
            system: systemPrompt,
            user: "Identify all the food ingredients visible in this image.",
            image: {
                kind: body.imageType,
                data: body.image,
                mimeType: body.mimeType,
            },
            // Both providers are capped here, unlike the adjudicators: this
            // output is a whole ingredient list, so the cap is a real ceiling
            // rather than a cost guard, and a Bedrock run needs its own budget
            // that clears the thinking allowance.
            //
            // Raised from 4000 once thinking became explicit: Anthropic counts
            // thinking against the same cap, so the old figure was the list
            // budget being shared rather than a ceiling above it. This is the
            // one capped call site that fails LOUDLY — the "try a clearer image"
            // branch below reads `finishReason` — so the headroom is about not
            // rejecting a busy fridge photo, not about hiding truncation.
            maxTokens: { openai: 2000, bedrock: 8000 },
        });

        if (!content) {
            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "No response from AI model" },
            };
        }

        // A response cut off at the token cap yields invalid JSON — surface it as
        // a clear, actionable error instead of a generic parse failure.
        if (finishReason === "length") {
            return {
                type: "raw" as const,
                statusCode: 500,
                data: {
                    error: "Ingredient extraction was truncated (token limit). Try a clearer or less crowded image.",
                },
            };
        }

        // Parse and validate defensively — the model can drift from the
        // requested JSON shape, and an unguarded parse would throw a 500.
        let extracted: z.infer<typeof ExtractedIngredientsSchema>;
        try {
            extracted = ExtractedIngredientsSchema.parse(JSON.parse(content));
        } catch (error) {
            console.error("Failed to parse extracted ingredients:", error);
            return {
                type: "raw" as const,
                statusCode: 502,
                data: { error: "Model returned malformed ingredient data" },
            };
        }

        const seenNames = extracted.ingredients
            .map((ingredient) => toDisplayName(ingredient.name))
            .filter((name) => name.length > 0);

        if (seenNames.length === 0) {
            return {
                type: "json" as const,
                data: { ingredients: [], confidence: extracted.confidence },
            };
        }

        // Resolve against the catalog with the SAME logic the suggestion persist
        // path uses — canonical id, then alias, then vector search, then LLM
        // adjudication, creating only what genuinely isn't there yet.
        //
        // This used to be the client's job, against a bulk-fetched copy of the
        // catalog, and it could only ever drop what it failed to match: a
        // photographed zucchini with no catalog row (or, as it turned out, with
        // one the client's capped fetch never received) vanished silently.
        // Resolution belongs on this side because only this side can create the
        // row, learn the alias, and reach the embeddings that make "courgette"
        // find "Zucchini" at all.
        //
        // Note this is all-or-nothing: `matchIngredients` abandons the names it
        // already resolved if any single create fails, so one bad row costs the
        // whole photo rather than the item. That is the right shape for its
        // original caller — a partial ingredient list silently corrupts the
        // dietary flags a suggestion stores as a NEGATIVE proof — and it is only
        // an annoyance here, so it is not worth forking the function over. If
        // extraction ever needs to degrade instead, fork it here rather than
        // loosening it there.
        const matched = await matchIngredients(seenNames);
        if (matched.success === false) {
            console.error(
                "Failed to match extracted ingredients:",
                matched.error
            );
            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Failed to resolve ingredients against catalog" },
            };
        }

        // `matchIngredients` pushes its results per phase (exact matches first,
        // then aliases, then everything it adjudicated), so what comes back is in
        // resolution order rather than the order the ingredients appear in the
        // photo. Rebuild the model's ordering, joining on canonical id because
        // that is what it deduplicated on.
        const byCanonicalId = new Map(
            matched.value.map((match) => [
                ingredientCanonicalId(match.originalName),
                match,
            ])
        );

        const repository = new IngredientsRepository();
        const rows = await repository.findByIds(
            matched.value.map((match) => match.ingredientId)
        );
        if (rows.success === false) {
            console.error("Failed to load matched ingredients:", rows.error);
            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Failed to resolve ingredients against catalog" },
            };
        }

        const resolved: z.infer<
            typeof ExtractIngredientsResponseSchema
        >["ingredients"] = [];
        const emitted = new Set<string>();

        for (const seenName of seenNames) {
            const match = byCanonicalId.get(ingredientCanonicalId(seenName));
            if (!match || emitted.has(match.ingredientId)) continue;

            // Prefer the catalog's own name: the row is the shared thing, and
            // "Zucchini" is what the rest of the app will call it even when this
            // photo produced "Courgette".
            const row = rows.value.get(match.ingredientId);

            emitted.add(match.ingredientId);
            resolved.push({
                id: match.ingredientId,
                name: row?.name ?? match.originalName,
                extractedName: seenName,
                matchType: match.matchType,
            });
        }

        const created = resolved.filter((item) => item.matchType === "created");
        if (created.length > 0) {
            console.log(
                `[Ingredients] Extraction created ${created.length} new ingredient(s): ${created
                    .map((item) => item.name)
                    .join(", ")}`
            );
        }

        return {
            type: "json" as const,
            data: { ingredients: resolved, confidence: extracted.confidence },
        };
    },
});
