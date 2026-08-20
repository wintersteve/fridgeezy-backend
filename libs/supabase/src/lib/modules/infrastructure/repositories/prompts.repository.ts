import { supabaseAdmin } from "../../client";

/**
 * Which surface a prompt was typed into.
 *
 * Mirrors the check constraint on `profile_prompts.surface` (`20260822000004`)
 * and `PromptSurfaceSchema` in `@fridgeezy/schemas`. The constraint is the one
 * that actually holds — a value added here without a migration fails at the
 * insert rather than at compile time.
 *
 * Declared here rather than imported from `@fridgeezy/schemas` because this
 * library does not depend on that one, and the dependency would run the wrong
 * way: schemas is the client-facing contract, this is the database seam.
 * `profile_taste_signals`' `TasteSignalKind` sits in the same position next
 * door.
 */
export type PromptSurface = "chat" | "recipe_chat" | "recipe_modify";

/**
 * Prompt-history reads and writes.
 *
 * Deliberately not built on a `@fridgeezy/domain` interface, for the same
 * reason `taste-signals.repository.ts` and `entitlements.repository.ts` are
 * not: those six domain repositories model food and are consumed by a pipeline
 * that benefits from the seam. This is one table whose readers and writers are
 * all in the API. Promote it if a second consumer appears.
 *
 * Every function here throws on failure. The decision to swallow that is taken
 * one layer up, per call site — see `recordPrompt` in the API's
 * `record-prompt.ts`, which never throws because its callers are stream
 * handlers mid-model-call, against the REST use cases, which report it.
 */

/** One row as it comes back from the table, with the dish name joined on. */
export interface PromptHistoryRow {
    id: string;
    surface: PromptSurface;
    prompt: string;
    recipeId: string | null;
    recipeName: string | null;
    conversationId: string | null;
    createdAt: string;
}

export interface RecordPromptInput {
    surface: PromptSurface;
    prompt: string;
    /** Required for the two recipe-scoped surfaces, forbidden for `chat`. */
    recipeId?: string | null;
    conversationId?: string | null;
}

/**
 * PostgREST embed for the dish name.
 *
 * Disambiguated by the FK name rather than written as a bare `recipes(name)`:
 * `profile_prompts_recipe_id_fkey` resolves to BOTH `recipes` and the
 * `recipe_dietary` view (both appear under that name in the generated
 * relationships), and an ambiguous embed is a 300 at request time rather than
 * anything that fails to build.
 */
const SELECT_WITH_RECIPE =
    "id, surface, prompt, recipe_id, conversation_id, created_at, recipes!profile_prompts_recipe_id_fkey(name)";

interface RawPromptRow {
    id: string;
    surface: string;
    prompt: string;
    recipe_id: string | null;
    conversation_id: string | null;
    created_at: string;
    recipes: { name: string } | { name: string }[] | null;
}

const toRow = (raw: RawPromptRow): PromptHistoryRow => ({
    id: raw.id,
    surface: raw.surface as PromptSurface,
    prompt: raw.prompt,
    recipeId: raw.recipe_id,
    // PostgREST types a to-one embed as an object, but returns an array shape
    // through some client versions; normalised here so one wobble in the client
    // library cannot reach the wire schema.
    recipeName: Array.isArray(raw.recipes)
        ? (raw.recipes[0]?.name ?? null)
        : (raw.recipes?.name ?? null),
    conversationId: raw.conversation_id,
    createdAt: raw.created_at,
});

/**
 * Append one prompt to a profile's history.
 *
 * Goes through the `record_prompt` RPC rather than a plain `.insert()` because
 * the write is append-AND-PRUNE: the retention cap has to be applied in the
 * same statement as the insert, or a crash between the two grows the table
 * without bound. See the migration for why the cap lives in the writer.
 *
 * Returns null for a prompt that was only whitespace — the RPC's own answer,
 * not an error. Note the RPC TRUNCATES an over-long prompt rather than
 * rejecting it, which is what the auto-capture path wants: a request whose
 * model call already succeeded must not fail on its bookkeeping.
 */
