import { generateEmbedding } from "@fridgeezy/openai";
import {
    ChatRequestSchema,
    chatMessageText,
    type ChatMessage,
    type ToolCall,
} from "@fridgeezy/schemas";
import { logRequestError, stripQuery } from "@fridgeezy/streaming-server";
import type { Request, Response } from "express";

import { TurnTimer } from "../../../../utils/turn-timer";
import { recordPrompt } from "../../../prompts/services";
import type {
    EarlyDish,
    PartialRecipeSuggestion,
    RecipeSuggestionItem,
    RecipeSuggestionResult,
    SearchMetadata,
    SearchUnsatisfied,
    SpeculativeEmbedding,
} from "../../../recipes/services/search-recipe-suggestions";
import {
    attachImageToLastUserMessage,
    buildIntentLine,
    buildUnsatisfiedLine,
    convertToolsToOpenAiTools,
    createChatCompletion,
    describeAttachment,
    emitAttachment,
    endSseStream,
    handleToolCalls,
    initSseStream,
    parseJsonBody,
    readRoutedSearch,
    STAGE_LABEL,
    writeSseEvent,
} from "../../services";
import {
    cacheKeyFor,
    readRoutingCache,
    replayToolCalls,
    writeRoutingCache,
} from "../../services/routing-cache";
import { getRecipeSuggestionsTool, planMenuTool, type MenuPlan } from "../../tools";

/**
 * The name this endpoint reports itself as in the log group. Hard-coded
 * because a mounted Express router only sees its sub-path — this and
 * `POST /rest/recipes/:id/chat` both arrive looking like `/chat`.
 */
const ROUTE = "chat";

/**
 * The model that reads the message and fills in the search arguments.
 *
 * Deliberately NOT `request.model`, which the client sends as `gpt-4o` and which
 * still writes the summary. This call produces nothing the user reads: it is
 * structured extraction against a fixed schema, and it is the first thing on the
 * critical path, so latency IS the quality that matters here — the same
 * reasoning that puts the voice-command classifier on Flash with no thinking
 * budget.
 *
 * **Downgrading it is a behaviour change and it has a guard.** The pinning rules
 * this call implements are subtle and were each written in response to a real
 * failure: `dish` is what stops a green-curry request returning Thai Red Curry,
 * `component` is what stops a Béchamel request returning Lasagne, and `exclude`
 * is what stops a follow-up handing back the card it just showed. Those are
 * exactly the instructions a smaller model drops first. Override with
 * `CHAT_ROUTING_MODEL` and re-run the routing eval before changing the default.
 */
export const ROUTING_MODEL = process.env.CHAT_ROUTING_MODEL || "gpt-4.1-mini";

/**
 * How many conversational messages are sent to the routing call.
 *
 * The client re-sends the whole transcript on every turn, and prompt tokens are
 * prefill latency — a long conversation was making its own routing call slower
 * every turn, forever. The routing model needs enough history to resolve a
 * pronoun and to know what it has already shown, and neither of those reaches
 * back more than a few turns; the summary call gets the same window for the
 * same reason.
 *
 * The system prompt is never counted here — it is prepended after trimming, so
 * it cannot be trimmed away.
 */
const MAX_HISTORY_MESSAGES = 12;

