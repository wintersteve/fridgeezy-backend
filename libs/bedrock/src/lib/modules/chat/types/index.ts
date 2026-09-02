import type { ChatMessage, ToolCall } from "@fridgeezy/schemas";

import type { ThinkingEffort, ThinkingType } from "../../completions/types";

/**
 * The provider-neutral chat event stream.
 *
 * Deliberately the shape the OpenAI chat path already emitted, for the same
 * reason `CompletionChunk` is OpenAI-shaped: `process-chat` branches on these
 * four variants, so a Bedrock adapter that produces them drops in without the
 * use case learning which provider answered.
 */
export type ChatStreamEvent =
    | { type: "chunk"; delta: string }
    | { type: "tool_calls"; tool_calls: ToolCall[] }
    | { type: "done"; finish_reason: string | null }
    | { type: "error"; error: string };

/**
 * A tool in OpenAI's function-calling shape — the form the app defines tools in
 * and the form `convert-tools-to-openai.ts` produces. `toAnthropicTools`
 * reshapes it rather than making call sites define tools twice.
 */
export interface OpenAiShapedTool {
    type: "function";
    function: {
        name: string;
        description?: string;
        /**
         * JSON Schema. Typed as a record rather than `unknown` because the
         * OpenAI SDK's `create` overloads require that shape, and widening it
         * here would force a cast at the call site instead.
         */
        parameters?: Record<string, unknown>;
    };
}

export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
}

export type AnthropicContentBlockParam =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; tool_use_id: string; content: string }
    /** A photograph on a user turn — see `toAnthropicImageBlock`. */
    | {
          type: "image";
          source:
              | { type: "url"; url: string }
              | { type: "base64"; media_type: string; data: string };
      };

export interface AnthropicMessage {
    role: "user" | "assistant";
    content: string | AnthropicContentBlockParam[];
}

/**
 * The result of splitting a `ChatMessage[]` for Anthropic: system turns are
 * lifted to a top-level field, everything else stays in order.
 */
export interface TranslatedConversation {
    system?: string;
    messages: AnthropicMessage[];
}

/**
 * Anthropic chat streaming events, narrowed to the fields this adapter reads.
 * Wider than `AnthropicStreamEvent` in the completions module because tool
 * calling adds content-block framing on top of plain text deltas.
 */
export interface AnthropicChatEvent {
    type: string;
    index?: number;
    content_block?: { type?: string; id?: string; name?: string };
    delta?: {
        type?: string;
        text?: string;
        partial_json?: string;
        stop_reason?: string | null;
    };
}

export interface BedrockChatParams {
    messages: ChatMessage[];
    tools?: OpenAiShapedTool[];
    /** Inference profile ID. Defaults to `BEDROCK_MODEL`. */
    model?: string;
    /** Bedrock requires an explicit output cap. */
    maxTokens?: number;
    temperature?: number;
    thinking?: ThinkingType;
    effort?: ThinkingEffort;
}
