import { ChatRequestSchema } from "@fridgeezy/schemas";
import type { Request, Response } from "express";

import { getRecipeSuggestionsTool } from "../../../mcp/tools";
import {
    convertMcpToolsToOpenAiTools,
    createChatCompletion,
    handleToolCalls,
} from "../../services";

/**
 * SSE helper to write Server-Sent Events
 */
function writeSseEvent(
    res: Response,
    event: { type: string; data?: any }
): void {
    res.write(`event: ${event.type}\n`);
    if (event.data !== undefined) {
        res.write(`data: ${JSON.stringify(event.data)}\n`);
    }
    res.write("\n");
}

/**
 * Initialize SSE stream with proper headers
 */
function initSseStream(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * End SSE stream
 */
function endSseStream(res: Response): void {
    writeSseEvent(res, { type: "end" });
    res.end();
}

/**
 * Parse JSON body from request
 */
async function parseJsonBody(req: Request): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

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
                            mcpTools
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
