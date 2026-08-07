import { ChatRequestSchema, type ToolCall } from "@fridgeezy/schemas";
import type { Request, Response } from "express";

import type {
    PartialRecipeSuggestion,
    RecipeSuggestionItem,
    RecipeSuggestionResult,
    SearchMetadata,
} from "../../../recipes/services/search-recipe-suggestions";
import {
    convertToolsToOpenAiTools,
    createChatCompletion,
    endSseStream,
    handleToolCalls,
    initSseStream,
    parseJsonBody,
    writeSseEvent,
} from "../../services";
import { getRecipeSuggestionsTool } from "../../tools";

const SYSTEM_PROMPT = `You are a helpful recipe assistant. When users ask questions about recipes, ingredients, dishes, sauces, cooking methods, or food-related topics, follow this pattern:

1. Start with a brief, friendly conversational response to acknowledge their question
2. Use the GET_RECIPE_SUGGESTIONS tool to fetch relevant recipe data based on their query
3. After receiving the tool results, provide a brief conversational summary or additional helpful context

Calling the tool:
- The \`query\` must stand on its own. Resolve every pronoun against the conversation first: after suggesting Chicken Parmesan, "what sauce goes with it?" is a search for "sauce for chicken parmesan", never for "it".
- When the user asks for something that goes WITH a dish — a sauce, a marinade, a glaze, a dressing — they are asking for that COMPONENT, and the dish itself is never the answer. Set \`component\` to what they asked for and put the accompanied dish in \`exclude\`. "What sauce goes with apple strudel" is query "sauce for apple strudel", component "sauce", exclude ["apple strudel"]. This holds on the very first message, not just on follow-ups.
- Add every dish name you have already shown in this conversation to \`exclude\` as well, so the search cannot hand the same card back a second time.

Always be conversational and friendly in your responses, using the tool results to enhance your answer.`;

/**
 * Steers the acknowledgement that streams WHILE the tool runs. It is generated
 * from the history alone — the results do not exist yet — so left unsteered the
 * model wrote the summary it was in no position to write ("here's a sauce that
 * goes with it") and the card that arrived afterwards contradicted it.
 */
const ACKNOWLEDGEMENT_PROMPT = `You have just called a recipe search tool and the results have NOT arrived yet. Reply with ONE short sentence acknowledging the request and nothing else — the substance of the answer comes afterwards, once the results are in. Do NOT name, describe, or promise any specific dish, ingredient or recipe, and do NOT claim anything about what the search found: you cannot see it.`;

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
 * Main chat processing use-case
 * Handles streaming chat with tool calls
 */
