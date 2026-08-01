import type {
    OpenAiShapedTool,
    ThinkingEffort,
    ThinkingType,
} from "@fridgeezy/bedrock";
import type { ChatMessage } from "@fridgeezy/schemas";

import type { ModelSelection, TokenLimit } from "../../completions/types";
import type { LlmProvider } from "../../provider";

export type { ChatStreamEvent, OpenAiShapedTool } from "@fridgeezy/bedrock";

export interface GenerateChatStreamParams {
    /** Full conversation, including tool results, in OpenAI's message shape. */
    messages: ChatMessage[];
    /**
     * Tools in OpenAI's function-calling shape. The Bedrock branch reshapes
     * them, so call sites define a tool once and neither provider leaks in.
     */
    tools?: OpenAiShapedTool[];
    model: ModelSelection;
    /** Overrides {@link resolveProvider} for this call — used to A/B the two. */
    provider?: LlmProvider;
    /**
     * Applies to both providers here, unlike `generateStream`. Bedrock requires
     * a cap, and chat is the one path where OpenAI is already given explicit
     * options, so honouring it costs nothing and keeps the two comparable.
     */
    maxTokens?: TokenLimit;
    temperature?: number;
    /** Bedrock only; ignored on OpenAI. */
    thinking?: ThinkingType;
    /** Bedrock only; ignored on OpenAI. */
    effort?: ThinkingEffort;
}
