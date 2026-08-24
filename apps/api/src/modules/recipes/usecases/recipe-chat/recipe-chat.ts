import { ChatRequestSchema, GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import {
    logRequestAnomaly,
    logRequestError,
    stripQuery,
} from "@fridgeezy/streaming-server";
import { canonicalizeName } from "@fridgeezy/toolkit";
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
 * Three, and none of them is interchangeable with another — each routes to a
 * different endpoint, because "change this recipe" is three different requests
 * wearing one sentence:
 *
 * - `MODIFY` -> `/recipes/modify`, which writes a new version of the SAME dish
 *   and pins its name, tags and difficulty to the source.
 * - `DIFFICULTY` -> `/recipes/difficulty/escalate`. A bug fix rather than a new
 *   capability: the prompt has always listed "change the difficulty" as a
 *   modification, but `modify-recipe` pins `difficulty` in both its prompt and
 *   its stream `initialState` — so "make this easier" wrote a variant labelled
 *   "Easier" at *exactly the same difficulty*.
 * - `NEWDISH` -> the dish is resolved by name (`/suggestions/resolve`) and
 *   written as a recipe of its own. Adding cheese to a béchamel does not give
 *   you a cheesy béchamel, it gives you a Mornay — and routing that through
 *   `modify` produced a row still called *Béchamel*, labelled "Cheese", carrying
 *   a `base_recipe_id` that hides it from every search surface in the app. A
 *   dish with its own name is not a version of something else.
 *
 * They are matched as one alternation so the buffered decision below stays a
 * single test: the opening tokens are held back only until we can tell any
 * sentinel from the start of an ordinary answer.
 *
 * `NEWDISH`, not `NEW`: eight characters that cannot begin an ordinary answer,
 * where a bare `NEW:` is one dropped space away from a sentence about a new
 * pan. It still fits inside DECISION_MIN_CHARS, so nothing below moves.
 */
const SENTINEL = /^\s*(MODIFY|DIFFICULTY|NEWDISH):/i;

/**
 * The name this endpoint reports itself as in the log group.
 *
 * Hard-coded rather than read off `req.url`, because Express hands a mounted
 * router only its sub-path: this route and `POST /rest/chat` both arrive
 * looking like `/chat`, and they are different features with different
 * failure modes.
 */
const ROUTE = "recipes.chat";

/** The three rungs `escalate-difficulty` writes. Anything else is not one. */
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Enough characters to tell "DIFFICULTY:" — the longest of the three — apart
// from the start of a normal answer. `NEWDISH:` is shorter and so is decided by
// the same threshold with room to spare; anything longer added here has to move
// this number with it.
const DECISION_MIN_CHARS = 11;

/**
 * System prompt scoping the chat to one recipe and defining the three
 * change-request classifications. The sentinels are an internal signal — this
 * endpoint parses the line and emits a structured `proposal` event, so the
 * client never sees one.
 *
 * The three are listed in DECISION ORDER, not in order of importance:
 * `NEWDISH` first, because it is the only question whose answer changes what
 * the other two mean. "Add cheese" is a modification right up until you notice
 * that the result is a dish with its own name.
 *
 * Exported for `chat-intent.eval.ts`, which sends the real prompt rather than a
 * paraphrase of it — a copy in the eval would drift and then measure itself.
 */
export const buildRecipeChatPrompt = (
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
        "If the user asks you to CHANGE this recipe, do NOT answer, explain, or list ingredients. Reply with EXACTLY one line and nothing else, choosing the line that matches what they asked for:",
        "",
        "NEWDISH: <the established name of the dish it becomes>",
        "  — when the change turns this into a DIFFERENT DISH that is known by its own name. Béchamel plus cheese is a Mornay sauce. Velouté finished with egg yolks and cream is an Allemande. Leftover risotto rolled and fried is Arancini. Tomato sauce plus cream and vodka is a Vodka Sauce. The result is not a version of this recipe — it is another dish, and it gets a recipe of its own.",
        "  Output ONLY the dish's name on that line, spelled the way a cook writes it. No explanation, no quotes, no ingredients.",
        "  Use this ONLY when you can name the result with a name people genuinely use for it. NEVER invent a name and never describe one: 'Béchamel with Cheese', 'Cheesy White Sauce', 'Spiced Béchamel' and 'Béchamel Soup' are all descriptions, not dishes. If you cannot name it, it is a MODIFY.",
        `  And if the name you would write is this recipe's own name (${recipe.name}), it is not a new dish — use MODIFY.`,
        "",
        "MODIFY: <a short imperative instruction capturing the change>",
        "  — for ingredient and diet changes that leave it the SAME dish: substitute/add/remove ingredients, adapt it for a diet, change the flavour or technique.",
        "  Examples: 'can you make it dairy free?' -> 'MODIFY: make it dairy-free'; 'swap the cream for coconut milk' -> 'MODIFY: swap the cream for coconut milk'.",
        "  A dietary adaptation is almost never a new dish — vegan lasagne is still lasagne, and gluten-free banana bread is still banana bread.",
        "",
        `DIFFICULTY: <one of ${DIFFICULTIES.join(" | ")}>`,
        "  — for requests about how HARD the recipe is: simpler, easier, quicker to execute, more advanced, more elaborate, restaurant-level, more of a challenge.",
        "  Write the line EXACTLY as shown: the word DIFFICULTY, a colon, then the target level and nothing after it. The label is not optional — a line containing only the level is not a valid answer.",
        `  This recipe is currently ${recipe.difficulty ?? "medium"}. Map the request to the level they want: 'make it easier'/'simpler' -> the level below, 'make it harder'/'more advanced'/'michelin-level' -> the level above. If they name a level directly, use that one.`,
        `  If they ask for the level it is ALREADY at (${recipe.difficulty ?? "medium"}), do not output this line — say so normally instead.`,
        "",
        "These three are exclusive — a request is exactly one of them. Decide in this order:",
        "  1. Does what they asked for produce a dish that has its own established name? -> NEWDISH",
        "  2. Is the request about how hard, quick or elaborate the recipe is? -> DIFFICULTY",
        "  3. Does it otherwise change what goes in or how it is cooked? -> MODIFY",
        "A change to the INGREDIENTS is MODIFY even when it also makes the dish simpler; DIFFICULTY is only for a request about the level of skill or effort itself.",
        "A serving-count change is NONE of them. 'make this for 8' and 'halve it' are answered normally, per the rule above.",
        "",
        "QUESTIONS ABOUT A CHANGE ARE NOT REQUESTS FOR IT:",
        "'what happens if I add cheese?', 'would that still be the same dish?', 'what's it called if I do that?' are QUESTIONS. Answer them in prose — name the dish it would become and say what changes — and output no line. Only an instruction to actually make it ('add cheese', 'can you add cheese to this?', 'turn this into a mornay') is a NEWDISH.",
        "",
        "SUBSTITUTION QUESTIONS ARE NOT REQUESTS:",
        "'what can I use instead of buttermilk?', 'is there a substitute for saffron?', 'can I use margarine?' are QUESTIONS. Answer them in prose with the best alternatives and what they cost in flavour or texture. Only a request to actually REWRITE the recipe around a swap ('swap the cream for coconut milk', 'make it with margarine instead') is a MODIFY.",
        "",
        "For ANY other message — questions about the existing recipe, tips, techniques, storage, pairings, whether something is possible — answer normally and NEVER output NEWDISH, MODIFY or DIFFICULTY.",
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
 *
 * **`newDish` deliberately has no such shim, and must not be given one.** The
 * only frame an old client would understand is `modify`, and a modify is
 * exactly what this intent exists to stop: it would write the Mornay as a
 * hidden, misnamed variant of the béchamel — the bug — on the clients least
 * able to report it. An old build reaching this branch gets a turn with no
 * usable frame, which it already draws as "something went wrong, retry". A
 * dead end beats a wrong paid action.
 */
function emitProposal(
    res: Response,
    buffer: string,
    req: Request,
    recipe: GenerateRecipeResponseDto
): boolean {
    const line = buffer.trim();

    if (/^\s*NEWDISH:/i.test(line)) {
        const dish = line.replace(/^\s*NEWDISH:\s*/i, "").trim();

        // Same dead end as the two below, and the likeliest of the three to be
        // reached: this sentinel is the only one whose payload is free text the
        // model has to come up with rather than pick off a list.
        if (!dish) {
            logRequestAnomaly("empty_newdish_name", {
                route: ROUTE,
                phase: "mid_stream",
                method: req.method,
                path: stripQuery(req.originalUrl),
                streaming: true,
            });
            return false;
        }

        // The dish it "becomes" is the dish they are already reading.
        //
        // The prompt says not to do this, but a classifier is not a guarantee
        // and the cost of believing it is specific: the client would resolve
        // the name, `findKnownDish` would answer with THIS recipe at step 0,
        // and the reader would be navigated to the page they are sitting on
        // and told it was something new. A dead-end turn, which the client
        // already draws as a retry, is the better failure.
        //
        // Canonicalised on both sides — the same comparison `findKnownDish`
        // makes — so "bechamel" does not slip past "Béchamel".
        if (
            canonicalizeName(dish) === canonicalizeName(recipe.name) ||
            (recipe.nameEn && canonicalizeName(dish) === canonicalizeName(recipe.nameEn))
        ) {
            logRequestAnomaly("newdish_names_source_recipe", {
                route: ROUTE,
                phase: "mid_stream",
                method: req.method,
                path: stripQuery(req.originalUrl),
                streaming: true,
                detail: { dish, recipeName: recipe.name },
            });
            return false;
        }

        writeSseEvent(res, {
            type: "proposal",
            data: { intent: "newDish", dish },
        });
        return true;
    }

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
            // WARN, not ERROR: nothing crashed, the model just answered off its
            // own menu. It is logged at all because the turn now ends having
            // emitted nothing, and a silent dead end is indistinguishable from
            // a broken endpoint on the client and invisible in the log group.
            logRequestAnomaly("unparseable_difficulty_sentinel", {
                route: ROUTE,
                phase: "mid_stream",
                method: req.method,
                path: stripQuery(req.originalUrl),
                streaming: true,
                detail: { sentinel: line.slice(0, 120) },
            });
            return false;
        }

        writeSseEvent(res, {
            type: "proposal",
            data: { intent: "difficulty", difficulty },
        });
        return true;
    }

    const instruction = line.replace(/^\s*MODIFY:\s*/i, "").trim();

    // A bare `MODIFY:` with nothing behind it. Same dead end as above, and it
    // was the more likely of the two to happen unseen — this branch returned
    // without so much as a warn.
    if (!instruction) {
        logRequestAnomaly("empty_modify_instruction", {
            route: ROUTE,
            phase: "mid_stream",
            method: req.method,
            path: stripQuery(req.originalUrl),
            streaming: true,
        });
        return false;
    }

    writeSseEvent(res, {
        type: "proposal",
        data: { intent: "modify", instruction },
    });

    // Compatibility only — see above.
    writeSseEvent(res, { type: "modify", data: { instruction } });

    return true;
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
            // Absence and refusal are one frame to the caller on purpose, but
            // they are two different things to us and the log says which:
            // "gone" is a stale client, "refused" is somebody probing ids.
            logRequestAnomaly(
                recipe ? "recipe_not_readable" : "recipe_not_found",
                {
                    route: ROUTE,
                    phase: "pre_stream",
                    method: req.method,
                    path: stripQuery(req.originalUrl),
                    streaming: true,
                    detail: { recipeId },
                }
            );

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

        // Whether this turn put anything usable on the wire — a token of an
        // answer, or a proposal. A turn that ends with neither is the dead end
        // the client draws as "something went wrong", and until now it was the
        // one failure this endpoint could produce while logging absolutely
        // nothing: no throw, no provider error, a clean 200.
        let produced = false;

        // Whether a specific cause has already been written for this turn. The
        // empty-turn line below is a catch-all for "ended with nothing and we
        // cannot say why"; a provider error is not that, and logging both would
        // double-count one failure in any metric filter counting either.
        let reported = false;

        for await (const event of stream) {
            if (event.type === "chunk") {
                if (isProposal) {
                    buffer += event.delta;
                } else if (decided) {
                    produced = true;
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
                            produced = true;
                            writeSseEvent(res, {
                                type: "content",
                                data: { delta: buffer },
                            });
                            buffer = "";
                        }
                    }
                }
            } else if (event.type === "error") {
                // `generateChatStream` already writes its own line, but it does
                // not know which endpoint it was serving — during the
                // 2026-08-21 quota outage that was precisely what made its logs
                // nearly useless. Classified and named here so the same Logs
                // Insights query that finds a `createStreamHandler` failure
                // finds this one, with the route and the dish on it.
                reported = true;
                logRequestError(new Error(event.error), {
                    route: ROUTE,
                    phase: "provider_event",
                    method: req.method,
                    path: stripQuery(req.originalUrl),
                    streaming: true,
                    detail: { recipeId },
                });

                writeSseEvent(res, {
                    type: "error",
                    data: { error: event.error },
                });
                break;
            } else if (event.type === "done") {
                if (isProposal) {
                    const emitted = emitProposal(res, buffer, req, recipe);
                    // A false here means `emitProposal` already named the
                    // reason — an unparseable level, or a bare `MODIFY:`.
                    reported = reported || !emitted;
                    produced = emitted || produced;
                } else if (buffer) {
                    produced = true;
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

        // The turn is over and nothing came of it, with nothing further up
        // having said why — the model streamed zero usable tokens, or ended
        // without ever crossing the decision threshold. This is the case that
        // reaches the user as "something went wrong" and, until now, reached
        // the log group as a clean 200 with no line at all.
        if (!produced && !reported) {
            logRequestAnomaly("empty_turn", {
                route: ROUTE,
                phase: "post_stream",
                method: req.method,
                path: stripQuery(req.originalUrl),
                streaming: true,
                detail: { recipeId, decided, isProposal },
            });
        }

        endSseStream(res);
    } catch (error) {
        logRequestError(error, {
            route: ROUTE,
            phase: res.headersSent ? "mid_stream" : "pre_stream",
            method: req.method,
            path: stripQuery(req.originalUrl),
            streaming: true,
        });

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
