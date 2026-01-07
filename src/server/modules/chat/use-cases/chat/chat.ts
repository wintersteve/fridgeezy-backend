import { zodFunction } from "openai/helpers/zod";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod/v4";

import { createStreamHandler } from "@/src/server/shared/streaming";

import { createChatStreamHandler } from "../../application/services";

// ============================================================================
// Schemas for structured output tools
// ============================================================================

const SuggestionSchema = z.object({
    title: z.string().describe("Name of the recipe (no parenthesis)"),
    ingredients: z.array(z.string()).describe("Main ingredients needed"),
    time: z.string().describe("Total time (e.g., 35 minutes)"),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).describe("Difficulty level"),
    tags: z.array(z.string()).describe("Recipe tags (dietary and cuisine)"),
});

export const SuggestionsOutputSchema = z.object({
    suggestions: z
        .array(SuggestionSchema)
        .length(5)
        .describe("Exactly 5 recipe suggestions"),
});

export const RecipeOutputSchema = z.object({
    name: z.string().describe("Recipe name"),
    description: z.string().describe("Brief description of the dish"),
    difficulty: z.enum(["easy", "medium", "hard"]).describe("Difficulty level"),
    servings: z.number().int().positive().describe("Number of servings"),
    prepTime: z.number().int().describe("Preparation time in minutes"),
    cookTime: z.number().int().describe("Cooking time in minutes"),
    ingredients: z
        .array(
            z.object({
                name: z
                    .string()
                    .describe(
                        "Ingredient canonical ID (lowercase_underscore_singular)"
                    ),
                category: z.string().describe("Top-level food category"),
                parent: z
                    .string()
                    .nullable()
                    .describe("Immediate parent ingredient if applicable"),
                quantity: z.number().positive().describe("Numeric quantity"),
                unit: z.string().describe("Unit DB id"),
            })
        )
        .describe("Detailed ingredients with quantities and hierarchy"),
    instructions: z
        .array(
            z.object({
                text: z.string().describe("Instruction step description"),
                ingredients: z
                    .array(z.string())
                    .optional()
                    .nullable()
                    .describe("Ingredients used in this step"),
            })
        )
        .describe("Step-by-step cooking instructions"),
    tips: z.array(z.string()).nullable().describe("Optional cooking tips"),
    tags: z.array(z.string()).describe("Recipe tags (dietary and cuisine)"),
});

// ============================================================================
// SSE Event Schemas
// ============================================================================

const ChatTokenSchema = z.object({
    type: z.literal("token"),
    content: z.string(),
});

const ChatToolCallSchema = z.object({
    type: z.literal("tool_call"),
    name: z.string(),
    status: z.enum(["started", "completed"]),
});

const ChatSuggestionsResultSchema = z.object({
    type: z.literal("suggestions"),
    data: SuggestionsOutputSchema,
});

const ChatRecipeResultSchema = z.object({
    type: z.literal("recipe"),
    data: RecipeOutputSchema,
    saved: z.boolean(),
});

const ChatMessageResultSchema = z.object({
    type: z.literal("message"),
    data: z.string(),
});

// ============================================================================
// Tool definitions
// ============================================================================

// GET_TAGS is a real tool that fetches data (uses cached version)
const GetTagsInputSchema = z.object({
    type: z
        .enum(["dietary", "cuisine"])
        .optional()
        .nullable()
        .describe("Filter by tag type"),
});

const TOOLS = [
    zodFunction({
        name: "GET_TAGS",
        description:
            "Fetch available recipe tags from the database. Returns dietary and cuisine tags. Call this before generating suggestions or recipes.",
        parameters: GetTagsInputSchema,
    }),
    zodFunction({
        name: "SUGGEST_RECIPES",
        description:
            "Output 5 recipe suggestions based on available ingredients. Call this when the user asks for recipe ideas or what they can make.",
        parameters: SuggestionsOutputSchema,
    }),
    zodFunction({
        name: "GENERATE_RECIPE",
        description:
            "Output a complete detailed recipe. Call this when the user selects a recipe or asks for a specific recipe to be generated. The recipe will be automatically saved.",
        parameters: RecipeOutputSchema,
    }),
];

// ============================================================================
// Request/Response types
// ============================================================================

const RequestSchema = z.object({
    message: z.string().min(1),
    history: z.array(z.any()).optional().nullable(),
});

// ============================================================================
// Handler
// ============================================================================

const SYSTEM_PROMPT = `You are a helpful recipe assistant. You help users find recipes based on their ingredients and generate detailed recipes.

## Tools Available
1. **GET_TAGS**: Fetch valid tags from the database. ALWAYS call this first before generating suggestions or recipes.
2. **SUGGEST_RECIPES**: Generate 5 recipe suggestions. Use when the user asks what they can make or wants recipe ideas.
3. **GENERATE_RECIPE**: Generate a complete detailed recipe. Use when the user selects a recipe or asks for a specific recipe.

## Workflow
1. When user mentions ingredients and wants ideas → call GET_TAGS, then SUGGEST_RECIPES
2. When user selects a recipe from suggestions → call GENERATE_RECIPE with the EXACT same title
3. For general questions → respond with plain text (no tool call)

## Rules
- ALWAYS call GET_TAGS before SUGGEST_RECIPES or GENERATE_RECIPE
- Only use tags returned by GET_TAGS
- When generating a recipe that was suggested, use the EXACT same title
- Include all ingredients the user mentioned in the suggestions
- Be conversational and helpful`;

export const chat = createStreamHandler({
    requestSchema: RequestSchema,
    responseSchema: [
        ChatTokenSchema,
        ChatToolCallSchema,
        ChatSuggestionsResultSchema,
        ChatRecipeResultSchema,
        ChatMessageResultSchema,
    ],

    handler: async ({ body }) => {
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: SYSTEM_PROMPT },
            ...((body.history as ChatCompletionMessageParam[]) ?? []),
            { role: "user", content: body.message },
        ];

        return {
            type: "stream" as const,
            stream: createChatStreamHandler(messages, TOOLS),
        };
    },
});
