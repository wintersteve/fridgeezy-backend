import { ChatRequestSchema } from "@fridgeezy/schemas";
import type { Request, Response } from "express";

import { getRecipeSuggestionsTool } from "../../../mcp/tools";
import type { PartialRecipeSuggestion } from "../../../recipes/services/search-recipe-suggestions";
import {
    convertMcpToolsToOpenAiTools,
    createChatCompletion,
    endSseStream,
    handleToolCalls,
    initSseStream,
    parseJsonBody,
    writeSseEvent,
} from "../../services";

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

        // Get MCP tools (in the future this could be dynamic)
        const mcpTools = {
            GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
        };

        // Convert MCP tools to OpenAI format
        const openaiTools = convertMcpToolsToOpenAiTools(mcpTools);

        // Add system message if not present
        let messages = [...request.messages];
        if (messages.length === 0 || messages[0].role !== "system") {
            messages = [
                {
                    role: "system",
                    content:
                        "You are a helpful recipe assistant. When users ask questions about recipes, ingredients, dishes, sauces, cooking methods, or food-related topics, follow this pattern:\n\n1. Start with a brief, friendly conversational response to acknowledge their question\n2. Use the GET_RECIPE_SUGGESTIONS tool to fetch relevant recipe data based on their query\n3. After receiving the tool results, provide a brief conversational summary or additional helpful context\n\nAlways be conversational and friendly in your responses, using the tool results to enhance your answer.",
                },
                ...messages,
            ];
        }

        let continueLoop = true;

        const maxIterations = 10; // Prevent infinite loops

        let iteration = 0;

        // Buffer suggestion/metadata events so they emit after content
        const bufferedSuggestions: Array<any> = [];
        let bufferedMetadata: any = null;

        while (continueLoop && iteration < maxIterations) {
            iteration++;

            // Create chat completion stream
            const stream = createChatCompletion(messages, openaiTools, {
                stream: request.stream,
                model: request.model,
                temperature: request.temperature,
            });

            let currentContent = "";
            let currentToolCalls: any[] | null = null;

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
                        // Snapshot messages before mutating for the parallel content call
                        const contentMessages = [...messages];

                        // Add assistant message with tool calls to history
                        messages.push({
                            role: "assistant",
                            content: currentContent || null,
                            tool_calls: currentToolCalls,
                        });

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
                            mcpTools,
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
                                // Emit each generated suggestion as an early,
                                // id-less `suggestion` frame the moment the LLM
                                // finishes it — before the (slow) persistence —
                                // so the card renders immediately. The enriched
                                // frame flushed below carries the same `tempId`,
                                // letting the client upgrade the card in place.
                                GET_RECIPE_SUGGESTIONS: {
                                    onPartialSuggestion: (
                                        partial: PartialRecipeSuggestion
                                    ) => {
                                        writeSseEvent(res, {
                                            type: "suggestion",
                                            data: partial,
                                        });
                                    },
                                },
                            }
                        );

                        // Stream content in parallel (no tools — pure conversational response)
                        const contentStream = createChatCompletion(
                            contentMessages,
                            [],
                            {
                                stream: request.stream,
                                model: request.model,
                                temperature: request.temperature,
                            }
                        );

                        for await (const contentEvent of contentStream) {
                            if (contentEvent.type === "chunk") {
                                writeSseEvent(res, {
                                    type: "content",
                                    data: { delta: contentEvent.delta },
                                });
                            }
                        }

                        // Await tool results (may already be resolved)
                        const toolResults = await toolResultsPromise;

                        // Buffer suggestions from tool results
                        for (let i = 0; i < toolResults.length; i++) {
                            const toolResult = toolResults[i];
                            const toolCall = currentToolCalls[i];

                            if (
                                toolResult.role === "tool" &&
                                toolResult.content
                            ) {
                                try {
                                    const parsedResult = JSON.parse(
                                        toolResult.content
                                    );

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
