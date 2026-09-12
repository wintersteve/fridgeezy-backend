import { supabaseAdmin } from "@fridgeezy/supabase";

interface RecipeMetadata {
    units: Array<{ abbreviation: string; type: string }>;
    tags: Array<{ name: string; type: string }>;
}

/**
 * How long a cached copy is served before it is read again.
 *
 * Units and tags are reference data — a new tag arrives when a migration adds
 * one, which is not something a running Lambda has to notice within seconds.
 * Ten minutes is comfortably shorter than the interval at which the taxonomy
 * actually changes and comfortably longer than a warm execution environment's
 * idle window, so in practice a warm Lambda reads this once.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

let cached: { at: number; value: RecipeMetadata } | null = null;

/**
 * Fetches the units and tags every recipe prompt is built from.
 *
 * Two things here are load-bearing for LATENCY rather than correctness, and
 * both were measured against the deployed project:
 *
 * **The ordering must be total.** `.order("type")` alone leaves ties unordered,
 * so Postgres is free to return the 240 tags in a different order on each read
 * — and it does: six consecutive reads produced two distinct orderings. That
 * order is formatted straight into the system prompt, which is the ~3.6k-token
 * cacheable prefix every AI route shares, so a reshuffle misses OpenAI's prompt
 * cache completely. Measured on the promote prompt: **12.5s uncached against
 * 6.8s cached**, for a call whose output is identical either way. The second
 * `.order(...)` is what makes the prefix a stable string.
 *
 * Several prompts are built to put their volatile blocks last precisely so this
 * prefix can be cached; without a total order that whole design bought nothing.
 *
 * **The two reads are concurrent and then memoised.** They were sequential, and
 * this is reference data: ~465-760ms of serial waiting in front of every
 * generate, promote, modify, escalate, personalise, import and compose call,
 * re-paid on every request.
 */
export async function fetchRecipeMetadata(): Promise<RecipeMetadata> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const [unitsResult, tagsResult] = await Promise.all([
        supabaseAdmin
            .from("units")
            .select("abbreviation, type")
            .order("type")
            .order("abbreviation"),
        supabaseAdmin
            .from("tags")
            .select("name, type")
            .order("type")
            .order("name"),
    ]);

    if (unitsResult.error) {
        console.error("Error fetching units:", unitsResult.error);
        throw new Error(`Failed to fetch units: ${unitsResult.error.message}`);
    }

    if (tagsResult.error) {
        console.error("Error fetching tags:", tagsResult.error);
        throw new Error(`Failed to fetch tags: ${tagsResult.error.message}`);
    }

    const value: RecipeMetadata = {
        units: unitsResult.data ?? [],
        tags: tagsResult.data ?? [],
    };

    cached = { at: Date.now(), value };

    return value;
}

/**
 * Format units grouped by type for the prompt
 */
export function formatUnitsForPrompt(
    units: Array<{ abbreviation: string; type: string }>
): string {
    const grouped = units.reduce(
        (acc, unit) => {
            if (!acc[unit.type]) acc[unit.type] = [];
            acc[unit.type].push(unit.abbreviation);
            return acc;
        },
        {} as Record<string, string[]>
    );

    return Object.entries(grouped)
        .map(([type, abbrevs]) => `${type} units: ${abbrevs.join(", ")}`)
        .join("\n");
}

/**
 * Format tags grouped by type for the prompt
 */
export function formatTagsForPrompt(
    tags: Array<{ name: string; type: string }>
): string {
    const grouped = tags.reduce(
        (acc, tag) => {
            if (!acc[tag.type]) acc[tag.type] = [];
            acc[tag.type].push(tag.name);
            return acc;
        },
        {} as Record<string, string[]>
    );

    return Object.entries(grouped)
        .map(([type, names]) => `${type}: ${names.join(", ")}`)
        .join("\n\n");
}