export async function processChat(req: Request, res: Response): Promise<void> {
    try {
        // Parse and validate request
        const body = await parseJsonBody(req);
        const request = ChatRequestSchema.parse(body);

        // Initialize SSE stream
        initSseStream(res);

        // Tools available to the model (in the future this could be dynamic)
        const tools = {
            GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
        };

        const openaiTools = convertToolsToOpenAiTools(tools);

        // Add system message if not present
        let messages = [...request.messages];
        if (messages.length === 0 || messages[0].role !== "system") {
            messages = [
                { role: "system", content: SYSTEM_PROMPT },
                ...messages,
            ];
        }

        let continueLoop = true;

        const maxIterations = 10; // Prevent infinite loops

        let iteration = 0;

        // Buffer suggestion/metadata events so they emit after content
        // Either shape can land here: an enriched item from the tool result, or
        // a partial promoted below when generation failed after its card
        // streamed. Both render as a card; only the enriched one has an id.
        const bufferedSuggestions: Array<
            RecipeSuggestionItem | PartialRecipeSuggestion
        > = [];
        let bufferedMetadata: SearchMetadata | null = null;

        // Partially-streamed suggestions, keyed by tempId. Only used as a
        // fallback: an enriched result normally supersedes its partial, but
        // generation can fail after the card has streamed, and emitting the
        // partial keeps that turn showing a dish instead of nothing.
        const partialsByTempId = new Map<string, PartialRecipeSuggestion>();

        while (continueLoop && iteration < maxIterations) {
            iteration++;

            // Create chat completion stream
            const stream = createChatCompletion(messages, openaiTools, {
                stream: request.stream,
                model: request.model,
                temperature: request.temperature,
            });

            let currentContent = "";
            let currentToolCalls: ToolCall[] | null = null;

            for await (const event of stream) {
                if (event.type === "chunk") {
                    // Stream content to client
                    currentContent += event.delta;
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: event.delta },
                    });
                } else if (event.type === "tool_calls") {
                    // Store tool calls for execution
                    currentToolCalls = event.tool_calls;
                } else if (event.type === "error") {
                    // Handle errors
                    writeSseEvent(res, {
                        type: "error",
                        data: { error: event.error },
                    });
                    continueLoop = false;
                    break;
                } else if (event.type === "done") {
                    // Check if we need to execute tool calls
                    if (
                        event.finish_reason === "tool_calls" &&
                        currentToolCalls
                    ) {
                        // Notify client about tool calls
                        writeSseEvent(res, {
                            type: "tool_calls",
                            data: {
                                tool_calls: currentToolCalls.map((tc) => ({
                                    id: tc.id,
                                    name: tc.function.name,
                                })),
                            },
                        });

                        // Run tool execution in background while we stream content
                        const toolResultsPromise = handleToolCalls(
                            currentToolCalls,
                            tools,
                            // Chat only surfaces a single suggestion; other
                            // callers keep the service default of 5. Forward the
                            // user's diet/allergies so generated suggestions
                            // respect them regardless of what the model asked for.
                            {
                                GET_RECIPE_SUGGESTIONS: {
                                    maxResults: 1,
                                    dietaryRestrictions:
                                        request.dietaryRestrictions,
                                    blacklist: request.blacklist,
                                },
                            },
                            {
                                // Keep the LAST partial per suggestion rather
                                // than writing each one out as it lands. Live
                                // partials raced the reply text, so the card
                                // and the words arrived together and the turn
                                // read as one simultaneous dump; held back, the
                                // card is the last thing to animate in. The
                                // callback still has to be PASSED, though — its
                                // presence is what selects single-suggestion
                                // generation over the JSONL batch generator.
                                GET_RECIPE_SUGGESTIONS: {
                                    onPartialSuggestion: (
                                        partial: PartialRecipeSuggestion
                                    ) => {
                                        partialsByTempId.set(
                                            partial.tempId,
                                            partial
                                        );
                                    },
                                },
                            },
                            // A DEFAULT, not an override: the user's saved skill
                            // level applies unless they asked for something else
                            // in the message, in which case the model sets
                            // `difficulty` from that and its value wins. Before
                            // this, nothing carried the preference into chat at
                            // all and the generator picked for itself.
                            {
                                GET_RECIPE_SUGGESTIONS: {
                                    difficulty: request.difficulty,
                                },
                            }
                        );

                        // Stream an acknowledgement in parallel (no tools) so the
                        // user sees words while the search runs. It cannot see
                        // the results, hence ACKNOWLEDGEMENT_PROMPT — the
                        // grounded half of the reply is the summary below.
                        const contentStream = createChatCompletion(
                            [
                                // `messages` still holds only the history here —
                                // the assistant turn is appended once this
                                // stream's text is known, below.
                                ...messages,
                                {
                                    role: "system",
                                    content: ACKNOWLEDGEMENT_PROMPT,
                                },
                            ],
                            [],
                            {
                                stream: request.stream,
                                model: request.model,
                                temperature: request.temperature,
                            }
                        );

                        let acknowledgement = "";

                        for await (const contentEvent of contentStream) {
                            if (contentEvent.type === "chunk") {
                                acknowledgement += contentEvent.delta;
                                writeSseEvent(res, {
                                    type: "content",
                                    data: { delta: contentEvent.delta },
                                });
                            }
                        }

                        // Add the assistant turn to history now that both halves
                        // of it are known: the text the user has already seen,
                        // plus the tool calls it made.
                        messages.push({
                            role: "assistant",
                            content: currentContent + acknowledgement || null,
                            tool_calls: currentToolCalls,
                        });

                        // Await tool results (may already be resolved)
                        const toolResults = await toolResultsPromise;

                        messages.push(...toolResults);

                        // Buffer suggestions from tool results
                        for (let i = 0; i < toolResults.length; i++) {
                            const toolResult = toolResults[i];
                            const toolCall = currentToolCalls[i];

                            if (
                                toolResult.role === "tool" &&
                                toolResult.content
                            ) {
                                try {
                                    // Tool output crosses a JSON boundary, so
                                    // this is an assertion about our own tool,
                                    // not a validated parse. Fields are read
                                    // defensively below.
                                    const parsedResult = JSON.parse(
                                        toolResult.content
                                    ) as Partial<RecipeSuggestionResult>;

                                    if (
                                        toolCall?.function.name ===
                                            "GET_RECIPE_SUGGESTIONS" &&
                                        parsedResult.suggestions
                                    ) {
                                        for (const suggestion of parsedResult.suggestions) {
                                            bufferedSuggestions.push(
                                                suggestion
                                            );
                                        }

                                        if (parsedResult.searchMetadata) {
                                            bufferedMetadata =
                                                parsedResult.searchMetadata;
                                        }
                                    }
                                } catch {
                                    console.warn(
                                        "[ProcessChat] Failed to parse tool result"
                                    );
                                }
                            }
                        }

                        // Done — no further iterations needed
                        continueLoop = false;

                        // Any suggestion that streamed but never came back
                        // enriched — generation failed after the card existed.
                        for (const [tempId, partial] of partialsByTempId) {
                            const enriched = bufferedSuggestions.some(
                                (item) => item.tempId === tempId
                            );

                            if (!enriched) bufferedSuggestions.push(partial);
                        }

                        // Close the turn with a line written WITH the tool
                        // output in context. Without it the reply was only ever
                        // the blind acknowledgement, so it could contradict the
                        // card beside it and never named the dish — which left
                        // the next turn's "it" pointing at nothing, since the
                        // client replays plain text history only.
                        if (bufferedSuggestions.length > 0) {
                            // The client concatenates deltas verbatim, so the
                            // break between the two halves has to be sent.
                            if (acknowledgement) {
                                writeSseEvent(res, {
                                    type: "content",
                                    data: { delta: "\n\n" },
                                });
                            }

                            const summaryStream = createChatCompletion(
                                [
                                    ...messages,
                                    {
                                        role: "system",
                                        content: SUMMARY_PROMPT,
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
                        }

                        // The card goes last, once every word of the reply has
                        // landed, so it reads as the answer arriving rather
                        // than as part of one simultaneous dump. The skeleton
                        // the `tool_calls` frame put up holds its place until
                        // then.
                        for (const suggestion of bufferedSuggestions) {
                            writeSseEvent(res, {
                                type: "suggestion",
                                data: suggestion,
                            });
                        }
                        if (bufferedMetadata) {
                            writeSseEvent(res, {
                                type: "metadata",
                                data: bufferedMetadata,
                            });
                        }

                        writeSseEvent(res, {
                            type: "done",
                            data: { finish_reason: "stop" },
                        });
                    } else {
                        // No tool calls — we're done
                        continueLoop = false;

                        // Flush buffered suggestions/metadata after content
                        for (const suggestion of bufferedSuggestions) {
                            writeSseEvent(res, {
                                type: "suggestion",
                                data: suggestion,
                            });
                        }
                        if (bufferedMetadata) {
                            writeSseEvent(res, {
                                type: "metadata",
                                data: bufferedMetadata,
                            });
                        }

                        writeSseEvent(res, {
                            type: "done",
                            data: { finish_reason: event.finish_reason },
                        });
                    }
                }
            }
        }

        if (iteration >= maxIterations) {
            writeSseEvent(res, {
                type: "error",
                data: { error: "Max iterations reached" },
            });
        }

        endSseStream(res);
    } catch (error) {
        console.error("[ProcessChat] Error:", error);

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

        endSseStream(res);
    }
}
