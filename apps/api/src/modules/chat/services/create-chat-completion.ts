import { openai } from "@fridgeezy/openai";
import type { ChatMessage } from "@fridgeezy/schemas";
import type OpenAI from "openai";

export interface ChatCompletionOptions {
    stream: boolean;
    model: string;
    temperature?: number;
}

export type ChatStreamEvent =
    | { type: "chunk"; delta: string }
    | { type: "tool_calls"; tool_calls: any[] }
    | { type: "done"; finish_reason: string | null }
    | { type: "error"; error: string };

/**
 * Create a chat completion with OpenAI, supporting streaming and tool calls
 */
export async function* createChatCompletion(
    messages: ChatMessage[],
    tools: OpenAI.ChatCompletionTool[],
    options: ChatCompletionOptions
): AsyncGenerator<ChatStreamEvent> {
    try {
        const { stream, model, temperature = 0.7 } = options;

        // Convert our ChatMessage format to OpenAI format
        const openaiMessages = messages.map((msg) => {
            if (msg.role === "tool") {
                return {
                    role: "tool" as const,
                    content: msg.content || "",
                    tool_call_id: msg.tool_call_id || "",
                };
            }

            if (msg.tool_calls) {
                return {
                    role: msg.role as "assistant",
                    content: msg.content,
                    tool_calls: msg.tool_calls.map((tc) => ({
                        id: tc.id,
                        type: "function" as const,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        },
                    })),
                };
            }

            return {
                role: msg.role as "system" | "user" | "assistant",
                content: msg.content || "",
            };
        });

        if (stream) {
            // Streaming mode
            const completion = await openai.chat.completions.create({
                model,
                messages: openaiMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature,
                stream: true,
            });

            const accumulatedToolCalls: any[] = [];

            for await (const chunk of completion) {
                const choice = chunk.choices[0];

                if (!choice) continue;

                // Handle content delta
                if (choice.delta?.content) {
                    yield {
                        type: "chunk",
                        delta: choice.delta.content,
                    };
                }

                // Accumulate tool calls
                if (choice.delta?.tool_calls) {
                    for (const toolCallDelta of choice.delta.tool_calls) {
                        const index = toolCallDelta.index;

                        if (!accumulatedToolCalls[index]) {
                            accumulatedToolCalls[index] = {
                                id: toolCallDelta.id || "",
                                type: "function",
                                function: {
                                    name: toolCallDelta.function?.name || "",
                                    arguments: toolCallDelta.function?.arguments || "",
                                },
                            };
                        } else {
                            if (toolCallDelta.function?.name) {
                                accumulatedToolCalls[index].function.name +=
                                    toolCallDelta.function.name;
                            }
                            if (toolCallDelta.function?.arguments) {
                                accumulatedToolCalls[index].function.arguments +=
                                    toolCallDelta.function.arguments;
                            }
                        }
                    }
                }

                // Handle finish reason
                if (choice.finish_reason) {
                    if (choice.finish_reason === "tool_calls") {
                        yield {
                            type: "tool_calls",
                            tool_calls: accumulatedToolCalls.filter(Boolean),
                        };
                    }

                    yield {
                        type: "done",
                        finish_reason: choice.finish_reason,
                    };
                }
            }
        } else {
            // Non-streaming mode
            const completion = await openai.chat.completions.create({
                model,
                messages: openaiMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature,
                stream: false,
            });

            const choice = completion.choices[0];

            if (choice.message.content) {
                yield {
                    type: "chunk",
                    delta: choice.message.content,
                };
            }

            if (choice.message.tool_calls) {
                yield {
                    type: "tool_calls",
                    tool_calls: choice.message.tool_calls,
                };
            }

            yield {
                type: "done",
                finish_reason: choice.finish_reason,
            };
        }
    } catch (error) {
        console.error("[CreateChatCompletion] Error:", error);
        yield {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
