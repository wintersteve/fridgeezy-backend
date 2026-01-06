import OpenAI from "openai";
import { z } from "zod/v4";

import { createMcpHandler } from "@/src/server/shared/streaming";
import { openai } from "@/src/shared/openai";

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

export const extractIngredients = createMcpHandler({
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

        // Build the image content based on type
        const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPartImage =
            body.imageType === "url"
                ? {
                      type: "image_url",
                      image_url: { url: body.image, detail: "high" },
                  }
                : {
                      type: "image_url",
                      image_url: {
                          url: `data:${body.mimeType};base64,${body.image}`,
                          detail: "high",
                      },
                  };

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        imageContent,
                        {
                            type: "text",
                            text: "Identify all the food ingredients visible in this image.",
                        },
                    ],
                },
            ],
            max_completion_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content?.trim();

        if (!content) {
            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "No response from AI model" },
            };
        }

        // Parse and validate the response
        const parsed = JSON.parse(content);
        const result = ExtractedIngredientsSchema.parse(parsed);

        return {
            type: "json" as const,
            data: result,
        };
    },
});