/** Exported so `chat-routing.eval.ts` measures the real prompt, not a copy of it. */
export const SYSTEM_PROMPT = `You are a helpful recipe assistant. When users ask questions about recipes, ingredients, dishes, sauces, cooking methods, or food-related topics, follow this pattern:

1. Call a tool to fetch the data — GET_RECIPE_SUGGESTIONS for a dish, PLAN_MENU for a menu
2. After receiving the tool results, provide a brief conversational summary or additional helpful context

Do NOT write an introductory sentence before calling the tool — the client writes that line itself, from the arguments you pass, so anything you write before the call is discarded.

## Which tool

The question is whether the user is asking for ONE DISH or for a MEAL OF SEVERAL COURSES.

- **PLAN_MENU** — a menu, a dinner party, a feast, a spread, a three-course meal, "something to cook for six people on Saturday", or any request naming several courses at once. The answer is one menu card and the courses are written later, on the menu screen.
- **GET_RECIPE_SUGGESTIONS** — everything else, including every request for a single recipe, a component, or an ingredient question.

Two traps, both of which look like menus and are not:

- A dish that happens to be a whole meal is still ONE dish. "A one-pot dinner", "a traybake for the family", "something hearty for tonight" all take GET_RECIPE_SUGGESTIONS.
- Asking what to serve WITH something is an accompaniment, not a menu: "what sauce goes with apple strudel", "a side for roast chicken" take GET_RECIPE_SUGGESTIONS with \`component\` set. A menu is only when the user wants the WHOLE meal planned.

When in doubt, use GET_RECIPE_SUGGESTIONS. A wrong menu card asks the user to plan a meal they did not want; a wrong recipe card is one dish they can ignore.

Calling PLAN_MENU:
- Set \`courses\` ONLY when the user said which ones they want — "a french menu with a side and dessert" is ["side", "dessert"]. When they did not say, LEAVE IT UNSET: the app then asks them, which is the whole point. Filling it in with a plausible default takes that question away and hands them a course they never chose.
- \`mainQuery\` is what the MAIN should be, and it is required either way. A menu is built around one dish, so "a french menu" with nothing else said still searches for a French main.

Calling GET_RECIPE_SUGGESTIONS:
- The \`query\` must stand on its own. Resolve every pronoun against the conversation first: after suggesting Chicken Parmesan, "what sauce goes with it?" is a search for "sauce for chicken parmesan", never for "it".
- When the user NAMES what they want — "a thai green curry recipe", "how do I make pad thai?", "how do I make a perfect Béchamel" — set \`dish\` to that plain name ("Thai Green Curry", "Pad Thai", "Béchamel"). This pins the answer to the thing they asked for; without it the closest similar row in the catalogue comes back in its place. A named SAUCE, DOUGH, STOCK or other building block counts as a named dish here — "Béchamel" is a name, and naming it is exactly what has to be pinned. Leave \`dish\` unset only when they describe what they want rather than naming it (a cuisine, a course, "something with...", "an apple dessert") — there, similar matches are exactly what they want.
- A BUILDING BLOCK is never answered with a dish that contains it. Set \`component\` whenever the user asks for one, in EITHER shape it arrives in:
  - **Named outright** — "how do I make a perfect Béchamel" is component "sauce", "the best pizza dough" is "dough", "how do you make a roux" is "roux". Set \`component\` to its kind AND set \`dish\` to the name they used. This is the shape that fails silently if you skip it: the nearest match to a sauce is always a dish built on that sauce, so "how do I make a Béchamel" comes back as Lasagne.
  - **As an accompaniment** — "what sauce goes with apple strudel", "a marinade for chicken". Set \`component\` to what they asked for and put the accompanied dish in \`exclude\`: query "sauce for apple strudel", component "sauce", exclude ["apple strudel"].
  Both shapes hold on the very first message, not just on follow-ups.
- Add every dish name you have already shown in this conversation to \`exclude\` as well, so the search cannot hand the same card back a second time.

Always be conversational and friendly in your responses, using the tool results to enhance your answer.`;

/**
 * Steers the closing line, which runs with the tool output in context. This is
 * the only part of the reply that can name the dish — and naming it is what
 * anchors the NEXT turn, since the client sends back plain text history with no
 * tool calls in it, leaving "it" unresolvable otherwise.
 */
const SUMMARY_PROMPT = `The tool results above are the recipe cards the user is about to see. Write the substance of your reply now, in 2-4 sentences of plain prose:

- Name the dish the results contain, so the user knows what you found.
- Say why it answers what they asked.
- Add one genuinely useful note — how it is served, what it goes with, a technique that matters, or what to watch out for.

Never introduce a dish other than the one in the results, never restate the full recipe or its ingredient list, and use no markdown headings, bullets or numbered lists.`;

/**
 * The closing line for a MENU turn.
 *
 * A separate prompt because the thing on screen is different: one card for a
 * whole meal, whose dishes do not exist yet. `SUMMARY_PROMPT` would have the
 * model describe "the recipe" and name a dish the card does not show.
 */
const MENU_SUMMARY_PROMPT = `The tool result above is the menu the user is about to see as a single card. Write the substance of your reply now, in 2-3 sentences of plain prose:

- Say what the menu is and what it is built around, naming the main course if there is one.
- Say why those courses go together.

The other courses have NOT been written yet — the user generates them on the menu screen — so never name or promise a specific appetizer, side or dessert. Use no markdown headings, bullets or numbered lists.`;

/**
 * The same reply, for a menu whose courses the user has NOT chosen yet.
 *
 * The turn ends in a question rather than a statement, and the card underneath
 * it is the way to answer — so the prose has to set that up and then stop.
 * Written as a separate prompt rather than an appended sentence because the
 * whole shape changes: there are no courses to justify, and the closing line is
 * the ask.
 */