export async function persistPrompt(
    profileId: string,
    { surface, prompt, recipeId, conversationId }: RecordPromptInput
): Promise<PromptHistoryRow | null> {
    const { data, error } = await supabaseAdmin
        .rpc("record_prompt", {
            p_profile_id: profileId,
            p_surface: surface,
            p_prompt: prompt,
            p_recipe_id: recipeId ?? undefined,
            p_conversation_id: conversationId ?? undefined,
        })
        .select(SELECT_WITH_RECIPE)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to record prompt: ${error.message}`);
    }

    return data ? toRow(data as unknown as RawPromptRow) : null;
}

export interface ListPromptsOptions {
    surface?: PromptSurface;
    recipeId?: string;
    conversationId?: string;
    limit: number;
    /** Keyset cursor: only entries strictly older than this. */
    before?: string;
}

/**
 * A page of this profile's history, newest first.
 *
 * Keyset-paginated on `created_at` rather than offset-paginated, because the
 * table is written while it is being read: a chat turn landing between two
 * pages of an offset scan shifts every subsequent row and the client renders
 * one entry twice.
 *
 * `created_at` defaults to `clock_timestamp()` precisely so that ordering is a
 * total one in practice (see the migration). Two rows sharing a microsecond
 * across concurrent transactions remains theoretically possible, and would drop
 * one entry at a page boundary; that is accepted rather than paid for with a
 * composite cursor the client would have to carry opaquely.
 */
export async function listPrompts(
    profileId: string,
    { surface, recipeId, conversationId, limit, before }: ListPromptsOptions
): Promise<PromptHistoryRow[]> {
    let query = supabaseAdmin
        .from("profile_prompts")
        .select(SELECT_WITH_RECIPE)
        .eq("profile_id", profileId);

    if (surface) query = query.eq("surface", surface);
    if (recipeId) query = query.eq("recipe_id", recipeId);
    if (conversationId) query = query.eq("conversation_id", conversationId);
    if (before) query = query.lt("created_at", before);

    const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to read prompt history: ${error.message}`);
    }

    return (data ?? []).map((raw) => toRow(raw as unknown as RawPromptRow));
}

export interface DeletePromptsFilters {
    surface?: PromptSurface;
    recipeId?: string;
    conversationId?: string;
}

/**
 * Forget a slice of this profile's history, returning how many entries went.
 *
 * **Always scoped to `profileId` first**, and every filter narrows from there.
 * An empty filter set means "all of this profile's history" and never "all
 * history" — which is the one way this function could be catastrophic, so the
 * profile predicate is applied before the filters are even looked at rather
 * than being one optional `.eq()` among several.
 */
export async function deletePrompts(
    profileId: string,
    { surface, recipeId, conversationId }: DeletePromptsFilters
): Promise<number> {
    let query = supabaseAdmin
        .from("profile_prompts")
        .delete()
        .eq("profile_id", profileId);

    if (surface) query = query.eq("surface", surface);
    if (recipeId) query = query.eq("recipe_id", recipeId);
    if (conversationId) query = query.eq("conversation_id", conversationId);

    const { data, error } = await query.select("id");

    if (error) {
        throw new Error(`Failed to delete prompt history: ${error.message}`);
    }

    return data?.length ?? 0;
}

/**
 * Forget one entry.
 *
 * Returns false when the id does not exist OR belongs to somebody else — the
 * two are deliberately indistinguishable, the same way `callerMayReadRecipe`
 * folds refusal into not-found, so that a caller cannot probe whether a given
 * prompt id exists.
 */
export async function deletePromptById(
    profileId: string,
    id: string
): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from("profile_prompts")
        .delete()
        .eq("profile_id", profileId)
        .eq("id", id)
        .select("id");

    if (error) {
        throw new Error(`Failed to delete prompt: ${error.message}`);
    }

    return (data?.length ?? 0) > 0;
}
