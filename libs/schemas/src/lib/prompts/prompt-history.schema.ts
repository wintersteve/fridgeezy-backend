import { z } from "zod/v4";

/**
 * Which surface a prompt was typed into.
 *
 * Mirrors the check constraint on `profile_prompts.surface`
 * (`20260822000004`) — the two must agree, and the constraint is the one that
 * actually holds, so a value added here without a migration fails at the insert
 * rather than at compile time.
 *
 * - `chat`          — the general assistant, `POST /rest/chat`. Not about any
 *                     one dish, and the only surface whose `recipeId` is null.
 * - `recipe_chat`   — `POST /rest/recipes/:recipeId/chat`, including cook mode.
 *                     Cook mode is the same endpoint with a `focusedStep`, and
 *                     is deliberately not its own surface: a question asked
 *                     standing at the hob is still a question about that dish,
 *                     and splitting them would give the recipe screen two lists
 *                     to merge.
 * - `recipe_modify` — the instruction sent to `POST /rest/recipes/modify`,
 *                     whether typed directly or extracted from a chat turn the
 *                     model classified as a modification.
 */
export const PromptSurfaceSchema = z.enum([
    "chat",
    "recipe_chat",
    "recipe_modify",
]);

/**
 * The cap enforced by `profile_prompts_prompt_check` and applied by
 * `record_prompt`, which truncates rather than rejects.
 *
 * Validated here too so an over-long prompt is a 400 the client can act on at
 * the one call site that sends prompts deliberately
 * (`POST /rest/prompts`), rather than a silent truncation. The
 * auto-capture path does NOT go through this schema and keeps the truncating
 * behaviour on purpose — see `recordPrompt`.
 */
export const PROMPT_MAX_LENGTH = 2000;

/**
 * One entry in a cook's prompt history, as it goes over the wire.
 *
 * camelCase, like every other response shape here; the table is snake_case and
 * the repository maps between them.
 */
export const PromptHistoryEntrySchema = z.object({
    id: z.uuid(),
    surface: PromptSurfaceSchema,
    /** The prompt as typed — not canonicalised, not shortened to a label. */
    prompt: z.string(),
    /**
     * The dish this was typed at. Null exactly when `surface` is `chat`, an
     * invariant the database holds rather than trusting callers with
     * (`profile_prompts_recipe_scope_check`).
     */
    recipeId: z.uuid().nullable(),
    /**
     * The dish's name at read time, resolved through the join rather than
     * snapshotted. A history row is only reachable while its recipe exists —
     * the FK cascades — so there is no dangling case to snapshot against, and a
     * renamed dish should read under its current name.
     */
    recipeName: z.string().nullable(),
    /** Groups the turns of one conversation. Client-generated; null for a modify. */
    conversationId: z.uuid().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
});

/**
 * `POST /rest/prompts` — record one prompt the API did not otherwise see.
 *
 * **Most prompts must NOT be sent here.** `POST /chat`,
 * `POST /recipes/:id/chat` and `POST /recipes/modify` already record their own
 * turn server-side as it passes, because the API is holding the text anyway and
 * a capture the client can forget is a capture that goes missing. This endpoint
 * exists for prompts that never reach one of those routes — a turn abandoned
 * before it was sent, or a future surface that talks to something other than
 * this API. Calling it for a prompt one of those three routes already carried
 * writes the row twice.
 */
export const RecordPromptRequestSchema = z
    .object({
        surface: PromptSurfaceSchema,
        prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH),
        recipeId: z.uuid().optional(),
        conversationId: z.uuid().optional(),
    })
    /**
     * The same rule `profile_prompts_recipe_scope_check` enforces, checked here
     * so it is a 400 naming the field rather than a 500 carrying a Postgres
     * constraint name. The database still holds it — this is the friendly copy,
     * not the enforcement.
     */
    .refine((body) => (body.surface === "chat") === (body.recipeId === undefined), {
        error: "recipeId is required for recipe_chat and recipe_modify, and must be omitted for chat",
        path: ["recipeId"],
    });

export const RecordPromptResponseSchema = z.object({
    entry: PromptHistoryEntrySchema,
});

/**
 * `GET /rest/prompts` — the caller's own history, newest first.
 *
 * Every field is optional, so a bare `GET /rest/prompts` is the whole-history
 * read. Parsed from the query string, hence the coercion on `limit`.
 */
export const ListPromptsRequestSchema = z.object({
    /** Narrow to one surface. Omit for everything. */
    surface: PromptSurfaceSchema.optional(),
    /** Narrow to one dish — the recipe screen's own history. */
    recipeId: z.uuid().optional(),
    /** Narrow to one thread. */
    conversationId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /**
     * Cursor: return only entries older than this timestamp. Taken from the
     * `createdAt` of the last entry of the previous page.
     *
     * Keyset rather than an offset because this table is written while it is
     * being read — a chat turn landing between two pages of an offset scan
     * shifts every subsequent row and the client sees one entry twice.
     */
    before: z.iso.datetime({ offset: true }).optional(),
});

export const ListPromptsResponseSchema = z.object({
    entries: z.array(PromptHistoryEntrySchema),
    /**
     * The cursor to pass as `before` for the next page, or null at the end.
     *
     * Sent rather than left for the client to derive from the last entry, so
     * "there is no more" is stated once by the server instead of inferred from
     * a short page — a full final page is indistinguishable from a full
     * non-final one.
     */
    nextCursor: z.string().nullable(),
});

/**
 * `DELETE /rest/prompts` — forget a whole slice of history.
 *
 * Every filter optional, and an empty body means "forget all of it". That is
 * deliberate rather than an oversight guarded by a required confirm flag: the
 * destructive-by-default read is the one the user asked for when they tapped
 * "clear history", and the confirmation belongs in the UI, not in the wire
 * format.
 */
export const DeletePromptsRequestSchema = z.object({
    surface: PromptSurfaceSchema.optional(),
    recipeId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
});

export const DeletePromptsResponseSchema = z.object({
    /** How many entries were forgotten. */
    deleted: z.number().int().nonnegative(),
});

export type PromptSurface = z.infer<typeof PromptSurfaceSchema>;
export type PromptHistoryEntryDto = z.infer<typeof PromptHistoryEntrySchema>;
export type RecordPromptRequestDto = z.infer<typeof RecordPromptRequestSchema>;
export type RecordPromptResponseDto = z.infer<typeof RecordPromptResponseSchema>;
export type ListPromptsRequestDto = z.infer<typeof ListPromptsRequestSchema>;
export type ListPromptsResponseDto = z.infer<typeof ListPromptsResponseSchema>;
export type DeletePromptsRequestDto = z.infer<typeof DeletePromptsRequestSchema>;
export type DeletePromptsResponseDto = z.infer<typeof DeletePromptsResponseSchema>;