const MENU_INQUIRY_PROMPT = `The tool result above is a menu the user is about to see as a single card. They have NOT said which courses they want, so this reply ends by asking. In 2-3 sentences of plain prose:

- Say what the menu is and name the main course it is built around.
- Then ask which courses they would like alongside it, naming the options that appear in the tool result's \`availableCourses\` in plain words (an appetizer, a side, a dessert).

Do not choose for them, do not say what you would recommend, and never name or promise a specific appetizer, side or dessert — none of them have been written. The card below your reply is how they answer, so do not ask them to type anything or list the options as bullets. Use no markdown headings, bullets or numbered lists.`;

/**
 * Keep the tail of the conversation, never the system message.
 *
 * Slicing from the end is what makes this safe: the newest turn is the one being
 * answered, and a dropped turn from ten messages ago costs at worst a pronoun
 * the model resolves from context it can still see.
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
    const system = messages.filter((message) => message.role === "system");
    const rest = messages.filter((message) => message.role !== "system");

    if (rest.length <= MAX_HISTORY_MESSAGES) return messages;

    return [...system, ...rest.slice(-MAX_HISTORY_MESSAGES)];
}

/** Render an early dish as the tool output shape the summary prompt expects. */
function earlyDishAsToolContent(dish: EarlyDish): string {
    return JSON.stringify(
        {
            suggestions: [
                {
                    name: dish.name,
                    description: dish.description,
                    difficulty: dish.difficulty,
                    totalTimeMinutes: dish.totalTimeMinutes ?? null,
                    source: "new_suggestion",
                    ingredients: dish.ingredients.map((name) => ({ name })),
                    tags: dish.tags.map((name) => ({ name })),
                },
            ],
        },
        null,
        2
    );
}

/**
 * Main chat processing use-case.
 *
 * ## The shape of a turn, and why it is not the shape it used to be
 *
 * A turn used to be four model calls in a straight line — route, acknowledge,
 * generate, summarise — with the recipe card written after the last of them.
 * That put the single most useful thing on screen behind every other thing that
 * could possibly be slow, and left a stretch of nine or ten seconds in the
 * middle during which the screen did not change at all.
 *
 * It is now three, and only the ones that produce words run in sequence:
 *
 * 1. **Route** (`ROUTING_MODEL`) — fills in the search arguments. Skipped
 *    entirely on a cache hit; see `routing-cache`.
 * 2. **The opening line** — templated from those arguments, not generated. This
 *    is where a whole model call used to be; see `buildIntentLine`.
 * 3. **Search / generate** — streams the card out FIELD BY FIELD as the
 *    generator writes it, rather than at the end.
 * 4. **Summarise**, started the moment the dish's words are known and running
 *    CONCURRENTLY with persisting it.
 *
 * ## Partials are emitted now, and that reverses a deliberate decision
 *
 * They used to be caught and held: "live partials raced the reply text, so the
 * card and the words arrived together and the turn read as one simultaneous
 * dump; held back, the card is the last thing to animate in."
 *
 * That was right for a turn that resolved in four seconds and wrong for one that
 * takes sixteen. The dish's name is known several seconds before persistence
 * finishes, and holding it back meant the screen showed nothing during the
 * longest part of the wait. The race it was avoiding is fixed by ORDERING rather
 * than by suppression: the opening line is written synchronously here, before
 * generation is even started, so text always precedes the card no matter how
 * fast the generator is.
 *
 * ## The summary can describe a dish that never lands
 *
 * Starting the summary from `onDishReady` means starting it before the
 * authenticity review has passed judgement. A dish dropped as unauthentic
 * therefore leaves a summary describing something the user never sees — but that
 * turn is already a failure by every other measure (the client treats
 * `tool_calls` with no suggestion as a failed turn and offers a retry, discarding
 * the reply), so the prose is discarded with it and never commits to history.
 * Dedup resolving onto a differently-named catalogue row is the softer version:
 * the summary names the dish that was generated and the card names the row it
 * merged into, which by construction is the same dish.
 */
