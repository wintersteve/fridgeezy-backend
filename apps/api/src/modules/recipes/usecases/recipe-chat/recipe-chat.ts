import { ChatRequestSchema, GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import type { Request, Response } from "express";

import {
    createChatCompletion,
    endSseStream,
    initSseStream,
    parseJsonBody,
    writeSseEvent,
} from "../../../chat/services";
import { recordPrompt } from "../../../prompts/services";
import { callerMayReadRecipe, fetchRecipe } from "../../services";

/**
 * The classification sentinels, and the intent each one proposes.
 *
 * Two, not one, and the second is a bug fix rather than a new capability. The
 * prompt has always listed "change the difficulty" as a modification, but
 * `modify-recipe` pins `difficulty` to the source recipe's in both its prompt
 * and its stream `initialState` — so "make this easier" wrote a variant
 * labelled "Easier" at *exactly the same difficulty*, and never reached
 * `escalate-difficulty`, which is the endpoint that actually re-pitches a dish.
 *
 * They are matched as one alternation so the buffered decision below stays a
 * single test: the opening tokens are held back only until we can tell any
 * sentinel from the start of an ordinary answer.
 */
const SENTINEL = /^\s*(MODIFY|DIFFICULTY):/i;

/** The three rungs `escalate-difficulty` writes. Anything else is not one. */
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Enough characters to tell "DIFFICULTY:" — the longer of the two — apart from
// the start of a normal answer.
const DECISION_MIN_CHARS = 11;

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
        "REQUESTS TO CHANGE THE RECIPE — read carefully:",
        "If the user asks you to CHANGE this recipe into a new version, do NOT answer, explain, or list ingredients. Reply with EXACTLY one line and nothing else, choosing the line that matches what they asked for:",
        "",
        "MODIFY: <a short imperative instruction capturing the change>",
        "  — for ingredient and diet changes: substitute/add/remove ingredients, adapt it for a diet, change the flavour or technique.",
        "  Examples: 'can you make it dairy free?' -> 'MODIFY: make it dairy-free'; 'swap the cream for coconut milk' -> 'MODIFY: swap the cream for coconut milk'.",
        "",
        `DIFFICULTY: <one of ${DIFFICULTIES.join(" | ")}>`,
        "  — for requests about how HARD the recipe is: simpler, easier, quicker to execute, more advanced, more elaborate, restaurant-level, more of a challenge. Output ONLY the target level, nothing else on the line.",
        `  This recipe is currently ${recipe.difficulty ?? "medium"}. Map the request to the level they want: 'make it easier'/'simpler' -> the level below, 'make it harder'/'more advanced'/'michelin-level' -> the level above. If they name a level directly, use that one.`,
        `  If they ask for the level it is ALREADY at (${recipe.difficulty ?? "medium"}), do not output this line — say so normally instead.`,
        "",
        "These two are exclusive: a request is one or the other, never both. A change to the INGREDIENTS is MODIFY even when it also makes the dish simpler; DIFFICULTY is only for a request about the level of skill or effort itself.",
        "A serving-count change is NEITHER. 'make this for 8' and 'halve it' are answered normally, per the rule above.",
        "",
        "SUBSTITUTION QUESTIONS ARE NOT REQUESTS:",
        "'what can I use instead of buttermilk?', 'is there a substitute for saffron?', 'can I use margarine?' are QUESTIONS. Answer them in prose with the best alternatives and what they cost in flavour or texture. Only a request to actually REWRITE the recipe around a swap ('swap the cream for coconut milk', 'make it with margarine instead') is a MODIFY.",
        "",
        "For ANY other message — questions about the existing recipe, tips, techniques, storage, pairings, whether something is possible — answer normally and NEVER output MODIFY or DIFFICULTY.",
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
 * Turn a buffered sentinel line into the `proposal` frame the client renders.
 *
 * ## It PROPOSES; it does not command
 *
 * The event used to be called `modify`, and the client acted on it the instant
 * it arrived: the turn was suppressed and the reader was moved to a screen
 * watching a paid rewrite of the dish they were reading. That is too much to
 * hang on a classifier — "could this be vegan?" is a question and "is there a
 * vegan version?" is a different question again, and both classify the same way
 * often enough to matter. The frame now describes what the model THINKS was
 * asked for, and the client draws it as an offer in the conversation. A wrong
 * proposal costs a glance; a wrong action cost a generation.
 *
 * ## The legacy `modify` frame
 *
 * Still emitted for the modify intent, and only for it. A client built before
 * this change knows `modify` and not `proposal`, and TestFlight builds are
 * pointed at this deployment — dropping it would take the feature out of every
 * installed copy the moment this ships. Newer clients handle `proposal` and
 * ignore `modify`. Delete this once no build older than 2026-08-20 is in the
 * wild.
 */
function emitProposal(res: Response, buffer: string): void {
    const line = buffer.trim();

    if (/^\s*DIFFICULTY:/i.test(line)) {
        const value = line
            .replace(/^\s*DIFFICULTY:\s*/i, "")
            .trim()
            .toLowerCase();

        const difficulty = DIFFICULTIES.find((level) => level === value);

        // Not one of the three rungs. Nothing is emitted, so the turn reaches
        // the client with neither content nor a proposal — which it already
        // treats as a dead-end turn and offers to retry. Guessing a level from
        // a line the model got wrong is the one outcome worth avoiding: it
        // would propose rewriting the dish at a difficulty nobody asked for.
        if (!difficulty) {
            console.warn(`Unparseable DIFFICULTY sentinel: ${line}`);
            return;
        }

        writeSseEvent(res, {
            type: "proposal",
            data: { intent: "difficulty", difficulty },
        });
        return;
    }

    const instruction = line.replace(/^\s*MODIFY:\s*/i, "").trim();

    if (!instruction) return;

    writeSseEvent(res, {
        type: "proposal",
        data: { intent: "modify", instruction },
    });

    // Compatibility only — see above.
    writeSseEvent(res, { type: "modify", data: { instruction } });
}

/**
 * Recipe-scoped chat. Streams a text answer for questions, or — when the model
 * classifies the turn as a request to change the recipe — emits a single
 * `proposal` event describing what it thinks was asked for, which the client
 * draws as an offer in the conversation rather than acting on.
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

        // Record the turn the user just typed, now that the recipe is known to
        // be readable by them — a prompt recorded before that check would let a
        // caller attach history to a recipe they were then refused, and read its
        // name back out of the history list.
        //
        // Only the LAST user message. The client re-sends the whole transcript
        // on every turn, so recording the array would rewrite the entire
        // conversation into history on each request. Cook-mode questions land
        // here too — same endpoint, same surface, deliberately not split out.
        const latestPrompt = request.messages
            .filter((message) => message.role === "user")
            .at(-1)?.content;

        if (latestPrompt) {
            recordPrompt(req, "recipe_chat", latestPrompt, {
                recipeId,
                conversationId: request.conversationId,
            });
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

        // Buffer the opening tokens until we can tell a change request (either
        // sentinel) from a normal answer, then either stream content or hold
        // back for the proposal event.
        let buffer = "";
        let decided = false;
        let isProposal = false;

        for await (const event of stream) {
            if (event.type === "chunk") {
                if (isProposal) {
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
                        isProposal = SENTINEL.test(buffer);
                        if (!isProposal) {
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
                if (isProposal) {
                    emitProposal(res, buffer);
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
