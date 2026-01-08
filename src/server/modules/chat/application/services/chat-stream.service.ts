import OpenAI from "openai";
import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from "openai/resources/chat/completions";
import { z } from "zod/v4";

import {
    RecipeOutputSchema,
    SuggestionsOutputSchema,
} from "@/src/server/modules/chat/use-cases/chat";
import { persistGenerateRecipe } from "@/src/server/modules/recipes";
import { RecipeAccumulator } from "@/src/server/modules/recipes/domain";
import { fetchTagsCached } from "@/src/server/shared/tags";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ChatStreamEvent =
    | { type: "token"; content: string }
    | { type: "tool_call"; name: string; status: "started" | "completed" }
    | { type: "suggestions"; data: z.infer<typeof SuggestionsOutputSchema> }
    | {
          type: "recipe";
          data: z.infer<typeof RecipeOutputSchema>;
          saved: boolean;
      }
    | { type: "message"; data: string };

interface ToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export async function* createChatStreamHandler(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[]
): AsyncGenerator<ChatStreamEvent> {
    const stream = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages,
        tools,
        stream: true,
        stream_options: { include_usage: true },
    });

    let accumulatedContent = "";
    const toolCallsMap = new Map<number, ToolCall>();

    // Stream tokens and accumulate tool calls
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Stream text tokens
        if (delta?.content) {
            accumulatedContent += delta.content;
            yield { type: "token", content: delta.content };
        }

        // Accumulate tool call chunks
        if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;
                const existing = toolCallsMap.get(index) || {
                    id: "",
                    type: "function" as const,
                    function: { name: "", arguments: "" },
                };

                if (toolCallDelta.id) existing.id = toolCallDelta.id;
                if (toolCallDelta.function?.name) {
                    existing.function.name = toolCallDelta.function.name;
                }
                if (toolCallDelta.function?.arguments) {
                    existing.function.arguments +=
                        toolCallDelta.function.arguments;
                }

                toolCallsMap.set(index, existing);
            }
        }
    }

    // If tool calls detected, execute them
    if (toolCallsMap.size > 0) {
        const toolCalls = Array.from(toolCallsMap.values());
        const toolCall = toolCalls[0]; // Process first tool call

        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        yield { type: "tool_call", name: toolName, status: "started" };

        if (toolName === "GET_TAGS") {
            // Real tool - execute and continue conversation
            const tags = await fetchTagsCached();
            yield { type: "tool_call", name: toolName, status: "completed" };

            // Add assistant message with tool call
            messages.push({
                role: "assistant",
                content: null,
                tool_calls: toolCalls,
            });

            // Add tool result
            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(tags),
            });

            // Continue conversation with recursive call
            yield* createChatStreamHandler(messages, tools);
        } else if (toolName === "SUGGEST_RECIPES") {
            // Structured output - return immediately
            const suggestions = SuggestionsOutputSchema.parse(args);
            yield { type: "tool_call", name: toolName, status: "completed" };
            yield { type: "suggestions", data: suggestions };
            return;
        } else if (toolName === "GENERATE_RECIPE") {
            // Structured output - save and return
            const recipe = RecipeOutputSchema.parse(args);
            yield { type: "tool_call", name: toolName, status: "completed" };

            await persistGenerateRecipe(recipe as unknown as RecipeAccumulator);
            yield { type: "recipe", data: recipe, saved: true };
            return;
        }
    } else if (accumulatedContent) {
        // If no tools or after tool completion, return message
        yield { type: "message", data: accumulatedContent };
    }
}