export async function processChat(req: Request, res: Response): Promise<void> {
    const timer = new TurnTimer(ROUTE);

    try {
        // Parse and validate request
        const body = await parseJsonBody(req);
        const request = ChatRequestSchema.parse(body);

        // Record the turn the user just typed. Only the LAST user message: the
        // client re-sends the whole transcript every turn, so recording the
        // array would rewrite the entire conversation into history on each
        // request. Fire-and-forget — it never delays the first token and cannot
        // fail this request.
        const latestPrompt = chatMessageText(
            request.messages.filter((message) => message.role === "user").at(-1)
                ?.content
        );

        if (latestPrompt) {
            recordPrompt(req, "chat", latestPrompt, {
                conversationId: request.conversationId,
            });
        }

        // Initialize SSE stream. This puts headers AND a byte on the wire, so
        // the client's connection opens now rather than whenever the first model
        // call happens to produce something.
        initSseStream(res);
        timer.start("open_to_done");

        /**
         * The query embedding, started before anyone knows what the query is.
         *
         * Stage 1b needs a vector, and computing one is a network round trip
         * that used to sit in the middle of the search — after the routing call
         * had already finished waiting for its own. Started here it overlaps the
         * routing call completely and is usually sitting ready by the time the
         * arguments arrive.
         *
         * The text travels with it because reuse is only sound when the routed
         * query is the same string; see `SpeculativeEmbedding`. `.catch` is
         * attached immediately so a failure here can never surface as an
         * unhandled rejection on a turn that went on to succeed without it.
         */
        const speculativeEmbedding: SpeculativeEmbedding | undefined = latestPrompt
            ? {
                  text: latestPrompt,
                  vector: generateEmbedding(latestPrompt).catch(() => null),
              }
            : undefined;

        // Tools available to the model (in the future this could be dynamic)
        // Two tools, and the routing model picks between them. The difference
        // is a MEAL versus a DISH: a menu is several courses eaten together and
        // ends on the menu screen, a suggestion is one recipe card in the
        // thread. They cannot be collapsed, because the menu one deliberately
        // does not write anything — see `planMenuTool`.
        const tools = {
            GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
            PLAN_MENU: planMenuTool,
        };

        const openaiTools = convertToolsToOpenAiTools(tools);

        /**
         * The caption for the attached photograph — see `describeAttachment`.
         * Started here and written to the stream just before `done`, so it costs
         * the turn no latency it would otherwise not have spent.
         */
        const describing = request.attachment
            ? describeAttachment(request.attachment)
            : null;

        // Add system message if not present
        let messages = trimHistory([...request.messages]);
        if (messages.length === 0 || messages[0].role !== "system") {
            messages = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
        }

        // The photograph goes on the last user turn, and only for this request
        // — it is never part of the transcript the client re-sends.
        if (request.attachment) {
            messages = attachImageToLastUserMessage(messages, request.attachment);
        }

        // Buffers for whatever the search returns. Either shape can land here:
        // an enriched item from the tool result, or nothing at all when a dish
        // was generated and then dropped — which is announced as a withdrawal
        // rather than left as a card that can never be tapped.
        const resultSuggestions: Array<
            RecipeSuggestionItem | PartialRecipeSuggestion
        > = [];
        let resultMetadata: SearchMetadata | null = null;
        /**
         * Why the search came back empty, when it knows. See
         * `SearchUnsatisfied` — a turn carrying one is a turn that ANSWERED the
         * question, and must not be reported as a broken stream.
         *
         * A holder rather than a bare `let`, for the reason spelled out on
         * `resultMenu`: it is written inside a `.then` and read after it, and
         * TypeScript would keep the `null` narrowing across that boundary.
         */
        const resultUnsatisfied: { reason: SearchUnsatisfied | null } = {
            reason: null,
        };

        /**
         * Set instead of `resultSuggestions` when the turn asked for a menu.
         *
         * A holder rather than a bare `let`, because it is written inside a
         * `.then` and read after it: TypeScript keeps the narrowing from the
         * `null` initialiser across that boundary, so every read of a plain
         * variable here would be typed `never` and no property on it would
         * compile. A property read is not narrowed that way.
         */
        const resultMenu: { plan: MenuPlan | null } = { plan: null };

        // Partially-streamed suggestions, keyed by tempId, so a card that
        // streamed in but never enriched can be explicitly withdrawn.
        const partialsByTempId = new Map<string, PartialRecipeSuggestion>();

        // --- 1. Route the request -------------------------------------------

        // A turn carrying a photograph is never cached or served from cache: the
        // key is built from the message TEXT, and "what can I make with this?"
        // routes on the picture rather than on the sentence. Two different
        // photographs under one sentence would otherwise share a decision.
        const cacheKey = request.attachment ? null : cacheKeyFor(request.messages);
        const cached = cacheKey ? readRoutingCache(cacheKey) : null;

        let currentContent = "";
        let currentToolCalls: ToolCall[] | null = null;
        let finishReason = "stop";

        if (cached) {
            timer.count("chat.routing_cache_hit");
            timer.label("routing", "cached");
            currentToolCalls = replayToolCalls(cached, timer.elapsed().toString(36));
        } else {
            timer.label("routing", "model");
            timer.start("route");

            const routingStream = createChatCompletion(messages, openaiTools, {
                stream: request.stream,
                model: ROUTING_MODEL,
                temperature: request.temperature,
            });

            let routingFailed: string | null = null;

            for await (const event of routingStream) {
                if (event.type === "chunk") {
                    // The prompt asks for no preamble, but a model that writes
                    // one anyway should not have it swallowed — it is still the
                    // assistant talking.
                    currentContent += event.delta;
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: event.delta },
                    });
                } else if (event.type === "tool_calls") {
                    currentToolCalls = event.tool_calls;
                } else if (event.type === "error") {
                    routingFailed = event.error;
                    break;
                } else if (event.type === "done") {
                    finishReason = event.finish_reason ?? "stop";
                }
            }

            timer.end("route");
            timer.count("model_calls");

            if (routingFailed) {
                // `generateChatStream` logs the throw but not the endpoint it was
                // serving. Named here so a chat outage is findable by the same
                // query as every other route's.
                logRequestError(new Error(routingFailed), {
                    route: ROUTE,
                    phase: "provider_event",
                    method: req.method,
                    path: stripQuery(req.originalUrl),
                    streaming: true,
                });

                writeSseEvent(res, {
                    type: "error",
                    data: { error: routingFailed },
                });
                endSseStream(res);
                timer.label("outcome", "routing_error");
                timer.emit();

                return;
            }

            if (cacheKey && currentToolCalls?.length) {
                writeRoutingCache(cacheKey, currentToolCalls);
            }
        }

        // --- 2. No tool call: an ordinary prose answer ----------------------

        if (!currentToolCalls?.length) {
            timer.label("outcome", "no_tool");
            // Before `done`, never after — see `emitAttachment`.
            await emitAttachment(res, describing);
            writeSseEvent(res, {
                type: "done",
                data: { finish_reason: finishReason },
            });
            endSseStream(res);
            timer.end("open_to_done");
            timer.emit();

            return;
        }

        writeSseEvent(res, {
            type: "tool_calls",
            data: {
                tool_calls: currentToolCalls.map((call) => ({
                    id: call.id,
                    name: call.function.name,
                })),
            },
        });

        // --- 3. The opening line, written here, at zero cost -----------------

        const routed = readRoutedSearch(currentToolCalls);
        const intentLine = buildIntentLine(routed);

        /**
         * A menu turn answers with ONE card for a whole meal, not a recipe.
         *
         * It shares this whole pipeline — routing, the opening line, the search
         * that resolves the main, the summary, the paint-after-the-prose
         * ordering — and differs only in what the tool returns and which frame
         * carries it. Giving it a second use-case would have duplicated all of
         * that to change two lines of it.
         */
        const isMenuTurn = currentToolCalls.some(
            (call) => call.function.name === "PLAN_MENU"
        );

        timer.label("turn", isMenuTurn ? "menu" : "dish");

        writeSseEvent(res, { type: "content", data: { delta: intentLine } });
        writeSseEvent(res, {
            type: "intent",
            data: {
                text: intentLine,
                dish: routed.dish ?? null,
                component: routed.component ?? null,
            },
        });

        // --- 4. Search and generate -----------------------------------------

        const emitStatus = (stage: string) => {
            const label = STAGE_LABEL[stage];
            if (label) writeSseEvent(res, { type: "status", data: { stage, label } });
        };

        emitStatus("catalogue");

        /**
         * Resolved by `onDishReady` — the generated dish's words, several
         * seconds before its id. `null` when the catalogue answered and nothing
         * was generated, in which case the tool result arrives first anyway.
         */
        let resolveEarlyDish: (dish: EarlyDish) => void = () => undefined;
        const earlyDishReady = new Promise<EarlyDish>((resolve) => {
            resolveEarlyDish = resolve;
        });

        timer.start("search");

        const toolResultsPromise = handleToolCalls(
            currentToolCalls,
            tools,
            // Chat only surfaces a single suggestion; other callers keep the
            // service default of 5. Forward the user's diet/allergies so
            // generated suggestions respect them regardless of what the model
            // asked for.
            {
                GET_RECIPE_SUGGESTIONS: {
                    maxResults: 1,
                    dietaryRestrictions: request.dietaryRestrictions,
                    blacklist: request.blacklist,
                },
            },
            {
                GET_RECIPE_SUGGESTIONS: {
                    /**
                     * Collected, not written. The newest one is flushed once
                     * the prose has stopped moving — see step 7.
                     *
                     * Writing these live is the obvious thing to do and it is
                     * wrong: the generator finishes several seconds before the
                     * summary does, so a live card landed under a paragraph that
                     * was still growing and got shoved down the screen for the
                     * next three seconds. A card that arrives early is worth
                     * nothing if it cannot be read while it arrives.
                     */
                    onPartialSuggestion: (partial: PartialRecipeSuggestion) => {
                        partialsByTempId.set(partial.tempId, partial);
                    },
                    onDishReady: (dish: EarlyDish) => {
                        timer.start("persist");
                        resolveEarlyDish(dish);
                    },
                    onStage: (stage: string) => {
                        if (stage === "generate") timer.start("generate");
                        if (stage === "persist") timer.end("generate");
                        emitStatus(stage);
                    },
                    onMetric: (name: string, value?: number) =>
                        timer.count(name, value),
                    // Context, not an argument: this is a live promise the
                    // service consumes, and the argument layers are for values
                    // the MODEL could have written. Threading it through those
                    // would put it in the search input, where nothing reads it.
                    speculativeEmbedding,
                },
                // The menu tool resolves the main through the same search, so it
                // takes the same narration and the same precomputed vector. It
                // gets no `onPartialSuggestion` or `onDishReady`: a menu turn
                // draws no recipe card, so a half-written dish has nowhere to go.
                PLAN_MENU: {
                    onStage: (stage: string) => emitStatus(stage),
                    onMetric: (name: string, value?: number) =>
                        timer.count(name, value),
                    speculativeEmbedding,
                },
            },
            // A DEFAULT, not an override: the user's saved skill level applies
            // unless they asked for something else in the message, in which case
            // the model sets `difficulty` from that and its value wins.
            {
                GET_RECIPE_SUGGESTIONS: {
                    difficulty: request.difficulty,
                },
            }
        ).then((results) => {
            timer.end("search");
            timer.end("persist");

            return results;
        });

        // Whichever comes first: the dish's words (generation finished, persist
        // still running) or the whole tool result (the catalogue answered, or
        // generation produced nothing).
        //
        // A menu turn never takes the early path. Its summary is about the MEAL,
        // and the only thing an early dish could tell it is the main — so
        // starting on that would have the model write about one course as
        // though it were the answer.
        const early = isMenuTurn
            ? { kind: "tool" as const }
            : await Promise.race([
                  earlyDishReady.then((dish) => ({ kind: "dish" as const, dish })),
                  toolResultsPromise.then(() => ({ kind: "tool" as const })),
              ]);

        // --- 5. Read the tool results -----------------------------------------

        /**
         * True once `parseTask` has settled — i.e. the dish has a real id.
         *
         * Read in step 7 to decide whether an unready card is worth drawing at
         * all: if persistence beat the summary home, the finished card can go
         * straight up and a skeleton would be a single frame of flicker.
         */
        let toolResultsSettled = false;

        const parseTask = toolResultsPromise.then((toolResults) => {
            for (let i = 0; i < toolResults.length; i++) {
                const toolResult = toolResults[i];
                const toolCall = currentToolCalls[i];

                if (toolResult.role !== "tool" || !toolResult.content) continue;

                try {
                    // Tool output crosses a JSON boundary, so this is an
                    // assertion about our own tool, not a validated parse.
                    // Fields are read defensively below.
                    const parsedResult = JSON.parse(
                        chatMessageText(toolResult.content)
                    ) as Partial<RecipeSuggestionResult>;

                    if (
                        toolCall?.function.name === "GET_RECIPE_SUGGESTIONS" &&
                        parsedResult.suggestions
                    ) {
                        resultSuggestions.push(...parsedResult.suggestions);

                        if (parsedResult.searchMetadata) {
                            resultMetadata = parsedResult.searchMetadata;
                        }

                        if (parsedResult.unsatisfied) {
                            resultUnsatisfied.reason = parsedResult.unsatisfied;
                        }
                    }

                    if (toolCall?.function.name === "PLAN_MENU") {
                        const withMenu = parsedResult as { menu?: MenuPlan };

                        if (withMenu.menu) resultMenu.plan = withMenu.menu;
                    }
                } catch {
                    console.warn("[ProcessChat] Failed to parse tool result");
                }
            }

            // Nothing is written here. Every frame this turn produces about a
            // card goes out in step 7, after the prose has settled.
            toolResultsSettled = true;

            return toolResults;
        });

        /**
         * The tool messages that pair with `currentToolCalls`.
         *
         * Every id in an assistant turn's `tool_calls` must be answered by a
         * `tool` message with that id, or the provider rejects the request
         * outright. The routing model is free to emit more than one call, so
         * neither "take the first result" nor "send one synthesised message"
         * is safe on its own — each has to be matched to the shape it is
         * describing, which is what the two branches below do.
         */
        const summaryTurn = (
            source: { early: string } | { results: ChatMessage[] }
        ): ChatMessage[] => {
            // The early path answers exactly one call, so it presents exactly
            // one — the others are still in flight and cannot be reported.
            if ("early" in source) {
                return [
                    {
                        role: "assistant",
                        content: currentContent + intentLine || null,
                        tool_calls: [currentToolCalls[0]],
                    },
                    {
                        role: "tool",
                        tool_call_id: currentToolCalls[0].id,
                        content: source.early,
                    },
                ];
            }

            const answered = source.results.filter(
                (message) => message.role === "tool" && message.tool_call_id
            );

            return [
                {
                    role: "assistant",
                    content: currentContent + intentLine || null,
                    tool_calls: currentToolCalls.filter((call) =>
                        answered.some(
                            (message) => message.tool_call_id === call.id
                        )
                    ),
                },
                ...answered,
            ];
        };

        // --- 6. Summarise, concurrently with whatever is left of persistence --

        const summaryTask = (async () => {
          try {
            let turn: ChatMessage[];

            if (early.kind === "dish") {
                turn = summaryTurn({ early: earlyDishAsToolContent(early.dish) });
                timer.label("summary_start", "early");
            } else {
                // Awaiting `parseTask` rather than `toolResultsPromise`,
                // because it is `parseTask` that fills `resultSuggestions` —
                // chaining off the same promise would work only by relying on
                // the order the two `.then`s were registered in, which is
                // exactly the kind of dependency that survives until someone
                // reorders two lines.
                const toolResults = await parseTask;

                // Nothing to summarise. A turn that produced neither a dish nor
                // a menu is already a failed turn upstream; writing prose about
                // it would give the client something to commit instead of a
                // retry.
                if (resultSuggestions.length === 0 && !resultMenu.plan) {
                    timer.label("summary_start", "skipped");

                    return;
                }

                turn = summaryTurn({ results: toolResults });
                timer.label("summary_start", "after_tool");
            }

            // The client concatenates deltas verbatim, so the break between the
            // opening line and the summary has to be sent.
            writeSseEvent(res, { type: "content", data: { delta: "\n\n" } });
            emitStatus("summary");

            timer.start("summary");

            const summaryStream = createChatCompletion(
                [
                    ...messages,
                    ...turn,
                    {
                        role: "system",
                        content: !isMenuTurn
                            ? SUMMARY_PROMPT
                            : // Empty courses is the question, not a failure —
                              // see `MenuPlan.courses`.
                              resultMenu.plan?.courses.length
                              ? MENU_SUMMARY_PROMPT
                              : MENU_INQUIRY_PROMPT,
                    },
                ],
                [],
                {
                    stream: request.stream,
                    model: request.model,
                    temperature: request.temperature,
                }
            );

            for await (const summaryEvent of summaryStream) {
                if (summaryEvent.type === "chunk") {
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: summaryEvent.delta },
                    });
                }
            }

            timer.end("summary");
            timer.count("model_calls");
          } catch (error) {
            // The prose is the least important half of this turn. A summary
            // that fell over must not take the card down with it — and the
            // card is gated on this task finishing, so a rejection here would
            // have held it back forever.
            logRequestError(error, {
                route: ROUTE,
                phase: "mid_stream",
                method: req.method,
                path: stripQuery(req.originalUrl),
                streaming: true,
                detail: { stage: "summary" },
            });

            timer.label("summary_outcome", "failed");
          }
        })();

        // --- 7. Paint the card, once the prose has stopped moving -------------
        //
        // ## Order on the wire IS the layout
        //
        // A chat bubble is prose with a card under it, so anything written into
        // the text after the card exists pushes the card down the screen. The
        // generator finishes several seconds before the summary does, so a card
        // emitted when it was ready landed under a paragraph that was still
        // growing and got shoved downward for the next three seconds — arriving
        // early is worth nothing if it cannot be read while it arrives.
        //
        // So the whole turn reads: line, summary, unready card, ready card. The
        // card still arrives far earlier than it used to, but that comes from
        // summarising and persisting CONCURRENTLY (step 6), not from racing the
        // card against the words.
        //
        // This is a partial reversal of the 2026-08-22 change that started
        // streaming partials live, and it restores the ordering the original
        // buffering was protecting — "held back, the card is the last thing to
        // animate in" was right about the order and wrong only about how long
        // the reader should wait for it.
        await summaryTask;

        /**
         * The unready card: everything the generator wrote, before it has an id.
         *
         * Skipped when persistence already finished, because then the real card
         * is one await away and a skeleton would be a single frame of flicker
         * rather than a state anybody perceives.
         */
        if (!toolResultsSettled) {
            for (const partial of partialsByTempId.values()) {
                writeSseEvent(res, { type: "suggestion", data: partial });
            }

            if (partialsByTempId.size > 0) timer.count("suggestion.partial_shown");
        }

        await parseTask;

        // ONE card for the whole meal. A menu turn emits no `suggestion` at
        // all: the courses do not exist yet, and a recipe card beside the menu
        // would offer a dish the menu is not built from.
        if (resultMenu.plan) {
            writeSseEvent(res, { type: "menu", data: resultMenu.plan });
        }

        // The ready card. Shares its `tempId` with the partial above, so the
        // client upgrades that card in place rather than adding a second one.
        for (const suggestion of resultSuggestions) {
            writeSseEvent(res, { type: "suggestion", data: suggestion });
        }

        /**
         * A dish that was written and then went nowhere.
         *
         * The generator can be overruled after the fact — the authenticity
         * review drops it, dedup folds it into a sibling, the write fails.
         * Saying so explicitly is the difference between a card that disappears
         * for no reason and one the client can remove deliberately; the same
         * `withdrawn` vocabulary the menu composer uses for a course it will not
         * fill. It matters even though the partial is only drawn a moment
         * earlier: without it, that moment lasts for the rest of the session.
         */
        for (const tempId of partialsByTempId.keys()) {
            const enriched = resultSuggestions.some(
                (item) => item.tempId === tempId
            );

            if (!enriched) {
                writeSseEvent(res, { type: "withdrawn", data: { tempId } });
                timer.count("suggestion.withdrawn");
            }
        }

        /**
         * The turn has nothing to offer, and says so.
         *
         * Written after the cards rather than before, for the same reason they
         * are written after the prose: this IS the reply's last paragraph, and
         * there is nothing above it to push down (the summary is skipped on this
         * path — there was no dish to summarise).
         *
         * Two frames, deliberately. The sentence goes out as `content` so a
         * client that has never heard of `unsatisfied` still renders a complete
         * reply; the frame is what tells a client that HAS heard of it that this
         * turn is finished and correct, so it commits the exchange instead of
         * offering to regenerate a request the server has just explained cannot
         * be answered.
         */
        const unsatisfied = resultUnsatisfied.reason;

        if (unsatisfied && resultSuggestions.length === 0) {
            writeSseEvent(res, {
                type: "content",
                data: {
                    delta: `\n\n${buildUnsatisfiedLine(unsatisfied.reason, routed)}`,
                },
            });
            writeSseEvent(res, { type: "unsatisfied", data: unsatisfied });
        }

        if (resultMetadata) {
            writeSseEvent(res, { type: "metadata", data: resultMetadata });
        }

        timer.label(
            "outcome",
            resultMenu.plan
                ? resultMenu.plan.courses.length
                    ? "menu"
                    : "menu_inquiry"
                : resultSuggestions.length > 0
                  ? "suggested"
                  : unsatisfied
                    ? `unsatisfied_${unsatisfied.reason}`
                    : "empty"
        );
        timer.count("suggestions", resultSuggestions.length);

        // Before `done`, never after — see `emitAttachment`.
        await emitAttachment(res, describing);

        writeSseEvent(res, { type: "done", data: { finish_reason: "stop" } });

        timer.end("open_to_done");

        // Emitted before `end` so a client watching the stream can read it, and
        // logged either way. Unknown frame types are ignored by every client the
        // app has ever shipped, so this is additive on the wire.
        writeSseEvent(res, { type: "metrics", data: timer.emit() });

        endSseStream(res);
    } catch (error) {
        logRequestError(error, {
            route: ROUTE,
            phase: res.headersSent ? "mid_stream" : "pre_stream",
            method: req.method,
            path: stripQuery(req.originalUrl),
            streaming: true,
        });

        // Try to send error via SSE if headers not sent
        if (!res.headersSent) {
            initSseStream(res);
        }

        writeSseEvent(res, {
            type: "error",
            data: {
                error: error instanceof Error ? error.message : "Unknown error",
            },
        });

        timer.label("outcome", "exception");
        timer.emit();

        endSseStream(res);
    }
}
