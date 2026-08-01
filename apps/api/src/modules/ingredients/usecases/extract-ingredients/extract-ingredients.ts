import { generateCompletion } from "@fridgeezy/llm";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

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

// Schema for a single ingredient with hierarchy
const IngredientSchema = z.object({
    name: z.string(),
    category: z.string(),
    parent: z.string().nullable(),
});

// Schema for validating extracted ingredients
const ExtractedIngredientsSchema = z.object({
    ingredients: z.array(IngredientSchema),
    confidence: z.enum(["high", "medium", "low"]),
});

export const extractIngredients = createStreamHandler({
    requestSchema: RequestSchema,
    responseSchema: ExtractedIngredientsSchema,
    useBufferedParser: true, // Use buffered parser for large base64 images

    handler: async ({ body }) => {
        const systemPrompt = `You are an ingredient extraction assistant. Analyze the provided image and identify all visible food ingredients.

## Rules
- Identify ALL visible ingredients in the image
- Be specific (e.g., "leg_of_lamb" not just "lamb")
- Use singular form (e.g., "tomato" not "tomatoes")
- For processed/prepared items, identify the base ingredients if visible
- If you cannot identify an item with certainty, make your best guess
- Ignore non-food items, packaging, and containers

## Ingredient Hierarchy
Each ingredient must include:
- name: The specific ingredient (lowercase_underscore_singular)
- category: The top-level food category (meat, poultry, seafood, dairy, vegetable, fruit, grain, legume, herb, spice, oil, condiment, nut, seed, sweetener, beverage, other)
- parent: The immediate parent ingredient if applicable (null if none)

Examples:
- leg_of_lamb -> parent: "lamb", category: "meat"
- lamb -> parent: null, category: "meat"
- chicken_breast -> parent: "chicken", category: "poultry"
- red_bell_pepper -> parent: "bell_pepper", category: "vegetable"
- bell_pepper -> parent: "pepper", category: "vegetable"
- extra_virgin_olive_oil -> parent: "olive_oil", category: "oil"
- ground_cumin -> parent: "cumin", category: "spice"

## Output Format
Output a single JSON object with this structure:
{"ingredients":[{"name":"leg_of_lamb","category":"meat","parent":"lamb"},{"name":"red_bell_pepper","category":"vegetable","parent":"bell_pepper"}],"confidence":"high"}

Ingredient names must be lowercase_underscore_singular (e.g., coriander_seed, olive_oil, chicken_breast, red_bell_pepper).

Confidence levels:
- "high": Clear image, ingredients easily identifiable
- "medium": Some ingredients unclear or partially visible
- "low": Poor image quality or many uncertain identifications

No markdown, no code blocks, just the JSON object.`;

        const { text: content, finishReason } = await generateCompletion({
            model: { openai: "gpt-4o" },
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
            maxTokens: { openai: 2000, bedrock: 4000 },
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
        let result: z.infer<typeof ExtractedIngredientsSchema>;
        try {
            result = ExtractedIngredientsSchema.parse(JSON.parse(content));
        } catch (error) {
            console.error("Failed to parse extracted ingredients:", error);
            return {
                type: "raw" as const,
                statusCode: 502,
                data: { error: "Model returned malformed ingredient data" },
            };
        }

        return {
            type: "json" as const,
            data: result,
        };
    },
});
