import { chatMessageText } from "@fridgeezy/schemas";
import type { ChatMessage, ToolCall } from "@fridgeezy/schemas";
import { canonicalizeName } from "@fridgeezy/toolkit";

/**
 * A memo of "which tool call does this opening message produce".
 *
 * The first model call of a chat turn is not writing anything the user reads. It
 * reads the message and fills in a fixed argument set — `query`, `dish`,
 * `component`, `ingredients`, `exclude` — and every one of those is a function
 * of the message text. "carbonara" resolves the same way for the thousandth
 * person to type it as it did for the first, and the popular dishes are by
 * definition the ones typed most, so the hit rate is highest exactly where the
 * traffic is.
 *
 * ## Only the FIRST turn is cacheable, and that is not a limitation to lift
 *
 * The routing prompt's whole job on a follow-up is to read the CONVERSATION:
 * resolve "it" against the dish suggested two turns ago, and add everything
 * already shown to `exclude`. Two users typing the same follow-up sentence into
 * different conversations must route differently, so a cache keyed on the
 * sentence would hand one user the other's context. `cacheKeyFor` returns null
 * the moment there is any assistant turn in the history, which is the only
 * condition under which the message is the entire input.
 *
 * ## Scope and lifetime
 *
 * Per execution environment, in memory, capped and TTL'd. There is no shared
 * store and there should not be one yet: this is a latency optimisation whose
 * value is unproven until `chat.routing_cache_hit` says otherwise, and a
 * process-local map costs nothing to remove. Nothing user-identifying is stored
 * — the key is the message text and the value is the model's reading of it.
 */

/** Entries are small; the cap is about bounding a long-lived Lambda, not memory pressure. */
const MAX_ENTRIES = 500;

/**
 * Long enough to cover a burst of people asking for the same thing, short enough
 * that a prompt change takes effect within one warm environment's lifetime
 * rather than being pinned by a cache nobody remembers exists.
 */
const TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
    toolCalls: ToolCall[];
    expiresAt: number;
}

/** Insertion-ordered, which is what makes the eviction below a true LRU-ish FIFO. */
const entries = new Map<string, CacheEntry>();

export interface RoutableMessage {
    role: string;
    /**
     * Widened with `ChatMessage.content` — a routable turn is always plain text
     * (a turn carrying a photograph is not cached at all, see `process-chat`),
     * but the type it is fed from no longer says so.
     */
    content: ChatMessage["content"];
}

/**
 * The cache key for this turn, or null when the turn is not cacheable.
 *
 * Null is returned for anything with conversational context — see the note
 * above — and for a message with no text to key on.
 */
export function cacheKeyFor(messages: RoutableMessage[]): string | null {
    const conversational = messages.filter((message) => message.role !== "system");

    // Exactly one turn, and it has to be the user's. Anything else means there
    // is history the routing model is expected to read.
    if (conversational.length !== 1) return null;

    const [only] = conversational;
    if (only.role !== "user") return null;

    const key = canonicalizeName(chatMessageText(only.content));

    return key || null;
}

export function readRoutingCache(key: string): ToolCall[] | null {
    const entry = entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
        entries.delete(key);

        return null;
    }

    // Refresh recency so a popular dish is not evicted by a long tail of one-offs.
    entries.delete(key);
    entries.set(key, entry);

    return entry.toolCalls;
}

export function writeRoutingCache(key: string, toolCalls: ToolCall[]): void {
    // A cached tool call is replayed with a FRESH id below; ids are correlation
    // handles for one request and reusing one across requests would put a
    // stranger's identifier into this turn's message history.
    entries.set(key, {
        toolCalls: toolCalls.map((call) => ({ ...call })),
        expiresAt: Date.now() + TTL_MS,
    });

    while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
    }
}

/**
 * A replayable copy of a cached tool call, with an id belonging to THIS request.
 *
 * The id ties an assistant `tool_calls` entry to its `tool` result inside one
 * message array. Replaying a stored id works by accident today (nothing checks
 * it across requests) and would break the moment anything correlated on it, so
 * the copy is minted fresh rather than trusted.
 */
export function replayToolCalls(toolCalls: ToolCall[], nonce: string): ToolCall[] {
    return toolCalls.map((call, index) => ({
        ...call,
        id: `cached_${nonce}_${index}`,
    }));
}

/** Exposed for tests and for the dev tooling; clears the process-local memo. */
export function clearRoutingCache(): void {
    entries.clear();
}
