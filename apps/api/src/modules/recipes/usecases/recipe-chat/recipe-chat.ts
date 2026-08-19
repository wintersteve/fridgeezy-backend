import { ChatRequestSchema, GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import type { Request, Response } from "express";

import {
    createChatCompletion,
    endSseStream,
    initSseStream,
    parseJsonBody,
    writeSseEvent,
} from "../../../chat/services";
import { callerMayReadRecipe, fetchRecipe } from "../../services";

/** The classification sentinel the model emits for modification requests. */
const MODIFY_SENTINEL = /^\s*MODIFY:/i;
// Enough characters to tell "MODIFY:" apart from the start of a normal answer.
const DECISION_MIN_CHARS = 7;

/**
 * System prompt scoping the chat to one recipe and defining the modify
 * classification. The `MODIFY:` sentinel is an internal signal — this endpoint
 * parses it and emits a structured `modify` event, so the client never sees it.
 */
const buildRecipeChatPrompt = (
    recipe: GenerateRecipeResponseDto,
    focusedStep?: number
): string => {
    const lines: string[] = [
        "You are a cooking assistant helping the user with one specific recipe they are currently viewing.",
        "Answer questions about this recipe: substitutions, techniques, timing, equipment, storage and pairings.",
        "Be concise and practical. Use the recipe's own ingredients and steps when you answer, and say so plainly if the recipe does not cover what they asked.",
        "",
        "SERVINGS — never a modification:",
        `This recipe is written for ${recipe.servings} servings, and the screen the user came from has a servings control that rescales every amount live. If they ask for a different number of servings, or to halve or double it, tell them to use that control — do NOT restate the ingredient list at the new size, and do NOT treat it as a modification.`,
        "",
        "MODIFICATION REQUESTS — read carefully:",
        "If the user asks you to CHANGE this recipe into a new version — substitute/add/remove ingredients, adapt it for a diet, change the difficulty, or any alteration that produces a modified recipe — do NOT answer, explain, or list ingredients. Reply with EXACTLY one line and nothing else:",
        "MODIFY: <a short imperative instruction capturing the change>",
        "Examples: 'can you make it dairy free?' -> 'MODIFY: make it dairy-free'; 'swap the cream for coconut milk' -> 'MODIFY: swap the cream for coconut milk'.",
        "A serving-count change is NOT one of these. 'make this for 8' and 'halve it' are answered normally, per the rule above.",
        "For ANY other message — questions about the existing recipe, tips, techniques, storage, pairings, whether something is possible — answer normally and NEVER output the word MODIFY.",
        "",
        "--- RECIPE ---",
        `Name: ${recipe.name}`,
    ];

    if (recipe.description) lines.push(`Description: ${recipe.description}`);
    if (recipe.difficulty) lines.push(`Difficulty: ${recipe.difficulty}`);
    if (recipe.prepTime) lines.push(`Prep time: ${recipe.prepTime} min`);
    if (recipe.cookTime) lines.push(`Cook time: ${recipe.cookTime} min`);
    if (recipe.tags?.length) lines.push(`Tags: ${recipe.tags.join(", ")}`);

    const ingredients = recipe.ingredients
        .map((item) => {
            const quantity = [item.quantity, item.unit].filter(Boolean).join(" ");
            return quantity ? `- ${quantity} ${item.name}` : `- ${item.name}`;
        })
        .filter(Boolean);

    if (ingredients.length > 0) {
        lines.push("", "Ingredients:", ...ingredients);
    }

    if (recipe.instructions.length > 0) {
        lines.push(
            "",
            "Steps:",
            ...recipe.instructions.map(
                (step, index) => `${index + 1}. ${step.text}`
            )
        );
    }

    lines.push("--- END RECIPE ---");

    /**
     * Where the cook actually is, when the client knows.
     *
     * Placed AFTER the recipe rather than in the opening instructions, so the
     * model reads the method first and then is told which line of it the user
     * is standing over. Without this, cook mode's questions have no subject:
     * "is this brown enough" is unanswerable against a whole recipe and obvious
     * against one step of it.
     *
     * Clamped to the method's own length, because the number is the client's
     * and a stale one must not index into a recipe that has since been edited.
     */
    const step =
        focusedStep && focusedStep >= 1 && focusedStep <= recipe.instructions.length
            ? focusedStep
            : undefined;

    if (step) {
        lines.push(
            "",
            `The user is cooking right now and is on step ${step}: "${recipe.instructions[step - 1].text}"`,
            "Assume any question without an explicit subject is about that step. Answer for where they are, not for the recipe as a whole."
        );
    }

    return lines.join("\n");
};

/**
 * Recipe-scoped chat. Streams a text answer for questions, or — when the model
 * classifies the turn as a modification request — emits a single `modify` event
 * carrying the extracted instruction (the client then runs the modify flow).
 */
export async function recipeChat(req: Request, res: Response): Promise<void> {
    try {
        const recipeId = (req.params as { recipeId?: string }).recipeId;

        const body = await parseJsonBody(req);
        const request = ChatRequestSchema.parse(body);

        const recipe = recipeId ? await fetchRecipe(recipeId) : null;

        // Owned recipes are readable only by their owner; this fetch runs as the
        // service role and so sees past the RLS that enforces that elsewhere.
        // Reported as the same "not found" frame, so refusal and absence look
        // identical to a caller probing ids — and checked BEFORE the stream
        // opens, so it stays one decision rather than two.
        const readable =
            recipe !== null &&
            (await callerMayReadRecipe(recipe.createdBy, req));

        initSseStream(res);

        if (!recipe || !readable) {
            writeSseEvent(res, {
                type: "error",
                data: { error: `Recipe not found: ${recipeId}` },
            });
            endSseStream(res);
            return;
        }

        // Own the system message — drop any the client sent and prepend ours.
        const messages = [
            {
                role: "system" as const,
                content: buildRecipeChatPrompt(recipe, request.focusedStep),
            },
            ...request.messages.filter((message) => message.role !== "system"),
        ];

        const stream = createChatCompletion(messages, [], {
            stream: request.stream,
            model: request.model,
            temperature: request.temperature,
        });

        // Buffer the opening tokens until we can tell a modification (the
        // `MODIFY:` sentinel) from a normal answer, then either stream content or
        // hold back for the modify event.
        let buffer = "";
        let decided = false;
        let isModify = false;

        for await (const event of stream) {
            if (event.type === "chunk") {
                if (isModify) {
                    buffer += event.delta;
                } else if (decided) {
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: event.delta },
                    });
                } else {
                    buffer += event.delta;
                    const seen = buffer.trimStart();
                    if (seen.length >= DECISION_MIN_CHARS || buffer.includes("\n")) {
                        decided = true;
                        isModify = MODIFY_SENTINEL.test(buffer);
                        if (!isModify) {
                            writeSseEvent(res, {
                                type: "content",
                                data: { delta: buffer },
                            });
                            buffer = "";
                        }
                    }
                }
            } else if (event.type === "error") {
                writeSseEvent(res, {
                    type: "error",
                    data: { error: event.error },
                });
                break;
            } else if (event.type === "done") {
                if (isModify) {
                    const instruction = buffer
                        .replace(/^\s*MODIFY:\s*/i, "")
                        .trim();
                    writeSseEvent(res, {
                        type: "modify",
                        data: { instruction },
                    });
                } else if (buffer) {
                    // A short answer that never crossed the decision threshold.
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: buffer },
                    });
                    buffer = "";
                }

                writeSseEvent(res, {
                    type: "done",
                    data: { finish_reason: event.finish_reason },
                });
            }
        }

        endSseStream(res);
    } catch (error) {
        console.error("[RecipeChat] Error:", error);

        if (!res.headersSent) {
            initSseStream(res);
        }

        writeSseEvent(res, {
            type: "error",
            data: {
                error: error instanceof Error ? error.message : "Unknown error",
            },
        });

        endSseStream(res);
    }
}
